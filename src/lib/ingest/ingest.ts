import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ChunkOptions } from "./chunk";
import { parseRepoUrl } from "./github";
import { buildRepoIndex, type RepoIndex } from "./repo-index";
import { decodeFile, extractTarball, fetchRepoTarball, type ExtractResult } from "./tarball";
import { skipReasonForPath } from "./filter";
import {
  DEFAULT_LIMITS,
  type IngestLimits,
  type ProgressCallback,
  type RepoFile,
  type RepoRef,
  type SkipReason,
} from "./types";

export interface IngestOptions {
  limits?: Partial<IngestLimits>;
  chunk?: Partial<ChunkOptions>;
  /** GitHub token. Raises the API rate limit from 60 to 5000 requests an hour. */
  token?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
}

/** Fetch a public GitHub repo and build a searchable index of it. */
export async function ingestRepo(input: string | RepoRef, options: IngestOptions = {}): Promise<RepoIndex> {
  const started = Date.now();
  const ref = typeof input === "string" ? parseRepoUrl(input) : input;
  const limits = { ...DEFAULT_LIMITS, ...options.limits };

  options.onProgress?.({ phase: "download", message: `Downloading ${ref.owner}/${ref.repo}` });
  const body = await fetchRepoTarball(ref, {
    limits,
    ...(options.token ? { token: options.token } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const extracted = await extractTarball(body, limits, options.onProgress);

  // GitHub names the root directory owner-repo-<short sha>.
  const sha = extracted.rootDir ? /-([0-9a-f]{7,40})$/.exec(extracted.rootDir)?.[1] : undefined;
  return buildFromExtract(ref, extracted, started, options, sha);
}

async function buildFromExtract(
  ref: RepoRef,
  extracted: ExtractResult,
  started: number,
  options: IngestOptions,
  sha?: string,
): Promise<RepoIndex> {
  return buildRepoIndex({
    files: extracted.files,
    repo: sha ? { ...ref, sha } : ref,
    skippedByReason: extracted.skippedByReason,
    skippedCount: extracted.skippedCount,
    truncated: extracted.truncated,
    startedAt: started,
    ...(options.chunk ? { chunk: options.chunk } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
}

/** Read a local directory with the same filters used for GitHub archives. Used by tests and the eval runner. */
export async function readLocalDir(
  root: string,
  limitsIn: Partial<IngestLimits> = {},
): Promise<Pick<ExtractResult, "files" | "skippedByReason" | "skippedCount" | "truncated">> {
  const limits = { ...DEFAULT_LIMITS, ...limitsIn };
  const files: RepoFile[] = [];
  const skippedByReason: Partial<Record<SkipReason, number>> = {};
  let skippedCount = 0;
  let truncated = false;
  let totalBytes = 0;

  const skip = (r: SkipReason): void => {
    skippedByReason[r] = (skippedByReason[r] ?? 0) + 1;
    skippedCount++;
  };

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      if (truncated) return;
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (e.isDirectory()) {
        if (e.name === ".git") continue;
        // Check the directory itself by testing a file path beneath it.
        if (skipReasonForPath(`${rel}/x`) === "ignored-dir") {
          skip("ignored-dir");
          continue;
        }
        await walk(abs);
      } else if (e.isFile()) {
        const reason = skipReasonForPath(rel);
        if (reason) {
          skip(reason);
          continue;
        }
        if ((await stat(abs)).size > limits.maxFileBytes) {
          skip("too-large");
          continue;
        }
        if (files.length >= limits.maxFiles) {
          skip("over-file-limit");
          truncated = true;
          return;
        }
        const decoded = decodeFile(rel, await readFile(abs), limits);
        if ("skip" in decoded) {
          skip(decoded.skip);
          continue;
        }
        if (totalBytes + decoded.text.length > limits.maxTotalBytes) {
          skip("over-size-budget");
          truncated = true;
          return;
        }
        totalBytes += decoded.text.length;
        files.push({ path: rel, text: decoded.text });
      }
    }
  }

  await walk(root);
  return { files, skippedByReason, skippedCount, truncated };
}

/** Index a local directory. */
export async function ingestDir(
  root: string,
  repo: RepoRef = { owner: "local", repo: path.basename(path.resolve(root)) },
  options: IngestOptions = {},
): Promise<RepoIndex> {
  const started = Date.now();
  const read = await readLocalDir(root, options.limits);
  return buildRepoIndex({
    files: read.files,
    repo,
    skippedByReason: read.skippedByReason,
    skippedCount: read.skippedCount,
    truncated: read.truncated,
    startedAt: started,
    ...(options.chunk ? { chunk: options.chunk } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
}
