import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITS,
  GitHubFetchError,
  GitHubRateLimitError,
  RepoNotFoundError,
  RepoTooLargeError,
  extractTarball,
  fetchRepoTarball,
} from "@/lib/ingest";
import { makeTarGz, mockFetch, tarStream } from "./helpers";

const ROOT = "owner-repo-abc1234";

async function sampleTar(): Promise<Buffer> {
  return makeTarGz([
    { name: `${ROOT}/`, type: "directory" },
    { name: `${ROOT}/src/app.ts`, content: "export const a = 1;\n" },
    { name: `${ROOT}/README.md`, content: "# Hi\n" },
    { name: `${ROOT}/package-lock.json`, content: "{}" },
    { name: `${ROOT}/node_modules/x/i.js`, content: "1" },
    { name: `${ROOT}/logo.png`, content: Buffer.from([1, 2, 3]) },
    { name: `${ROOT}/data.bin2`, content: Buffer.from([65, 0, 66]) },
    { name: `${ROOT}/latin1.txt`, content: Buffer.from([0x63, 0x61, 0x66, 0xe9]) },
    { name: `${ROOT}/empty.txt`, content: "   \n" },
    { name: `${ROOT}/link`, type: "symlink", linkname: "src/app.ts" },
  ]);
}

describe("extractTarball", () => {
  it("keeps text files, strips the root directory and counts skips by reason", async () => {
    const result = await extractTarball(tarStream(await sampleTar()), DEFAULT_LIMITS);
    expect(result.files.map((f) => f.path).sort()).toEqual(["README.md", "src/app.ts"]);
    expect(result.rootDir).toBe(ROOT);
    expect(result.truncated).toBe(false);
    expect(result.skippedByReason).toMatchObject({
      lockfile: 1,
      "ignored-dir": 1,
      "binary-ext": 1,
      "binary-content": 2, // NUL bytes, and invalid UTF-8
      empty: 1,
    });
    expect(result.skippedCount).toBe(6);
  });

  it("skips files over the size limit without reading them", async () => {
    const tarball = await makeTarGz([
      { name: `${ROOT}/big.ts`, content: "a\n".repeat(600) },
      { name: `${ROOT}/small.ts`, content: "a\n" },
    ]);
    const result = await extractTarball(tarStream(tarball), { ...DEFAULT_LIMITS, maxFileBytes: 100 });
    expect(result.files.map((f) => f.path)).toEqual(["small.ts"]);
    expect(result.skippedByReason["too-large"]).toBe(1);
  });

  it("stops at maxFiles and reports truncation", async () => {
    const tarball = await makeTarGz(Array.from({ length: 10 }, (_, i) => ({ name: `${ROOT}/f${i}.ts`, content: `export const v = ${i};\n` })));
    const result = await extractTarball(tarStream(tarball), { ...DEFAULT_LIMITS, maxFiles: 3 });
    expect(result.files).toHaveLength(3);
    expect(result.truncated).toBe(true);
    expect(result.skippedByReason["over-file-limit"]).toBe(1);
  });

  it("stops at the total size budget and reports truncation", async () => {
    const tarball = await makeTarGz(Array.from({ length: 5 }, (_, i) => ({ name: `${ROOT}/f${i}.ts`, content: `${"x".repeat(100)}\n` })));
    const result = await extractTarball(tarStream(tarball), { ...DEFAULT_LIMITS, maxTotalBytes: 250 });
    expect(result.files).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.skippedByReason["over-size-budget"]).toBe(1);
  });

  it("rejects an archive larger than the compressed limit", async () => {
    const noise = Buffer.from(Array.from({ length: 20000 }, (_, i) => (i * 7919) % 251));
    const tarball = await makeTarGz([{ name: `${ROOT}/noise.txt`, content: noise.toString("latin1") }]);
    await expect(extractTarball(tarStream(tarball), { ...DEFAULT_LIMITS, maxTarballBytes: 500 })).rejects.toBeInstanceOf(
      RepoTooLargeError,
    );
  });

  it("rejects data that is not a gzipped tarball", async () => {
    await expect(extractTarball(tarStream(Buffer.from("definitely not gzip")), DEFAULT_LIMITS)).rejects.toThrow();
    await expect(extractTarball(tarStream(gzipSync(Buffer.from("gzip but not tar"))), DEFAULT_LIMITS)).rejects.toThrow();
  });

  it("reports progress while reading many files", async () => {
    const tarball = await makeTarGz(Array.from({ length: 450 }, (_, i) => ({ name: `${ROOT}/f${i}.ts`, content: `export const v = ${i};\n` })));
    const seen: number[] = [];
    await extractTarball(tarStream(tarball), DEFAULT_LIMITS, (p) => seen.push(p.filesKept ?? 0));
    expect(seen).toEqual([200, 400]);
  });
});

describe("fetchRepoTarball", () => {
  const ref = { owner: "o", repo: "r" };
  const opts = { limits: DEFAULT_LIMITS };

  it("sends the token and API headers", async () => {
    const { fetchImpl, calls } = mockFetch(200, await sampleTar());
    const stream = await fetchRepoTarball(ref, { ...opts, fetchImpl, token: "ghp_test" });
    stream.destroy();
    expect(calls[0]!.url).toBe("https://api.github.com/repos/o/r/tarball");
    expect(calls[0]!.headers.Authorization).toBe("Bearer ghp_test");
    expect(calls[0]!.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("omits Authorization when no token is set", async () => {
    const { fetchImpl, calls } = mockFetch(200, await sampleTar());
    (await fetchRepoTarball(ref, { ...opts, fetchImpl })).destroy();
    expect(calls[0]!.headers.Authorization).toBeUndefined();
  });

  it("maps 404 to RepoNotFoundError", async () => {
    const { fetchImpl } = mockFetch(404, "Not Found");
    await expect(fetchRepoTarball(ref, { ...opts, fetchImpl })).rejects.toBeInstanceOf(RepoNotFoundError);
  });

  it("maps an exhausted rate limit to GitHubRateLimitError with the reset time", async () => {
    const { fetchImpl } = mockFetch(403, "API rate limit exceeded", { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1900000000" });
    const err = await fetchRepoTarball(ref, { ...opts, fetchImpl }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubRateLimitError);
    expect((err as GitHubRateLimitError).resetAt?.getTime()).toBe(1900000000 * 1000);
  });

  it("maps 429 with retry-after to GitHubRateLimitError even without reset headers", async () => {
    const { fetchImpl } = mockFetch(429, "slow down", { "retry-after": "30" });
    const err = await fetchRepoTarball(ref, { ...opts, fetchImpl }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubRateLimitError);
    expect((err as GitHubRateLimitError).resetAt).toBeNull();
  });

  it("treats other 403s as a plain fetch error", async () => {
    const { fetchImpl } = mockFetch(403, "Repository access blocked");
    const err = await fetchRepoTarball(ref, { ...opts, fetchImpl }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubFetchError);
    expect(err).not.toBeInstanceOf(GitHubRateLimitError);
  });

  it("refuses an oversized archive from content-length alone", async () => {
    const { fetchImpl } = mockFetch(200, "x", { "content-length": String(DEFAULT_LIMITS.maxTarballBytes + 1) });
    await expect(fetchRepoTarball(ref, { ...opts, fetchImpl })).rejects.toBeInstanceOf(RepoTooLargeError);
  });

  it("maps server errors to GitHubFetchError", async () => {
    const { fetchImpl } = mockFetch(502, "bad gateway");
    await expect(fetchRepoTarball(ref, { ...opts, fetchImpl })).rejects.toBeInstanceOf(GitHubFetchError);
  });
});
