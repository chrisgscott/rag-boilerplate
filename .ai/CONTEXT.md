# Project Context

## Current State
- **Phase:** 1 of 6 (Foundation)
- **Progress:** 0/42 tasks complete
- **Status:** Specs complete, ready to begin implementation

## Active Focus
Ready to begin Phase 1: Foundation — scaffolding, auth, core schema, multi-tenant org setup.

First task: `1.1 — Scaffold with npx create-next-app . -e with-supabase`

## Key Decisions (Quick Reference)
- Stack: Next.js 15 + Supabase + pgvector (Decision #001)
- pgvector over Pinecone (Decision #002)
- RLS for multi-tenancy on ALL tables (Decision #003)
- Hybrid search via RRF (Decision #004)
- Vercel AI SDK for LLM (Decision #005)
- text-embedding-3-small for embeddings (Decision #006)
- Async document ingestion (Decision #007)
- Private GitHub repo for distribution (Decision #008)

## Gotchas & Nuances
- Use Supabase transaction pooler (port 6543) for serverless
- PostgREST doesn't support pgvector operators — must use RPC functions
- SECURITY INVOKER (not DEFINER) on search RPC so RLS applies
- Tables as complete chunking units — never split a table across chunks
- Recursive chunking at 400-512 tokens with 15% overlap

## Files to Review Before Coding
- `specs/PRD.md` — What we're building
- `specs/ARCHITECTURE.md` — How it's structured
- `specs/DATA_MODEL.md` — Full schema + RLS
- `planning/PROJECT_PLAN.md` — Current task
- `docs/rag-design-guide.docx` — RAG technical reference

## Stack Quick Reference
- **Scaffolding:** `npx create-next-app . -e with-supabase`
- **Frontend:** Next.js 15 (App Router) + ShadCN/UI
- **Backend:** Supabase (Postgres, Auth, Storage, RLS, pgvector)
- **LLM:** Vercel AI SDK (Claude, OpenAI)
- **Embeddings:** OpenAI text-embedding-3-small
- **Search:** pgvector HNSW + tsvector BM25 + RRF
- **Testing:** Vitest + Playwright

## Commands
```bash
pnpm dev                    # Start dev server
pnpm build                  # Build for production
supabase start              # Start local Supabase
supabase db reset           # Reset and re-run migrations
supabase gen types typescript --local > src/types/database.types.ts
pnpm test                   # Run unit tests
pnpm tsc --noEmit          # Type check
```

---
*Last updated: 2026-02-18*
*Update this file at the end of each session*
