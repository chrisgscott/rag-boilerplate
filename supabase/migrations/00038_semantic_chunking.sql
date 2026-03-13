-- Add semantic chunking metadata columns
ALTER TABLE public.document_chunks
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS headings text[];

-- Immutable helper so we can use array_to_string in a GENERATED column
CREATE OR REPLACE FUNCTION public.text_array_to_string(arr text[])
  RETURNS text
  LANGUAGE sql
  IMMUTABLE PARALLEL SAFE
AS $$
  SELECT coalesce(array_to_string(arr, ' '), '');
$$;

-- Rebuild fts generated column to include headings for BM25
ALTER TABLE public.document_chunks DROP COLUMN fts;
ALTER TABLE public.document_chunks ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      public.text_array_to_string(headings) || ' ' ||
      coalesce(context, '') || ' ' ||
      content
    )
  ) STORED;

-- Recreate GIN index
CREATE INDEX IF NOT EXISTS document_chunks_fts_idx ON public.document_chunks USING gin(fts);
