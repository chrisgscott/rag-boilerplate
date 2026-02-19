-- Enable required extensions
-- moddatetime: auto-update updated_at columns on row changes
-- pgcrypto: UUID generation (gen_random_uuid)
-- vector: pgvector for embedding storage and similarity search

CREATE EXTENSION IF NOT EXISTS moddatetime WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
