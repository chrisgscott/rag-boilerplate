-- Add contextual chunking support.
-- New nullable `context` column stores LLM-generated situating context per chunk.
-- Updated `fts` generated column includes context for BM25 search.

-- Add context column (nullable — existing chunks have NULL)
ALTER TABLE public.document_chunks ADD COLUMN context text;

-- Rebuild fts generated column to include context for BM25
ALTER TABLE public.document_chunks DROP COLUMN fts;
ALTER TABLE public.document_chunks ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(context, '') || ' ' || content)
  ) STORED;

-- Recreate the GIN index on the new fts column
CREATE INDEX document_chunks_fts_idx
  ON public.document_chunks USING gin(fts);
