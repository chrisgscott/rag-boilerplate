# RAG Boilerplate

## Project Overview
A production-ready RAG boilerplate built on Next.js 15 + Supabase + pgvector. Developers purchase access to a private GitHub repo, fork it, and customize it to build AI-powered document Q&A features. Ships with a PropTech demo (lease & HOA document Q&A), built-in evaluation tooling, cost tracking, and security defaults.

## Tech Stack
- **Scaffolding:** `npx create-next-app . -e with-supabase`
- **Frontend:** Next.js 15 (App Router), ShadCN/UI, TailwindCSS
- **Backend:** Supabase (Postgres, Auth, Storage, RLS, pgvector)
- **LLM:** Vercel AI SDK (provider-agnostic: Claude, OpenAI)
- **Embeddings:** OpenAI text-embedding-3-small (1536 dims)
- **Search:** pgvector HNSW + Postgres tsvector (hybrid via RRF)
- **Testing:** Vitest + Playwright
- **Hosting:** Vercel (frontend), Supabase (backend)

## Key Patterns

### Data Fetching
- Server Components for reads (default)
- Server Actions for mutations
- ONE exception: `/api/chat/route.ts` uses Route Handler for Vercel AI SDK streaming
- Generate types: `supabase gen types typescript --local > src/types/database.types.ts`

### Authorization
- ALL auth via Supabase RLS — no application-level auth checks
- Every table with org-scoped data has RLS enabled
- `get_user_organizations()` helper function is the foundation
- RPC functions use SECURITY INVOKER (not DEFINER)
- Cross-tenant isolation tests verify this

### Vector Operations
- PostgREST doesn't support pgvector operators — use RPC functions
- Call via `supabase.rpc('hybrid_search', { ... })`
- RLS applies automatically via SECURITY INVOKER

### Multi-Tenancy
- `organization_id` column on all tenant-scoped tables
- RLS policies filter by user's organizations
- Denormalize `organization_id` on child tables (e.g., document_chunks) for RLS performance

### Connection Pooling
- Use Supabase transaction pooler (port 6543) in serverless environments
- Direct connection (port 5432) for migrations only

### File Organization
- Pages in `src/app/(dashboard)/`
- Server Actions colocated with pages in `actions.ts`
- RAG pipeline logic in `src/lib/rag/`
- Parsers in `src/lib/parsers/`
- Evaluation logic in `src/lib/eval/`
- Supabase clients in `src/lib/supabase/`

## Session Protocol

### At Session Start
1. Read `.ai/CONTEXT.md` for current state
2. Check `planning/PROJECT_PLAN.md` for current task
3. Review relevant `specs/` files for the task
4. Check `docs/rag-design-guide.docx` for RAG-specific guidance

### During Development
- Add ideas to `.ai/INBOX.md` (don't scope creep)
- Append gotchas to `.ai/LEARNINGS.md`
- Log significant decisions in `planning/DECISIONS.md`
- Always implement RLS when creating new tables
- Run backpressure commands after each task

### At Session End
1. Update `planning/PROJECT_PLAN.md` with completed tasks
2. Update `.ai/CONTEXT.md` with current state summary
3. Commit with message referencing task ID

## Commands

```bash
# Development
pnpm dev                    # Start dev server (http://localhost:3000)
pnpm build                  # Production build
pnpm lint                   # Run ESLint

# Database
supabase start              # Start local Supabase
supabase stop               # Stop local Supabase
supabase db reset           # Reset and re-run all migrations
supabase gen types typescript --local > src/types/database.types.ts

# Testing
pnpm test                   # Run Vitest
pnpm test:e2e              # Run Playwright
pnpm tsc --noEmit          # Type check only
```

## Anti-Patterns (Avoid These)

- Don't use API routes for CRUD — use Server Actions
- Don't check auth in application code — rely on RLS
- Don't use `any` types — generate types from Supabase
- Don't skip RLS on new tables — every table needs policies
- Don't use SECURITY DEFINER on search RPC functions — use INVOKER
- Don't expose service_role key in client code — server-only
- Don't chunk through tables — extract tables as complete units
- Don't use naive fixed-size chunking — use recursive with overlap
- Don't skip the similarity threshold — refuse to answer below 0.7

## Design Reference
- `docs/rag-design-guide.docx` — Comprehensive RAG technical reference
- `docs/rag-vertical-dev-icp.docx` — Developer ICP analysis
- `docs/rag-vertical-icp.docx` — End-market ICP analysis
- `specs/` — Product requirements, architecture, data model
- `planning/` — Project plan, decisions, backlog
