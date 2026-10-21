export class InvalidRepoUrlError extends Error {
  constructor(input: string) {
    super(`Not a valid GitHub repository reference: ${JSON.stringify(input)}`);
    this.name = "InvalidRepoUrlError";
  }
}

export class RepoNotFoundError extends Error {
  constructor(public readonly slug: string) {
    super(`Repository ${slug} was not found. It may be private, renamed or misspelled.`);
    this.name = "RepoNotFoundError";
  }
}

export class GitHubRateLimitError extends Error {
  constructor(public readonly resetAt: Date | null) {
    super(
      resetAt
        ? `GitHub rate limit reached. Try again after ${resetAt.toISOString()} or set GITHUB_TOKEN.`
        : "GitHub rate limit reached. Try again later or set GITHUB_TOKEN.",
    );
    this.name = "GitHubRateLimitError";
  }
}

export class RepoTooLargeError extends Error {
  constructor(public readonly limitBytes: number) {
    super(`Repository archive is larger than the ${Math.round(limitBytes / (1024 * 1024))} MB limit.`);
    this.name = "RepoTooLargeError";
  }
}

export class GitHubFetchError extends Error {
  constructor(
    public readonly status: number,
    detail: string,
  ) {
    super(`GitHub request failed with status ${status}: ${detail}`);
    this.name = "GitHubFetchError";
  }
}
