# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** 2.5 of 6 (Docling Ingestion Service) — NEARLY COMPLETE (11/12 tasks done)
- **Progress:** 34/42+ tasks (Phase 1 + Phase 2 + Phase 2.5 mostly done)
- **Branch:** `phase-2/document-ingestion` (worktree at `.worktrees/phase-2`)
- **Phase 2.5 plan:** `planning/PHASE_2_5_PLAN.md` (12 tasks, 11 complete)
- **Using skill:** `superpowers:executing-plans` — batch execution with review checkpoints

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

### What's Done (Phase 2.5) — IN PROGRESS (11/12)
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
- **2.5.12**: Docker Compose for local development — PENDING

## Recent Changes (This Session)
- **Batch 3 complete** — Tasks 2.5.7–2.5.9:
  - `592e678` — Python embedding wrapper with DI and batch support (6 tests)
  - `c0d02ab` — Queue worker orchestrating full pipeline (3 tests)
  - `d150215` — Upload UI expanded for DOCX + HTML
- **Batch 4 complete** — Tasks 2.5.10–2.5.11:
  - `bfb9608` — Removed TypeScript parsers/chunker/pipeline, unpdf dependency
  - Updated ARCHITECTURE.md (3-service diagram, pgmq flow, Docling tech stack)
  - Updated INBOX.md (triaged Docling, OCR, Supabase Realtime)
- **Supabase Cloud** instance configured (user set up .env)
- **27 Python tests passing** (7 parser + 11 chunker + 6 embedder + 3 worker)
- **7 TypeScript tests passing** (embedder only — parsers/chunker tests removed with code)
- **Next.js build clean**

## Next Steps
1. **Task 2.5.12**: Docker Compose for local development (last Phase 2.5 task)
2. **Phase 2.5 completion**: Run finishing-a-development-branch skill
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
- **Supabase Cloud** — using cloud instance instead of local Supabase

## Open Questions
- Role-based sidebar visibility: when to wire up the actual role check
- Organization UPDATE/DELETE policies deferred to Phase 6
- `current_organization_id` validation (no DB constraint that user belongs to the org)
- `hasEnvVars` bypass in proxy.ts — remove before production
- Python service `.env` still points to local Supabase — update for cloud when ready for E2E testing

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
supabase start              # Start local Supabase

# Python service (from services/ingestion/)
source .venv/bin/activate   # Activate Python venv
pytest -v                   # Run Python tests (27 tests)
ruff check .                # Lint Python code
uvicorn src.main:app --port 8000  # Start ingestion service
```
