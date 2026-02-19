-- Phase 3: Document access logging
-- Audit trail for search queries — one row per document accessed per query

CREATE TABLE public.document_access_logs (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  query_text text,
  chunks_returned integer,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX document_access_logs_org_idx
  ON public.document_access_logs(organization_id);
CREATE INDEX document_access_logs_created_idx
  ON public.document_access_logs(created_at);

ALTER TABLE public.document_access_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org access logs"
  ON public.document_access_logs FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can insert org access logs"
  ON public.document_access_logs FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.get_user_organizations()));
