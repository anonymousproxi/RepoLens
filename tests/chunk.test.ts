import { describe, expect, it } from "vitest";
import { chunkFile } from "@/lib/ingest";
import type { Chunk } from "@/lib/ingest";

/** Every line 1..N belongs to exactly one chunk, in order, and the text matches the source. */
function expectTiles(source: string, chunks: Chunk[]): void {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  expect(chunks.length).toBeGreaterThan(0);
  expect(chunks[0]!.startLine).toBe(1);
  expect(chunks[chunks.length - 1]!.endLine).toBe(lines.length);
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]!;
    expect(c.endLine).toBeGreaterThanOrEqual(c.startLine);
    if (i > 0) expect(c.startLine).toBe(chunks[i - 1]!.endLine + 1);
    expect(c.text).toBe(lines.slice(c.startLine - 1, c.endLine).join("\n"));
    expect(c.id).toBe(`${c.path}:${c.startLine}-${c.endLine}`);
  }
}

const TS_SOURCE = [
  "import fs from 'node:fs';",
  "",
  "// Reads the config.",
  "export function readConfig(path: string) {",
  "  return fs.readFileSync(path, 'utf8');",
  "}",
  "",
  "export class Server {",
  "  start() {",
  "    return 1;",
  "  }",
  "  stop() {",
  "    return 2;",
  "  }",
  "}",
  "",
  "export const VERSION = '1.0.0';",
].join("\n");

describe("chunkFile", () => {
  it("keeps a small TypeScript file in one chunk and records its symbols", async () => {
    const chunks = await chunkFile({ path: "a.ts", text: TS_SOURCE });
    expectTiles(TS_SOURCE, chunks);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.language).toBe("typescript");
    expect(chunks[0]!.symbols).toEqual(expect.arrayContaining(["readConfig", "Server", "VERSION"]));
  });

  it("splits on declaration boundaries when the budget is small", async () => {
    const chunks = await chunkFile({ path: "a.ts", text: TS_SOURCE }, { maxChars: 120 });
    expectTiles(TS_SOURCE, chunks);
    expect(chunks.length).toBeGreaterThan(1);
    const readConfig = chunks.find((c) => c.symbols.includes("readConfig"))!;
    expect(readConfig.text).toContain("return fs.readFileSync");
    expect(readConfig.text).toContain("// Reads the config."); // leading comment travels with its function
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(120 + 40);
  });

  it("descends into a large class and splits it between methods", async () => {
    const methods = Array.from({ length: 12 }, (_, i) => `  method${i}() {\n    return ${i};\n  }`).join("\n");
    const src = `export class Big {\n${methods}\n}\n`;
    const chunks = await chunkFile({ path: "big.ts", text: src }, { maxChars: 100 });
    expectTiles(src, chunks);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.some((c) => c.symbols.includes("Big"))).toBe(true);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(100);
    // No method is cut in half: each chunk has balanced braces apart from the class wrapper lines.
    const mid = chunks.slice(1, -1);
    for (const c of mid) expect((c.text.match(/{/g) ?? []).length).toBe((c.text.match(/}/g) ?? []).length);
  });

  it("chunks Python, Go and TSX with their grammars", async () => {
    const py = "def a():\n    return 1\n\n\nclass B:\n    def m(self):\n        return 2\n";
    const go = "package main\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n";
    const tsx = "export function App() {\n  return <div>hi</div>;\n}\n";
    for (const [path, src, sym] of [
      ["x.py", py, "a"],
      ["x.go", go, "Add"],
      ["x.tsx", tsx, "App"],
    ] as const) {
      const chunks = await chunkFile({ path, text: src });
      expectTiles(src, chunks);
      expect(chunks[0]!.symbols).toContain(sym);
    }
  });

  it("splits markdown at headings and ignores # inside code fences", async () => {
    const md = "# Title\n\nintro\n\n## Setup\n\n```sh\n# not a heading\nnpm i\n```\n\n## Usage\n\nrun it\n";
    const chunks = await chunkFile({ path: "README.md", text: md }, { maxChars: 40 });
    expectTiles(md, chunks);
    const setup = chunks.find((c) => c.symbols.includes("Setup"))!;
    expect(setup.text).toContain("# not a heading");
    expect(chunks.some((c) => c.symbols.includes("Usage"))).toBe(true);
  });

  it("falls back to line packing for unknown file types", async () => {
    const src = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const chunks = await chunkFile({ path: "data.xyz", text: src }, { maxChars: 100 });
    expectTiles(src, chunks);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks[0]!.language).toBeNull();
  });

  it("packs a long function body into several chunks", async () => {
    const body = Array.from({ length: 80 }, (_, i) => `  const v${i} = ${i};`).join("\n");
    const src = `function huge() {\n${body}\n}\n`;
    const chunks = await chunkFile({ path: "h.js", text: src }, { maxChars: 300 });
    expectTiles(src, chunks);
    expect(chunks.length).toBeGreaterThan(3);
  });

  it("keeps a single over-long line as its own chunk instead of dropping it", async () => {
    const src = `a\n${"x".repeat(500)}\nb\n`;
    const chunks = await chunkFile({ path: "t.txt", text: src }, { maxChars: 100 });
    expectTiles(src, chunks);
    expect(chunks.some((c) => c.text.length >= 500)).toBe(true);
  });

  it("normalises CRLF and counts lines the same way", async () => {
    const src = "def a():\r\n    return 1\r\n";
    const chunks = await chunkFile({ path: "a.py", text: src });
    expectTiles(src, chunks);
    expect(chunks[0]!.text).not.toContain("\r");
  });

  it("still tiles a file with a syntax error", async () => {
    const src = "function ok() { return 1; }\nfunction broken( {{{ \nlet x = ;\n";
    const chunks = await chunkFile({ path: "e.js", text: src }, { maxChars: 40 });
    expectTiles(src, chunks);
  });

  it("returns nothing for an empty file and handles a single line without newline", async () => {
    expect(await chunkFile({ path: "e.ts", text: "" })).toEqual([]);
    const chunks = await chunkFile({ path: "one.ts", text: "export const a = 1;" });
    expectTiles("export const a = 1;", chunks);
  });

  it("handles unicode content", async () => {
    const src = "const saludo = 'hola, ¿cómo estás? 你好 🎉';\nfunction f() { return saludo; }\n";
    const chunks = await chunkFile({ path: "u.js", text: src }, { maxChars: 50 });
    expectTiles(src, chunks);
  });
});
