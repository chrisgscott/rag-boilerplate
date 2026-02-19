# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** 2 of 6 (Document Ingestion Pipeline) — COMPLETE
- **Progress:** 23/42 tasks (55%)
- **Branch:** `phase-2/document-ingestion` (worktree at `.worktrees/phase-2`)
- **All 13 Phase 2 tasks done.** Ready for Phase 2 security review, then Phase 3.

### What's Done (Phase 1) — COMPLETE
- Next.js 16 scaffold with Supabase auth (proxy.ts pattern, not middleware.ts)
- 15 ShadCN/UI components installed (new-york style)
- 4 Supabase migrations: extensions, profiles, organizations, security hardening
- Dashboard shell with ShadCN Sidebar (App/Admin nav sections)
- Auto-org creation on first signup (`ensureOrganization()`)
- Type generation pipeline (`pnpm db:types`)
- RLS on all Phase 1 tables with security hardening applied

### What's Done (Phase 2) — COMPLETE
- **2.1**: documents table + 4 RLS policies (migration 00005)
- **2.2**: document_chunks table + HNSW/GIN indexes + 3 RLS policies (migration 00006)
- **2.3**: Supabase Storage bucket `documents` (config.toml) + 3 storage RLS policies (migration 00007)
- **2.4**: Document upload UI — drag-and-drop, file picker, server actions (upload + delete)
- **2.5**: Document list page — table with status badges, chunk count, delete button, empty state
- **2.6**: PDF parser — `unpdf` library, TDD with 5 passing tests, parser registry
- **2.7**: Markdown parser — header hierarchy extraction, sections with breadcrumb trails, 6 TDD tests
- **2.8**: Recursive text chunker — paragraph → sentence → word splitting, 15% overlap, header context prepend, 11 TDD tests
- **2.9**: OpenAI embedding wrapper — text-embedding-3-small, auto-batching at 100, DI for testing, 7 TDD tests
- **2.10**: Async ingestion pipeline — parse → chunk → embed → upsert, API route at `/api/ingest`, fire-and-forget from client
- **2.11**: Document status tracking — pipeline updates pending → processing → complete/error, UI auto-polls every 3s
- **2.12**: Document deletion with cascade — guards against deleting during processing, FK cascade for chunks
- **2.13**: Content hash tracking — SHA-256 computed during upload, stored in content_hash column

## Recent Changes (This Session)
- Built `lib/parsers/markdown.ts` — parseMarkdown() with section-aware header hierarchy
- Updated `lib/parsers/index.ts` — routes text/markdown to parseMarkdown, re-exports types
- Built `lib/rag/chunker.ts` — recursive splitting with overlap, header context prepend
- Built `lib/rag/embedder.ts` — OpenAI wrapper with batch support, DI via setEmbeddingClient()
- Built `lib/rag/pipeline.ts` — processDocument() orchestrates full ingestion
- Built `app/api/ingest/route.ts` — POST endpoint triggers async processing
- Updated `components/documents/upload-form.tsx` — fires ingestion after upload
- Updated `components/documents/document-list.tsx` — auto-polls when docs are processing
- Updated `app/(dashboard)/documents/actions.ts` — SHA-256 content hash, processing guard on delete
- Installed: openai SDK
- Created tests: markdown-parser.test.ts (6), chunker.test.ts (11), embedder.test.ts (7)
- **29 tests total, all passing. Build clean.**

## Next Steps
1. **Phase 2 Security Review Checkpoint** — verify RLS on documents + document_chunks tables
2. **Phase 3: Search & Retrieval** (tasks 3.1–3.6)
   - 3.1: hybrid_search RPC function (vector + BM25 + RRF)
   - 3.2: Search orchestration layer
   - 3.3: Metadata filtering support
   - 3.4: Configurable top-k and similarity threshold
   - 3.5: Document access logging
   - 3.6: document_access_logs table + RLS
