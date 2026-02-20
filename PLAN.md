# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** Phase 5 IMPLEMENTATION PLAN COMPLETE — ready for execution
- **Progress:** Phases 1–4 done, Phase 5 design approved, implementation plan written
- **Branch:** `main` (all feature branches merged)
- **Repo:** `https://github.com/chrisgscott/rag-boilerplate.git`
- **Supabase Cloud:** `xjzhiprdbzvmijvymkbn` (us-west-2), 13 migrations applied
- **Tests:** 40 passing (7 embedder + 12 search + 21 chat) + 6 Playwright e2e
- **Build:** Clean production build
- **Tailwind:** Upgraded to v4.2.0 (from v3.4.1)

### What's Done (Phases 1-4) — COMPLETE
- Phase 1: Next.js 16 + Supabase auth + dashboard shell
- Phase 2: Document upload/management + RLS
- Phase 2.5: Python/FastAPI ingestion (Docling + pgmq)
- Phase 3: Hybrid search (vector + BM25 + RRF) + access logging
- Phase 4: Chat interface (streaming, conversation history, source citations)

### Phase 5 Design — APPROVED
Design doc: `docs/plans/2026-02-19-phase-5-eval-cost-design.md`

Key decisions:
- **Custom-built** evaluation & cost tracking (not Langfuse) — self-contained in Supabase
- **Cost tracking:** usage_logs table + model_rates table (DB-managed with admin UI)
- **Evaluation:** Retrieval metrics (P@k, R@k, MRR) + answer quality (faithfulness, relevance, completeness via LLM judge)
- **User feedback:** Thumbs up/down on messages → convert to eval test cases
- **Eval runner:** Server Actions (not background queue)
- **UI:** /eval with 3 tabs (Test Sets, Run Evaluation, Results History), /usage dashboard, /settings model rates
- **Eval pipeline:** Search-only for retrieval metrics, full pipeline for answer quality

### Phase 5 Implementation Plan — WRITTEN
Plan doc: `docs/plans/2026-02-19-phase-5-eval-cost-impl.md` (commit a0d9848)

21 tasks covering:
1. **Tasks 1-4:** DB migrations (usage_logs, model_rates, eval tables, message_feedback) + type regen
2. **Tasks 5-7:** Core library with TDD (cost calculator, eval metrics, LLM judge)
3. **Task 8:** Cost tracking integration in chat route's onFinish callback
4. **Tasks 9-12:** Settings page (model rates CRUD) + Usage dashboard
5. **Tasks 13-14:** Message feedback (thumbs up/down in chat)
6. **Tasks 15-16:** Eval runner + Server Actions
7. **Tasks 17-20:** Eval page UI (test sets, runner, results, feedback conversion)
8. **Task 21:** Final verification

User was asked to choose execution method (subagent-driven or parallel session) — has not yet answered.

## Recent Changes (This Session)
- **Phase 5 implementation plan written** — 21-task plan at `docs/plans/2026-02-19-phase-5-eval-cost-impl.md` (commit a0d9848)
- Used writing-plans skill: read all key files (chat route, search, embedder, provider, tests, migrations, sidebar, etc.) to write precise plan with exact code
- Key observations captured in plan: `messages.id` is bigint (not uuid), `hybridSearch()` already returns `queryTokenCount`, next migration = 00014

## Next Steps
1. **Choose execution method** — subagent-driven (this session) vs parallel session
2. **Execute Phase 5** — 21 tasks: migrations, cost tracking, eval system, feedback UI, dashboards
3. **Phase 6: PropTech Demo & Polish**

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

## Open Questions
- Role-based sidebar visibility: when to wire up the actual role check
- Organization UPDATE/DELETE policies deferred to Phase 6
- `current_organization_id` validation (no DB constraint that user belongs to the org)
- `hasEnvVars` bypass in proxy.ts — remove before production
- Sources display for historical messages (stored in DB but not yet passed to UI)
- Chat UI polish items (user noted "things I'd like to change" — deferred to later)

## Key Files
### Phase 5 (Eval & Cost) — DESIGN ONLY
- `docs/plans/2026-02-19-phase-5-eval-cost-design.md` — Approved design doc

### Phase 4 (Chat Interface) — COMPLETE
- `app/api/chat/route.ts` — Streaming chat endpoint
- `app/(dashboard)/chat/page.tsx` + `actions.ts` — Chat page + server actions
- `components/chat/chat-interface.tsx` — Client component with useChat
- `components/ai/` — shadcn.io AI components (message, conversation, prompt-input, sources)
- `tests/unit/chat.test.ts` — 21 tests
- `tests/e2e/chat.spec.ts` — 6 Playwright tests

### Sidebar & Layout
- `components/app-sidebar.tsx` — ShadCN sidebar-07 adapted (App + Admin nav)
- `components/nav-main.tsx` — Flat nav with active state
- `components/nav-user.tsx` + `team-switcher.tsx` — From sidebar-07
- `app/(dashboard)/layout.tsx` — SidebarProvider + SidebarInset layout

### Tailwind v4
- `app/globals.css` — CSS-based config with @theme inline
- `postcss.config.mjs` — @tailwindcss/postcss
- `tailwind.config.ts` — DELETED (config now in CSS)

## Commands
```bash
pnpm dev                    # Start Next.js dev server
pnpm build                  # Build for production
pnpm vitest run             # Run TypeScript tests (40 tests)
npx playwright test         # Run Playwright e2e tests (6 tests)
pnpm db:types               # Regenerate types from schema

# Python service (from services/ingestion/)
source .venv/bin/activate && pytest -v  # Run Python tests (27 tests)
```
