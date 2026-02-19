# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** Phase 4 IN PROGRESS (5/9 tasks complete)
- **Progress:** 42/42+ tasks (Phases 1–3 done) + 5/9 Phase 4 tasks
- **Branch:** `feature/phase-4-chat` (worktree at `.worktrees/phase-4-chat`)
- **Repo:** `https://github.com/chrisgscott/rag-boilerplate.git`
- **Supabase Cloud:** `xjzhiprdbzvmijvymkbn` (us-west-2), 13 migrations applied
- **Tests:** 40 passing (7 embedder + 12 search + 21 chat)
- **Workflow:** Subagent-driven development (fresh subagent per task + two-stage review)

### Phase 4 Task Status
1. ✅ **Install Dependencies** — AI SDK, markdown packages, ShadCN base components (commit `86ed528`)
2. ✅ **Database Migrations** — conversations + messages tables with RLS (commit `2f6f01c`)
3. ✅ **LLM Provider Factory (TDD)** — `getLLMProvider()` + `getModelId()`, 7 tests (commit `4b108fc`)
4. ✅ **System Prompt Builder (TDD)** — `buildSystemPrompt()` with security rules, 6 tests (commit `b0f2daf`)
5. ✅ **Chat Route Handler (TDD)** — streaming POST with auth/search/threshold/onFinish, 8 tests (commit `e0cc1dd`)
6. ⬜ **Chat Server Actions** — `getConversations()`, `getConversationMessages()`, `deleteConversation()`
7. ⬜ **Chat UI Components** — custom header + conversation list (shadcn.io AI components already installed)
8. ⬜ **Chat Page Wiring** — Replace stub with ChatInterface using useChat + shadcn.io AI components
9. ⬜ **Environment & Final Verification** — .env.example, full test suite, build, PLAN.md update

### IMPORTANT: shadcn.io AI Components Installed
- Official shadcn.io AI components installed via `npx shadcn@latest add` with token auth
- Components in `components/ai/`: `message.tsx`, `conversation.tsx`, `prompt-input.tsx`, `sources.tsx`
- Uses `streamdown` for streaming markdown, `use-stick-to-bottom` for auto-scroll
- Install command: `npx shadcn@latest add "https://www.shadcn.io/r/{component}.json?token=11da10a159485f7a4cd0b509b28cb86ab5054e074d44434edc93bbc033bd5743"`
- Tasks 7-8 need adaptation: use `components/ai/` imports instead of custom `components/chat/`
- Key API: `Message` + `MessageContent` + `MessageResponse`, `Conversation` + `ConversationContent` + `ConversationScrollButton`, composable `PromptInput` sub-components, `Sources` + `SourcesTrigger` + `SourcesContent` + `Source`

### What's Done (Phases 1-3) — COMPLETE
- Phase 1: Next.js 16 + Supabase auth + dashboard shell
- Phase 2: Document upload/management + RLS
- Phase 2.5: Python/FastAPI ingestion (Docling + pgmq)
- Phase 3: Hybrid search (vector + BM25 + RRF) + access logging

## Recent Changes (This Session)
- **Phase 4 implementation plan** written and committed (`docs/plans/2026-02-19-phase-4-chat-implementation-plan.md`)
- **Tasks 1-5 implemented** via subagent-driven development with TDD
- **shadcn.io AI components** installed from official registry (message, conversation, prompt-input, sources) — commit `c20ef73`
- **Route handler created** at `app/api/chat/route.ts` with full streaming pipeline
- **Provider factory** at `lib/rag/provider.ts` — Anthropic/OpenAI via `LLM_PROVIDER` env var
- **System prompt builder** at `lib/rag/prompt.ts` — security rules + `[RETRIEVED_CONTEXT]` tags
- **Database**: conversations + messages tables with RLS applied to Supabase Cloud (migrations 00012-00013)
- **Bug fixes during Task 5**: provider mocks made callable, null user handling, threshold read at request time

