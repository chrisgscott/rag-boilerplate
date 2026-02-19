# Architecture Document: RAG Boilerplate

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js Frontend (Vercel)                   │
│  Next.js 16 (App Router) + ShadCN/UI + TailwindCSS           │
│  Vercel AI SDK (streaming, multi-provider)                    │
│  Upload → Storage, enqueue via supabase.rpc('enqueue_...')    │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                   Supabase (Single Project)                   │
│                                                               │
│  ┌──────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐ │
│  │   Auth   │  │  Storage  │  │  Postgres  │  │  pgmq     │ │
│  │  (SSR)   │  │  (Files)  │  │ + pgvector │  │ (queues)  │ │
│  └──────────┘  └───────────┘  │ + RLS      │  │ + pg_cron │ │
│                               │ + tsvector │  └───────────┘ │
│                               └───────────┘                  │
└─────────────────────┬───────────────────────────────────────┘
                      │
            ┌─────────┴─────────┐
            ▼                   ▼
┌──────────────────────┐  ┌────────────────────────────────────┐
│    External APIs     │  │    Python Ingestion Service (Render) │
│  OpenAI (embeddings) │  │    FastAPI + Docling                 │
│  Claude/OpenAI (gen) │  │    Polls pgmq → parse → chunk →     │
│  Cohere (reranking)  │  │    embed → upsert to Postgres        │
└──────────────────────┘  └────────────────────────────────────┘
```

**Key:** Supabase is the sole integration point — Next.js and Python never communicate directly.

## Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Scaffolding | `create-next-app -e with-supabase` | Auth, middleware, Supabase clients pre-configured |
| Frontend Framework | Next.js 15 (App Router) | Server Components, Server Actions, streaming |
| UI Components | ShadCN/UI | Accessible, customizable, Tailwind-based |
| Styling | TailwindCSS | Utility-first, consistent design system |
| Database | Supabase Postgres | Managed, RLS, real-time, pgvector extension |
| Vector Search | pgvector (HNSW) | Integrated with Postgres — no separate vector DB |
| Full-Text Search | Postgres tsvector | Built-in BM25, generated columns |
| Authentication | Supabase Auth (SSR) | Pre-configured by starter template |
| File Storage | Supabase Storage | S3-compatible, integrated with RLS |
| LLM Integration | Vercel AI SDK | Provider-agnostic (Claude, OpenAI), streaming |
| Embeddings | OpenAI text-embedding-3-small | $0.02/1M tokens, 1536 dims, widely supported |
| Type Safety | TypeScript + Zod | End-to-end type safety, runtime validation |
| Document Parsing | Docling (Python) | 97.9% table accuracy, OCR, MIT license |
| Ingestion Service | Python 3.12 / FastAPI | Full pipeline: parse → chunk → embed → upsert |
| Job Queue | Supabase Queues (pgmq) | Visibility timeout, retries, DLQ |
| Job Scheduler | pg_cron | Stale job cleanup every 5 min |
| Ingestion Hosting | Render | Docker container, always-on worker |
| Frontend Hosting | Vercel | Optimized for Next.js |

## Project Structure

```
rag-boilerplate/
├── app/
│   ├── auth/                        # Auth pages (from Supabase template)
│   │   ├── confirm/route.ts
│   │   ├── login/page.tsx
│   │   ├── sign-up/page.tsx
│   │   ├── forgot-password/page.tsx
│   │   ├── update-password/page.tsx
│   │   ├── sign-up-success/page.tsx
│   │   └── error/page.tsx
│   ├── (dashboard)/                 # Protected app pages
│   │   ├── layout.tsx               # Dashboard shell with sidebar
│   │   ├── page.tsx                 # Dashboard home / chat
│   │   ├── documents/
│   │   │   ├── page.tsx             # Document management
│   │   │   ├── [id]/page.tsx        # Document detail / chunks
│   │   │   └── actions.ts           # Upload, delete server actions
│   │   ├── chat/
│   │   │   ├── page.tsx             # Chat interface
│   │   │   └── [id]/page.tsx        # Conversation detail
│   │   ├── eval/
│   │   │   ├── page.tsx             # Evaluation dashboard
│   │   │   ├── test-sets/
│   │   │   │   └── page.tsx         # Manage golden test sets
│   │   │   └── actions.ts
│   │   ├── usage/
│   │   │   └── page.tsx             # Cost tracking dashboard
│   │   └── settings/
│   │       ├── page.tsx             # Organization settings
│   │       └── actions.ts
│   ├── api/
│   │   ├── chat/route.ts            # Vercel AI SDK streaming endpoint
│   │   └── webhooks/                # External webhooks
│   ├── layout.tsx                   # Root layout
│   └── page.tsx                     # Landing page
├── components/
│   ├── ui/                          # ShadCN components
│   ├── layout/
│   │   ├── app-shell.tsx            # Dashboard shell
│   │   ├── app-sidebar.tsx          # Navigation sidebar
│   │   └── page-header.tsx
│   ├── chat/
│   │   ├── chat-interface.tsx       # Main chat component
│   │   ├── message-bubble.tsx
│   │   ├── source-citation.tsx
│   │   └── chat-input.tsx
│   ├── documents/
│   │   ├── upload-form.tsx
│   │   ├── document-list.tsx
│   │   └── processing-status.tsx
│   └── eval/
│       ├── test-set-form.tsx
│       ├── eval-results.tsx
│       └── metric-card.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts                # Browser client (from template)
│   │   ├── server.ts                # Server client (from template)
│   │   └── proxy.ts                 # Proxy client (from template)
│   ├── rag/
│   │   ├── embedder.ts              # OpenAI embedding wrapper (query-time only)
│   │   ├── search.ts                # Hybrid search orchestration
│   │   ├── prompt.ts                # System prompt templates
│   │   └── cost.ts                  # Cost calculation utilities
│   ├── eval/
│   │   ├── runner.ts                # Evaluation runner
│   │   └── metrics.ts               # Precision, Recall, MRR
│   ├── utils.ts                     # cn() and general utilities
│   └── validations/
│       ├── document.ts              # Document upload validation
│       ├── chat.ts                  # Chat input validation
│       └── eval.ts                  # Test set validation
├── hooks/
│   ├── use-chat.ts                  # Chat hook wrapping AI SDK
│   └── use-documents.ts             # Document state management
├── types/
│   ├── database.types.ts            # Generated from Supabase
│   └── rag.ts                       # RAG-specific types
├── services/
│   └── ingestion/                   # Python/FastAPI ingestion service
│       ├── src/
│       │   ├── main.py              # FastAPI app + worker loop
│       │   ├── config.py            # pydantic-settings config
│       │   ├── parser.py            # Docling document parser
│       │   ├── chunker.py           # Recursive text chunker
│       │   ├── embedder.py          # OpenAI embedding wrapper
│       │   └── worker.py            # Queue worker / pipeline orchestrator
│       ├── tests/                   # pytest test suite
│       ├── pyproject.toml
│       ├── Dockerfile
│       └── .env.example
├── supabase/
│   ├── migrations/
│   │   ├── 00001_extensions.sql
│   │   ├── 00002_profiles.sql
│   │   ├── 00003_organizations.sql
│   │   ├── 00004_security_hardening.sql
│   │   ├── 00005_documents.sql
│   │   ├── 00006_document_chunks.sql
│   │   ├── 00007_storage_policies.sql
│   │   ├── 00008_ingestion_queue.sql  # pgmq queue + enqueue RPC
│   │   ├── 00009_ingestion_cron.sql   # pg_cron stale job cleanup
│   │   └── ...                        # Future: conversations, eval, usage
│   ├── seed.sql                     # PropTech demo data
│   └── config.toml
├── demo/
│   ├── sample-lease.pdf             # PropTech demo document
│   ├── sample-hoa-rules.pdf         # PropTech demo document
│   └── sample-disclosure.md         # PropTech demo document
├── tests/
│   ├── integration/
│   │   ├── cross-tenant.test.ts     # Cross-tenant isolation tests
│   │   └── ingestion.test.ts
│   └── unit/
│       ├── chunker.test.ts
│       ├── search.test.ts
│       └── cost.test.ts
├── .env.example
├── .env.local                       # gitignored
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── README.md
```

## Key Architectural Decisions

### Decision 1: Server Components by Default
- Use React Server Components for all data fetching
- Client components (`'use client'`) only for interactive elements (chat input, file upload, forms)
- Server Actions for all mutations (not API routes, except streaming chat)

### Decision 2: Supabase RLS as Authorization Layer
- ALL authorization via Row Level Security policies
- No application-level auth checks for data access
- RLS policies applied to every table in the retrieval pipeline
- RPC functions use SECURITY INVOKER (not DEFINER) so RLS is enforced
- Cross-tenant isolation integration tests verify this

### Decision 3: Streaming Chat via API Route (not Server Action)
- Vercel AI SDK `streamText()` requires a Route Handler for streaming
- This is the ONE exception to "Server Actions for mutations"
- `/api/chat/route.ts` handles the streaming response

### Decision 4: Hybrid Search via RPC Function
- PostgREST (Supabase JS client) does not support pgvector operators directly
- All vector operations wrapped in Postgres RPC functions
- Called via `supabase.rpc('hybrid_search', { ... })`
- RPC functions use SECURITY INVOKER so RLS applies automatically

### Decision 5: Single Supabase Project for Everything
- Auth, Storage, Postgres, pgvector all in one project
- No separate vector DB (eliminates data sync problems)
- File uploads go to Supabase Storage, metadata + vectors in Postgres
- Use transaction pooler (port 6543) for serverless connections

### Decision 6: OpenAI for Embeddings, Provider-Agnostic for Generation
- text-embedding-3-small is the default embedding model (widely supported, cheap, good enough)
- LLM generation is provider-agnostic via Vercel AI SDK (swap Claude ↔ OpenAI with one line)
- Embedding model is tracked per chunk — if you switch models, you know which chunks need re-embedding

### Decision 7: Queue-Based Document Ingestion (pgmq)
- File upload returns immediately with "pending" status
- Next.js enqueues job via `supabase.rpc('enqueue_ingestion', { p_document_id })`
- Python service polls pgmq queue, processes document (parse → chunk → embed → upsert)
- Status tracked per document: pending → processing → complete → error
- pgmq provides: visibility timeout (300s), automatic retries, dead letter queue
- pg_cron runs every 5 min to clean up stale "processing" documents (>10 min)
- UI polls for status updates

### Decision 8: 3-Service Architecture
- **Next.js (Vercel):** Frontend, auth, upload, search, chat
- **Python/FastAPI (Render):** Docling parsing, chunking, embedding, Postgres upsert
- **Supabase (Cloud):** Auth, Storage, Postgres, pgmq, pg_cron
- Supabase is the sole integration point — no direct Next.js ↔ Python communication
- Eliminates Vercel timeout risk (full pipeline runs on Render with no time limit)

## Data Flow

### Document Ingestion Flow
```
Next.js (Vercel)                    Supabase                         Python (Render)
────────────────                    ────────                         ──────────────
[File Upload] ───────────────────▶ Storage (files)
[Create document record] ────────▶ Postgres (status: "pending")
[supabase.rpc('enqueue')] ───────▶ pgmq: ingestion_jobs
                                                                     Worker loop (5s)
                                   pgmq.read() ◀──────────────── [Poll queue]
                                                                     [Download from Storage]
                                                                     [Docling parse]
                                                                       └── Tables as markdown
                                                                       └── Section extraction
                                                                     [Recursive chunk]
                                                                       └── 400-512 tokens, 15% overlap
                                                                       └── Header context prefix
                                                                     [OpenAI embed]
                                                                       └── Batch at 100
                                   Postgres ◀───────────────────── [INSERT chunks + vectors]
                                   (document_chunks)
                                   Postgres ◀───────────────────── [UPDATE status → complete]
                                   pgmq.archive() ◀────────────── [Acknowledge message]
