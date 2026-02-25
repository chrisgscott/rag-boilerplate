# RAG Boilerplate

A production-ready Retrieval-Augmented Generation boilerplate for building document Q&A applications. Upload documents, ask questions, get cited answers — out of the box.

Built on Next.js, Supabase, and the Vercel AI SDK. Ships with a PropTech demo (lease and HOA document Q&A), built-in evaluation tooling, cost tracking, and a REST API for headless use.

## Features

- **Document ingestion** — Upload PDF, Markdown, plain text, HTML, or DOCX. Automatic chunking, embedding, and indexing.
- **Hybrid search** — Vector similarity (pgvector HNSW) + BM25 full-text search, merged with Reciprocal Rank Fusion.
- **Cohere reranking** — Optional reranking pass for higher retrieval precision (opt-in via env var).
- **Streaming chat** — Real-time AI responses with source citations via Server-Sent Events.
- **Multi-tenant** — Organization-based data isolation enforced at the database level (RLS).
- **REST API** — Full API with key-based auth for building custom frontends. SSE and Vercel AI SDK streaming supported.
- **Evaluation toolkit** — Built-in retrieval and answer quality metrics (Precision@k, Recall@k, MRR, Faithfulness, Relevance, Completeness).
- **Cost tracking** — Per-query token usage and cost logging.
- **Visual extraction** — Optional VLM pipeline (GPT-4o-mini) extracts information from images in PDFs.
- **Provider-agnostic** — Switch between OpenAI and Anthropic with a single env var.

## Architecture

```
┌─────────────────────┐     ┌──────────────────────────┐
│  Next.js App        │     │  Python Ingestion Worker  │
│  (Dashboard + API)  │     │  (Docling + FastAPI)      │
│                     │     │                           │
│  - Chat UI          │     │  - PDF/DOCX parsing       │
│  - Document mgmt    │     │  - Chunking & embedding   │
│  - REST API /v1/    │     │  - VLM visual extraction  │
│  - Eval & usage     │     │  - Queue polling (pgmq)   │
└────────┬────────────┘     └────────────┬──────────────┘
         │                               │
         └───────────┬───────────────────┘
                     │
          ┌──────────▼──────────┐
          │  Supabase (Cloud)   │
          │                     │
          │  - Postgres + pgvec │
          │  - Auth             │
          │  - Storage          │
          │  - RLS policies     │
          │  - pgmq queues      │
          └─────────────────────┘
```

Supabase is the sole integration point — Next.js and the Python worker never communicate directly.

## Prerequisites

