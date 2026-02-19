# Project Context

## Current State
- **Phase:** 1 of 6 (Foundation) — COMPLETE, pending security review
- **Progress:** 10/42 tasks complete
- **Status:** Phase 1 done, ready for Phase 2: Document Ingestion Pipeline

## What's Built
- Next.js 16 scaffold with Supabase auth (proxy.ts, login, sign-up, forgot-password)
- 15 ShadCN/UI components installed
- Supabase local dev running with 3 migrations (extensions, profiles, organizations)
- Dashboard shell with ShadCN Sidebar (App: Chat, Documents; Admin: Eval, Usage, Settings)
- Auto-org creation on first signup (ensureOrganization() in dashboard layout)
- Type generation pipeline (`pnpm db:types`)
- RLS on profiles, organizations, organization_members

## Key Decisions (Quick Reference)
- Stack: Next.js 15 + Supabase + pgvector (Decision #001)
- pgvector over Pinecone (Decision #002)
- RLS for multi-tenancy on ALL tables (Decision #003)
- Hybrid search via RRF (Decision #004)
- Vercel AI SDK for LLM (Decision #005)
- text-embedding-3-small for embeddings (Decision #006)
- Async document ingestion (Decision #007)
- Private GitHub repo for distribution (Decision #008)
- No `src/` directory — root-level app/, components/, lib/ (matches scaffold)
- Sidebar split into App/Admin sections (role-based filtering TODO)

## Gotchas & Nuances
- Next.js 16 uses `proxy.ts` not `middleware.ts`
- `cookies()` and auth calls need `<Suspense>` wrapping (dynamic data)
- Supabase CLI outputs version warnings to stdout — filter in db:types script
- `getClaims()` (fast/local) used instead of `getUser()` (network call)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (not legacy ANON_KEY)
- PostgREST doesn't support pgvector operators — must use RPC functions
- SECURITY INVOKER (not DEFINER) on search RPC so RLS applies
- Tables as complete chunking units — never split a table across chunks
- Recursive chunking at 400-512 tokens with 15% overlap

## Next Up
Phase 2: Document Ingestion Pipeline (tasks 2.1–2.13)
- First: documents table + RLS, document_chunks table + indexes
- Then: Storage bucket, upload UI, parsers, chunker, embedder, ingestion pipeline

## Files to Review Before Phase 2
- `specs/DATA_MODEL.md` — documents + document_chunks schema
- `specs/ARCHITECTURE.md` — ingestion flow diagram
- `docs/rag-design-guide.docx` — Chunking + embedding technical details

## Commands
```bash
pnpm dev                    # Start dev server
pnpm build                  # Build for production
pnpm db:types               # Regenerate types from schema
pnpm db:reset               # Reset and re-run all migrations
supabase start              # Start local Supabase
supabase stop               # Stop local Supabase
pnpm tsc --noEmit          # Type check
```

---
*Last updated: 2026-02-18*
*Update this file at the end of each session*
