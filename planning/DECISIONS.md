# Architecture Decisions

## Decision #001: Technology Stack
**Date:** 2026-02-18
**Status:** Accepted

### Context
Need to select a technology stack for the RAG boilerplate that aligns with the target buyer (indie SaaS devs already using Next.js + Supabase).

### Options Considered
1. **Next.js + Supabase + pgvector** — Buyer already uses this stack; everything in one Supabase project
2. **Next.js + Supabase + Pinecone** — Dedicated vector DB for better scale
3. **Python (FastAPI + LangChain)** — Most RAG tooling is Python-native

### Decision
Next.js 15 (App Router) + Supabase + pgvector, scaffolded via `npx create-next-app . -e with-supabase`

### Rationale
- Target buyer already uses Next.js + Supabase — zero new services to learn
- pgvector eliminates data sync problems between relational and vector data
- One Supabase project = one bill, one account, one set of API keys
- TypeScript ecosystem is underserved for RAG tooling (most is Python)
- `create-next-app -e with-supabase` gives auth, middleware, and client setup for free

### Consequences
- PDF parsing may need external service (limited client-side PDF parsing in JS)
- pgvector has a ceiling around 10M vectors where dedicated DBs outperform — acceptable for 95% of use cases
- Tied to Supabase for database (migration path exists but non-trivial)

---

## Decision #002: pgvector over Dedicated Vector Database
**Date:** 2026-02-18
**Status:** Accepted

### Context
Need to choose where to store embeddings: in Postgres via pgvector (same DB as everything else) or in a dedicated vector database like Pinecone.

### Options Considered
1. **pgvector (in Supabase Postgres)** — Everything in one place
2. **Pinecone** — Purpose-built, better at extreme scale
3. **Qdrant** — Self-hosted option, good performance

### Decision
pgvector with HNSW indexing, integrated in the same Supabase Postgres database

### Rationale
- Eliminates data sync problem (vectors and metadata are columns in the same row)
- Hybrid search (vector + BM25) is just SQL — no orchestration layer needed
- Metadata filtering is SQL WHERE clauses (not a separate metadata filter API with quirks)
- Transactions: upsert documents and embeddings atomically
- RLS works naturally — tenant isolation via the same policies as all other data
- HNSW delivers 40.5 QPS at 0.998 recall for 1M vectors (15x faster than IVFFlat)
- Cost: included with Supabase, no separate vector DB bill

