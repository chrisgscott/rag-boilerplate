# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** 2 of 6 (Document Ingestion Pipeline) — IN PROGRESS
- **Progress:** 16/42 tasks (38%)
- **Branch:** `phase-2/document-ingestion` (worktree at `.worktrees/phase-2`)
- **Batch:** Batch 2 complete (tasks 2.4–2.6), ready for Batch 3 (2.7–2.9)

### What's Done (Phase 1) — COMPLETE
- Next.js 16 scaffold with Supabase auth (proxy.ts pattern, not middleware.ts)
- 15 ShadCN/UI components installed (new-york style)
- 4 Supabase migrations: extensions, profiles, organizations, security hardening
- Dashboard shell with ShadCN Sidebar (App/Admin nav sections)
- Auto-org creation on first signup (`ensureOrganization()`)
- Type generation pipeline (`pnpm db:types`)
- RLS on all Phase 1 tables with security hardening applied

### What's Done (Phase 2 so far)
- **2.1**: documents table + 4 RLS policies (migration 00005)
- **2.2**: document_chunks table + HNSW/GIN indexes + 3 RLS policies (migration 00006)
- **2.3**: Supabase Storage bucket `documents` (config.toml) + 3 storage RLS policies (migration 00007)
- **2.4**: Document upload UI — drag-and-drop, file picker, server actions (upload + delete)
- **2.5**: Document list page — table with status badges, chunk count, delete button, empty state
- **2.6**: PDF parser — `unpdf` library, TDD with 5 passing tests, parser registry

## Recent Changes (This Session)
- Added `.worktrees/` to .gitignore, created git worktree for Phase 2
- Created migrations: 00005_documents, 00006_document_chunks, 00007_storage_policies
- Configured storage bucket in supabase/config.toml
- Built `app/(dashboard)/documents/actions.ts` — uploadDocument(), deleteDocument()
- Built `components/documents/upload-form.tsx` — drag-and-drop with file preview
- Built `components/documents/document-list.tsx` — status table with badges
- Updated `app/(dashboard)/documents/page.tsx` — Server Component with data fetching
- Built `lib/parsers/pdf.ts` — parsePdf() using unpdf
- Built `lib/parsers/index.ts` — parser registry (PDF, markdown, plaintext)
- Created `tests/unit/pdf-parser.test.ts` — 5 tests (TDD: red-green-refactor)
- Installed: vitest, unpdf
- Created vitest.config.ts

## Next Steps
1. **Batch 3: Tasks 2.7–2.9**
   - 2.7: Markdown parser implementation (header hierarchy) — already scaffolded as parseText in registry
   - 2.8: Recursive text chunker (400-512 tokens, 15% overlap) — USE TDD
   - 2.9: OpenAI embedding wrapper (text-embedding-3-small, batch support) — USE TDD

2. **Batch 4: Tasks 2.10–2.13**
   - 2.10: Async ingestion pipeline (parse → chunk → embed → upsert)
   - 2.11: Document status tracking (pending → processing → complete → error)
   - 2.12: Document deletion with cascade
   - 2.13: Content hash tracking for delta processing

3. **After Phase 2**: Security review checkpoint, then Phase 3 (Search & Retrieval)

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

## Open Questions
- Role-based sidebar visibility: when to wire up the actual role check
- Organization UPDATE/DELETE policies deferred to Phase 6
- `current_organization_id` validation (no DB constraint that user belongs to the org)
- `hasEnvVars` bypass in proxy.ts — remove before production
- Markdown parser: should it preserve header hierarchy as metadata? (relevant for chunker)

## Key Files (Phase 2)
- `supabase/migrations/00005_documents.sql` — Documents table + RLS
- `supabase/migrations/00006_document_chunks.sql` — Chunks table + indexes + RLS
- `supabase/migrations/00007_storage_policies.sql` — Storage bucket RLS
- `app/(dashboard)/documents/page.tsx` — Document management page (Server Component)
- `app/(dashboard)/documents/actions.ts` — Upload/delete server actions
- `components/documents/upload-form.tsx` — Drag-and-drop upload
- `components/documents/document-list.tsx` — Document table with status
- `lib/parsers/pdf.ts` — PDF text extraction (unpdf)
- `lib/parsers/index.ts` — Parser registry
- `tests/unit/pdf-parser.test.ts` — PDF parser tests
- `vitest.config.ts` — Test configuration

## Commands
```bash
pnpm dev                    # Start dev server
pnpm build                  # Build for production
pnpm db:types               # Regenerate types from schema
pnpm db:reset               # Reset and re-run all migrations
pnpm vitest run             # Run all tests
pnpm vitest run tests/unit/pdf-parser.test.ts  # Run specific test
supabase start              # Start local Supabase
```