## Next Steps
1. **Task 6: Chat Server Actions** — `app/(dashboard)/chat/actions.ts` with `getCurrentOrg()` pattern
2. **Task 7: Chat UI Components** — Only need custom `chat-header.tsx` + `conversation-list.tsx` (shadcn.io AI components handle the rest)
3. **Task 8: Chat Page Wiring** — Adapt to use `components/ai/` imports (Message, MessageContent, MessageResponse, Conversation, ConversationContent, etc.)
4. **Task 9: Final Verification** — .env.example, build, tests, PLAN.md
5. **Finish branch** — use finishing-a-development-branch skill
6. **Phase 5: Evaluation & Cost Tracking**
7. **Phase 6: PropTech Demo & Polish**

## Key Decisions
- No `src/` directory — root-level app/, components/, lib/
- Next.js 16 uses `proxy.ts` not `middleware.ts` for auth
- Security hardening: search_path on DEFINER functions, tightened org INSERT policy
- **Git worktrees** for isolated branch work (`.worktrees/` directory, gitignored)
- **Vitest** for unit testing; **TDD** for all logic-heavy components
- **Docling** for document parsing — 97.9% table accuracy, OCR, MIT license
- **3-service architecture** — Next.js (Render) + Python ingestion (Render) + Supabase (Cloud)
- **Phase 4 streaming** — Vercel AI SDK `useChat` + `/api/chat/route.ts`
- **Phase 4 provider config** — `LLM_PROVIDER` env var, no hardcoded default
- **Phase 4 similarity threshold** — `SIMILARITY_THRESHOLD` env var (default 0.7), read at request time (not module load)
- **Phase 4 schema** — `parent_message_id` (branching-ready) + `parts` jsonb (agentic RAG-ready)
- **shadcn.io AI components** — Official components from registry, NOT custom implementations. Installed via token auth.
- **Provider mocks** must be callable functions (not strings) since route handler calls `provider(modelId)`

## Open Questions
- Role-based sidebar visibility: when to wire up the actual role check
- Organization UPDATE/DELETE policies deferred to Phase 6
- `current_organization_id` validation (no DB constraint that user belongs to the org)
- `hasEnvVars` bypass in proxy.ts — remove before production

## Key Files
### Phase 4 (Chat Interface) — IN PROGRESS
- `docs/plans/2026-02-19-phase-4-chat-implementation-plan.md` — Full implementation plan (9 tasks)
- `docs/plans/2026-02-19-phase-4-chat-interface-design.md` — Approved design doc
- `supabase/migrations/00012_conversations.sql` — Conversations table + RLS
- `supabase/migrations/00013_messages.sql` — Messages table + RLS
- `app/api/chat/route.ts` — Streaming chat endpoint (auth → search → threshold → stream → persist)
- `lib/rag/prompt.ts` — System prompt with security rules + [RETRIEVED_CONTEXT]
- `lib/rag/provider.ts` — LLM provider factory (Anthropic/OpenAI)
- `components/ai/message.tsx` — shadcn.io Message component (MessageContent, MessageResponse, MessageBranch)
- `components/ai/conversation.tsx` — shadcn.io Conversation component (ConversationContent, ScrollButton)
- `components/ai/prompt-input.tsx` — shadcn.io PromptInput component (composable sub-components)
- `components/ai/sources.tsx` — shadcn.io Sources component (collapsible)
- `tests/unit/chat.test.ts` — 21 tests (7 provider + 6 prompt + 8 route handler)

### Phase 3 (Search & Retrieval)
- `lib/rag/search.ts` — `hybridSearch()` orchestration
- `tests/unit/search.test.ts` — 12 search tests

### Phase 2.5 (Python)
- `services/ingestion/` — Python/FastAPI ingestion service (27 tests)

## Commands
```bash
pnpm dev                    # Start Next.js dev server
pnpm build                  # Build for production
pnpm vitest run --exclude '.worktrees/**'  # Run TypeScript tests (40 tests)
pnpm db:types               # Regenerate types from schema

# Python service (from services/ingestion/)
source .venv/bin/activate && pytest -v  # Run Python tests (27 tests)
```