### Consequences
- Performance ceiling at ~10M vectors with high QPS (but target users won't hit this)
- Must wrap vector operations in RPC functions (PostgREST doesn't support pgvector operators directly)
- HNSW index parameters need tuning as dataset grows (documented in design guide)

---

## Decision #003: Supabase RLS for Multi-Tenancy
**Date:** 2026-02-18
**Status:** Accepted

### Context
Need multi-tenant data isolation. Options are application-level auth checks or database-level RLS.

### Options Considered
1. **Supabase RLS** — All authorization at the database layer
2. **Application-level middleware** — Filter by org_id in code
3. **Separate databases per tenant** — Complete isolation

### Decision
Supabase RLS on EVERY table in the retrieval pipeline, using a `get_user_organizations()` helper function

### Rationale
- RLS is enforced at database level — can't be bypassed by application bugs
- Even with API key compromise, users can't access other tenants' data
- RPC functions for hybrid search use SECURITY INVOKER, so RLS applies automatically
- Single source of truth for permissions
- The design guide's security analysis specifically recommends this approach

### Consequences
- Must define RLS policies for every table (not just documents)
- Testing requires simulating auth context
- Background workers using service_role key bypass RLS — must add explicit filters
- Must remember to add RLS to new tables as they're created

---

## Decision #004: Hybrid Search (Vector + BM25 via RRF)
**Date:** 2026-02-18
**Status:** Accepted

### Context
Need to choose a retrieval strategy. Pure vector search has known weaknesses with exact keyword matches and acronyms.

### Options Considered
1. **Vector-only search** — Simplest implementation
2. **Hybrid search (vector + BM25)** — Higher recall, handles keywords and semantic meaning
3. **Hybrid + reranking** — Highest quality, adds latency and API cost

### Decision
Hybrid search combining pgvector HNSW with Postgres tsvector BM25, merged via Reciprocal Rank Fusion (RRF). Reranking deferred to post-MVP.

### Rationale
- Hybrid recall reaches ~0.91 vs BM25-only at ~0.72 (design guide Section 4)
- Both vector and BM25 live in Postgres — a single RPC function handles the merge
- RRF is parameter-free (just k=60) — no tuning required
- tsvector is a generated column on document_chunks, so BM25 is always in sync
- Reranking adds 20-40% accuracy but also API dependency and ~200ms latency — better as a post-MVP upgrade

### Consequences
- RPC function is more complex than simple vector search
- Both HNSW and GIN indexes needed (slightly more storage and insert latency)
- Reranking would be a significant quality upgrade — should be first post-MVP feature

---

## Decision #005: Vercel AI SDK for LLM Integration
**Date:** 2026-02-18
**Status:** Accepted

### Context
Need to integrate with LLMs for the generation layer. Want provider flexibility.

### Options Considered
1. **Vercel AI SDK** — Provider-agnostic, streaming, React hooks
2. **LangChain JS** — Feature-rich, but heavyweight and complex
3. **Direct API calls** — Maximum control, more code to maintain

### Decision
Vercel AI SDK with `streamText()` for the generation layer

### Rationale
- Provider-agnostic: swap `openai('gpt-4o-mini')` for `anthropic('claude-3-haiku')` with one line
- Built-in streaming support with React hooks (`useChat`)
- Actively maintained by Vercel, excellent Next.js integration
- Lightweight compared to LangChain (no dependency bloat)
- The design guide explicitly recommends this approach

### Consequences
- Streaming requires Route Handler (not Server Action) — one exception to the SA pattern
- Tied to AI SDK's abstraction layer (generally a benefit, occasionally limiting)
- Some advanced features (structured output, tool use) may need AI SDK experimental features

---

## Decision #006: OpenAI text-embedding-3-small as Default Embedding Model
**Date:** 2026-02-18
**Status:** Accepted

### Context
Need to choose a default embedding model for the boilerplate.

### Options Considered
1. **OpenAI text-embedding-3-small** — $0.02/1M tokens, 1536 dims, widely supported
2. **OpenAI text-embedding-3-large** — Higher quality, $0.065/1M tokens, 3072 dims
3. **Voyage-3.5** — Best API quality (~66-67 MTEB), $0.06/1M tokens
4. **Qwen3-Embedding-8B** — Best open-source (70.58 MTEB), requires self-hosting

### Decision
text-embedding-3-small (1536 dimensions) as the default, with embedding model tracked per chunk for future swapability

### Rationale
- Cole Medin (prominent RAG practitioner) defaults to this across all production projects
- $0.02/1M tokens — embedding cost barely matters (2% of total cost per design guide)
- 1536 dimensions is well-supported by pgvector
- Widely adopted — most buyers already have an OpenAI API key
- Tracking model per chunk allows future migration without re-embedding everything at once

### Consequences
- Not the highest quality embedding available (MTEB ~62 vs Voyage-3.5 at ~66-67)
- Tied to OpenAI for embeddings (separate from generation model choice)
- Domain-specific models can show 30-35% higher accuracy — buyers should benchmark on their data

---

## Decision #007: Async Document Ingestion
**Date:** 2026-02-18
**Status:** Accepted

### Context
Document processing (parse → chunk → embed → upsert) takes time. Need to decide whether to process synchronously or asynchronously.

### Options Considered
1. **Synchronous** — Upload blocks until processing completes
2. **Async with status tracking** — Upload returns immediately, processing in background
3. **Queue-based** — Full job queue system (Bull, Inngest, etc.)

### Decision
Async processing with status tracking. Upload returns immediately with `status: 'pending'`. Processing happens via API route or Supabase Edge Function. Full job queue deferred to post-MVP if needed.

### Rationale
- Documents can take 30+ seconds to process (especially PDFs with many pages)
- Blocking the UI for that long is unacceptable UX
- Status tracking (pending → processing → complete → error) gives clear feedback
- A full job queue (Bull, Inngest) adds infrastructure complexity — overkill for MVP
- Can use Supabase Edge Functions or a simple API route with fetch() for background processing

### Consequences
- Need to poll for status updates (or use Supabase Realtime)
- Error handling is more complex (need to surface processing errors to the user)
- No retry mechanism in MVP — if processing fails, user re-uploads

---

## Decision #008: Private GitHub Repo for Distribution
**Date:** 2026-02-18
**Status:** Accepted

### Context
Need to decide how buyers receive the boilerplate code after purchase.

### Options Considered
1. **Private GitHub repo** — Buyers get invited, can git pull updates
2. **Download via Gumroad/Lemonsqueezy** — One-time zip download
3. **npm/CLI scaffolding** — `npx create-rag-app`

### Decision
Private GitHub repo access (like ShipFa.st model)

### Rationale
- Buyers can `git pull` updates as the boilerplate improves
- GitHub is familiar to the target audience (developers)
- Easy to manage access (add/remove collaborators)
- Buyers can see commit history, diffs, and changelogs
- Can use GitHub's built-in issues/discussions for community support

### Consequences
- Need a payment → GitHub invite automation (Lemonsqueezy webhook → GitHub API)
- Managing access at scale requires tooling (or manual invites for early sales)
- Buyers who fork lose the ability to pull updates (but that's expected with code ownership)

---

*Add new decisions as they arise during development*
