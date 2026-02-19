-- Phase 2: Documents table
-- Stores metadata for uploaded documents (the source files)

CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL NOT NULL,
  name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint,
  content_hash text,
  status text DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'processing', 'complete', 'error')),
  error_message text,
  chunk_count integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX documents_organization_id_idx ON public.documents(organization_id);
CREATE INDEX documents_status_idx ON public.documents(status);

CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- RLS
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org documents"
  ON public.documents FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can upload to their org"
  ON public.documents FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can update org documents"
  ON public.documents FOR UPDATE
  USING (organization_id IN (SELECT public.get_user_organizations()))
  WITH CHECK (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can delete org documents"
  ON public.documents FOR DELETE
  USING (organization_id IN (SELECT public.get_user_organizations()));
