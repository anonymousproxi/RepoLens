import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import tar from "tar-stream";

export interface TarEntry {
  name: string;
  content?: string | Buffer;
  type?: "file" | "directory" | "symlink";
  linkname?: string;
}

/** Build an in-memory .tar.gz like the ones GitHub serves. */
export async function makeTarGz(entries: TarEntry[]): Promise<Buffer> {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  const collected = new Promise<Buffer>((resolve, reject) => {
    pack.on("data", (c: unknown) => chunks.push(c as Buffer));
    pack.on("end", () => resolve(Buffer.concat(chunks)));
    pack.on("error", reject);
  });
  for (const e of entries) {
    const type = e.type ?? "file";
    const body = typeof e.content === "string" ? Buffer.from(e.content) : (e.content ?? Buffer.alloc(0));
    await new Promise<void>((resolve, reject) => {
      const done = (err?: Error | null): void => (err ? reject(err) : resolve());
      if (type === "file") {
        pack.entry({ name: e.name, type, size: body.length }, body, done);
      } else {
        const header = { name: e.name, type, ...(type === "symlink" ? { linkname: e.linkname ?? "x" } : {}) } as tar.Header;
        pack.entry(header, done);
      }
    });
  }
  pack.finalize();
  return gzipSync(await collected);
}

export function tarStream(buf: Buffer): Readable {
  return Readable.from([buf]);
}

/** A fetch stand-in that returns the given status, headers and body once. */
export function mockFetch(
  status: number,
  body: Buffer | string = "",
  headers: Record<string, string> = {},
): { fetchImpl: typeof fetch; calls: { url: string; headers: Record<string, string> }[] } {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
    const payload = typeof body === "string" ? Buffer.from(body) : body;
    return new Response(status === 204 ? null : new Uint8Array(payload), { status, headers });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export async function makeTempRepo(files: Record<string, string | Buffer>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "repolens-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  return root;
}

export const SAMPLE_REPO: Record<string, string | Buffer> = {
  "README.md": "# Demo\n\nA tiny app.\n\n## Running\n\nRun `npm start`.\n",
  "src/auth/login.ts": [
    "import { hash } from './hash';",
    "",
    "export function handleLogin(user: string, password: string): boolean {",
    "  return hash(password) === lookupHash(user);",
    "}",
    "",
    "function lookupHash(user: string): string {",
    "  return user + ':hash';",
    "}",
  ].join("\n"),
  "src/util.py": "def slugify(text):\n    return text.lower().replace(' ', '-')\n\n\nclass Cache:\n    def get(self, key):\n        return None\n",
  "cmd/main.go": "package main\n\nfunc main() {\n\tprintln(\"hi\")\n}\n",
  "package-lock.json": "{\"lockfileVersion\": 3}",
  "node_modules/dep/index.js": "module.exports = 1;\n",
  "assets/logo.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]),
};
