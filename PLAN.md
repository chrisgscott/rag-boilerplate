# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** All core phases complete. Docs & polish in progress.
- **Progress:** Phases 1–7 complete. Pushed to origin. README and API guide written.
- **Branch:** `main` (up to date with origin)
- **Repo:** `https://github.com/chrisgscott/rag-boilerplate.git`
- **Supabase Cloud:** `xjzhiprdbzvmijvymkbn` (us-west-2), 31 migrations applied
- **Tests:** 120 TS + 46 Python passing, clean build
- **Docs:** README.md (setup guide), docs/api-guide.md (REST API reference)

### What's Done (Phases 1-7) — ALL COMPLETE
- Phase 1: Next.js 16 + Supabase auth + dashboard shell
- Phase 2: Document upload/management + RLS
- Phase 2.5: Python/FastAPI ingestion (Docling + pgmq)
- Phase 3: Hybrid search (vector + BM25 + RRF) + access logging
- Phase 4: Chat interface (streaming, conversation history, source citations)
- Phase 5: Evaluation & cost tracking + Cohere reranking
- Phase 6: PropTech Demo & Polish + VLM visual extraction
- Phase 7: REST API Layer (9 tasks, all complete, E2E tested)
- Docs: README setup guide, API reference, "Building On Top of This" guide

## Next Steps
1. **Deploy to Render** — add `VLM_ENABLED=true`, `COHERE_API_KEY` env vars, test end-to-end
2. Pick next feature from inbox (see `.ai/INBOX.md`)

## Backlog (from .ai/INBOX.md)

**High-value additions:**
- Embeddable chat widget (`<script>` tag, Intercom-style — REST API backend is ready)
- Inline citations (Perplexity-style — ShadCN component already installed)
- Semantic caching in pgvector (60-90% cost reduction)
- Contextual chunking (Anthropic method — 35-67% failure reduction)

**Nice to have:**
- CLI tools (`rag ingest`, `rag eval`, `rag cost-report`)
- Smart model routing (cheap for simple, powerful for complex)
- Document versioning and diff tracking
- Agentic RAG with multiple retrieval tools
- Multi-query / HyDE retrieval
- Togglable web search (blend outside context with document-grounded answers on demand)
- MCP server (expose RAG as tools for Claude Desktop, Cursor, etc.)

**Verticals:** LegalTech, InsurTech, Course/educational content

## Key Decisions
- No `src/` directory — root-level app/, components/, lib/
- **Solo developer workflow** — merge locally, no PRs needed
- **Tailwind v4** — CSS-based config, @theme inline, tw-animate-css
- **3-service architecture** — Next.js (Render) + Python ingestion (Render) + Supabase (Cloud)
- **AI SDK v6** — UIMessage stream protocol, DefaultChatTransport
- **Custom eval** (not Langfuse) — keeps boilerplate self-contained
- **Per-org system prompt** — `organizations.system_prompt` column in DB
- **Service role client** for admin operations — `lib/supabase/admin.ts` bypasses RLS
- **OpenAI GPT-4o-mini** for VLM — replaces Gemini (rate limit issues), opt-in via `VLM_ENABLED=true`
- **Cohere reranking** — opt-in via `COHERE_API_KEY`, over-fetch 4x then rerank
- **BM25 OR logic** — AND killed natural language queries; switched to OR-based tsquery
- **REST API: Tier 1 scope** — Chat, Documents, Conversations only. Eval/usage/settings stay dashboard-only.
- **REST API: API key auth** — org-scoped, SHA-256 hashed, service role client for all queries
- **REST API: Dual streaming** — SSE default + AI SDK format via Accept header

## Eval Results History
| Run | BM25 | Rerank | Prompt | P@k | R@k | MRR | F | R | C | Cases |
|-----|------|--------|--------|-----|-----|-----|---|---|---|-------|
| 1 | AND | No | Old | 0.93 | 0.93 | 1.00 | 4.0 | 4.6 | 3.9 | 7 |
| 2 | OR | No | Old | 0.69 | 1.00 | 1.00 | 4.3 | 4.6 | 4.0 | 7 |
| 3 | OR | Yes | Old | 0.76 | 0.93 | 1.00 | 4.1 | 4.4 | 3.9 | 7 |
| 4 | OR | Yes | New | 0.76 | 0.93 | 1.00 | 4.4 | 4.7 | 3.7 | 7 |
| 5 | OR | Yes | New | 0.72 | 0.98 | 0.98 | 4.8 | 4.9 | 3.9 | 25 |
| 6 | OR | Yes | New* | 0.72 | 0.98 | 0.98 | 4.9 | 5.0 | 4.4 | 25 |

*Run 6: same config as Run 5 but with trimmed expected answers (removed tangential details from 9 QA pairs)

## Open Questions
- Role-based sidebar visibility (YAGNI'd out of Phase 6)
- Org invitation/member management UI (deferred)
- Dead code cleanup: EnvVarWarning + ConnectSupabaseSteps components (unused after Task 10)

## Commands
```bash
pnpm dev                    # Start Next.js dev server
pnpm build                  # Build for production
pnpm vitest run             # Run TypeScript tests (120 tests)
npx playwright test         # Run Playwright e2e tests (6 tests)
pnpm db:types               # Regenerate types from schema

# Python service (from services/ingestion/)
source .venv/bin/activate && pytest -v  # Run Python tests (46 tests)
```
