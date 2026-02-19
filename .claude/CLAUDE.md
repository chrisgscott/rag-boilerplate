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
- Generate types: `supabase gen types typescript --local > types/database.types.ts`

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
- Pages in `app/(dashboard)/`
- Server Actions colocated with pages in `actions.ts`
- RAG pipeline logic in `lib/rag/`
- Parsers in `lib/parsers/`
- Evaluation logic in `lib/eval/`
- Supabase clients in `lib/supabase/`

## Session Protocol

### At Session Start
1. Read `PLAN.md` (root) for current state
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
2. Update `PLAN.md` with current state summary
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
supabase gen types typescript --local > types/database.types.ts

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

## Project Directory Guide

### `PLAN.md` (project root)
Session-aware progress tracker. Updated at the end of each session with current status, what's done, recent changes, next steps, key decisions, and open questions. This is the primary "where are we?" file. Read this first when starting a new session.

### `.ai/` — Session Context (AI-facing)
Ephemeral, session-updated files for AI assistants. Updated during and after every session.
- `LEARNINGS.md` — Gotchas, patterns, and non-obvious knowledge discovered during development
- `INBOX.md` — Out-of-scope ideas parked for triage
- ~~`CONTEXT.md`~~ — **Deleted** (redundant with root `PLAN.md`)
- `INBOX.md` — Out-of-scope ideas captured during development. Triage at phase boundaries.
- `LEARNINGS.md` — Gotchas, non-obvious patterns, and discoveries. Append as you learn them.

### `.claude/` — Claude Code Configuration
- `CLAUDE.md` — This file. Project-level instructions for Claude Code sessions.
- `settings.local.json` — Local Claude Code settings (gitignored).

### `docs/` — Reference Documents (read-only)
Background research and reference material that informed the specs. Not actively updated during development.
- `rag-design-guide.docx` — Comprehensive RAG technical reference (chunking, search, eval, security)
- `rag-vertical-dev-icp.docx` — Developer ICP analysis
- `rag-vertical-icp.docx` — End-market ICP analysis

### `planning/` — Project Management
Active project planning documents. Updated as work progresses and decisions are made.
- `PROJECT_BRIEF.md` — High-level project brief (what, why, for whom). Written once, rarely updated.
- `PROJECT_PLAN.md` — Master task list with phases and status tracking. The original plan from spec-driven-dev.
- `DECISIONS.md` — Architecture Decision Records (ADRs). Append when making significant technical choices.
- `PHASE_2_5_PLAN.md` — Detailed implementation plan for Docling ingestion service migration.

### `prompts/` — Agent Handoff Prompts
Prompts designed to onboard AI agents into the project with full context.
- `HANDOFF_PROMPT.md` — Instructions for an AI agent starting implementation work. References which files to read, critical implementation notes, backpressure commands, and task workflow.

### `specs/` — Technical Specifications (stable)
Formal specifications written during planning. These define what to build. Updated only when requirements change.
- `PRD.md` — Product Requirements Document. Features, user stories, scope, open questions.
- `ARCHITECTURE.md` — System architecture, tech stack, data flows, project structure, security model.
- `DATA_MODEL.md` — Full database schema, RLS policies, RPC functions, indexes.

### Where to put new files
| Type of file | Directory | Example |
|---|---|---|
| Implementation plan for a phase/feature | `planning/` | `PHASE_3_PLAN.md` |
| Architecture decision | `planning/DECISIONS.md` | Append new ADR |
| Gotcha or non-obvious pattern | `.ai/LEARNINGS.md` | Append to relevant section |
| Out-of-scope idea | `.ai/INBOX.md` | Add to "To Triage" |
| Spec change (schema, requirements, architecture) | `specs/` | Update existing file |
| Reference research document | `docs/` | Add new file |
| Agent onboarding prompt | `prompts/` | New prompt file |
| Session progress update | `PLAN.md` (root) | Update status section |
