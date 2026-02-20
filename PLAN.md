# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** Phase 6 COMPLETE — PropTech Demo & Polish
- **Progress:** Phases 1–6 complete on main
- **Branch:** `main` (15 commits ahead of origin)
- **Repo:** `https://github.com/chrisgscott/rag-boilerplate.git`
- **Supabase Cloud:** `xjzhiprdbzvmijvymkbn` (us-west-2), 19 migrations applied
- **Tests:** 67 passing (4 cost + 14 eval-metrics + 6 judge + 7 embedder + 12 search + 24 chat) + 6 Playwright e2e
- **Build:** Clean production build
- **Tailwind:** v4.2.0

### What's Done (Phases 1-6) — COMPLETE
- Phase 1: Next.js 16 + Supabase auth + dashboard shell
- Phase 2: Document upload/management + RLS
- Phase 2.5: Python/FastAPI ingestion (Docling + pgmq)
- Phase 3: Hybrid search (vector + BM25 + RRF) + access logging
- Phase 4: Chat interface (streaming, conversation history, source citations)
- Phase 5: Evaluation & cost tracking
- Phase 6: PropTech Demo & Polish (12 commits)

### Phase 6 Summary — COMPLETE
**Design doc:** `docs/plans/2026-02-19-phase-6-proptech-demo-polish-design.md`
**Implementation plan:** `docs/plans/2026-02-19-phase-6-proptech-demo-polish-impl.md`

**Track A: Infrastructure Polish (Tasks 1-10)**
- 3 migrations (00017-00019): system_prompt + is_demo columns, FK fix, org RLS
- Per-org system prompt with buildSystemPrompt() (TDD, 3 new tests)
- Chat route wired to org system prompt
- System prompt editor on settings page
- Sidebar wired to real user/org data with org switching API
- Historical chat messages now surface stored sources
- Removed hasEnvVars bypass (env vars required in all environments)

**Track B: Demo Experience (Tasks 11-12)**
- 3 PropTech demo documents (lease, HOA, community guidelines)
- 7 eval test cases for demo content
- Admin page at /admin with one-click seed/delete demo lifecycle
- Demo org "Sunrise Properties" with cascade delete

## Recent Changes (This Session)
- Executed Phase 6 via subagent-driven development (12 commits)
- Task 1: Migration 00017 — system_prompt + is_demo (b995259)
- Task 2: Migration 00018 — FK ON DELETE SET NULL (a34fd53)
- Task 3: Migration 00019 — org UPDATE/DELETE RLS (7bc008a)
- Task 4: Regenerate TypeScript types (c6a6fe7)
- Task 5: buildSystemPrompt with org prompt (1cd6a12)
- Task 6: Wire chat route to org prompt (5322a91)
- Task 7: System prompt editor (1c4e132)
- Task 8: Sidebar real data + org switching (b2ba3aa)
- Task 9: Surface historical sources (0ad4db6)
- Task 10: Remove hasEnvVars bypass (9599369)
- Task 11: Demo content module (f93c6b4)
- Task 12: Admin page with seed/delete (d3ecd31)

## Next Steps
1. **Push to GitHub** — 15 commits ahead of origin
2. **Deploy to Render** — test end-to-end with live Supabase
3. **Seed demo data** — use /admin page to create Sunrise Properties demo
4. **Run ingestion pipeline** — process the 3 demo documents
5. **Test demo flow** — chat with PropTech assistant, verify sources

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
- **Phase 6: Admin page** — /admin with seed + delete demo buttons

## Open Questions
- Role-based sidebar visibility (YAGNI'd out of Phase 6)
- Chat UI cosmetic polish (deferred to later)
- Org invitation/member management UI (deferred)
- Dead code cleanup: EnvVarWarning + ConnectSupabaseSteps components (unused after Task 10)

## Commands
```bash
pnpm dev                    # Start Next.js dev server
pnpm build                  # Build for production
pnpm vitest run             # Run TypeScript tests (67 tests)
npx playwright test         # Run Playwright e2e tests (6 tests)
pnpm db:types               # Regenerate types from schema

# Python service (from services/ingestion/)
source .venv/bin/activate && pytest -v  # Run Python tests (27 tests)
```
