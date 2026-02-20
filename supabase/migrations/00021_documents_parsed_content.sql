-- Add parsed_content column to store Docling markdown output during ingestion
ALTER TABLE public.documents ADD COLUMN parsed_content text;
