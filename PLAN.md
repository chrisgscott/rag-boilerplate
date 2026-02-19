# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** Phase 3 PLANNED, ready for implementation
- **Progress:** 36/42+ tasks (Phase 1 + Phase 2 + Phase 2.5 all done; Phase 3 designed + planned)
- **Branch:** `main` (all feature branches merged and deleted)
- **Repo:** `https://github.com/chrisgscott/rag-boilerplate.git`
- **Supabase Cloud:** `xjzhiprdbzvmijvymkbn` (us-west-2), 9 migrations applied, user seeded
- **Phase 3 Plan:** `docs/plans/2026-02-19-phase-3-search-retrieval-plan.md` (10 tasks, TDD)
- **Phase 3 Design:** `docs/plans/2026-02-19-phase-3-search-retrieval-design.md`

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
- **2.6–2.7**: PDF parser (unpdf) + markdown parser — *replaced by Docling in Phase 2.5*
- **2.8–2.9**: Recursive text chunker + OpenAI embedding wrapper — *ported to Python in Phase 2.5*
- **2.10–2.11**: Async ingestion pipeline + status tracking — *replaced by Python service in Phase 2.5*
- **2.12–2.13**: Delete with cascade + SHA-256 content hash
- Security review PASSED — RLS verified on documents, document_chunks, storage

### What's Done (Phase 2.5) — COMPLETE (12/12)
- **2.5.1**: pgmq ingestion queue + enqueue RPC (`00008_ingestion_queue.sql`) ✅
- **2.5.2**: pg_cron stale job cleanup every 5 min (`00009_ingestion_cron.sql`) ✅
- **2.5.3**: Next.js switched from fire-and-forget to `supabase.rpc('enqueue_ingestion')` ✅
- **2.5.4**: Python/FastAPI scaffold with Docling v2.74.0, health endpoint working ✅
- **2.5.5**: Docling document parser — PDF, Markdown, Plain text, section extraction (7 tests) ✅
- **2.5.6**: Python recursive chunker — ported from TypeScript (11 tests) ✅
- **2.5.7**: Python embedding wrapper — DI via set_embedding_client(), batch at 100 (6 tests) ✅
- **2.5.8**: Queue worker — polls pgmq, orchestrates parse→chunk→embed→upsert (3 tests) ✅
- **2.5.9**: Upload UI expanded for DOCX + HTML formats ✅
- **2.5.10**: Cleaned up replaced TypeScript code (removed parsers, chunker, pipeline, unpdf) ✅
- **2.5.11**: Updated ARCHITECTURE.md + INBOX.md for 3-service architecture ✅
- **2.5.12**: Docker Compose for local development ✅

## Recent Changes (This Session)
- **Phase 3 brainstorming complete**: Design approved via superpowers:brainstorming skill
- **Design doc committed**: `docs/plans/2026-02-19-phase-3-search-retrieval-design.md` (0f0b3d2)
- **Implementation plan committed**: `docs/plans/2026-02-19-phase-3-search-retrieval-plan.md` (d6c4b39)
- **10 tasks planned**: 2 migrations + 7 TDD tasks + 1 docs update
- **Hosting decision**: Next.js moves from Vercel to Render (all services on one platform)
- **Ready for**: superpowers:subagent-driven-development to execute the plan

## Next Steps
1. **Execute Phase 3 plan** — use `superpowers:subagent-driven-development` to implement `docs/plans/2026-02-19-phase-3-search-retrieval-plan.md` (10 tasks)
2. **Phase 4: Chat Interface** (tasks 4.1–4.9)
3. **Phase 5: Evaluation & Cost Tracking** (tasks 5.1–5.8)
4. **Phase 6: PropTech Demo & Polish** (tasks 6.1–6.8)

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
- **3-service architecture** — Next.js (Render) + Python ingestion (Render) + Supabase (Cloud)
- **Hosting consolidation** — Next.js moved from Vercel to Render (simpler, no serverless timeouts)
- **Phase 3 filter strategy** — `filter_document_ids uuid[]` in RPC, higher-level filters (mime, date) resolved to doc IDs in TypeScript
- **Phase 3 similarity threshold** — NOT enforced in search layer; belongs in chat (Phase 4) and eval (Phase 5)
- **Phase 3 access logging** — fire-and-forget, one row per document per query, failures swallowed
- **Phase 3 single function** — `hybridSearch(supabase, params)` orchestrates embed → filter → RPC → log
- **Supabase Queues (pgmq)** — reliable job processing with visibility timeout, automatic retries, DLQ
- **pg_cron** — stale job cleanup every 5 min, marks stuck "processing" docs as "error"
- **Supabase as sole integration point** — no direct Next.js ↔ Python communication
- **Expanded format support** — PDF, Markdown, Plain text, DOCX, HTML (Docling-supported)
- **Supabase Cloud** — using cloud instance (project ref: xjzhiprdbzvmijvymkbn, region: us-west-2)
- **Direct DB connection** for Python worker (port 5432) — long-running transactions during pgmq processing

## Open Questions
- Role-based sidebar visibility: when to wire up the actual role check
- Organization UPDATE/DELETE policies deferred to Phase 6
- `current_organization_id` validation (no DB constraint that user belongs to the org)
- `hasEnvVars` bypass in proxy.ts — remove before production

## Key Files
### Phase 2 (TypeScript)
- `supabase/migrations/00005_documents.sql` — Documents table + RLS
- `supabase/migrations/00006_document_chunks.sql` — Chunks table + indexes + RLS
- `supabase/migrations/00007_storage_policies.sql` — Storage bucket RLS
- `app/(dashboard)/documents/page.tsx` — Document management page
- `app/(dashboard)/documents/actions.ts` — Upload/delete server actions + enqueue_ingestion
- `components/documents/upload-form.tsx` — Drag-and-drop upload (PDF/MD/TXT/HTML/DOCX)
- `components/documents/document-list.tsx` — Document table with status polling
- `lib/rag/embedder.ts` — OpenAI embedding wrapper (query-time only)
- `tests/unit/embedder.test.ts` — 7 embedder tests

### Phase 2.5 (Python)
- `services/ingestion/` — Python/FastAPI ingestion service
- `services/ingestion/src/config.py` — pydantic-settings config
- `services/ingestion/src/main.py` — FastAPI app with worker loop lifecycle
- `services/ingestion/src/parser.py` — Docling document parser
- `services/ingestion/src/chunker.py` — Recursive text chunker
- `services/ingestion/src/embedder.py` — OpenAI embedding wrapper (batch)
- `services/ingestion/src/worker.py` — Queue worker (pgmq → pipeline orchestrator)
- `services/ingestion/tests/` — 27 passing tests
- `supabase/migrations/00008_ingestion_queue.sql` — pgmq queue + enqueue RPC
- `supabase/migrations/00009_ingestion_cron.sql` — pg_cron housekeeping

## Commands
```bash
pnpm dev                    # Start Next.js dev server
pnpm build                  # Build for production
pnpm db:types               # Regenerate types from schema
pnpm vitest run             # Run TypeScript tests (7 embedder tests)

# Python service (from services/ingestion/)
source .venv/bin/activate   # Activate Python venv
pytest -v                   # Run Python tests (27 tests)
ruff check .                # Lint Python code
uvicorn src.main:app --port 8000  # Start ingestion service
```
