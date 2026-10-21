import { Readable, Transform, pipeline } from "node:stream";
import { createGunzip } from "node:zlib";
import tar from "tar-stream";
import {
  GitHubFetchError,
  GitHubRateLimitError,
  RepoNotFoundError,
  RepoTooLargeError,
} from "./errors";
import { looksMinified, skipReasonForContent, skipReasonForPath } from "./filter";
import { tarballUrl } from "./github";
import type { IngestLimits, ProgressCallback, RepoFile, RepoRef, SkipReason } from "./types";

export interface ExtractResult {
  files: RepoFile[];
  skippedByReason: Partial<Record<SkipReason, number>>;
  skippedCount: number;
  /** True when a limit stopped extraction early. */
  truncated: boolean;
  /** Top-level directory of the archive, `owner-repo-<sha>` for GitHub. */
  rootDir: string | null;
}

function bump(counts: Partial<Record<SkipReason, number>>, reason: SkipReason): void {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

/** Decide whether a file's bytes are kept, returning text or the reason it is skipped. */
export function decodeFile(
  path: string,
  bytes: Uint8Array,
  limits: Pick<IngestLimits, "maxFileBytes">,
): { text: string } | { skip: SkipReason } {
  const reason = skipReasonForContent(bytes, limits);
  if (reason) return { skip: reason };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { skip: "binary-content" };
  }
  if (looksMinified(text)) return { skip: "minified" };
  if (text.trim().length === 0) return { skip: "empty" };
  return { text };
}

/**
 * Read a gzipped tarball stream into text files, applying the filters and limits.
 * Never holds more than `maxTotalBytes` of file text.
 */
export async function extractTarball(
  source: Readable,
  limits: IngestLimits,
  onProgress?: ProgressCallback,
): Promise<ExtractResult> {
  const files: RepoFile[] = [];
  const skippedByReason: Partial<Record<SkipReason, number>> = {};
  let skippedCount = 0;
  let totalBytes = 0;
  let truncated = false;
  let rootDir: string | null = null;
  let compressed = 0;
  let fatal: Error | null = null;

  const skip = (reason: SkipReason): void => {
    bump(skippedByReason, reason);
    skippedCount++;
  };

  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      compressed += chunk.length;
      if (compressed > limits.maxTarballBytes) {
        fatal = new RepoTooLargeError(limits.maxTarballBytes);
        cb(fatal);
      } else {
        cb(null, chunk);
      }
    },
  });

  const extract = tar.extract();
  const done = new Promise<void>((resolve, reject) => {
    pipeline(source, counter, createGunzip(), extract, (err) => (err ? reject(err) : resolve()));
  });
  done.catch(() => undefined); // surfaced below, once the entries stop

  try {
    for await (const entry of extract) {
      const { header } = entry;
      const full = header.name.replace(/^\.\//, "");
      const slash = full.indexOf("/");
      if (rootDir === null && slash > 0) rootDir = full.slice(0, slash);
      const rel = slash >= 0 ? full.slice(slash + 1) : "";

      if (header.type !== "file" || !rel) {
        entry.resume();
        continue;
      }
      const pathReason = skipReasonForPath(rel);
      if (pathReason) {
        skip(pathReason);
        entry.resume();
        continue;
      }
      if ((header.size ?? 0) > limits.maxFileBytes) {
        skip("too-large");
        entry.resume();
        continue;
      }
      if (files.length >= limits.maxFiles) {
        skip("over-file-limit");
        truncated = true;
        entry.resume();
        break;
      }

      const parts: Buffer[] = [];
      for await (const part of entry) parts.push(part as Buffer);
      const decoded = decodeFile(rel, Buffer.concat(parts), limits);
      if ("skip" in decoded) {
        skip(decoded.skip);
        continue;
      }
      if (totalBytes + decoded.text.length > limits.maxTotalBytes) {
        skip("over-size-budget");
        truncated = true;
        break;
      }
      totalBytes += decoded.text.length;
      files.push({ path: rel, text: decoded.text });
      if (files.length % 200 === 0) {
        onProgress?.({
          phase: "extract",
          message: `Read ${files.length} files`,
          filesKept: files.length,
          filesSkipped: skippedCount,
        });
      }
    }
  } catch (err) {
    if (fatal) throw fatal;
    throw err;
  } finally {
    if (truncated) {
      source.destroy();
      extract.destroy();
    }
  }
  if (fatal) throw fatal;
  if (!truncated) await done;
  return { files, skippedByReason, skippedCount, truncated, rootDir };
}

export interface FetchOptions {
  token?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  limits: Pick<IngestLimits, "maxTarballBytes">;
}

/** Download a repo tarball from the GitHub API, translating failures into typed errors. */
export async function fetchRepoTarball(ref: RepoRef, opts: FetchOptions): Promise<Readable> {
  const doFetch = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "repolens",
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const res = await doFetch(tarballUrl(ref), { headers, redirect: "follow", signal: opts.signal ?? null });

  if (res.status === 404) throw new RepoNotFoundError(`${ref.owner}/${ref.repo}`);
  if (res.status === 429 || res.status === 403) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    const retryAfter = res.headers.get("retry-after");
    const body = await res.text().catch(() => "");
    if (remaining === "0" || retryAfter || /rate limit/i.test(body)) {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      const resetAt = Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : null;
      throw new GitHubRateLimitError(resetAt);
    }
    throw new GitHubFetchError(res.status, body.slice(0, 200) || "forbidden");
  }
  if (!res.ok) throw new GitHubFetchError(res.status, (await res.text().catch(() => "")).slice(0, 200));

  const length = Number(res.headers.get("content-length"));
  if (Number.isFinite(length) && length > opts.limits.maxTarballBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new RepoTooLargeError(opts.limits.maxTarballBytes);
  }
  if (!res.body) throw new GitHubFetchError(res.status, "empty response body");
  return Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>);
}
