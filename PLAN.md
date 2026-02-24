# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** Phase 6 COMPLETE + VLM visual extraction COMPLETE
- **Progress:** Phases 1–6 complete, VLM feature implemented (5 commits)
- **Branch:** `main`
- **Repo:** `https://github.com/chrisgscott/rag-boilerplate.git`
- **Supabase Cloud:** `xjzhiprdbzvmijvymkbn` (us-west-2), 24 migrations applied
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
- **VLM visual extraction implemented** (5 commits) — Gemini 2.5 Flash step in ingestion pipeline:
  - `src/vlm.py` — `get_visual_pages`, `describe_visual_pages` (concurrent via asyncio.gather), `upload_page_images` (WebP to Supabase Storage), `enrich_sections`
  - Parser tracks page numbers per section (`pages: set[int]` on Section dataclass)
  - Chunks carry metadata (`metadata: dict` on Chunk dataclass, propagated through worker)
  - `process_message` is now async for VLM calls
  - `ParseResult.docling_doc` avoids double-parsing
  - Auto-detect: runs when `GOOGLE_API_KEY` is set and document has pictures
  - Page images stored at `page-images/{doc_id}/page-{n}.webp` for future chat display
  - 14 new VLM tests + 2 worker integration tests + 2 parser tests + 1 chunker test

## Next Steps
1. **Re-seed demo data** — delete existing demo via /admin, re-seed with VLM-enriched processing
2. **Run eval** — verify retrieval scores
3. **Deploy to Render** — add env vars (including GOOGLE_API_KEY), test end-to-end
4. **Test demo flow** — chat with PropTech assistant, verify sources + visual content
5. **Display page images in chat sources** (Level 2) — frontend-only change when `page_image_paths` exists in chunk metadata

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
- **Gemini 2.5 Flash** for VLM visual extraction — best quality/cost balance (~$0.03/100 pages)
- **enqueue_ingestion as SECURITY DEFINER** — authenticated role lacks pgmq schema access; function does explicit org membership check instead of relying on RLS

## Future Enhancements
- **Inline citations (Perplexity-style)** — ShadCN `inline-citation` component installed. Medium-lift — save for post-launch polish.
- **Page images in chat sources (Level 2)** — Display source page images when `page_image_paths` exists in chunk metadata. Frontend-only change.

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