- **Node.js** 20+
- **pnpm** (or npm/yarn)
- **Python** 3.12+
- **Supabase CLI** — [Install guide](https://supabase.com/docs/guides/cli/getting-started)
- **Docker** — Required by Supabase CLI for local development
- An **OpenAI** API key (for embeddings; also for chat if using OpenAI as LLM provider)
- An **Anthropic** API key (if using Claude as LLM provider)

## Quick Start

### 1. Clone and install

```bash
git clone <your-repo-url>
cd rag-boilerplate
pnpm install
```

### 2. Start Supabase locally

```bash
supabase start
```

This starts a local Supabase instance with Postgres, Auth, Storage, and all extensions. It also runs all migrations automatically.

Note the output — you'll need the `API URL`, `anon key`, and `service_role key` for the next step.

### 3. Configure environment variables

Copy the example file and fill in your keys:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# From `supabase start` output
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<anon-key-from-supabase-start>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key-from-supabase-start>

# LLM keys (at least one required)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Chat config
LLM_PROVIDER=anthropic          # or "openai"
SIMILARITY_THRESHOLD=0.7        # Refuse to answer below this
```

### 4. Set up the Python ingestion worker

```bash
cd services/ingestion
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

Copy and configure its env file:

```bash
cp .env.example .env
```

Edit `services/ingestion/.env`:

```bash
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<service-role-key-from-supabase-start>
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
OPENAI_API_KEY=sk-...
```

### 5. Start development servers

In one terminal — Next.js:

```bash
pnpm dev
```

In another terminal — Python worker:

```bash
cd services/ingestion
source .venv/bin/activate
uvicorn src.main:app --reload --port 8000
```

### 6. Open the app

Go to [http://localhost:3000](http://localhost:3000). Sign up for an account, create an organization, upload a document, and start chatting.

## Environment Variables

### Next.js App (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase API URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server-only) |
| `OPENAI_API_KEY` | Yes | OpenAI API key (embeddings + optional LLM) |
| `ANTHROPIC_API_KEY` | If using Claude | Anthropic API key |
| `LLM_PROVIDER` | No | `"anthropic"` (default) or `"openai"` |
| `SIMILARITY_THRESHOLD` | No | Minimum similarity to answer (default `0.7`) |
| `COHERE_API_KEY` | No | Enables Cohere reranking if set |
| `VLM_ENABLED` | No | Set `true` to enable visual extraction from PDFs |

### Python Ingestion Worker (`services/ingestion/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `DATABASE_URL` | Yes | Direct Postgres connection (port 5432 for cloud, 54322 for local) |
| `OPENAI_API_KEY` | Yes | For generating embeddings |
| `QUEUE_POLL_INTERVAL` | No | Seconds between queue polls (default `5`) |
| `QUEUE_VISIBILITY_TIMEOUT` | No | Seconds before a failed job becomes visible again (default `300`) |
| `QUEUE_MAX_RETRIES` | No | Max retry attempts (default `3`) |
| `EMBEDDING_MODEL` | No | OpenAI model (default `text-embedding-3-small`) |
| `EMBEDDING_DIMENSIONS` | No | Vector dimensions (default `1536`) |
| `CHUNK_MAX_TOKENS` | No | Max tokens per chunk (default `512`) |
| `CHUNK_OVERLAP` | No | Overlap ratio between chunks (default `0.15`) |

## Project Structure

```
.
├── app/                        # Next.js App Router
│   ├── (dashboard)/            # Protected routes (chat, documents, settings, etc.)
│   ├── api/                    # API routes
│   │   ├── v1/                 # REST API (key auth)
│   │   └── chat/               # Dashboard chat endpoint (session auth)
│   └── auth/                   # Auth pages (login, sign-up, etc.)
├── components/                 # React components
│   ├── ui/                     # ShadCN/UI base components
│   ├── chat/                   # Chat interface
│   ├── documents/              # Document management
│   └── ...
├── lib/                        # Shared logic
│   ├── rag/                    # RAG pipeline (search, embedding, reranking)
│   ├── supabase/               # Supabase client helpers
│   ├── api/                    # REST API auth & response utilities
│   └── eval/                   # Evaluation toolkit
├── services/
│   └── ingestion/              # Python worker (Docling + FastAPI)
│       ├── src/                # Source code
│       ├── tests/              # Python tests
│       └── Dockerfile          # Production container
├── supabase/
│   └── migrations/             # Database migrations
├── types/
│   └── database.types.ts       # Auto-generated Supabase types
└── docs/
    └── api-guide.md            # REST API documentation
```

## REST API

The boilerplate includes a full REST API at `/api/v1/` for building custom frontends, mobile apps, or integrations without using the bundled dashboard.

- API key authentication (org-scoped)
- SSE streaming and Vercel AI SDK streaming for chat
- Documents, conversations, and feedback endpoints

Create an API key from **Settings > API Keys** in the dashboard.

See [docs/api-guide.md](docs/api-guide.md) for complete documentation with examples.

## Deployment

### Supabase (Database)

1. Create a project at [supabase.com](https://supabase.com)
2. Link your local project:
   ```bash
   supabase link --project-ref <your-project-ref>
   ```
3. Push migrations:
   ```bash
   supabase db push
   ```
4. Note your project URL, anon key, and service role key from the Supabase dashboard.

### Next.js App (Render, Vercel, etc.)

1. Set all env vars from the table above (using your Supabase Cloud credentials)
2. Build command: `pnpm build`
3. Start command: `pnpm start`

### Python Ingestion Worker (Render)

1. Deploy from `services/ingestion/Dockerfile`
2. Set env vars (using Supabase Cloud credentials and direct DB connection string with port 5432)
3. The worker auto-starts and polls the ingestion queue

> **Connection strings:** Use the **transaction pooler** (port 6543) for the Next.js app in serverless environments. Use the **direct connection** (port 5432) for the Python worker and migrations.

## Testing

```bash
# TypeScript tests (Vitest)
pnpm vitest run

# Playwright e2e tests
npx playwright test

# Python tests
cd services/ingestion
source .venv/bin/activate
pytest -v

# Type checking
pnpm tsc --noEmit

# Build verification
pnpm build
```

## Customization

This boilerplate is designed to be forked and customized. Common changes:

- **System prompt** — Set per-organization via the Settings page or `organizations.system_prompt` column
- **LLM provider** — Switch between OpenAI and Anthropic with the `LLM_PROVIDER` env var
- **Similarity threshold** — Adjust `SIMILARITY_THRESHOLD` to control answer refusal sensitivity
- **Chunking parameters** — Tune `CHUNK_MAX_TOKENS` and `CHUNK_OVERLAP` in the worker config
- **Reranking** — Add a `COHERE_API_KEY` to enable Cohere reranking for better retrieval precision
- **Branding** — Update the dashboard UI in `components/` and styles in `app/globals.css`
- **Add new file types** — Extend the allowed MIME types in the upload routes and add Docling parsers

## License

Private repository. See LICENSE file for terms.
