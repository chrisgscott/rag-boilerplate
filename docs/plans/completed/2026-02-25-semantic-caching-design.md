# Semantic Caching Design

## Goal

Cache LLM responses for semantically similar queries using pgvector, targeting 60-90% cost reduction on repeated/similar questions within the same organization.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Cache level | Full LLM response (not just retrieval) | LLM is 95%+ of per-query cost; caching only retrieval barely moves the needle |
| Storage | pgvector table in Supabase | No new infrastructure; leverages existing stack; HNSW lookup is ~1-5ms |
| Invalidation | Org-wide via `cache_version` counter | Simple, correct; new docs could answer old queries, so surgical invalidation has a blind spot |
| Cache hit delivery | Simulated streaming | Consistent UX with normal responses; speed difference still dramatic |
| Similarity threshold | 0.95 default, configurable via env var | Conservative enough to avoid wrong answers, catches common rephrasings |
| Opt-in model | `SEMANTIC_CACHE_ENABLED=true` env var | Same pattern as Cohere reranking; off by default |

## Database Schema

### New table: `response_cache`

```sql
CREATE TABLE response_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cache_version INTEGER NOT NULL,
  query_text TEXT NOT NULL,
  query_embedding vector(1536) NOT NULL,
  response_text TEXT NOT NULL,
  sources JSONB NOT NULL DEFAULT '[]',
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW index for fast cosine similarity lookup
CREATE INDEX idx_response_cache_embedding
  ON response_cache USING hnsw (query_embedding vector_cosine_ops);

-- Composite index for org + version filtering
CREATE INDEX idx_response_cache_org_version
  ON response_cache (organization_id, cache_version);

-- RLS
ALTER TABLE response_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org isolation" ON response_cache
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));
```

### Modified table: `organizations`

```sql
ALTER TABLE organizations ADD COLUMN cache_version INTEGER NOT NULL DEFAULT 1;
```

### New RPC: `cache_lookup`

```sql
CREATE FUNCTION cache_lookup(
  query_embedding vector(1536),
  org_id UUID,
  org_cache_version INTEGER,
  similarity_threshold FLOAT DEFAULT 0.95
)
RETURNS TABLE (
  id UUID,
  response_text TEXT,
  sources JSONB,
  model TEXT,
  similarity FLOAT
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    rc.id,
    rc.response_text,
    rc.sources,
    rc.model,
    1 - (rc.query_embedding <=> query_embedding) AS similarity
  FROM public.response_cache rc
  WHERE rc.organization_id = org_id
    AND rc.cache_version = org_cache_version
    AND 1 - (rc.query_embedding <=> query_embedding) >= similarity_threshold
  ORDER BY rc.query_embedding <=> query_embedding
  LIMIT 1;
$$;
```

## Data Flow

### Cache hit path (fast — embedding + 1 SQL query, no LLM)

1. User sends query
2. Embed the query via `embedQuery()` (reuses existing embedder)
3. Fetch org's current `cache_version` from organizations table
4. Call `cache_lookup` RPC with embedding + org_id + cache_version + threshold
5. Hit found: save user message + cached response as assistant message to conversation
6. Return cached response via simulated streaming with `cached: true` in metadata headers
7. Track usage with zero LLM tokens (embedding cost only)

### Cache miss path (normal — embedding + search + LLM)

1. Steps 1-3 same as above
2. Cache miss: proceed with normal `hybridSearch()` pipeline, passing pre-computed embedding (avoids double-embed)
3. After LLM finishes (`onFinish`), fire-and-forget write to `response_cache` with query embedding, response text, sources, model, and current cache_version
4. Return streamed response as normal

### Invalidation path

1. Document finishes ingestion (status -> `complete`) or gets deleted
2. Bump `organizations.cache_version` via: `UPDATE organizations SET cache_version = cache_version + 1 WHERE id = $org_id`
3. All subsequent cache lookups include the new version -> old entries naturally miss
4. Old rows are dead weight; optional periodic cleanup via pg_cron or manual DELETE

## Integration Points

### New file: `lib/rag/cache.ts`

Three exports:
- `isCacheEnabled()` -> boolean (reads `SEMANTIC_CACHE_ENABLED`)
- `lookupCache(supabase, embedding, orgId, cacheVersion)` -> cached response or null
- `writeCache(supabase, embedding, queryText, orgId, cacheVersion, responseText, sources, model)` -> void

### Modified files

- **`lib/rag/search.ts`** — `SearchParams` accepts optional `precomputedEmbedding` so cache miss path doesn't double-embed
- **`app/api/chat/route.ts`** (dashboard) — embed query first, check cache, short-circuit on hit with simulated streaming, otherwise pass embedding to hybridSearch
- **`app/api/v1/chat/route.ts`** (API) — same pattern for all three response formats (SSE, AI SDK, non-streaming JSON)
- **Python ingestion worker** — bump `organizations.cache_version` after successful ingestion
- **Document deletion** (dashboard `actions.ts` + API `route.ts`) — bump cache_version after delete

### Env vars

| Variable | Default | Description |
|----------|---------|-------------|
| `SEMANTIC_CACHE_ENABLED` | `false` | Set `true` to enable semantic caching |
| `CACHE_SIMILARITY_THRESHOLD` | `0.95` | Minimum cosine similarity for cache hit (0.0-1.0) |

### Response metadata

Cache hits include an `x-cache-status: hit` response header. Cache misses include `x-cache-status: miss`. When caching is disabled, no header is sent.

## What's NOT included

- No UI for cache management (clear cache, view entries, etc.) — YAGNI
- No per-document invalidation — org-wide is simpler and handles the "new doc answers old query" case
- No TTL-based expiration — cache_version invalidation is sufficient
- No cache warming — entries are populated organically as users ask questions