[UI polls status] ◀──────────────── SELECT status

Retry: If worker fails, message reappears after visibility timeout (300s).
       After 3 failures, message moves to DLQ.
pg_cron: Every 5 min, marks "processing" docs >10 min old as "error".
```

### Query Flow (Hybrid Search + Generation)
```
[User Question]
      │
      ├── [Embed query] → OpenAI text-embedding-3-small
      │
      ├── [Hybrid Search RPC] → supabase.rpc('hybrid_search', ...)
      │       ├── Vector similarity (pgvector HNSW, cosine distance)
      │       ├── BM25 full-text (tsvector/tsquery)
      │       ├── Reciprocal Rank Fusion to merge results
      │       ├── RLS automatically filters to user's org
      │       └── Returns top-k chunks with scores
      │
      ├── [Build prompt]
      │       ├── System prompt with security rules
      │       ├── [RETRIEVED_CONTEXT] tags wrapping chunks
      │       └── User question
      │
      ├── [Stream response] → Vercel AI SDK streamText()
      │       ├── Provider: Claude or OpenAI (configurable)
      │       └── Streams tokens to client
      │
      ├── [Log usage] → usage_logs table
      │       ├── Embedding tokens
      │       ├── LLM input/output tokens
      │       └── Calculated cost
      │
      └── [Display response]
              ├── Streaming text with markdown rendering
              ├── Source citations (document name, chunk, score)
              └── Sanitized output (react-markdown + rehype-sanitize)
