export interface RepoRef {
  owner: string;
  repo: string;
  /** Branch, tag or commit. When omitted the default branch is used. */
  ref?: string;
}

export interface RepoFile {
  /** POSIX path relative to the repo root. */
  path: string;
  text: string;
}

export type SkipReason =
  | "ignored-dir"
  | "lockfile"
  | "binary-ext"
  | "binary-content"
  | "too-large"
  | "minified"
  | "generated"
  | "empty"
  | "unsafe-path"
  | "over-file-limit"
  | "over-size-budget";

export interface Chunk {
  /** `path:start-end`, unique within an index. */
  id: string;
  path: string;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  language: string | null;
  text: string;
  /** Names of the top-level declarations the chunk contains, when known. */
  symbols: string[];
}

export interface IngestLimits {
  /** Largest single file kept, in bytes. */
  maxFileBytes: number;
  /** Most files kept after filtering. */
  maxFiles: number;
  /** Most bytes of kept text across all files. */
  maxTotalBytes: number;
  /** Largest compressed tarball accepted, in bytes. */
  maxTarballBytes: number;
}

export const DEFAULT_LIMITS: IngestLimits = {
  maxFileBytes: 256 * 1024,
  maxFiles: 4000,
  maxTotalBytes: 40 * 1024 * 1024,
  maxTarballBytes: 80 * 1024 * 1024,
};

export type IngestPhase = "download" | "extract" | "chunk" | "index" | "done";

export interface IngestProgress {
  phase: IngestPhase;
  message: string;
  filesKept?: number;
  filesSkipped?: number;
}

export type ProgressCallback = (p: IngestProgress) => void;

export interface IndexStats {
  filesKept: number;
  filesSkipped: number;
  skippedByReason: Partial<Record<SkipReason, number>>;
  chunks: number;
  bytes: number;
  /** True when a limit stopped ingestion before every file was read. */
  truncated: boolean;
  durationMs: number;
}
