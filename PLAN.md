# Project Plan — RAG Boilerplate

## Current Status
- **Phase:** Phase 4 COMPLETE (9/9 tasks done)
- **Progress:** 42/42+ tasks (Phases 1–3 done) + 9/9 Phase 4 tasks
- **Branch:** `feature/phase-4-chat` (worktree at `.worktrees/phase-4-chat`)
- **Repo:** `https://github.com/chrisgscott/rag-boilerplate.git`
- **Supabase Cloud:** `xjzhiprdbzvmijvymkbn` (us-west-2), 13 migrations applied
- **Tests:** 40 passing (7 embedder + 12 search + 21 chat)
- **Build:** Clean production build
- **Workflow:** Subagent-driven development (fresh subagent per task + two-stage review)

### Phase 4 Task Status — ALL COMPLETE
1. ✅ **Install Dependencies** — AI SDK, markdown packages, ShadCN base components (commit `86ed528`)
2. ✅ **Database Migrations** — conversations + messages tables with RLS (commit `2f6f01c`)
3. ✅ **LLM Provider Factory (TDD)** — `getLLMProvider()` + `getModelId()`, 7 tests (commit `4b108fc`)
4. ✅ **System Prompt Builder (TDD)** — `buildSystemPrompt()` with security rules, 6 tests (commit `b0f2daf`)
5. ✅ **Chat Route Handler (TDD)** — streaming POST with auth/search/threshold/onFinish, 8 tests (commit `e0cc1dd`)
6. ✅ **Chat Server Actions** — getConversations, getConversationMessages, deleteConversation (commit `d98d151`)
7. ✅ **Chat UI Components** — custom header + conversation list (commit `a16e872`)
8. ✅ **Chat Page Wiring** — ChatInterface with useChat + shadcn.io AI components + AI SDK v6 (commit `f2a4177`)
9. ✅ **Environment & Final Verification** — .env.example updated, build clean, 40 tests passing

### AI SDK v6 Adaptation
The implementation plan was written for AI SDK v4, but the project uses AI SDK v6. Key adaptations:
- `DefaultChatTransport` replaces `api` + `body` on `useChat`
- `sendMessage({ text })` replaces `append({ role, content })`
- UIMessages use `parts` array instead of `content` string
- Route handler uses `toUIMessageStreamResponse` + `convertToModelMessages`
- Refusal uses `createUIMessageStream` + `createUIMessageStreamResponse`

### shadcn.io AI Components
- Official components installed via `npx shadcn@latest add` with token auth
- Components in `components/ai/`: `message.tsx`, `conversation.tsx`, `prompt-input.tsx`, `sources.tsx`
- Uses `streamdown` for streaming markdown, `use-stick-to-bottom` for auto-scroll
- Install command: `npx shadcn@latest add "https://www.shadcn.io/r/{component}.json?token=11da10a159485f7a4cd0b509b28cb86ab5054e074d44434edc93bbc033bd5743"`

### What's Done (Phases 1-3) — COMPLETE
- Phase 1: Next.js 16 + Supabase auth + dashboard shell
- Phase 2: Document upload/management + RLS
- Phase 2.5: Python/FastAPI ingestion (Docling + pgmq)
- Phase 3: Hybrid search (vector + BM25 + RRF) + access logging

## Recent Changes (This Session)
- **Tasks 6-9 implemented** via subagent-driven development with two-stage review
- **Chat server actions** at `app/(dashboard)/chat/actions.ts` — getCurrentOrg pattern, Json types
- **Chat UI components** — `components/chat/chat-header.tsx` + `conversation-list.tsx`
- **Chat interface** — `components/chat/chat-interface.tsx` with DefaultChatTransport, UIMessage parts, ref-based conversation ID tracking
- **Route handler upgraded** to AI SDK v6 UIMessage stream protocol
- **Tests updated** with AI SDK v6 mocks (createUIMessageStream, convertToModelMessages)
- **Toaster** added to root layout for error toast notifications
- **Sheet** component installed for conversation history sidebar
- **.env.example** updated with LLM_PROVIDER and SIMILARITY_THRESHOLD

## Next Steps
1. **Finish branch** — use finishing-a-development-branch skill
2. **Phase 5: Evaluation & Cost Tracking**
3. **Phase 6: PropTech Demo & Polish**

## Key Decisions
- No `src/` directory — root-level app/, components/, lib/
- Next.js 16 uses `proxy.ts` not `middleware.ts` for auth
- Security hardening: search_path on DEFINER functions, tightened org INSERT policy
- **Git worktrees** for isolated branch work (`.worktrees/` directory, gitignored)
- **Vitest** for unit testing; **TDD** for all logic-heavy components
- **Docling** for document parsing — 97.9% table accuracy, OCR, MIT license
- **3-service architecture** — Next.js (Render) + Python ingestion (Render) + Supabase (Cloud)
- **Phase 4 streaming** — Vercel AI SDK v6 `useChat` + `/api/chat/route.ts`
- **Phase 4 provider config** — `LLM_PROVIDER` env var, no hardcoded default
- **Phase 4 similarity threshold** — `SIMILARITY_THRESHOLD` env var (default 0.7), read at request time (not module load)
- **Phase 4 schema** — `parent_message_id` (branching-ready) + `parts` jsonb (agentic RAG-ready)
- **shadcn.io AI components** — Official components from registry, NOT custom implementations
- **AI SDK v6** — UIMessage stream protocol, DefaultChatTransport, convertToModelMessages
- **Provider mocks** must be callable functions (not strings) since route handler calls `provider(modelId)`

## Open Questions
- Role-based sidebar visibility: when to wire up the actual role check
- Organization UPDATE/DELETE policies deferred to Phase 6
- `current_organization_id` validation (no DB constraint that user belongs to the org)
- `hasEnvVars` bypass in proxy.ts — remove before production
- Sources display for historical messages (stored in DB but not yet passed to UI)

## Key Files
### Phase 4 (Chat Interface) — COMPLETE
- `docs/plans/2026-02-19-phase-4-chat-implementation-plan.md` — Full implementation plan (9 tasks)
- `docs/plans/2026-02-19-phase-4-chat-interface-design.md` — Approved design doc
- `supabase/migrations/00012_conversations.sql` — Conversations table + RLS
- `supabase/migrations/00013_messages.sql` — Messages table + RLS
- `app/api/chat/route.ts` — Streaming chat endpoint (auth → search → threshold → stream → persist)
- `app/(dashboard)/chat/page.tsx` — Server component loading conversation data
- `app/(dashboard)/chat/actions.ts` — Server actions (getConversations, getConversationMessages, deleteConversation)
- `components/chat/chat-interface.tsx` — Client component wiring useChat + AI components
- `components/chat/chat-header.tsx` — Custom header with History/New Chat buttons
- `components/chat/conversation-list.tsx` — Conversation history with delete
- `lib/rag/prompt.ts` — System prompt with security rules + [RETRIEVED_CONTEXT]
- `lib/rag/provider.ts` — LLM provider factory (Anthropic/OpenAI)
- `components/ai/message.tsx` — shadcn.io Message component (MessageContent, MessageResponse)
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
