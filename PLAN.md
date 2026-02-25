# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** REST API Layer (in progress)
- **Progress:** Phases 1–6 complete, VLM, eval, reranking done. REST API Task 1 of 9 complete.
- **Branch:** `main` (3 commits ahead of origin)
- **Repo:** `https://github.com/chrisgscott/rag-boilerplate.git`
- **Supabase Cloud:** `xjzhiprdbzvmijvymkbn` (us-west-2), 27 migrations applied
- **Tests:** 72 TS + 46 Python passing, clean build
- **Tailwind:** v4.2.0

### What's Done (Phases 1-6) — COMPLETE
- Phase 1: Next.js 16 + Supabase auth + dashboard shell
- Phase 2: Document upload/management + RLS
- Phase 2.5: Python/FastAPI ingestion (Docling + pgmq)
- Phase 3: Hybrid search (vector + BM25 + RRF) + access logging
- Phase 4: Chat interface (streaming, conversation history, source citations)
- Phase 5: Evaluation & cost tracking
- Phase 6: PropTech Demo & Polish (12 commits)

## Recent Changes (This Session)
- **REST API design:** Brainstormed and wrote design doc at `docs/plans/2026-02-24-rest-api-design.md`
- **REST API plan:** Wrote 9-task implementation plan at `docs/plans/2026-02-24-rest-api-plan.md`
- **Task 1 COMPLETE:** Applied `api_keys` table migration (migration 00027) to Supabase Cloud
- **Using subagent-driven development** to execute tasks 2-9

### REST API Implementation Progress
| Task | Status | Description |
|------|--------|-------------|
| 1 | DONE | `api_keys` table migration (00027) |
| 2 | NEXT | API auth helper (`lib/api/auth.ts`) + response utilities (`lib/api/response.ts`) |
| 3 | Pending | Documents list + upload (`app/api/v1/documents/route.ts`) |
| 4 | Pending | Document detail + delete (`app/api/v1/documents/[id]/route.ts`) |
| 5 | Pending | Conversations list, detail, delete |
| 6 | Pending | Feedback endpoint |
| 7 | Pending | Chat API with SSE + AI SDK dual streaming |
| 8 | Pending | Dashboard API key management UI (settings page) |
| 9 | Pending | Build verification & cleanup |

## Next Steps
1. **Continue REST API implementation** — Tasks 2-9 per plan
2. **Deploy to Render** — add `VLM_ENABLED=true`, `COHERE_API_KEY` env vars, test end-to-end
3. **Inline citations** — Perplexity-style bracket ref parsing (deferred)

## Key Decisions
- No `src/` directory — root-level app/, components/, lib/
- **Solo developer workflow** — merge locally, no PRs needed
- **Tailwind v4** — CSS-based config, @theme inline, tw-animate-css
- **ShadCN sidebar-07** — collapsible icon sidebar pattern
- **3-service architecture** — Next.js (Render) + Python ingestion (Render) + Supabase (Cloud)
- **AI SDK v6** — UIMessage stream protocol, DefaultChatTransport
- **Phase 5: Custom eval** (not Langfuse) — keeps boilerplate self-contained
- **Phase 6: Demo org approach** — all demo content under one org, cascade delete
- **Phase 6: Per-org system prompt** — `organizations.system_prompt` column in DB
- **Service role client** for admin operations — `lib/supabase/admin.ts` bypasses RLS
- **OpenAI GPT-4o-mini** for VLM visual extraction — replaces Gemini (rate limit issues), uses existing API key
- **VLM_ENABLED flag** — opt-in via env var, replaces implicit google_api_key check
- **Org-prefixed storage paths** — `{org_id}/page-images/{doc_id}/page-N.webp` to match RLS policy that casts first folder to UUID
- **Dialog lightbox for page images** — uses existing shadcn Dialog component, no new dependencies
- **useSignedUrl hook** — lazy client-side signed URL generation with stale reset, reused across SourceThumbnail and PageImageCard
- **Skeleton loading states** — prevents layout shift in Dialog lightbox and thumbnail cards
- **Lightbox prev/next** — portaled arrows outside DialogContent, centered wrapper pattern for edge positioning
- **BM25 OR logic** — `websearch_to_tsquery` ANDs all terms (kills natural language queries); switched to OR via `replace(plainto_tsquery(...)::text, ' & ', ' | ')::tsquery`
- **Cohere reranking** — `cohere-ai` SDK, `rerank-v3.5` model, opt-in via `COHERE_API_KEY` env var; over-fetch 4x candidates from hybrid_search, rerank down to final count
- **REST API: Tier 1 scope** — Chat, Documents, Conversations only. Eval/usage/settings stay dashboard-only.
- **REST API: API key auth** — org-scoped, SHA-256 hashed, stored in `api_keys` table. Service role client for all API queries.
- **REST API: Dual streaming** — SSE default (`text/event-stream`) + AI SDK format (`text/x-vercel-ai-data-stream`) via Accept header
- **REST API: Same Next.js app** — `/api/v1/` routes alongside existing app, sharing all `lib/rag/*` code
- **REST API: Direct upload** — multipart/form-data through API server (not presigned URLs)

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

## Future Enhancements
- **Inline citations (Perplexity-style)** — ShadCN `inline-citation` component installed. Medium-lift — save for post-launch polish.
- **OpenAI Responses API** — built-in tool calling (web search) could enhance capabilities. Vercel AI SDK abstracts the API layer, so switching would be straightforward if needed.

## Open Questions
- Role-based sidebar visibility (YAGNI'd out of Phase 6)
- Org invitation/member management UI (deferred)
- Dead code cleanup: EnvVarWarning + ConnectSupabaseSteps components (unused after Task 10)

## Commands
```bash
pnpm dev                    # Start Next.js dev server
pnpm build                  # Build for production
pnpm vitest run             # Run TypeScript tests (72 tests)
npx playwright test         # Run Playwright e2e tests (6 tests)
pnpm db:types               # Regenerate types from schema

# Python service (from services/ingestion/)
source .venv/bin/activate && pytest -v  # Run Python tests (46 tests)
```
