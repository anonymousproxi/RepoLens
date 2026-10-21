import type { IngestLimits, SkipReason } from "./types";

const IGNORED_DIRS = new Set([
  "node_modules", "vendor", "third_party", "third-party", "bower_components",
  "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", "target",
  ".git", ".hg", ".svn", ".idea", ".vscode", ".gradle",
  "__pycache__", ".venv", "venv", "env", "site-packages", ".tox", ".mypy_cache", ".pytest_cache",
  "coverage", ".cache", "Pods", "obj",
]);

const LOCKFILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock",
  "Cargo.lock", "poetry.lock", "Pipfile.lock", "uv.lock", "composer.lock",
  "Gemfile.lock", "go.sum", "mix.lock", "pubspec.lock", "packages.lock.json",
]);

const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "avif", "tiff", "psd", "svg",
  "pdf", "zip", "gz", "tgz", "tar", "bz2", "xz", "7z", "rar", "jar", "war",
  "exe", "dll", "so", "dylib", "a", "o", "obj", "class", "pyc", "pyo", "wasm", "bin",
  "ttf", "otf", "woff", "woff2", "eot",
  "mp3", "mp4", "mov", "avi", "mkv", "wav", "ogg", "webm",
  "db", "sqlite", "sqlite3", "parquet", "pkl", "npy", "onnx", "pt", "safetensors",
  "map",
]);

const GENERATED = [/\.generated\./, /_pb2(_grpc)?\.py$/, /\.pb\.go$/, /\.snap$/];

/** Path-only checks. Cheap, run before reading content. */
export function skipReasonForPath(path: string): SkipReason | null {
  const parts = path.split("/");
  if (path.startsWith("/") || parts.includes("..") || path.includes("\\") || path.includes("\u0000")) return "unsafe-path";
  const name = parts[parts.length - 1] ?? "";
  for (let i = 0; i < parts.length - 1; i++) {
    if (IGNORED_DIRS.has(parts[i] ?? "")) return "ignored-dir";
  }
  if (LOCKFILES.has(name)) return "lockfile";
  const dot = name.lastIndexOf(".");
  if (dot > 0 && BINARY_EXT.has(name.slice(dot + 1).toLowerCase())) return "binary-ext";
  if (/\.min\.(js|css)$/.test(name)) return "minified";
  if (GENERATED.some((re) => re.test(path))) return "generated";
  return null;
}

/** Content checks on the raw bytes. */
export function skipReasonForContent(buf: Uint8Array, limits: Pick<IngestLimits, "maxFileBytes">): SkipReason | null {
  if (buf.length === 0) return "empty";
  if (buf.length > limits.maxFileBytes) return "too-large";
  const probe = Math.min(buf.length, 8000);
  for (let i = 0; i < probe; i++) if (buf[i] === 0) return "binary-content";
  return null;
}

/** Minified or machine-written text: very long lines on average. */
export function looksMinified(text: string): boolean {
  if (text.length < 2000) return false;
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  return text.length / lines > 400;
}
