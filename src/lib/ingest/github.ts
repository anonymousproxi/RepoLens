import { InvalidRepoUrlError } from "./errors";
import type { RepoRef } from "./types";

const NAME = /^[A-Za-z0-9_.-]+$/;

function validName(s: string | undefined): s is string {
  return !!s && NAME.test(s) && s !== "." && s !== "..";
}

/**
 * Accepts `owner/repo`, https URLs (with optional `.git`, `/tree/<ref>`,
 * `/blob/<ref>/...`), and `git@github.com:owner/repo.git`.
 */
export function parseRepoUrl(input: string): RepoRef {
  const raw = input.trim();
  let path: string;

  const ssh = /^git@github\.com:(.+)$/.exec(raw);
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  if (ssh) {
    path = ssh[1] ?? "";
  } else if (hasScheme || /^(www\.)?github\.com\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(hasScheme ? raw : `https://${raw}`);
    } catch {
      throw new InvalidRepoUrlError(input);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new InvalidRepoUrlError(input);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") throw new InvalidRepoUrlError(input);
    path = url.pathname;
  } else {
    path = raw;
  }

  const segs = path.split("/").filter(Boolean);
  const owner = segs[0];
  const repo = segs[1]?.replace(/\.git$/, "");
  if (!validName(owner) || !validName(repo)) throw new InvalidRepoUrlError(input);

  const kind = segs[2];
  if ((kind === "tree" || kind === "blob" || kind === "commit") && segs.length > 3) {
    try {
      // A /blob/<ref>/<file> URL cannot be split reliably, so only the first segment is kept.
      const ref =
        kind === "tree" ? segs.slice(3).map(decodeURIComponent).join("/") : decodeURIComponent(segs[3] ?? "");
      if (ref) return { owner, repo, ref };
    } catch {
      throw new InvalidRepoUrlError(input);
    }
  }
  return { owner, repo };
}

export function tarballUrl(ref: RepoRef): string {
  const base = `https://api.github.com/repos/${ref.owner}/${ref.repo}/tarball`;
  return ref.ref ? `${base}/${ref.ref.split("/").map(encodeURIComponent).join("/")}` : base;
}
