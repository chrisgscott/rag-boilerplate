-- Semantic units: one row per natural document element (paragraph, list, table)
-- with heading hierarchy. Used for structured extraction, not RAG retrieval.

CREATE TABLE public.document_semantic_units (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  content text NOT NULL,
  headings text[] NOT NULL DEFAULT '{}',
  label text NOT NULL DEFAULT 'paragraph',
  page_numbers integer[] DEFAULT '{}',
  unit_index integer NOT NULL,
  docling_ref text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.document_semantic_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org semantic units"
  ON public.document_semantic_units FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Service role can manage semantic units"
  ON public.document_semantic_units FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_semantic_units_doc ON public.document_semantic_units(document_id);
CREATE INDEX idx_semantic_units_org ON public.document_semantic_units(organization_id);
CREATE INDEX idx_semantic_units_headings ON public.document_semantic_units USING GIN(headings);
CREATE INDEX idx_semantic_units_label ON public.document_semantic_units(label);

COMMENT ON TABLE public.document_semantic_units IS
  'One row per natural document element extracted by Docling HierarchicalChunker. Used for structured extraction pipelines.';
