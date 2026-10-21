import { createRequire } from "node:module";
import path from "node:path";
import Parser from "web-tree-sitter";
import { detectLanguage, PARSEABLE } from "./language";
import type { Chunk, RepoFile } from "./types";

export interface ChunkOptions {
  /** Soft cap on characters per chunk. A single line longer than this still becomes one chunk. */
  maxChars: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxChars: 1800 };

/** Row range, 0-based and inclusive, with the declaration names found inside it. */
interface Seg {
  start: number;
  end: number;
  symbols: string[];
}

// ---------------------------------------------------------------------------
// Parser loading
// ---------------------------------------------------------------------------

const requireFromHere = createRequire(import.meta.url);
let initPromise: Promise<void> | null = null;
const languages = new Map<string, Promise<Parser | null>>();

function wasmPath(lang: string): string {
  const file = `tree-sitter-wasms/out/tree-sitter-${lang}.wasm`;
  try {
    return requireFromHere.resolve(file);
  } catch {
    return path.join(process.cwd(), "node_modules", file);
  }
}

function getParser(lang: string): Promise<Parser | null> {
  let p = languages.get(lang);
  if (!p) {
    p = (async () => {
      try {
        initPromise ??= Parser.init();
        await initPromise;
        const language = await Parser.Language.load(wasmPath(lang));
        const parser = new Parser();
        parser.setLanguage(language);
        return parser;
      } catch {
        return null;
      }
    })();
    languages.set(lang, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Segmenting
// ---------------------------------------------------------------------------

function nameOf(node: Parser.SyntaxNode): string | null {
  const direct = node.childForFieldName("name");
  if (direct) return direct.text.slice(0, 80);
  for (const field of ["declaration", "definition"]) {
    const inner = node.childForFieldName(field);
    if (inner) return nameOf(inner);
  }
  if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
    const decl = node.namedChildren.find((c) => c.type === "variable_declarator");
    const n = decl?.childForFieldName("name");
    if (n) return n.text.slice(0, 80);
  }
  return null;
}

function endRow(node: Parser.SyntaxNode): number {
  const row = node.endPosition.row;
  // A node that ends at column 0 does not really include that line.
  return node.endPosition.column === 0 && row > node.startPosition.row ? row - 1 : row;
}

function collect(node: Parser.SyntaxNode, maxChars: number, out: Seg[]): void {
  const size = node.endIndex - node.startIndex;
  if (size <= maxChars || node.namedChildCount === 0) {
    const name = nameOf(node);
    out.push({ start: node.startPosition.row, end: endRow(node), symbols: name ? [name] : [] });
    return;
  }
  const before = out.length;
  collectChildren(node.namedChildren, maxChars, out);
  // Keep the container's own name on its first piece so the class or module stays findable.
  const name = nameOf(node);
  const first = out[before];
  if (name && first && !first.symbols.includes(name)) first.symbols.unshift(name);
}

/** Collect sibling nodes, tying a comment block to the declaration directly below it. */
function collectChildren(children: Parser.SyntaxNode[], maxChars: number, out: Seg[]): void {
  let pending: { start: number; end: number } | null = null;
  for (const child of children) {
    if (child.type.includes("comment")) {
      const row = child.startPosition.row;
      pending = pending && row <= pending.end + 1 ? { start: pending.start, end: endRow(child) } : { start: row, end: endRow(child) };
      continue;
    }
    const before = out.length;
    collect(child, maxChars, out);
    const first = out[before];
    if (pending && first && child.startPosition.row <= pending.end + 1) {
      first.start = Math.min(first.start, pending.start);
    } else if (pending) {
      out.push({ start: pending.start, end: pending.end, symbols: [] });
    }
    pending = null;
  }
  if (pending) out.push({ start: pending.start, end: pending.end, symbols: [] });
}

/** Make segments ordered, non-overlapping and gap-free so every line belongs to exactly one. */
function normalise(segs: Seg[], lineCount: number): Seg[] {
  const sorted = [...segs].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Seg[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev && s.start <= prev.end) {
      prev.end = Math.max(prev.end, s.end);
      prev.symbols.push(...s.symbols);
    } else {
      out.push({ start: s.start, end: s.end, symbols: [...s.symbols] });
    }
  }
  if (out.length === 0) return [{ start: 0, end: lineCount - 1, symbols: [] }];
  // Gaps (imports, comments, decorators) attach to the segment that follows them.
  out[0]!.start = 0;
  for (let i = 1; i < out.length; i++) out[i]!.start = out[i - 1]!.end + 1;
  out[out.length - 1]!.end = lineCount - 1;
  return out;
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}

function mergeAndSplit(segs: Seg[], lines: string[], maxChars: number): Seg[] {
  // prefix[i] = characters in lines[0..i-1], counting one newline per line.
  const prefix = new Array<number>(lines.length + 1).fill(0);
  for (let i = 0; i < lines.length; i++) prefix[i + 1] = (prefix[i] ?? 0) + (lines[i]?.length ?? 0) + 1;
  const chars = (a: number, b: number): number => (prefix[b + 1] ?? 0) - (prefix[a] ?? 0);

  const merged: Seg[] = [];
  let cur: Seg | null = null;
  for (const s of segs) {
    if (cur && chars(cur.start, s.end) <= maxChars) {
      cur = { start: cur.start, end: s.end, symbols: [...cur.symbols, ...s.symbols] };
    } else {
      if (cur) merged.push(cur);
      cur = { ...s, symbols: [...s.symbols] };
    }
  }
  if (cur) merged.push(cur);

  const out: Seg[] = [];
  for (const s of merged) {
    if (chars(s.start, s.end) <= maxChars) {
      out.push({ ...s, symbols: unique(s.symbols) });
      continue;
    }
    // Still too big (a long function body, data table): pack its lines.
    let start = s.start;
    let first = true;
    while (start <= s.end) {
      let end = start;
      while (end < s.end && chars(start, end + 1) <= maxChars) end++;
      out.push({ start, end, symbols: first ? unique(s.symbols) : [] });
      first = false;
      start = end + 1;
    }
  }
  return out;
}

function markdownSegs(lines: string[]): Seg[] {
  const segs: Seg[] = [];
  let inFence = false;
  let start = 0;
  let title: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && /^#{1,6}\s+\S/.test(line) && i > start) {
      segs.push({ start, end: i - 1, symbols: title ? [title] : [] });
      start = i;
    }
    if (!inFence && /^#{1,6}\s+\S/.test(line)) title = line.replace(/^#{1,6}\s+/, "").trim().slice(0, 80);
  }
  segs.push({ start, end: lines.length - 1, symbols: title ? [title] : [] });
  return segs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Split one file into chunks that tile it exactly: every line belongs to one
 * chunk, and line numbers are 1-based and inclusive.
 */
export async function chunkFile(file: RepoFile, options: ChunkOptions = DEFAULT_CHUNK_OPTIONS): Promise<Chunk[]> {
  const text = file.text.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) return [];

  const language = detectLanguage(file.path);
  let segs: Seg[] | null = null;

  if (language && PARSEABLE.has(language)) {
    const parser = await getParser(language);
    if (parser) {
      let tree: Parser.Tree | null = null;
      try {
        tree = parser.parse(text);
        const found: Seg[] = [];
        collectChildren(tree.rootNode.namedChildren, options.maxChars, found);
        segs = found;
      } catch {
        segs = null;
      } finally {
        tree?.delete();
      }
    }
  } else if (language === "markdown") {
    segs = markdownSegs(lines);
  }

  const tiled = normalise(segs ?? [], lines.length);
  return mergeAndSplit(tiled, lines, options.maxChars).map((s) => ({
    id: `${file.path}:${s.start + 1}-${s.end + 1}`,
    path: file.path,
    startLine: s.start + 1,
    endLine: s.end + 1,
    language,
    text: lines.slice(s.start, s.end + 1).join("\n"),
    symbols: s.symbols,
  }));
}
