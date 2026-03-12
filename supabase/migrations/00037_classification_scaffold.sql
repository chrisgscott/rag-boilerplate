-- Classification proposals: AI-proposed labels for semantic units, queued for human review.
-- Generic scaffold — deployments define their own label schemas via the proposed_labels JSONB.

CREATE TABLE public.classification_proposals (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  semantic_unit_id bigint REFERENCES public.document_semantic_units(id) ON DELETE CASCADE,
  content text NOT NULL,
  headings text[],
  proposed_labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence float,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'modified', 'rejected')),
  reviewer_labels jsonb,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.classification_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org proposals"
  ON public.classification_proposals FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can update own org proposals"
  ON public.classification_proposals FOR UPDATE
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Service role full access"
  ON public.classification_proposals FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_proposals_status ON public.classification_proposals(status);
CREATE INDEX idx_proposals_doc ON public.classification_proposals(document_id);
CREATE INDEX idx_proposals_org ON public.classification_proposals(organization_id);
CREATE INDEX idx_proposals_unit ON public.classification_proposals(semantic_unit_id);

COMMENT ON TABLE public.classification_proposals IS
  'AI-proposed classifications for semantic units. Deployments define label schemas; this table stores proposals for human review.';
