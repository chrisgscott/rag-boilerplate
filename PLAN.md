# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** Phase 6 COMPLETE + bugfix session
- **Progress:** Phases 1–6 complete on main, ingestion pipeline bugs fixed
- **Branch:** `main` (2 commits ahead of origin)
- **Repo:** `https://github.com/chrisgscott/rag-boilerplate.git`
- **Supabase Cloud:** `xjzhiprdbzvmijvymkbn` (us-west-2), 24 migrations applied
- **Tests:** 70 TS + 27 Python passing, clean build
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
- **Fix enqueue_ingestion permissions** (migration 00024) — `SECURITY INVOKER` → `SECURITY DEFINER` with explicit org membership check. Root cause: `authenticated` role has no USAGE on `pgmq` schema, so the RPC silently failed. Documents uploaded but never queued.
- **Fix chunker infinite recursion** — `_split_segment` ↔ `_merge_segments` mutual recursion had no base case for single oversized tokens. Added hard character split fallback.
- **Fix worker retry loop** — `conn.rollback()` after failure undid `pgmq.read` visibility timeout (same transaction). Added `conn.commit()` after read to persist the lock. Messages now properly increment `read_ct` on retry.
- **Raise upload body size limit** — Next.js 16 requires `experimental.serverActions.bodySizeLimit` (50MB) AND `experimental.proxyClientMaxBodySize` (50MB). Two separate limits.
- **VLM research completed** — Gemini 2.5 Flash selected for optional visual extraction step ($0.03/100 pages). GOOGLE_API_KEY added to ingestion `.env`. Feature parked in INBOX.md for next session.

## Next Steps
1. **Plan & implement VLM visual extraction** — Gemini 2.5 Flash step in ingestion pipeline for pages with images/charts/diagrams. GOOGLE_API_KEY already configured.
2. **Re-seed demo data** — delete existing demo via /admin, re-seed
3. **Run eval** — verify retrieval scores
4. **Deploy to Render** — add env vars, test end-to-end
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
- **Service role client** for admin operations — `lib/supabase/admin.ts` bypasses RLS
- **Gemini 2.5 Flash** for VLM visual extraction — best quality/cost balance (~$0.03/100 pages)
- **enqueue_ingestion as SECURITY DEFINER** — authenticated role lacks pgmq schema access; function does explicit org membership check instead of relying on RLS

## Future Enhancements
- **Inline citations (Perplexity-style)** — ShadCN `inline-citation` component installed. Medium-lift — save for post-launch polish.
- **VLM visual extraction** — Gemini 2.5 Flash for document pages with images/charts/diagrams. See `.ai/INBOX.md`.

## Open Questions
- Role-based sidebar visibility (YAGNI'd out of Phase 6)
- Org invitation/member management UI (deferred)
- Dead code cleanup: EnvVarWarning + ConnectSupabaseSteps components (unused after Task 10)

## Commands
```bash
pnpm dev                    # Start Next.js dev server
pnpm build                  # Build for production
pnpm vitest run             # Run TypeScript tests (70 tests)
npx playwright test         # Run Playwright e2e tests (6 tests)
pnpm db:types               # Regenerate types from schema

# Python service (from services/ingestion/)
source .venv/bin/activate && pytest -v  # Run Python tests (27 tests)
```
