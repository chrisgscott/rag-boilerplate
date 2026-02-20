# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** Phase 5 DESIGN COMPLETE — ready for implementation planning
- **Progress:** Phases 1–4 done, Phase 5 design approved
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

## Recent Changes (This Session)
- **Phase 4 branch merged** to main (fast-forward), feature branch deleted
- **Tailwind v4 upgrade** — removed v3 + autoprefixer + tailwindcss-animate, added v4 + @tailwindcss/postcss + tw-animate-css, rewrote globals.css with CSS-based config, deleted tailwind.config.ts
- **ShadCN sidebar-07** adopted — collapsible icon sidebar with TeamSwitcher, NavUser, SidebarRail
- **Org error fixed** — ensureOrganization now checks profiles.current_organization_id first
- **Playwright e2e tests** — 6 tests for chat interface (login, empty state, send/receive, history, new chat)
- **vitest.config.ts** — added e2e exclude pattern
- **Phase 5 design completed** — brainstorming skill, all sections approved

## Next Steps
1. **Write Phase 5 implementation plan** — invoke writing-plans skill
2. **Execute Phase 5** — eval tables, cost tracking, eval runner, feedback UI, dashboards
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
