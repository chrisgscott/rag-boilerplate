-- Phase 2: Document chunks table
-- Chunked content with embeddings and full-text search — the core RAG table
-- organization_id is denormalized from documents for RLS performance

CREATE TABLE public.document_chunks (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  chunk_index integer NOT NULL,
  token_count integer,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Vector similarity search (HNSW with cosine distance)
-- m=24, ef_construction=100 tuned for datasets up to ~1M vectors
CREATE INDEX document_chunks_embedding_idx
  ON public.document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 24, ef_construction = 100);

-- Full-text search (BM25 via GIN index on tsvector)
CREATE INDEX document_chunks_fts_idx
  ON public.document_chunks USING gin(fts);

-- Lookup by document (for cascade operations and document detail views)
CREATE INDEX document_chunks_document_id_idx
  ON public.document_chunks(document_id);

-- RLS performance: filter by org before vector search
CREATE INDEX document_chunks_organization_id_idx
  ON public.document_chunks(organization_id);

-- RLS
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org chunks"
  ON public.document_chunks FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can insert org chunks"
  ON public.document_chunks FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can delete org chunks"
  ON public.document_chunks FOR DELETE
  USING (organization_id IN (SELECT public.get_user_organizations()));
