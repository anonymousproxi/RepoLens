const BY_EXT: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript",
  tsx: "tsx",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  py: "python", pyi: "python",
  go: "go",
  java: "java",
  rs: "rust",
  rb: "ruby",
  php: "php",
  c: "c", h: "c",
  cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  cs: "c_sharp",
  md: "markdown", mdx: "markdown",
  json: "json", yml: "yaml", yaml: "yaml", toml: "toml",
  html: "html", css: "css", scss: "scss",
  sh: "shell", bash: "shell",
  sql: "sql",
};

const BY_NAME: Record<string, string> = {
  Dockerfile: "dockerfile",
  Makefile: "makefile",
};

/** Language label for a path, or null when unknown. */
export function detectLanguage(path: string): string | null {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const named = BY_NAME[base];
  if (named) return named;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  return BY_EXT[base.slice(dot + 1).toLowerCase()] ?? null;
}

/** Languages that have a tree-sitter grammar in tree-sitter-wasms. */
export const PARSEABLE = new Set([
  "typescript", "tsx", "javascript", "python", "go", "java", "rust", "ruby", "php", "c", "cpp", "c_sharp",
]);
