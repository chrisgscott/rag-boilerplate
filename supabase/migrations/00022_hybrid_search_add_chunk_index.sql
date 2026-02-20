-- Drop and recreate hybrid_search to add chunk_index to return type.
-- Cannot use CREATE OR REPLACE when adding new return columns.

DROP FUNCTION IF EXISTS public.hybrid_search(text, vector, int, float, float, int, uuid[]);

CREATE FUNCTION public.hybrid_search(
  query_text text,
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  full_text_weight float DEFAULT 1.0,
  semantic_weight float DEFAULT 1.0,
  rrf_k int DEFAULT 60,
  filter_document_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  chunk_id bigint,
  chunk_index int,
  document_id uuid,
  content text,
  metadata jsonb,
  similarity float,
  fts_rank float,
  rrf_score float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH semantic AS (
    SELECT
      dc.id,
      dc.chunk_index,
      dc.document_id,
      dc.content,
      dc.metadata,
      1 - (dc.embedding <=> query_embedding) AS similarity,
      ROW_NUMBER() OVER (ORDER BY dc.embedding <=> query_embedding) AS rank_ix
    FROM public.document_chunks dc
    WHERE dc.embedding IS NOT NULL
      AND (filter_document_ids IS NULL OR dc.document_id = ANY(filter_document_ids))
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count * 2
  ),
  full_text AS (
    SELECT
      dc.id,
      dc.chunk_index,
      dc.document_id,
      dc.content,
      dc.metadata,
      ts_rank_cd(dc.fts, websearch_to_tsquery('english', query_text)) AS fts_rank,
      ROW_NUMBER() OVER (ORDER BY ts_rank_cd(dc.fts, websearch_to_tsquery('english', query_text)) DESC) AS rank_ix
    FROM public.document_chunks dc
    WHERE dc.fts @@ websearch_to_tsquery('english', query_text)
      AND (filter_document_ids IS NULL OR dc.document_id = ANY(filter_document_ids))
    ORDER BY fts_rank DESC
    LIMIT match_count * 2
  )
  SELECT
    COALESCE(s.id, f.id) AS chunk_id,
    COALESCE(s.chunk_index, f.chunk_index) AS chunk_index,
    COALESCE(s.document_id, f.document_id) AS document_id,
    COALESCE(s.content, f.content) AS content,
    COALESCE(s.metadata, f.metadata) AS metadata,
    COALESCE(s.similarity, 0.0)::float AS similarity,
    COALESCE(f.fts_rank, 0.0)::float AS fts_rank,
    (
      COALESCE(semantic_weight / (rrf_k + s.rank_ix), 0.0) +
      COALESCE(full_text_weight / (rrf_k + f.rank_ix), 0.0)
    )::float AS rrf_score
  FROM semantic s
  FULL OUTER JOIN full_text f ON s.id = f.id
  ORDER BY rrf_score DESC
  LIMIT match_count;
END;
$$;
