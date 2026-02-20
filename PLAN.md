# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** Phase 6 COMPLETE — PropTech Demo & Polish
- **Progress:** Phases 1–6 complete on main
- **Branch:** `main` (up to date with origin, 21 commits pushed)
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
- **Eval Retrieval & Detail View Improvements** (3 commits, pushed to origin)
  - Fixed truthiness bug: `0` scores were mapped to `null` (displayed as "--") — changed to explicit `!== null` check
  - Added `expected_doc_names` to demo test cases + wired seeding to resolve doc names → UUIDs for `expected_source_ids`
  - Built expandable row detail view in eval results table: click any result row to see per-case breakdown
  - Per-case table shows: Question, Expected Answer, Generated Answer, Retrieval scores, Answer Quality scores
  - Markdown rendering in generated answers via react-markdown + remark-gfm
  - Tooltips on all score abbreviations (P@k, R@k, MRR, F, R, C) explaining what each metric measures
  - Design doc: `docs/plans/2026-02-20-eval-retrieval-detail-view-design.md`
  - Implementation plan: `docs/plans/2026-02-20-eval-retrieval-detail-view-plan.md`

## Next Steps
1. **Re-seed demo data** — delete existing demo via /admin, re-seed to populate `expected_source_ids` and `expectedAnswer` in new eval runs
2. **Run eval** — verify retrieval scores now show actual values (not "--") and detail view works
3. **Deploy to Render** — add SUPABASE_SERVICE_ROLE_KEY env var, test end-to-end
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
- **Service role client** for admin operations — `lib/supabase/admin.ts` bypasses RLS

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
