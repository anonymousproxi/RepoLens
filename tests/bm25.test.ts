import { describe, expect, it } from "vitest";
import { Bm25, tokenize } from "@/lib/ingest";

describe("tokenize", () => {
  it("splits camelCase, keeps the joined identifier, and drops stopwords", () => {
    const t = tokenize("getUserById and the HTTPServer");
    expect(t).toEqual(expect.arrayContaining(["getuserbyid", "get", "user", "id", "httpserver", "http", "server"]));
    expect(t).not.toContain("and");
    expect(t).not.toContain("the");
  });
  it("splits snake_case and ignores punctuation", () => {
    expect(tokenize("max_retry_count = 3;")).toEqual(expect.arrayContaining(["max", "retry", "count"]));
  });
  it("returns nothing for empty or symbol-only input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("{}[]();")).toEqual([]);
  });
});

describe("Bm25", () => {
  const docs = [
    "function handleLogin(user, password) { checkPassword(password) }",
    "function renderChart(data) { drawAxes(data) }",
    "login login login session cookie",
    "database connection pool configuration",
  ];
  const index = Bm25.build(docs);

  it("ranks documents containing the query terms first", () => {
    const hits = index.search("login password", 3);
    expect(hits[0]!.doc).toBe(0);
    expect(hits.map((h) => h.doc)).toContain(2);
    expect(hits.map((h) => h.doc)).not.toContain(3);
  });

  it("matches a camelCase identifier through its parts", () => {
    expect(index.search("render chart", 1)[0]!.doc).toBe(1);
  });

  it("returns no hits for unknown terms or an empty query", () => {
    expect(index.search("zzzzqq")).toEqual([]);
    expect(index.search("")).toEqual([]);
  });

  it("respects k and orders by descending score", () => {
    const hits = index.search("function login data", 2);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.score).toBeGreaterThanOrEqual(hits[1]!.score);
  });

  it("survives a JSON round trip with identical results", () => {
    const copy = Bm25.fromSerialized(JSON.parse(JSON.stringify(index.serialize())));
    expect(copy.search("login password")).toEqual(index.search("login password"));
  });

  it("is not confused by terms that collide with Object.prototype", () => {
    const idx = Bm25.build(["constructor toString hasOwnProperty __proto__"]);
    expect(idx.search("constructor")[0]?.doc).toBe(0);
    expect(idx.search("valueOf")).toEqual([]);
  });

  it("works on an empty corpus", () => {
    expect(Bm25.build([]).search("anything")).toEqual([]);
  });
});
