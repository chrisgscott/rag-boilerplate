# Architecture Document: RAG Boilerplate

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (Vercel)                        │
│  Next.js 16 (App Router) + ShadCN/UI + TailwindCSS          │
│  Vercel AI SDK (streaming, multi-provider)                   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   Supabase (Cloud)                            │
│                                                               │
│  ┌──────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐ │
│  │   Auth   │  │  Storage  │  │  Postgres  │  │   pgmq    │ │
│  │  (SSR)   │  │  (Files)  │  │ + pgvector │  │  (Queues) │ │
│  └──────────┘  └───────────┘  │ + RLS      │  └───────────┘ │
│                               │ + tsvector │                 │
│                               │ + pg_cron  │                 │
│                               └───────────┘                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
┌──────────────────┐  ┌────────────────────────────────────┐
│   External APIs  │  │    Ingestion Service (Render)       │
│  OpenAI (embed)  │  │    Python/FastAPI + Docling          │
│  Claude (gen)    │  │    Polls pgmq → parse → chunk →     │
│                  │  │    embed → upsert to Postgres        │
└──────────────────┘  └────────────────────────────────────┘
```

### 3-Service Architecture

| Service | Tech | Hosting | Responsibility |
|---------|------|---------|----------------|
| Frontend | Next.js 16 | Vercel | UI, auth, file upload, query-time embedding, chat |
| Backend | Supabase | Supabase Cloud | Auth, storage, Postgres, pgvector, pgmq queues |
| Ingestion | Python/FastAPI | Render | Document parsing (Docling), chunking, embedding, upsert |

**Integration pattern:** Supabase is the sole integration point — no direct Next.js ↔ Python communication. Next.js enqueues jobs via `supabase.rpc('enqueue_ingestion')`, Python worker polls the pgmq queue.

## Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Scaffolding | `create-next-app -e with-supabase` | Auth, proxy.ts, Supabase clients pre-configured |
| Frontend Framework | Next.js 16 (App Router) | Server Components, Server Actions, streaming |
| UI Components | ShadCN/UI | Accessible, customizable, Tailwind-based |
| Styling | TailwindCSS | Utility-first, consistent design system |
| Database | Supabase Postgres | Managed, RLS, real-time, pgvector extension |
| Vector Search | pgvector (HNSW) | Integrated with Postgres — no separate vector DB |
| Full-Text Search | Postgres tsvector | Built-in BM25, generated columns |
| Job Queue | pgmq (Supabase Queues) | Postgres-native message queue with visibility timeout, DLQ |
| Scheduled Jobs | pg_cron | Stale job cleanup every 5 min |
| Authentication | Supabase Auth (SSR) | Pre-configured by starter template |
| File Storage | Supabase Storage | S3-compatible, integrated with RLS |
| Document Parsing | Docling (Python) | 97.9% table accuracy, OCR, PDF/DOCX/HTML/MD support |
| LLM Integration | Vercel AI SDK | Provider-agnostic (Claude, OpenAI), streaming |
| Embeddings | OpenAI text-embedding-3-small | $0.02/1M tokens, 1536 dims, widely supported |
| Type Safety | TypeScript + Zod | End-to-end type safety, runtime validation |
| Frontend Hosting | Vercel | Optimized for Next.js |
| Ingestion Hosting | Render | Python service with persistent process for queue polling |

## Project Structure

```
rag-boilerplate/
├── app/
│   ├── auth/                        # Auth pages (from Supabase template)
│   ├── (dashboard)/                 # Protected app pages
│   │   ├── layout.tsx               # Dashboard shell with sidebar
│   │   ├── page.tsx                 # Dashboard home
│   │   └── documents/
│   │       ├── page.tsx             # Document management
│   │       └── actions.ts           # Upload, delete + enqueue_ingestion
│   ├── api/
│   │   └── chat/route.ts            # Vercel AI SDK streaming (future)
│   ├── layout.tsx                   # Root layout
│   └── page.tsx                     # Landing page
├── components/
│   ├── ui/                          # ShadCN components (new-york style)
│   ├── layout/
│   │   ├── app-sidebar.tsx          # Navigation sidebar
│   │   └── page-header.tsx
│   └── documents/
│       ├── upload-form.tsx          # Drag-and-drop upload (PDF/MD/TXT/HTML/DOCX)
│       └── document-list.tsx        # Document table with status polling
├── lib/
│   ├── supabase/
│   │   ├── client.ts                # Browser client
│   │   ├── server.ts                # Server client
│   │   └── proxy.ts                 # Proxy client (Next.js 16 auth)
│   └── rag/
│       └── embedder.ts              # OpenAI embedding wrapper (query-time only)
├── services/
│   └── ingestion/                   # Python/FastAPI ingestion service
│       ├── src/
│       │   ├── config.py            # pydantic-settings config
│       │   ├── main.py              # FastAPI app with worker loop
│       │   ├── parser.py            # Docling document parser
│       │   ├── chunker.py           # Recursive text chunker
│       │   ├── embedder.py          # OpenAI embedding wrapper (batch)
│       │   └── worker.py            # Queue worker (pgmq → pipeline)
│       ├── tests/                   # 27 Python tests
│       ├── pyproject.toml
│       └── Dockerfile
├── types/
│   └── database.types.ts            # Generated from Supabase
├── supabase/
│   ├── migrations/
│   │   ├── 00001_extensions.sql     # pgvector, moddatetime
│   │   ├── 00002_profiles.sql       # User profiles
│   │   ├── 00003_organizations.sql  # Multi-tenant orgs
│   │   ├── 00004_security.sql       # Security hardening
│   │   ├── 00005_documents.sql      # Documents table + RLS
│   │   ├── 00006_document_chunks.sql # Chunks + HNSW + GIN + RLS
│   │   ├── 00007_storage_policies.sql # Storage bucket RLS
│   │   ├── 00008_ingestion_queue.sql # pgmq queue + enqueue RPC
│   │   └── 00009_ingestion_cron.sql  # pg_cron stale job cleanup
│   └── config.toml
├── tests/
│   └── unit/
│       └── embedder.test.ts         # 7 TypeScript embedder tests
├── .env.example
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── docker-compose.dev.yml           # Local dev (ingestion service)
└── PLAN.md                          # Session-aware progress tracker
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