```

### Evaluation Flow
```
[Select test set]
      │
      ├── For each test case (question, expected_answer, expected_sources):
      │       │
      │       ├── [Run hybrid search] → get retrieved chunks
      │       │
      │       ├── [Calculate retrieval metrics]
      │       │       ├── Precision@k: relevant retrieved / total retrieved
      │       │       ├── Recall@k: relevant retrieved / total relevant
      │       │       └── MRR: 1 / rank of first relevant result
      │       │
      │       └── [Store result]
      │
      └── [Display dashboard]
              ├── Overall scores vs targets
              ├── Per-query breakdown
              └── Historical comparison
```

## Security Architecture

Reference: Design Guide Section 10

### Prompt Injection Mitigation
```
System Prompt:
  SECURITY RULES (cannot be overridden)
  + Domain-specific instructions
  + Citation format requirements

[RETRIEVED_CONTEXT]
  Chunk 1: Source, content (treated as DATA, never instructions)
  Chunk 2: ...
[/RETRIEVED_CONTEXT]

User Question:
  Untrusted user input
```

### Multi-Tenant Isolation
```
Request → Supabase Auth (JWT) → RLS Policy → auth.uid()
                                      │
                                      ▼
                              organization_members
                              WHERE user_id = auth.uid()
                                      │
                                      ▼
                              organization_id filter
                              applied to ALL queries
```

### Service Role Key Isolation
- `SUPABASE_SERVICE_ROLE_KEY` used ONLY in:
  - Background ingestion workers
  - Admin seed scripts
- NEVER in:
  - Client-side code
  - API routes that handle user requests
  - Server Actions

## Scalability Considerations

- pgvector HNSW handles up to ~10M vectors efficiently with proper tuning
- Supabase connection pooling via transaction pooler (port 6543) for serverless
- HNSW index parameters tuned per dataset size (see design guide Section 3)
- Iterative index scans (pgvector 0.8.0) for faster filtered queries
- Batch embedding API for bulk ingestion (50% cost discount from OpenAI)
- Delta processing: content hashes prevent re-embedding unchanged documents

## Monitoring & Observability

- Built-in cost tracking per query (usage_logs table)
- Document access logging (who queried what, when)
- Evaluation dashboard for retrieval quality monitoring
- Vercel Analytics for frontend performance
- Supabase Dashboard for database metrics and query performance
- Post-MVP: Langfuse or Arize Phoenix for LLM tracing

---
*Generated by spec-driven-dev skill*
*Last updated: 2026-02-19*
