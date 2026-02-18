# Project Plan: RAG Boilerplate

## Overview
- **Current Phase:** 1 of 6
- **Progress:** 0/42 tasks (0%)
- **Status:** Not Started
- **Target:** MVP in 6 weeks

## Phase 1: Foundation ⏳

**Goal:** Project scaffolding, auth working, core schema deployed, multi-tenant org setup

| ID | Task | Status | Complexity | Notes |
|----|------|--------|------------|-------|
| 1.1 | Scaffold with `npx create-next-app . -e with-supabase` | ready | S | Auth, middleware, clients pre-configured |
| 1.2 | Install ShadCN/UI + core components (button, card, input, dialog, table, sidebar, sonner) | blocked | S | Needs 1.1 |
| 1.3 | Enable extensions: moddatetime, pgcrypto, vector | blocked | S | Needs 1.1 (local Supabase) |
| 1.4 | Create profiles table + auto-create trigger | blocked | S | Needs 1.3 |
| 1.5 | Create organizations + organization_members tables | blocked | S | Needs 1.3 |
| 1.6 | Create `get_user_organizations()` helper function | blocked | S | Needs 1.5 |
| 1.7 | Organization creation flow (auto-create org on first signup) | blocked | M | Needs 1.5, 1.6 |
| 1.8 | Protected route middleware (redirect to /sign-in if unauthenticated) | blocked | S | Needs 1.1 (mostly pre-configured) |
| 1.9 | Dashboard shell layout with sidebar (ShadCN Sidebar) | blocked | M | Needs 1.2 |
| 1.10 | Type generation pipeline (`supabase gen types typescript`) | blocked | S | Needs 1.4, 1.5 |

**Phase 1 Checklist:**
- [ ] Can run `pnpm dev` and see landing page
- [ ] Can run `supabase start` locally
- [ ] Can sign up, log in, log out
- [ ] Organization created automatically on first signup
- [ ] Dashboard shell renders with sidebar navigation
- [ ] Types auto-generate from schema
- [ ] All RLS policies on profiles, organizations, org_members

**CHECKPOINT: Security Review** — Verify auth implementation and initial RLS policies

---

## Phase 2: Document Ingestion Pipeline 📋

**Goal:** Upload documents, parse, chunk, embed, store with full-text search

| ID | Task | Status | Complexity | Notes |
|----|------|--------|------------|-------|
| 2.1 | Create documents table + RLS policies | blocked | S | Needs Phase 1 |
| 2.2 | Create document_chunks table + HNSW index + GIN index + RLS | blocked | M | Needs 2.1 |
| 2.3 | Supabase Storage bucket for document uploads | blocked | S | Needs Phase 1 |
| 2.4 | Document upload UI (drag-and-drop, file picker) | blocked | M | Needs 2.3 |
| 2.5 | Document list page with status indicators | blocked | M | Needs 2.1 |
| 2.6 | PDF parser implementation (extract text, preserve tables) | blocked | M | Research: Docling vs LlamaParse vs pdf-parse |
| 2.7 | Markdown parser implementation (header hierarchy) | blocked | S | |
| 2.8 | Recursive text chunker (400-512 tokens, 15% overlap) | blocked | M | Core RAG component |
| 2.9 | OpenAI embedding wrapper (text-embedding-3-small, batch support) | blocked | S | |
| 2.10 | Async ingestion pipeline (parse → chunk → embed → upsert) | blocked | L | Orchestrates 2.6-2.9 |
| 2.11 | Document status tracking (pending → processing → complete → error) | blocked | S | Needs 2.10 |
| 2.12 | Document deletion with cascade (delete all chunks + embeddings) | blocked | S | Needs 2.2 |
| 2.13 | Content hash tracking for delta processing | blocked | S | Prevents re-embedding unchanged docs |

**Phase 2 Checklist:**
- [ ] Can upload a PDF and see it appear in document list
- [ ] Document shows processing status (pending → complete)
- [ ] Chunks are created with embeddings in document_chunks table
- [ ] Full-text search index (tsvector) is populated
- [ ] Deleting a document removes all chunks
- [ ] RLS prevents cross-tenant document access

**CHECKPOINT: Security Review** — Verify RLS on documents and document_chunks tables

---

## Phase 3: Search & Retrieval 📋

**Goal:** Hybrid search (vector + BM25) with Reciprocal Rank Fusion

| ID | Task | Status | Complexity | Notes |
|----|------|--------|------------|-------|
| 3.1 | `hybrid_search` RPC function (vector + BM25 + RRF) | blocked | M | Core retrieval function |
| 3.2 | Search orchestration layer (embed query → call RPC → format results) | blocked | M | Needs 3.1 |
| 3.3 | Metadata filtering support (document type, date range) | blocked | S | SQL WHERE in RPC |
| 3.4 | Configurable top-k and similarity threshold | blocked | S | |
| 3.5 | Document access logging (who searched what, when) | blocked | S | Security requirement |
| 3.6 | Create document_access_logs table + RLS | blocked | S | Needs 3.5 |

**Phase 3 Checklist:**
- [ ] Can search across uploaded documents
- [ ] Hybrid search returns relevant results from both vector and keyword matches
- [ ] Results include source document name, chunk content, relevance scores
- [ ] Search is scoped to user's organization (RLS enforced)
- [ ] Document access is logged

---

## Phase 4: Chat Interface 📋

**Goal:** Streaming chat with source citations, conversation history

