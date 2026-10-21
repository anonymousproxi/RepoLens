# Progress: codebase-guide

Last updated: 2026-10-21. Status: M1 code-complete and tested (offline fixtures plus one live GitHub run). M2 next; it needs an LLM and embeddings key.

## Milestones
| ID | Milestone | Status | Notes |
|---|---|---|---|
| M1 | Ingestion and index | Code complete | 98 offline tests pass, tsc strict clean, `next build` passes. Live run on one real repo recorded below |
| M2 | Retrieval, Q&A, citation verifier | Not started | |
| M3 | Overview features | Not started | |
| M4 | UI | Not started | |
| M5 | Evaluation (50 questions, 5 repos) | Not started | |
| M6 | Polish and deploy | Not started | |
| M7 | MCP + mock integrations (optional) | Not started | |

## Metrics (measured only)
| Metric | Value | Sample size / split | Model | Date |
|---|---|---|---|---|
| Citation accuracy | not yet measured | | | |
| Hybrid vs embeddings-only | not yet measured | | | |
| Indexing time / cost (mid-size repo) | not yet measured | | | |
| p95 answer latency | not yet measured | | | |
| Tests passing | 98 passed, 0 failed (vitest); `tsc --noEmit` clean | offline fixtures, in-memory tarballs, mocked fetch | n/a | 2026-10-21 |
| Live ingestion check | 1 repo (anonymousproxi/EvalSQL): 25 files kept, 1 skipped, 61 chunks, 70,333 chars, 1.2 s end to end, no token | single run on a small repo, not a benchmark | n/a | 2026-10-21 |

## Decisions
- **Parser:** `web-tree-sitter@0.22.6` (pinned exactly) with `tree-sitter-wasms@0.1.x`. `web-tree-sitter` 0.27 fails to load these grammars (ABI mismatch), so do not upgrade one without the other. Pure WASM, so it runs on Vercel with no native build. Grammars: TS, TSX, JS, Python, Go, Java, Rust, Ruby, PHP, C, C++, C#; markdown splits on headings; everything else is packed by lines.
- **Chunking rule:** chunks tile each file exactly (every line in exactly one chunk, 1-based inclusive ranges, `path:start-end` ids), so the M2 citation verifier can check ranges. Nodes bigger than the budget (1,800 chars) are split by recursing into their children; small neighbours are merged; comments stay with the declaration below them.
- **Retrieval index (M1 part):** in-memory BM25 over `path + symbol names + code`, serialised as JSON next to the chunks. Embeddings and the reranker are added in M2. Showcase indexes for the hosted demo are precomputed from this format (M6).
- **Limits (defaults):** 256 KB per file, 4,000 files, 40 MB of text, 80 MB compressed archive. When a limit stops ingestion the index is flagged `truncated`. Rate limits, 404s and oversize archives raise typed errors (`GitHubRateLimitError` with reset time, `RepoNotFoundError`, `RepoTooLargeError`).
- **Skipped on purpose:** vendored and build directories, lockfiles, binaries, minified or generated files, empty files, and archive paths with `..` or absolute paths.
- **Known limits:** the tokenizer is ASCII-only, so non-Latin identifiers and comments are not searchable by BM25; tokens are not stemmed.

## Blockers / needs from human
- **M2** needs an OpenAI-compatible key for chat and embeddings in `.env` (`OPENAI_API_KEY`, optionally `OPENAI_BASE_URL`, `MODEL_NAME`). Until then M2 can only be built and tested against mocks.
- Optional: `GITHUB_TOKEN` for higher API limits.

## Log
- 2026-10-21: repo scaffolded with CLAUDE.md, subagents, hooks.
- 2026-10-21: M1. Scaffolded the Next.js app and built `src/lib/ingest`: URL parsing, tarball download with typed errors, filters and limits, tree-sitter chunking, BM25 index with JSON round trip, local-directory ingestion. 98 tests. A self-review before commit found and fixed two things: comments were being separated from the function they describe, and archive paths containing `..` were not rejected.
