import { describe, expect, it } from "vitest";
import { InvalidRepoUrlError, parseRepoUrl, tarballUrl } from "@/lib/ingest";

describe("parseRepoUrl", () => {
  it.each([
    ["https://github.com/vercel/next.js", { owner: "vercel", repo: "next.js" }],
    ["https://github.com/vercel/next.js/", { owner: "vercel", repo: "next.js" }],
    ["https://github.com/vercel/next.js.git", { owner: "vercel", repo: "next.js" }],
    ["http://www.github.com/a/b", { owner: "a", repo: "b" }],
    ["github.com/a/b", { owner: "a", repo: "b" }],
    ["git@github.com:a/b.git", { owner: "a", repo: "b" }],
    ["a/b", { owner: "a", repo: "b" }],
    ["  a/b  ", { owner: "a", repo: "b" }],
    ["https://github.com/a/b/tree/main", { owner: "a", repo: "b", ref: "main" }],
    ["https://github.com/a/b/tree/feature/x", { owner: "a", repo: "b", ref: "feature/x" }],
    ["https://github.com/a/b/blob/v1.2.0/src/x.ts", { owner: "a", repo: "b", ref: "v1.2.0" }],
    ["https://github.com/a/b/issues/3", { owner: "a", repo: "b" }],
  ])("parses %s", (input, expected) => {
    expect(parseRepoUrl(input)).toEqual(expected);
  });

  it.each([
    "",
    "justone",
    "https://gitlab.com/a/b",
    "https://github.com.evil.com/a/b",
    "https://evil.com/github.com/a/b",
    "ftp://github.com/a/b",
    "javascript://github.com/a/b",
    "https://github.com/a",
    "../b",
    "a/..",
    "a/b c",
    "https://github.com/a/b/tree/%E0%A4%A",
  ])("rejects %j", (input) => {
    expect(() => parseRepoUrl(input)).toThrow(InvalidRepoUrlError);
  });
});

describe("tarballUrl", () => {
  it("uses the default branch when no ref is given", () => {
    expect(tarballUrl({ owner: "a", repo: "b" })).toBe("https://api.github.com/repos/a/b/tarball");
  });
  it("encodes each ref segment but keeps the slashes", () => {
    expect(tarballUrl({ owner: "a", repo: "b", ref: "feat/a b" })).toBe("https://api.github.com/repos/a/b/tarball/feat/a%20b");
  });
});