### Decision 7: Async Document Ingestion via pgmq
- File upload returns immediately with "pending" status
- Jobs enqueued via `supabase.rpc('enqueue_ingestion')` to pgmq queue
- Python worker polls queue, processes: Docling parse → chunk → embed → upsert
- Status tracked per document: pending → processing → complete → error
- UI polls for status updates (every 3 seconds when docs are in progress)
- Retry handling: pgmq visibility timeout (5 min), max 3 retries, then DLQ
- pg_cron cleanup: marks stuck "processing" docs as "error" every 5 min

### Decision 8: Python Service for Ingestion (3-Service Architecture)
- Docling requires Python — replaces TypeScript unpdf parser
- Full pipeline runs in Python: parse + chunk + embed + upsert
- Eliminates Vercel serverless timeout risk (60s limit on free tier)
- Supabase is sole integration point — no direct Next.js ↔ Python communication
- Service role key used in Python service only (bypasses RLS for worker operations)
- Supported formats: PDF, Markdown, Plain text, DOCX, HTML

## Data Flow

### Document Ingestion Flow
```
Next.js (Vercel)                     Supabase                       Python Service (Render)
─────────────────                    ────────                       ───────────────────────
[File Upload] ──────────────▶ Storage (documents bucket)
[Create document record] ───▶ Postgres (status: "pending")
[enqueue_ingestion RPC] ────▶ pgmq: ingestion_jobs queue
                                                                    Worker loop (every 5s)
                              pgmq.read() ◀─────────────────────── poll queue
                                                                    Download from Storage
                                                                    Docling parse (PDF/DOCX/HTML/MD)
                                                                      └─ Tables → markdown, sections extracted
                                                                    Recursive chunk (512 tokens, 15% overlap)
                                                                      └─ Header context prepended
                                                                    OpenAI embed (batch 100)
                              Postgres ◀────────────────────────── INSERT chunks + vectors
                              (document_chunks)
                              Postgres ◀────────────────────────── UPDATE status → complete
                              (documents)
                              pgmq.archive() ◀──────────────────── acknowledge message
UI polls ◀──────────────────── SELECT status (every 3s)

Retry handling:
  - pgmq visibility timeout (5 min) — messages reappear if worker crashes
  - Max 3 retries — then moved to ingestion_jobs_dlq
  - pg_cron cleanup — marks stuck "processing" docs as "error" (every 5 min)
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
