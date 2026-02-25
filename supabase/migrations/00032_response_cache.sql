-- Add cache_version to organizations for org-wide cache invalidation
ALTER TABLE organizations ADD COLUMN cache_version INTEGER NOT NULL DEFAULT 1;

-- Response cache table
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

-- Composite index for org + version filtering (used by cache_lookup WHERE clause)
CREATE INDEX idx_response_cache_org_version
  ON response_cache (organization_id, cache_version);

-- RLS
ALTER TABLE response_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org isolation" ON response_cache
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));

-- Cache lookup RPC — finds the nearest cached response above similarity threshold
-- SECURITY INVOKER so RLS applies when called by dashboard (session auth)
-- Service role client (API routes) bypasses RLS automatically
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
AS $$
  SELECT
    rc.id,
    rc.response_text,
    rc.sources,
    rc.model,
    1 - (rc.query_embedding <=> cache_lookup.query_embedding) AS similarity
  FROM public.response_cache rc
  WHERE rc.organization_id = org_id
    AND rc.cache_version = org_cache_version
    AND 1 - (rc.query_embedding <=> cache_lookup.query_embedding) >= similarity_threshold
  ORDER BY rc.query_embedding <=> cache_lookup.query_embedding
  LIMIT 1;
$$;
