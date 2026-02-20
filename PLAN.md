# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** Phase 6 PLANNED — design approved, implementation plan written, ready for execution
- **Progress:** Phases 1–5 complete on main, Phase 6 plan committed
- **Branch:** `main` (Phase 5 merged, Phase 6 plans committed)
- **Repo:** `https://github.com/chrisgscott/rag-boilerplate.git`
- **Supabase Cloud:** `xjzhiprdbzvmijvymkbn` (us-west-2), 16 migrations applied
- **Tests:** 64 passing (4 cost + 14 eval-metrics + 6 judge + 7 embedder + 12 search + 21 chat) + 6 Playwright e2e
- **Build:** Clean production build
- **Tailwind:** v4.2.0

### What's Done (Phases 1-5) — COMPLETE
- Phase 1: Next.js 16 + Supabase auth + dashboard shell
- Phase 2: Document upload/management + RLS
- Phase 2.5: Python/FastAPI ingestion (Docling + pgmq)
- Phase 3: Hybrid search (vector + BM25 + RRF) + access logging
- Phase 4: Chat interface (streaming, conversation history, source citations)
- Phase 5: Evaluation & cost tracking (merged to main)

### Phase 6 — DESIGN APPROVED, PLAN WRITTEN, READY TO EXECUTE

**Design doc:** `docs/plans/2026-02-19-phase-6-proptech-demo-polish-design.md`
**Implementation plan:** `docs/plans/2026-02-19-phase-6-proptech-demo-polish-impl.md`

**13 tasks in two tracks:**

**Track A: Infrastructure Polish**
1. Migration 00017: `system_prompt` + `is_demo` on organizations
2. Migration 00018: Fix `profiles.current_organization_id` FK → ON DELETE SET NULL
3. Migration 00019: Org UPDATE/DELETE RLS policies
4. Regenerate TypeScript types
5. `buildSystemPrompt()` with org prompt support (TDD, 3 new tests)
6. Wire chat route to fetch org system prompt
7. System prompt editor on settings page
8. Wire sidebar to real user/org data + org switching API route
9. Surface sources in historical chat messages
10. Remove `hasEnvVars` bypass

**Track B: Demo Experience**
11. Create demo document content (3 PropTech Markdown docs + 7 eval test cases)
12. Admin page with seed/delete demo lifecycle
13. Final verification

**Key design decisions:**
- All demo content under a dedicated "Sunrise Properties" org with `is_demo = true`
- One-click delete = delete org row, FKs cascade everything
- Per-org system prompt in `organizations.system_prompt` column
- Security rules hardcoded (non-overridable by org prompt)
- Admin page at `/admin` (new sidebar nav item)

## Recent Changes (This Session)
- Merged `phase-5-eval-cost` to `main` (fast-forward, 32 files +2883 lines)
- Pushed main to GitHub
- Deleted `phase-5-eval-cost` branch
- Brainstormed Phase 6 scope (5 design sections approved)
- Wrote Phase 6 design doc (commit 99e3a1c)
- Wrote Phase 6 implementation plan — 13 tasks (commit a9149df)
- User has NOT yet chosen execution method (subagent-driven vs parallel session)

## Next Steps
1. **Choose execution method** — subagent-driven (same session) vs parallel session
2. **Execute Phase 6** — 13 tasks per implementation plan
3. User preference: execute autonomously like Phase 5 (subagent-driven, bypassPermissions)

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
- `current_organization_id` validation constraint (YAGNI'd out of Phase 6)
- Chat UI cosmetic polish (deferred to later)
- Org invitation/member management UI (deferred)

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
