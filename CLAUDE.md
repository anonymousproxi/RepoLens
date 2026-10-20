# Project 2: Codebase Onboarding Assistant

## Goal
Paste a GitHub repo link. The tool produces an architecture overview, instructions for running the project, answers to questions such as "where is login handled?" with exact file and line citations, and suggestions for good first issues for new contributors.

## Stack (fixed)
- App: Next.js (App Router) + TypeScript (strict) + Tailwind CSS + Lucide icons, deployable to Vercel with no separate Python server.
- Repo access: GitHub REST API / tarball download for public repos. Handle rate limits and large repos gracefully (file size limits, ignore lists for binaries, lockfiles, vendored code).
- Chunking: split code along structure (functions, classes, top-level blocks) using `tree-sitter` or a comparable parser, falling back to line windows. Every chunk keeps file path and start/end line numbers.
- Retrieval: hybrid search, combining embedding similarity and keyword/BM25, with a reranking step. Start with an in-memory index; for the hosted demo, precompute indexes for a few showcase repos and serve them from static storage. Record the choice in PROGRESS.md.
- Model access: `ModelProvider` and `EmbeddingProvider` interfaces over OpenAI-compatible APIs, so models can be swapped by configuration.
- Tests: Vitest.

## Layout
```
codebase-guide/
  CLAUDE.md  PROGRESS.md  README.md  .env.example
  src/app/              # pages and API routes
  src/lib/ingest/       # fetch repo, filter files, chunk, build index
  src/lib/retrieval/    # embeddings, BM25, hybrid search, reranker
  src/lib/answer/       # prompt building, answer generation, citation verification
  src/lib/mcp/          # MCP server and mock integrations (final milestone)
  eval/                 # question set, runner, scorer
  data/indexes/         # precomputed showcase indexes (small)
  docs/RESULTS.md       # measured numbers only
```

## Milestones (do in order)
- **M1 Ingestion and index:** fetch a public repo, filter files, chunk with line ranges, build the index. Tests on small fixture repos.
- **M2 Retrieval and Q&A:** hybrid retrieval plus reranking, answer generation with citations of the form `path:start-end`. Add a **citation verifier** that checks every cited file and line range exists and actually overlaps the retrieved chunk, and drops or flags any citation that fails.
- **M3 Overview features:** architecture overview (entry points, main modules, data flow), "how to run" extraction from README/config, good-first-issue suggestions.
- **M4 UI:** repo input, progress during indexing, chat with clickable citations that show the cited code, overview tab, error and rate-limit states.
- **M5 Evaluation:** write 50 questions about 5 well-known open-source repos with hand-checked expected files. Measure citation accuracy (cited file contains the answer), answer correctness on a sample, and refusal behaviour on unanswerable questions. Compare hybrid retrieval against embeddings-only as an ablation.
- **M6 Polish and deploy:** README with architecture diagram and honest limitations, demo video script, precomputed showcase repos, Vercel deployment.
- **M7 MCP and integrations (optional, last):** MCP server with tools `ask_repo` and `get_architecture`. Mock-first integrations with a Live/Mock toggle: turn a suggested good first issue into a Jira ticket, share an answer to Slack, schedule an onboarding session on a calendar. Mock mode must work with no keys.

## Definition of done and numbers to produce
- Citation accuracy on the 50-question set, with the repos and model named.
- Hybrid vs embeddings-only retrieval comparison.
- Indexing time and cost for a mid-size repo, and p95 answer latency.
- Test count and pass status.

## Rules
- Never fabricate or estimate metrics. Only report values from a run that was actually executed. If a run needs a key or data that is missing, write the exact command for the human and mark the result "not yet measured".
- Every answer must show citations that were verified against the real files. No citation, no confident claim: say "not found in this repo" instead of guessing.
- Never commit secrets. Keep `.env.example` current.
- Conventional commits, one per milestone step. Update PROGRESS.md after each milestone.
- Use the subagents in `.claude/agents/`: builder writes, tester tests, evaluator runs benchmarks, reviewer checks before a milestone is marked done.
- If you need the human (API key, GitHub token, deployment account), stop and say exactly what is needed.
