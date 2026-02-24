# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** Phase 6 COMPLETE + VLM + Eval + Reranking + Prompt Tuning
- **Progress:** Phases 1–6 complete, VLM, 4 eval runs, BM25 OR fix, Cohere reranking, prompt tuning, 25 test cases
- **Branch:** `main` (needs commit + push)
- **Repo:** `https://github.com/chrisgscott/rag-boilerplate.git`
- **Supabase Cloud:** `xjzhiprdbzvmijvymkbn` (us-west-2), 26 migrations applied
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
- **Prompt tuning:** Softened system prompt refusal behavior in `lib/rag/prompt.ts`. Split single rule into: (1) answer with partial info and note gaps, (2) only refuse when context contains nothing relevant. Fixed LLM over-refusal on parking question (F 1→3, R 1→3, C 1→2).
- **Copy Results button:** Added one-click clipboard copy to eval results page (`components/eval/eval-results.tsx`). Formats summary + per-case results as markdown table for pasting into chat.
- **Expanded eval test set:** Created 18 new QA pairs covering uncovered document sections (utilities, maintenance, lease renewal, insurance, early termination, fitness, EV charging, balcony, HOA fines, trash, move-in, cat registration, conference room, packages, fire safety, windows, tornado, unit mods). Inserted directly into `eval_test_cases` table in Supabase Cloud. Total: 25 test cases (was 7).
- **QA pairs also added to `lib/demo/content.ts`** for future re-seeds.
- **Previous session:** BM25 OR fix, Cohere reranking, eval config cleanup, 72 TS + 46 Python tests.

## Next Steps
1. **Run eval with 25 test cases** — expanded test set ready, need to run eval from UI
2. **Commit + push** all changes (prompt tuning, copy button, expanded QA pairs)
3. **Deploy to Render** — add `VLM_ENABLED=true`, `COHERE_API_KEY` env vars, test end-to-end
4. **Consider OpenAI Responses API** — built-in tool calling (web search) could enhance capabilities

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

## Eval Results History
| Run | BM25 | Rerank | Prompt | P@k | R@k | MRR | F | R | C | Cases |
|-----|------|--------|--------|-----|-----|-----|---|---|---|-------|
| 1 | AND | No | Old | 0.93 | 0.93 | 1.00 | 4.0 | 4.6 | 3.9 | 7 |
| 2 | OR | No | Old | 0.69 | 1.00 | 1.00 | 4.3 | 4.6 | 4.0 | 7 |
| 3 | OR | Yes | Old | 0.76 | 0.93 | 1.00 | 4.1 | 4.4 | 3.9 | 7 |
| 4 | OR | Yes | New | 0.76 | 0.93 | 1.00 | 4.4 | 4.7 | 3.7 | 7 |
| 5 | OR | Yes | New | TBD | TBD | TBD | TBD | TBD | TBD | 25 |

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
