import { describe, expect, it } from "vitest";
import { looksMinified, skipReasonForContent, skipReasonForPath } from "@/lib/ingest/filter";

describe("skipReasonForPath", () => {
  it.each([
    ["node_modules/x/index.js", "ignored-dir"],
    ["packages/a/node_modules/x.js", "ignored-dir"],
    ["vendor/lib.go", "ignored-dir"],
    ["src/dist/out.js", "ignored-dir"],
    ["package-lock.json", "lockfile"],
    ["web/yarn.lock", "lockfile"],
    ["go.sum", "lockfile"],
    ["img/logo.PNG", "binary-ext"],
    ["lib/a.wasm", "binary-ext"],
    ["static/app.min.js", "minified"],
    ["api/user_pb2.py", "generated"],
    ["api/user.pb.go", "generated"],
    ["../outside.ts", "unsafe-path"],
    ["a/../../b.ts", "unsafe-path"],
    ["/etc/passwd", "unsafe-path"],
    ["a\\b.ts", "unsafe-path"],
  ])("skips %s as %s", (path, reason) => {
    expect(skipReasonForPath(path)).toBe(reason);
  });

  it.each(["src/index.ts", "README.md", "build.gradle", "src/builder/x.ts", "Dockerfile", "docs/vendored.md"])(
    "keeps %s",
    (path) => {
      expect(skipReasonForPath(path)).toBeNull();
    },
  );

  it("does not treat a file named like an ignored dir as ignored", () => {
    expect(skipReasonForPath("src/dist")).toBeNull();
  });
});

describe("skipReasonForContent", () => {
  const limits = { maxFileBytes: 100 };
  it("flags empty, oversized and NUL-containing content", () => {
    expect(skipReasonForContent(new Uint8Array(0), limits)).toBe("empty");
    expect(skipReasonForContent(new Uint8Array(101).fill(97), limits)).toBe("too-large");
    expect(skipReasonForContent(Uint8Array.from([97, 0, 98]), limits)).toBe("binary-content");
  });
  it("accepts plain text", () => {
    expect(skipReasonForContent(Buffer.from("hello"), limits)).toBeNull();
  });
});

describe("looksMinified", () => {
  it("detects one huge line", () => {
    expect(looksMinified("a".repeat(5000))).toBe(true);
  });
  it("ignores normal code and short files", () => {
    expect(looksMinified("let a = 1;\n".repeat(500))).toBe(false);
    expect(looksMinified("a".repeat(100))).toBe(false);
  });
});