| ID | Task | Status | Complexity | Notes |
|----|------|--------|------------|-------|
| 4.1 | Create conversations + messages tables + RLS | blocked | S | |
| 4.2 | `/api/chat/route.ts` — Vercel AI SDK streaming endpoint | blocked | M | streamText() with context injection |
| 4.3 | System prompt template with injection delimiters | blocked | S | [RETRIEVED_CONTEXT] tags |
| 4.4 | Chat interface component (message list, input, streaming) | blocked | L | Core UI |
| 4.5 | Source citation component (expandable, shows doc name + chunk) | blocked | M | |
| 4.6 | Conversation history sidebar (list, create new, switch) | blocked | M | |
| 4.7 | Output sanitization (react-markdown + rehype-sanitize) | blocked | S | Security requirement |
| 4.8 | Multi-model provider support (Claude, OpenAI via AI SDK) | blocked | S | Environment variable to switch |
| 4.9 | "I don't have enough information" fallback behavior | blocked | S | When similarity < threshold |

**Phase 4 Checklist:**
- [ ] Can start a conversation and ask questions about uploaded documents
- [ ] Responses stream in real-time
- [ ] Source citations show which document and section the answer came from
- [ ] Can switch between conversations
- [ ] Output is sanitized (no XSS via document content)
- [ ] System prompt includes injection delimiters
- [ ] Can switch LLM provider via environment variable

---

## Phase 5: Evaluation & Cost Tracking 📋

**Goal:** Eval dashboard with golden test sets, cost tracking per query

| ID | Task | Status | Complexity | Notes |
|----|------|--------|------------|-------|
| 5.1 | Create eval tables (test_sets, test_cases, results) + RLS | blocked | S | |
| 5.2 | Create usage_logs table + RLS | blocked | S | |
| 5.3 | Test set management UI (CRUD for test sets and cases) | blocked | M | |
| 5.4 | Evaluation runner (run test set, calculate metrics) | blocked | L | Precision@k, Recall@k, MRR |
| 5.5 | Eval results dashboard (scores, pass/fail, per-case breakdown) | blocked | M | |
| 5.6 | Per-query cost calculation utility | blocked | S | Embedding + LLM token costs |
| 5.7 | Integrate cost logging into chat flow | blocked | S | Log every query to usage_logs |
| 5.8 | Usage dashboard (total cost, cost/query, projected monthly) | blocked | M | |

**Phase 5 Checklist:**
- [ ] Can create golden test sets with question-answer pairs
- [ ] Can run evaluation and see Precision@k, Recall@k, MRR scores
- [ ] Eval results show pass/fail against target thresholds
- [ ] Every chat query logs cost to usage_logs
- [ ] Usage dashboard shows total spend and projections
- [ ] Historical eval results trackable over time

---

## Phase 6: PropTech Demo & Polish 📋

**Goal:** Ship-ready boilerplate with PropTech demo, documentation, and cross-tenant tests

| ID | Task | Status | Complexity | Notes |
|----|------|--------|------------|-------|
| 6.1 | Create/source PropTech sample documents (lease, HOA rules, disclosure) | blocked | M | Demo content |
| 6.2 | PropTech metadata schema in seed data | blocked | S | property_address, document_type, etc. |
| 6.3 | PropTech-specific system prompt templates | blocked | S | "Cite clause numbers", property context |
| 6.4 | Cross-tenant isolation integration tests | blocked | M | Verify tenant A can't read tenant B's docs |
| 6.5 | .env.example with all required variables documented | blocked | S | |
| 6.6 | README.md — Quick start guide (fork → env → supabase start → pnpm dev) | blocked | M | |
| 6.7 | Landing page for the boilerplate product | blocked | M | Marketing page, not the app |
| 6.8 | Final security audit (RLS on all tables, service key isolation) | blocked | M | |

**Phase 6 Checklist:**
- [ ] PropTech demo works end-to-end (upload sample lease → ask questions → get cited answers)
- [ ] Cross-tenant tests pass
- [ ] New developer can go from fork to working local app in < 30 minutes
- [ ] README documents all setup steps clearly
- [ ] All environment variables documented
- [ ] Security audit passes (RLS, prompt injection delimiters, output sanitization)

**CHECKPOINT: Final Review** — Full security audit, UX review, documentation review before launch

---

## Post-MVP Backlog

| Feature | Priority | Rationale |
|---------|----------|-----------|
| Cohere reranking integration | High | 20-40% accuracy improvement |
| Semantic caching in pgvector | High | 60-90% cost reduction |
| Contextual chunking (Anthropic method) | Medium | 35-67% retrieval failure reduction |
| Organization invitation flow | Medium | Add team members by email |
| CLI tools (ingest, eval, cost-report) | Medium | Developer convenience |
| Smart model routing (cheap vs. powerful) | Medium | 60-80% cost reduction |
| Multi-query / HyDE retrieval | Low | Handles ambiguous queries |
| Agentic RAG (multiple retrieval tools) | Low | Advanced use case |
| LegalTech vertical edition | Low | Second vertical after PropTech |
| Supabase Realtime for ingestion status | Low | Replace polling with push |
| Document versioning | Low | Track changes over time |

---

## Human Checkpoints

| After | Review Type | Status |
|-------|-------------|--------|
| Phase 1 | Security: Auth + initial RLS | ⏳ |
| Phase 2 | Security: Document + chunk RLS | ⏳ |
| Phase 4 | UX: Chat interface design review | ⏳ |
| Phase 6 | Final: Security audit + documentation | ⏳ |

---

## Legend
- **Status:** ready | in_progress | blocked | done
- **Complexity:** S (< 30 min) | M (30-60 min) | L (> 1 hour, consider splitting)

---
*Updated automatically by AI after each task completion*