3. **Phase 4: Chat Interface** (tasks 4.1–4.9)
4. **Phase 5: Evaluation & Cost Tracking** (tasks 5.1–5.8)
5. **Phase 6: PropTech Demo & Polish** (tasks 6.1–6.8)

## Key Decisions
- No `src/` directory — root-level app/, components/, lib/ (matches scaffold convention)
- Sidebar split into App/Admin sections (role-based filtering deferred)
- Next.js 16 uses `proxy.ts` not `middleware.ts` for auth
- `getClaims()` (local JWT) used instead of `getUser()` (network call)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (newer) not `ANON_KEY` (legacy)
- Dynamic data wrapped in `<Suspense>` for Partial Prerendering
- Security hardening: search_path on DEFINER functions, tightened org INSERT policy
- REST API + MCP server added to INBOX for headless/AI-native integration
- **Git worktrees** for isolated branch work (`.worktrees/` directory, gitignored)
- **unpdf** over pdf-parse (v2 has problematic API; unpdf is clean Mozilla pdf.js wrapper)
- **Vitest** for unit testing (installed in Phase 2)
- **TDD** (superpowers:test-driven-development) for all logic-heavy components
- Storage path convention: `{organization_id}/{document_id}/{filename}`
- UPDATE RLS policies include WITH CHECK (lesson from Phase 1 security review)
- Using `superpowers:executing-plans` skill — batch execution with review checkpoints
- **Embedder uses DI** — setEmbeddingClient() for testing, avoids vi.mock complexity
- **Ingestion is TypeScript, not Python** — runs as Next.js API route, no separate service needed
- **Chunker reserves overlap budget** — splits into smaller segments to leave room for overlap text
- **Markdown parser preserves header hierarchy** — sections[] with breadcrumb headers array
- **Service architecture** — only 2 services needed: Next.js app + Supabase (no separate Python/FastAPI)

## Open Questions
- Role-based sidebar visibility: when to wire up the actual role check
- Organization UPDATE/DELETE policies deferred to Phase 6
- `current_organization_id` validation (no DB constraint that user belongs to the org)
- `hasEnvVars` bypass in proxy.ts — remove before production
- MCP server: if added later, would be a separate Node.js service (from INBOX)

## Key Files (Phase 2)
- `supabase/migrations/00005_documents.sql` — Documents table + RLS
- `supabase/migrations/00006_document_chunks.sql` — Chunks table + indexes + RLS
- `supabase/migrations/00007_storage_policies.sql` — Storage bucket RLS
- `app/(dashboard)/documents/page.tsx` — Document management page (Server Component)
- `app/(dashboard)/documents/actions.ts` — Upload/delete server actions + content hash
- `components/documents/upload-form.tsx` — Drag-and-drop upload + ingestion trigger
- `components/documents/document-list.tsx` — Document table with status polling
- `lib/parsers/pdf.ts` — PDF text extraction (unpdf)
- `lib/parsers/markdown.ts` — Markdown parser with header hierarchy
- `lib/parsers/index.ts` — Parser registry
- `lib/rag/chunker.ts` — Recursive text chunker
- `lib/rag/embedder.ts` — OpenAI embedding wrapper
- `lib/rag/pipeline.ts` — Ingestion pipeline orchestrator
- `app/api/ingest/route.ts` — Async ingestion API endpoint
- `tests/unit/pdf-parser.test.ts` — 5 PDF parser tests
- `tests/unit/markdown-parser.test.ts` — 6 markdown parser tests
- `tests/unit/chunker.test.ts` — 11 chunker tests
- `tests/unit/embedder.test.ts` — 7 embedder tests
- `vitest.config.ts` — Test configuration

## Commands
```bash
pnpm dev                    # Start dev server
pnpm build                  # Build for production
pnpm db:types               # Regenerate types from schema
pnpm db:reset               # Reset and re-run all migrations
pnpm vitest run             # Run all tests (from worktree dir)
supabase start              # Start local Supabase
```
