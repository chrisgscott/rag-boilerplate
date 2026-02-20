# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** Phase 6 COMPLETE — PropTech Demo & Polish
- **Progress:** Phases 1–6 complete on main
- **Branch:** `main` (up to date with origin, 21 commits pushed)
- **Repo:** `https://github.com/chrisgscott/rag-boilerplate.git`
- **Supabase Cloud:** `xjzhiprdbzvmijvymkbn` (us-west-2), 23 migrations applied
- **Tests:** 70 passing (4 cost + 14 eval-metrics + 6 judge + 7 embedder + 12 search + 24 chat) + 6 Playwright e2e
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
- **Fix nested button hydration error** — conversation-list.tsx outer `<button>` → `<div role="button">` to avoid `<button>` inside `<button>` (delete button nested in conversation row)
- **Fix RLS infinite recursion** (migration 00023, applied to Supabase Cloud)
  - `organization_members` FOR ALL policy directly queried itself → infinite recursion on org UPDATE/DELETE
  - Created `get_user_owner_organizations()` SECURITY DEFINER function (like `get_user_organizations()` but filtered to owner role)
  - Updated 3 policies: org_members FOR ALL, organizations UPDATE, organizations DELETE
  - Settings page system prompt save now works
- **Embeddable chat widget** idea parked in `.ai/INBOX.md` — script tag / iframe for tenant portals
- **Tests:** 70 passing, clean build, 23 migrations on Supabase Cloud

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

## Future Enhancements
- **Inline citations (Perplexity-style)** — ShadCN `inline-citation` component installed at `components/ai/inline-citation.tsx` + `components/ui/carousel.tsx`. Would replace the collapsible Sources dropdown with inline citation badges that parse `[Document-Name.md]` references from LLM output. Requires: (1) custom Streamdown plugin or post-processor to find bracket citations, (2) mapping document names back to source metadata (documentId, chunkId), (3) rendering `InlineCitation` components inline with streamed text. Medium-lift — save for post-launch polish.

## Open Questions
- Role-based sidebar visibility (YAGNI'd out of Phase 6)
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
