# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** Phase 6 COMPLETE + VLM switched to OpenAI + Visuals tab in progress
- **Progress:** Phases 1–6 complete, VLM working with GPT-4o-mini, all 4 PDFs reprocessed
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
- **VLM switched from Gemini to OpenAI GPT-4o-mini:**
  - Gemini free tier rate limits (5 RPM / 20 RPD) were unresolvable — no billing upgrade path available in AI Studio
  - Replaced `google-genai` dependency with OpenAI SDK (already present for embeddings)
  - Config: removed `google_api_key`, added `vlm_enabled: bool = False` + `vlm_model: str = gpt-4o-mini`
  - Added `extra: "ignore"` to Pydantic Settings model_config for env var tolerance
  - Tests updated to mock `AsyncOpenAI` instead of `genai`
  - Result: 12/12 pages described, 0 rate limit errors, 24 chunks / 3,164 tokens — clean run
- **All 4 PDFs reprocessed** with OpenAI VLM — all completed successfully
- **Visuals tab added to document detail page** (uncommitted):
  - Server component extracts `page_image_paths` from chunk metadata
  - Generates signed Storage URLs (1hr expiry) via `createSignedUrls`
  - New "Visuals" tab shows page images in 2-column grid with page numbers
- **Chat sources metadata passthrough** (uncommitted):
  - `route.ts` x-sources header now includes `pageImagePaths` from chunk metadata
  - Ready for frontend to display page image thumbnails alongside source citations

## Next Steps
1. **Commit current changes** — VLM OpenAI switch + Visuals tab + chat metadata
2. **Wire up page image thumbnails in chat Source component** — show small image preview when source has pageImagePaths
3. **Run eval** — verify retrieval scores with VLM-enriched chunks
4. **Deploy to Render** — add `VLM_ENABLED=true` env var, test end-to-end
5. **Test demo flow** — chat with assistant, verify sources + visual content

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
- **enqueue_ingestion as SECURITY DEFINER** — authenticated role lacks pgmq schema access
- **Concise VLM prompt** — semantic focus (meaning > appearance), 2-4 sentences per visual, ~3x fewer tokens
- **Docling generate_page_images=True** — required for VLM, conditionally enabled when vlm_enabled=true

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
