-- Phase 3: Agent decide step schema changes

-- Add corpus fingerprint and hypothesis to experiments
ALTER TABLE public.optimization_experiments
  ADD COLUMN IF NOT EXISTS corpus_fingerprint jsonb,
  ADD COLUMN IF NOT EXISTS hypothesis text;

-- Add session report to runs
ALTER TABLE public.optimization_runs
  ADD COLUMN IF NOT EXISTS session_report text;

-- Cumulative insights table (one row per org)
CREATE TABLE public.optimization_insights (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  insights jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.optimization_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org insights"
  ON public.optimization_insights FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can upsert org insights"
  ON public.optimization_insights FOR ALL
  USING (organization_id IN (SELECT public.get_user_organizations()));
