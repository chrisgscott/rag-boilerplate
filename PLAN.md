# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** Phase 5 COMPLETE — all 21 tasks implemented, ready to merge
- **Progress:** Phases 1–5 done on feature branch, pending merge to main
- **Branch:** `phase-5-eval-cost` (15 commits ahead of main)
- **Repo:** `https://github.com/chrisgscott/rag-boilerplate.git`
- **Supabase Cloud:** `xjzhiprdbzvmijvymkbn` (us-west-2), 16 migrations applied (00014-00016 new)
- **Tests:** 64 passing (4 cost + 14 eval-metrics + 6 judge + 7 embedder + 12 search + 21 chat) + 6 Playwright e2e
- **Build:** Clean production build
- **Tailwind:** v4.2.0

### What's Done (Phases 1-5) — COMPLETE
- Phase 1: Next.js 16 + Supabase auth + dashboard shell
- Phase 2: Document upload/management + RLS
- Phase 2.5: Python/FastAPI ingestion (Docling + pgmq)
- Phase 3: Hybrid search (vector + BM25 + RRF) + access logging
- Phase 4: Chat interface (streaming, conversation history, source citations)
- Phase 5: Evaluation & cost tracking (see below)

### Phase 5 — ALL 21 TASKS COMPLETE

**Migrations (Tasks 1-4):**
- `00014_usage_logs.sql` — usage_logs + model_rates tables with RLS
- `00015_eval_tables.sql` — eval_test_sets, eval_test_cases, eval_results with RLS
- `00016_message_feedback.sql` — message_feedback (bigint FK to messages) with RLS
- TypeScript types regenerated

**Core Libraries (Tasks 5-7, TDD):**
- `lib/rag/cost.ts` — calculateCost(), DEFAULT_MODEL_RATES (4 tests)
- `lib/rag/eval-metrics.ts` — precisionAtK, recallAtK, meanReciprocalRank, aggregateMetrics (14 tests)
- `lib/rag/judge.ts` — buildJudgePrompt, parseJudgeResponse (6 tests)

**Cost Tracking (Task 8):**
- `lib/rag/cost-tracker.ts` — getModelRates (DB + fallback), trackUsage (fire-and-forget)
- `app/api/chat/route.ts` — onFinish callback extended with trackUsage()

**Settings & Usage (Tasks 9-12):**
- `app/(dashboard)/settings/actions.ts` — Model rates CRUD + seed defaults
- `components/settings/model-rates-table.tsx` — Admin table with add/delete/seed
- `app/(dashboard)/usage/actions.ts` — getUsageSummary, getRecentUsage
- `components/usage/usage-dashboard.tsx` + `usage-table.tsx` — Dashboard cards + query table
- `app/(dashboard)/usage/page.tsx` — Server Component page

**Feedback (Tasks 13-14):**
- `app/(dashboard)/chat/actions.ts` — submitFeedback (upsert, rating 1 or 5)
- `components/chat/message-feedback.tsx` — ThumbsUp/ThumbsDown (hover-to-show)
- `components/chat/chat-interface.tsx` — Integrated feedback into message rendering

**Eval Engine (Tasks 15-16):**
- `lib/rag/eval-runner.ts` — runEvaluation (retrieval + answer quality phases)
- `app/(dashboard)/eval/actions.ts` — Full Server Actions (test set CRUD, test case CRUD, runEval, getResults, feedback suggestions, convertFeedbackToTestCase)

**Eval Page UI (Tasks 17-20):**
- `app/(dashboard)/eval/page.tsx` — 3-tab Server Component (Test Sets, Run, Results)
- `components/eval/test-set-manager.tsx` — Expandable test set cards with case CRUD
- `components/eval/test-case-form.tsx` — Add test case form
- `components/eval/eval-runner.tsx` — Select test set + run button
- `components/eval/eval-results.tsx` — Results table with ScoreBadge/QualityScore/StatusBadge
- `components/eval/feedback-suggestions.tsx` — Negative feedback → test case conversion

**Final Verification (Task 21):** 64 tests passing, clean build

## Recent Changes (This Session)
- Executed all 21 Phase 5 tasks via subagent-driven development
- Used `bypassPermissions` mode for autonomous execution
- Batched related tasks into single subagents (9+10, 11+12, 13+14, 15+16, 17-20)
- Added ShadCN Tabs component
- 15 commits on `phase-5-eval-cost` branch

## Next Steps
1. **Merge `phase-5-eval-cost` to `main`** — user preference: merge locally (solo dev)
2. **Phase 6: PropTech Demo & Polish** — next major phase

## Key Decisions
- No `src/` directory — root-level app/, components/, lib/
- **Solo developer workflow** — merge locally, no PRs needed
- **Tailwind v4** — CSS-based config, @theme inline, tw-animate-css
- **ShadCN sidebar-07** — collapsible icon sidebar pattern
- **3-service architecture** — Next.js (Render) + Python ingestion (Render) + Supabase (Cloud)
- **AI SDK v6** — UIMessage stream protocol, DefaultChatTransport
- **Phase 5: Custom eval** (not Langfuse) — keeps boilerplate self-contained
- **Phase 5: Model rates in DB** — admin page for managing, not hardcoded
- **Phase 5: Multi-dimension rubric** — faithfulness, relevance, completeness (1-5 each)
- **Phase 5: Feedback loop** — thumbs up/down → convert to eval test cases
- **Phase 5: Subagent-driven execution** — fresh subagent per task batch, bypassPermissions mode

## Open Questions
- Role-based sidebar visibility: when to wire up the actual role check
- Organization UPDATE/DELETE policies deferred to Phase 6
- `current_organization_id` validation (no DB constraint that user belongs to the org)
- `hasEnvVars` bypass in proxy.ts — remove before production
- Sources display for historical messages (stored in DB but not yet passed to UI)
- Chat UI polish items (user noted "things I'd like to change" — deferred to later)

## Commands
```bash
pnpm dev                    # Start Next.js dev server
pnpm build                  # Build for production
pnpm vitest run             # Run TypeScript tests (64 tests)
npx playwright test         # Run Playwright e2e tests (6 tests)
pnpm db:types               # Regenerate types from schema

# Python service (from services/ingestion/)
source .venv/bin/activate && pytest -v  # Run Python tests (27 tests)
```
