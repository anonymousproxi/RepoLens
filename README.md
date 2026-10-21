# RepoLens

Paste a GitHub repo link and get an architecture overview, instructions for running it, and
answers with exact `file:line` citations. Work in progress. See [CLAUDE.md](CLAUDE.md) for the
plan and [PROGRESS.md](PROGRESS.md) for status.

## Status

| Milestone | State |
|---|---|
| M1 Ingestion and index | Done: fetch, filter, structure-aware chunking, BM25 index |
| M2 Retrieval and Q&A with verified citations | Next |
| M3 to M7 | Not started |

## Ingestion library (`src/lib/ingest`)

```ts
import { ingestRepo, IndexSearcher } from "@/lib/ingest";

const index = await ingestRepo("https://github.com/owner/repo", { token: process.env.GITHUB_TOKEN });
const hits = new IndexSearcher(index).search("where is login handled", 5);
// hits[0].chunk -> { path, startLine, endLine, symbols, text }
```

- Accepts `owner/repo`, https and ssh URLs, and `/tree/<branch>` links.
- Downloads one tarball, so it costs a single API request. Skips vendored code, lockfiles,
  binaries, minified and generated files. Limits: 256 KB per file, 4,000 files, 40 MB of text.
- Chunks follow code structure using tree-sitter (TS, JS, Python, Go, Java, Rust, Ruby, PHP,
  C, C++, C#) and fall back to line windows. Chunks tile each file exactly with 1-based line ranges.
- `ingestDir(path)` indexes a local folder with the same filters.

## Develop

```bash
npm install
npm test          # 98 offline tests
npm run typecheck
LIVE_GITHUB=1 npx vitest run tests/live.test.ts   # optional, hits the real GitHub API
npm run dev
```

Copy `.env.example` to `.env` for the keys later milestones need.
