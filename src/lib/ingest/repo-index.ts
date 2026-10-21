import { Bm25, type SerializedBm25 } from "./bm25";
import { chunkFile, type ChunkOptions, DEFAULT_CHUNK_OPTIONS } from "./chunk";
import { detectLanguage } from "./language";
import type { Chunk, IndexStats, ProgressCallback, RepoFile, RepoRef, SkipReason } from "./types";

export const INDEX_VERSION = 1;

export interface IndexedFile {
  path: string;
  language: string | null;
  lines: number;
}

export interface RepoIndex {
  version: typeof INDEX_VERSION;
  repo: RepoRef & { sha?: string };
  createdAt: string;
  stats: IndexStats;
  files: IndexedFile[];
  chunks: Chunk[];
  bm25: SerializedBm25;
}

export interface BuildInput {
  files: RepoFile[];
  repo: RepoRef & { sha?: string };
  skippedByReason?: Partial<Record<SkipReason, number>>;
  skippedCount?: number;
  truncated?: boolean;
  startedAt?: number;
  chunk?: Partial<ChunkOptions>;
  onProgress?: ProgressCallback;
}

/** The text BM25 sees for a chunk: path and symbol names count as well as the code. */
export function searchText(c: Chunk): string {
  return `${c.path}\n${c.symbols.join(" ")}\n${c.text}`;
}

export async function buildRepoIndex(input: BuildInput): Promise<RepoIndex> {
  const started = input.startedAt ?? Date.now();
  const options = { ...DEFAULT_CHUNK_OPTIONS, ...input.chunk };
  const files = [...input.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const chunks: Chunk[] = [];
  const indexed: IndexedFile[] = [];
  let bytes = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const pieces = await chunkFile(file, options);
    if (pieces.length === 0) continue;
    chunks.push(...pieces);
    bytes += file.text.length;
    indexed.push({ path: file.path, language: detectLanguage(file.path), lines: pieces[pieces.length - 1]!.endLine });
    if ((i + 1) % 200 === 0) {
      input.onProgress?.({ phase: "chunk", message: `Chunked ${i + 1} of ${files.length} files`, filesKept: files.length });
    }
  }

  input.onProgress?.({ phase: "index", message: `Indexing ${chunks.length} chunks`, filesKept: indexed.length });
  const bm25 = Bm25.build(chunks.map(searchText));

  const stats: IndexStats = {
    filesKept: indexed.length,
    filesSkipped: input.skippedCount ?? 0,
    skippedByReason: input.skippedByReason ?? {},
    chunks: chunks.length,
    bytes,
    truncated: input.truncated ?? false,
    durationMs: Date.now() - started,
  };
  input.onProgress?.({ phase: "done", message: "Index ready", filesKept: stats.filesKept, filesSkipped: stats.filesSkipped });

  return {
    version: INDEX_VERSION,
    repo: input.repo,
    createdAt: new Date().toISOString(),
    stats,
    files: indexed,
    chunks,
    bm25: bm25.serialize(),
  };
}

export function serializeIndex(index: RepoIndex): string {
  return JSON.stringify(index);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Parse and sanity-check a stored index. Throws on anything that does not look like one. */
export function parseIndex(json: string): RepoIndex {
  const data: unknown = JSON.parse(json);
  if (!isObject(data) || data.version !== INDEX_VERSION) throw new Error("Unsupported or corrupt index file");
  if (!Array.isArray(data.chunks) || !Array.isArray(data.files) || !isObject(data.bm25) || !isObject(data.repo)) {
    throw new Error("Index file is missing required fields");
  }
  const docLens = (data.bm25 as { docLens?: unknown }).docLens;
  if (!Array.isArray(docLens) || docLens.length !== data.chunks.length) {
    throw new Error("Index file is inconsistent: BM25 document count does not match chunk count");
  }
  return data as unknown as RepoIndex;
}

export interface SearchHit {
  chunk: Chunk;
  score: number;
}

/** A searcher over a built index. Construct once, query many times. */
export class IndexSearcher {
  private readonly bm25: Bm25;

  constructor(readonly index: RepoIndex) {
    this.bm25 = Bm25.fromSerialized(index.bm25);
  }

  search(query: string, k = 10): SearchHit[] {
    return this.bm25.search(query, k).map((h) => ({ chunk: this.index.chunks[h.doc]!, score: h.score }));
  }
}
