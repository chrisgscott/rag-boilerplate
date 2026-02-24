# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** Phase 6 COMPLETE + VLM + Page Image Gallery in Chat
- **Progress:** Phases 1–6 complete, VLM working with GPT-4o-mini, page image gallery + lightbox in chat, Visuals tab on doc detail
- **Branch:** `main` (15 commits ahead of origin)
- **Repo:** `https://github.com/chrisgscott/rag-boilerplate.git`
- **Supabase Cloud:** `xjzhiprdbzvmijvymkbn` (us-west-2), 25 migrations applied
- **Tests:** 70 TS + 46 Python passing, clean build
- **Tailwind:** v4.2.0

### What's Done (Phases 1-6) — COMPLETE
- Phase 1: Next.js 16 + Supabase auth + dashboard shell
- Phase 2: Document upload/management + RLS
- Phase 2.5: Python/FastAPI ingestion (Docling + pgmq)
- Phase 3: Hybrid search (vector + BM25 + RRF) + access logging
- Phase 4: Chat interface (streaming, conversation history, source citations)
- Phase 5: Evaluation & cost tracking
- Phase 6: PropTech Demo & Polish (12 commits)

## Recent Changes (This Session)
- **Storage path fix for RLS:** Changed page image upload path from `page-images/{doc_id}/...` to `{org_id}/page-images/{doc_id}/...` — the existing RLS policy on `storage.objects` casts `foldername(name)[1]` to UUID, so the first folder must be the org ID. Error was `22P02` (invalid text representation).
- **Worker tests updated:** Replaced `mock_settings.google_api_key` with `mock_settings.vlm_enabled` across all test_worker.py tests (leftovers from Gemini→OpenAI switch).
- **Page image gallery in chat:** Horizontal row of clickable thumbnail cards below each assistant message. Click opens a Dialog lightbox with full-size image. Uses `useSignedUrl` hook for lazy signed URL generation. Skeleton placeholders prevent layout shift.
- **pageImagePaths saved to DB:** `route.ts` onFinish now includes `pageImagePaths` in the saved `messages.sources` column, so historical messages also show thumbnails.
- **Source thumbnails in dropdown:** Sources dropdown shows small image preview replacing BookIcon when source has page images.
- **Documents requeued for reprocessing:** All 4 PDFs queued with new org-prefixed storage paths. Worker needs to run to complete.

## Next Steps
1. **Run worker** to reprocess 4 PDFs with org-prefixed storage paths
2. **Verify Visuals tab** — should work after reprocessing (RLS was the blocker)
3. **Verify chat thumbnails + gallery** — test with a new chat question
4. **Run eval** — verify retrieval scores with VLM-enriched chunks
5. **Deploy to Render** — add `VLM_ENABLED=true` env var, test end-to-end
6. **Clean up unused imports** — `XIcon` imported but unused in chat-interface.tsx

## Key Decisions
- No `src/` directory — root-level app/, components/, lib/
- **Solo developer workflow** — merge locally, no PRs needed
- **Tailwind v4** — CSS-based config, @theme inline, tw-animate-css
- **ShadCN sidebar-07** — collapsible icon sidebar pattern
- **3-service architecture** — Next.js (Render) + Python ingestion (Render) + Supabase (Cloud)
- **AI SDK v6** — UIMessage stream protocol, DefaultChatTransport
- **Phase 5: Custom eval** (not Langfuse) — keeps boilerplate self-contained
- **Phase 6: Demo org approach** — all demo content under one org, cascade delete
- **Phase 6: Per-org system prompt** — `organizations.system_prompt` column in DB
- **Service role client** for admin operations — `lib/supabase/admin.ts` bypasses RLS
- **OpenAI GPT-4o-mini** for VLM visual extraction — replaces Gemini (rate limit issues), uses existing API key
- **VLM_ENABLED flag** — opt-in via env var, replaces implicit google_api_key check
- **Org-prefixed storage paths** — `{org_id}/page-images/{doc_id}/page-N.webp` to match RLS policy that casts first folder to UUID
- **Dialog lightbox for page images** — uses existing shadcn Dialog component, no new dependencies
- **useSignedUrl hook** — lazy client-side signed URL generation with stale reset, reused across SourceThumbnail and PageImageCard
- **Skeleton loading states** — prevents layout shift in Dialog lightbox and thumbnail cards

## Future Enhancements
- **Inline citations (Perplexity-style)** — ShadCN `inline-citation` component installed. Medium-lift — save for post-launch polish.

## Open Questions
- Role-based sidebar visibility (YAGNI'd out of Phase 6)
- Org invitation/member management UI (deferred)
- Dead code cleanup: EnvVarWarning + ConnectSupabaseSteps components (unused after Task 10)

## Commands
```bash
pnpm dev                    # Start Next.js dev server
pnpm build                  # Build for production
pnpm vitest run             # Run TypeScript tests (70 tests)
npx playwright test         # Run Playwright e2e tests (6 tests)
pnpm db:types               # Regenerate types from schema

# Python service (from services/ingestion/)
source .venv/bin/activate && pytest -v  # Run Python tests (46 tests)
```
