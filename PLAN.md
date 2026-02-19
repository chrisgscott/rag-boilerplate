# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** 2.5 of 6 (Docling Ingestion Service) — PLANNING COMPLETE, ready to execute
- **Progress:** 23/42+ tasks (Phase 1 + Phase 2 done, Phase 2.5 planned)
- **Branch:** `phase-2/document-ingestion` (worktree at `.worktrees/phase-2`)
- **Phase 2.5 plan written:** `planning/PHASE_2_5_PLAN.md` (12 tasks)

### What's Done (Phase 1) — COMPLETE
- Next.js 16 scaffold with Supabase auth (proxy.ts pattern, not middleware.ts)
- 15 ShadCN/UI components installed (new-york style)
- 4 Supabase migrations: extensions, profiles, organizations, security hardening
- Dashboard shell with ShadCN Sidebar (App/Admin nav sections)
- Auto-org creation on first signup (`ensureOrganization()`)
- Type generation pipeline (`pnpm db:types`)
- RLS on all Phase 1 tables with security hardening applied

### What's Done (Phase 2) — COMPLETE
- **2.1–2.3**: Database (documents, document_chunks, storage bucket) + RLS + indexes
- **2.4–2.5**: Upload UI (drag-and-drop) + document list (status badges, polling)
- **2.6–2.7**: PDF parser (unpdf) + markdown parser (header hierarchy) — *will be replaced by Docling in Phase 2.5*
- **2.8–2.9**: Recursive text chunker + OpenAI embedding wrapper — *will be ported to Python in Phase 2.5*
- **2.10–2.11**: Async ingestion pipeline + status tracking — *will be replaced by Python service in Phase 2.5*
- **2.12–2.13**: Delete with cascade + SHA-256 content hash
- **29 tests total, all passing. Build clean.**

### What's Planned (Phase 2.5) — READY TO EXECUTE
Migrate ingestion from TypeScript/Next.js to Python/FastAPI with Docling + pgmq.
See `planning/PHASE_2_5_PLAN.md` for detailed 12-task plan.

## Recent Changes (This Session)
- **Consolidated all stale docs** (7 files updated, 1 deleted) — see commit `7f4fed4`
  - Deleted `.ai/CONTEXT.md` (redundant with PLAN.md)
  - Updated `planning/PROJECT_PLAN.md`: Phase 2 tasks → done, added Phase 2.5 section
  - Updated `specs/ARCHITECTURE.md`: 3-service diagram, pgmq flow, Docling in tech stack
  - Updated `specs/PRD.md`: Docling decided, OCR resolved, expanded format support
  - Added decisions #009-#011 to `planning/DECISIONS.md`
  - Rewrote `prompts/HANDOFF_PROMPT.md`: fixed paths, 3-service architecture
  - Triaged `.ai/INBOX.md`: OCR, Realtime, queue items resolved
  - Updated `.claude/CLAUDE.md`: removed CONTEXT.md references

## Next Steps
1. **Phase 2 Security Review Checkpoint** — verify RLS on documents + document_chunks tables
2. **Execute Phase 2.5** — Docling ingestion service (12 tasks in `planning/PHASE_2_5_PLAN.md`)
3. **Phase 3: Search & Retrieval** (tasks 3.1–3.6)
4. **Phase 4: Chat Interface** (tasks 4.1–4.9)
5. **Phase 5: Evaluation & Cost Tracking** (tasks 5.1–5.8)
6. **Phase 6: PropTech Demo & Polish** (tasks 6.1–6.8)

## Key Decisions
- No `src/` directory — root-level app/, components/, lib/ (matches scaffold convention)
- Next.js 16 uses `proxy.ts` not `middleware.ts` for auth
- `getClaims()` (local JWT) used instead of `getUser()` (network call)
- Security hardening: search_path on DEFINER functions, tightened org INSERT policy
- **Git worktrees** for isolated branch work (`.worktrees/` directory, gitignored)
- **Vitest** for unit testing; **TDD** for all logic-heavy components
- Storage path: `{organization_id}/{document_id}/{filename}`
- UPDATE RLS policies include WITH CHECK
- **Embedder uses DI** — setEmbeddingClient() for testing, avoids vi.mock complexity
- **Docling** for document parsing (replaces unpdf) — 97.9% table accuracy, OCR, MIT license
- **Full pipeline in Python** — parse + chunk + embed + upsert all in Python service (eliminates Vercel timeout risk)
- **3-service architecture** — Next.js (Vercel) + Python ingestion (Render) + Supabase (Cloud)
- **Supabase Queues (pgmq)** — reliable job processing with visibility timeout, automatic retries, DLQ
- **pg_cron** — stale job cleanup every 5 min, marks stuck "processing" docs as "error"
- **Supabase as sole integration point** — no direct Next.js ↔ Python communication
- **Expanded format support** — PDF, Markdown, Plain text, DOCX, HTML (Docling-supported)

## Doc Debt — RESOLVED
All stale files consolidated in commit `7f4fed4`. No remaining doc debt.

## Open Questions
- Role-based sidebar visibility: when to wire up the actual role check
- Organization UPDATE/DELETE policies deferred to Phase 6
- `current_organization_id` validation (no DB constraint that user belongs to the org)
- `hasEnvVars` bypass in proxy.ts — remove before production

## Key Files
### Phase 2 (TypeScript — will be partially replaced by Phase 2.5)
- `supabase/migrations/00005_documents.sql` — Documents table + RLS
- `supabase/migrations/00006_document_chunks.sql` — Chunks table + indexes + RLS
- `supabase/migrations/00007_storage_policies.sql` — Storage bucket RLS
- `app/(dashboard)/documents/page.tsx` — Document management page
- `app/(dashboard)/documents/actions.ts` — Upload/delete server actions + content hash
- `components/documents/upload-form.tsx` — Drag-and-drop upload
- `components/documents/document-list.tsx` — Document table with status polling
- `lib/rag/embedder.ts` — OpenAI embedding wrapper (embedQuery stays for search)
- `tests/unit/embedder.test.ts` — 7 embedder tests

### Phase 2.5 (Python — to be created)
- `services/ingestion/` — Python/FastAPI ingestion service
- `supabase/migrations/00008_ingestion_queue.sql` — pgmq queue + enqueue RPC
- `supabase/migrations/00009_ingestion_cron.sql` — pg_cron housekeeping

## Commands
```bash
pnpm dev                    # Start Next.js dev server
pnpm build                  # Build for production
pnpm db:types               # Regenerate types from schema
pnpm db:reset               # Reset and re-run all migrations
pnpm vitest run             # Run all tests (from worktree dir)
supabase start              # Start local Supabase
```
