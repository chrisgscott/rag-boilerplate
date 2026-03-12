-- Add column to store full DoclingDocument JSON for re-processing without re-parsing
ALTER TABLE documents ADD COLUMN IF NOT EXISTS docling_doc jsonb;

COMMENT ON COLUMN documents.docling_doc IS 'Full DoclingDocument JSON export — enables re-processing without re-parsing';
