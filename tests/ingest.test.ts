import { rm } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import {
  IndexSearcher,
  RepoNotFoundError,
  ingestDir,
  ingestRepo,
  parseIndex,
  serializeIndex,
  type IngestProgress,
} from "@/lib/ingest";
import { SAMPLE_REPO, makeTarGz, makeTempRepo, mockFetch } from "./helpers";

const ROOT = "acme-demo-0f1e2d3";

async function tarOfSample(): Promise<Buffer> {
  return makeTarGz(
    Object.entries(SAMPLE_REPO).map(([name, content]) => ({ name: `${ROOT}/${name}`, content })),
  );
}

describe("ingestRepo", () => {
  it("downloads, filters, chunks and indexes a repo end to end", async () => {
    const { fetchImpl } = mockFetch(200, await tarOfSample());
    const phases: IngestProgress["phase"][] = [];
    const index = await ingestRepo("https://github.com/acme/demo", { fetchImpl, onProgress: (p) => phases.push(p.phase) });

    expect(index.repo).toEqual({ owner: "acme", repo: "demo", sha: "0f1e2d3" });
    expect(index.files.map((f) => f.path)).toEqual(["README.md", "cmd/main.go", "src/auth/login.ts", "src/util.py"]);
    expect(index.stats).toMatchObject({
      filesKept: 4,
      filesSkipped: 3,
      truncated: false,
      skippedByReason: { lockfile: 1, "ignored-dir": 1, "binary-ext": 1 },
    });
    expect(index.stats.chunks).toBe(index.chunks.length);
    expect(index.bm25.docLens).toHaveLength(index.chunks.length);
    expect(phases[0]).toBe("download");
    expect(phases.at(-1)).toBe("done");
  });

  it("finds the login handler for a natural-language query", async () => {
    const { fetchImpl } = mockFetch(200, await tarOfSample());
    const index = await ingestRepo("acme/demo", { fetchImpl });
    const hits = new IndexSearcher(index).search("where is login handled");
    expect(hits[0]!.chunk.path).toBe("src/auth/login.ts");
    expect(hits[0]!.chunk.symbols).toContain("handleLogin");
    expect(hits[0]!.chunk.startLine).toBe(1);
  });

  it("surfaces typed errors from GitHub", async () => {
    const { fetchImpl } = mockFetch(404, "nope");
    await expect(ingestRepo("acme/missing", { fetchImpl })).rejects.toBeInstanceOf(RepoNotFoundError);
  });

  it("marks the index truncated when a limit is hit", async () => {
    const { fetchImpl } = mockFetch(200, await tarOfSample());
    const index = await ingestRepo("acme/demo", { fetchImpl, limits: { maxFiles: 2 } });
    expect(index.stats.truncated).toBe(true);
    expect(index.files).toHaveLength(2);
  });
});

describe("index serialisation", () => {
  it("round-trips and gives the same search results", async () => {
    const { fetchImpl } = mockFetch(200, await tarOfSample());
    const index = await ingestRepo("acme/demo", { fetchImpl });
    const copy = parseIndex(serializeIndex(index));
    expect(new IndexSearcher(copy).search("slugify cache")).toEqual(new IndexSearcher(index).search("slugify cache"));
  });

  it("rejects corrupt or mismatched index files", () => {
    expect(() => parseIndex("{}")).toThrow(/Unsupported/);
    expect(() => parseIndex("not json")).toThrow();
    expect(() => parseIndex(JSON.stringify({ version: 1, chunks: [], files: [], repo: {}, bm25: { docLens: [1] } }))).toThrow(
      /inconsistent/,
    );
  });
});

describe("ingestDir", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it("applies the same filters to a local directory", async () => {
    const dir = await makeTempRepo(SAMPLE_REPO);
    dirs.push(dir);
    const index = await ingestDir(dir);
    expect(index.files.map((f) => f.path)).toEqual(["README.md", "cmd/main.go", "src/auth/login.ts", "src/util.py"]);
    expect(index.stats.skippedByReason).toMatchObject({ lockfile: 1, "ignored-dir": 1, "binary-ext": 1 });
    expect(index.repo.owner).toBe("local");
  });

  it("is deterministic: indexing twice gives identical chunks and scores", async () => {
    const dir = await makeTempRepo(SAMPLE_REPO);
    dirs.push(dir);
    const a = await ingestDir(dir);
    const b = await ingestDir(dir);
    expect(a.chunks).toEqual(b.chunks);
    expect(a.bm25).toEqual(b.bm25);
  });
});
