# Learnings & Discoveries

Append gotchas, patterns, and non-obvious knowledge as you discover them.

## Supabase

### pgvector
- HNSW outperforms IVFFlat by 15x in QPS at 1M vectors (design guide)
- pgvector 0.8.0 iterative index scans: `SET hnsw.iterative_scan = on` — 9x faster filtered queries
- PostgREST can't call pgvector operators directly — MUST use RPC functions
- RPC functions should use SECURITY INVOKER (default) not DEFINER for RLS to apply

### RLS
- RLS must cover EVERY table in the retrieval pipeline (documents, chunks, cache, logs)
- `get_user_organizations()` helper uses SECURITY DEFINER — this is correct (it needs to read org_members)
- Denormalize `organization_id` on child tables (document_chunks, messages) for RLS performance

### Auth
- `create-next-app -e with-supabase` provides complete auth setup
- Profile auto-creation via trigger on auth.users insert

### Connection Pooling
- Transaction pooler (port 6543) is required for serverless environments
- Direct connection (port 5432) for migrations only

## RAG Pipeline

### Chunking
- 80% of RAG failures trace to chunking decisions (design guide)
- Recursive character splitting at 400-512 tokens with 15% overlap is the benchmark winner
- NEVER chunk through a table — extract tables as complete units
- Prepend document title + section header to each chunk for context

### Search
- Hybrid search (vector + BM25) recall ~0.91 vs BM25-only ~0.72
- Reciprocal Rank Fusion (RRF) with k=60 is parameter-free
- Top-k=3-5 for final generation context outperforms 10-20

### Cost
- 94% of per-query cost is LLM inference, 4% vector DB, 2% embeddings
- Semantic caching = 60-90% cost reduction (highest-ROI optimization)
- OpenAI batch embedding API = 50% discount for bulk ingestion

## Next.js

### App Router
- Server Components for data fetching (default)
- Server Actions for mutations
- Route Handlers only for streaming (Vercel AI SDK)

## Project-Specific
*Add learnings specific to this project as you build*

---
*Append new learnings during development*
