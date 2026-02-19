# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** 1 of 6 (Foundation) — COMPLETE
- **Progress:** 10/42 tasks (24%)
- **Branch:** `phase-1/foundation`
- **Security review:** Passed (C1, I1 fixed in migration 00004)

### What's Done (Phase 1)
- Next.js 16 scaffold with Supabase auth (proxy.ts pattern, not middleware.ts)
- 15 ShadCN/UI components installed (new-york style)
- 4 Supabase migrations: extensions, profiles, organizations, security hardening
- Dashboard shell with ShadCN Sidebar (App/Admin nav sections)
- Auto-org creation on first signup (`ensureOrganization()`)
- Type generation pipeline (`pnpm db:types`)
- RLS on all Phase 1 tables with security hardening applied

## Recent Changes (This Session)
- Scaffolded project from `create-next-app -e with-supabase`
- Installed ShadCN components: badge, button, card, checkbox, dialog, dropdown-menu, input, label, separator, sheet, sidebar, skeleton, sonner, table, tooltip
- Created migrations: 00001_extensions, 00002_profiles, 00003_organizations, 00004_security_hardening
- Built dashboard layout: `app/(dashboard)/layout.tsx` with SidebarProvider, OrgGuard (Suspense-wrapped)
- Created sidebar: `components/layout/app-sidebar.tsx` (App: Chat, Documents; Admin: Eval, Usage, Settings)
- Created page header: `components/layout/page-header.tsx`
- Placeholder pages for all 5 dashboard routes
- Updated login/signup redirects to `/chat`
- Updated ARCHITECTURE.md to remove `src/` prefix (root-level structure)
- Updated CLAUDE.md file paths to match
- Security review: fixed search_path on DEFINER functions, tightened org_members INSERT policy, added WITH CHECK clauses

## Next Steps
1. **Phase 2: Document Ingestion Pipeline** (tasks 2.1–2.13)
   - 2.1: Create documents table + RLS policies (migration 00005)
   - 2.2: Create document_chunks table + HNSW/GIN indexes + RLS (migration 00006)
   - 2.3: Supabase Storage bucket for document uploads
   - 2.4: Document upload UI (drag-and-drop, file picker)
   - 2.5: Document list page with status indicators
   - 2.6: PDF parser implementation
   - 2.7: Markdown parser implementation
   - 2.8: Recursive text chunker (400-512 tokens, 15% overlap)
   - 2.9: OpenAI embedding wrapper (text-embedding-3-small)
   - 2.10: Async ingestion pipeline (parse → chunk → embed → upsert)
   - 2.11-2.13: Status tracking, deletion, content hashing

2. **Before starting Phase 2**, review:
   - `specs/DATA_MODEL.md` — documents + document_chunks schema
   - `specs/ARCHITECTURE.md` — ingestion flow diagram
   - `docs/rag-design-guide.docx` — chunking + embedding details

3. **Use TDD** (superpowers:test-driven-development) for Phase 2 logic (chunker, search, etc.)

## Key Decisions
- No `src/` directory — root-level app/, components/, lib/ (matches scaffold convention)
- Sidebar split into App/Admin sections (role-based filtering deferred)
- Next.js 16 uses `proxy.ts` not `middleware.ts` for auth
- `getClaims()` (local JWT) used instead of `getUser()` (network call)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (newer) not `ANON_KEY` (legacy)
- Dynamic data wrapped in `<Suspense>` for Partial Prerendering
- Security hardening: search_path on DEFINER functions, tightened org INSERT policy
- REST API + MCP server added to INBOX for headless/AI-native integration

## Open Questions
- Role-based sidebar visibility: when to wire up the actual role check (need org data flowing first)
- Whether Documents page should be user-facing or admin-only (vertical-dependent)
- Organization UPDATE/DELETE policies deferred to Phase 6
- `current_organization_id` validation (no DB constraint that user belongs to the org)
- `hasEnvVars` bypass in proxy.ts — remove before production

## Key Files
- `app/(dashboard)/layout.tsx` — Dashboard layout with OrgGuard
- `app/(dashboard)/actions.ts` — ensureOrganization() server action
- `components/layout/app-sidebar.tsx` — Navigation sidebar
- `components/layout/page-header.tsx` — Page header with auth
- `supabase/migrations/` — 4 migrations
- `types/database.types.ts` — Generated Supabase types
- `planning/PROJECT_PLAN.md` — Full project plan with all 42 tasks
- `.ai/CONTEXT.md` — Session context file
- `.ai/LEARNINGS.md` — Gotchas and patterns discovered
