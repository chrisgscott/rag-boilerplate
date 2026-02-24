# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** Phase 6 COMPLETE + VLM visual extraction LIVE-TESTED
- **Progress:** Phases 1–6 complete, VLM feature implemented and tested with real PDFs
- **Branch:** `main`
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
- **VLM live-tested and debugged** (3 fix commits on top of 5 implementation commits):
  - **Fix 1:** Docling needs `generate_page_images=True` in `PdfPipelineOptions` — page images are off by default. Added conditional config in `parser.py:get_converter()` when `GOOGLE_API_KEY` is set.
  - **Fix 2:** Gemini free tier rate limits (5 RPM / 20 RPD). Added retry with backoff (15s/30s/45s) for 429 errors. Reduced default `vlm_concurrency` from 10 to 5.
  - **Fix 3:** Supabase Storage bucket didn't allow `image/webp`. Migration 00025 adds it. Upload uses `upsert: "true"` for reprocessing.
  - **Prompt revision:** Rewrote VLM prompt to focus on meaning over appearance — 3x more token-efficient (3,086 vs 8,895 tokens for same doc), better search relevance.
  - **Live test results:** Strategic_Design_System_For_Momentum.pdf (13 pages, 28 pictures) → 12 pages with images detected, VLM descriptions enriching chunks with methodology names, relationships, and semantic content.

## Next Steps
1. **Upgrade Gemini API key** to paid tier (free tier: 5 RPM / 20 RPD is too limiting for multi-doc processing)
2. **Reprocess all 4 PDFs** once rate limits allow (or with paid key)
3. **Run eval** — verify retrieval scores with VLM-enriched chunks
4. **Deploy to Render** — add env vars (including GOOGLE_API_KEY), test end-to-end
5. **Test demo flow** — chat with assistant, verify sources + visual content
6. **Display page images in chat sources** (Level 2) — frontend-only change when `page_image_paths` exists in chunk metadata

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
- **enqueue_ingestion as SECURITY DEFINER** — authenticated role lacks pgmq schema access
- **Concise VLM prompt** — semantic focus (meaning > appearance), 2-4 sentences per visual, ~3x fewer tokens
- **Docling generate_page_images=True** — required for VLM, conditionally enabled when GOOGLE_API_KEY set

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
