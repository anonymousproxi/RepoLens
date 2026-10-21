import { describe, expect, it } from "vitest";
import { IndexSearcher, ingestRepo } from "@/lib/ingest";

/** Hits the real GitHub API. Run with LIVE_GITHUB=1 (and optionally GITHUB_TOKEN). */
describe.skipIf(!process.env.LIVE_GITHUB)("live GitHub ingestion", () => {
  it("indexes a real public repo and answers a lookup", async () => {
    const token = process.env.GITHUB_TOKEN;
    const index = await ingestRepo("https://github.com/anonymousproxi/EvalSQL", token ? { token } : {});
    expect(index.repo.sha).toMatch(/^[0-9a-f]{7,40}$/);
    expect(index.stats.filesKept).toBeGreaterThan(10);
    expect(index.files.some((f) => f.path === "eval/t2s_eval/executor.py")).toBe(true);
    const hits = new IndexSearcher(index).search("read-only sqlite executor authorizer", 3);
    expect(hits[0]!.chunk.path).toContain("executor");
    console.log(JSON.stringify({ stats: index.stats, top: hits.map((h) => `${h.chunk.path}:${h.chunk.startLine}-${h.chunk.endLine}`) }, null, 1));
  }, 60000);
});
