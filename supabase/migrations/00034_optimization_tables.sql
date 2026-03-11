-- Optimization tables for RAG Auto-Optimizer.
-- Tracks optimization runs (sessions), individual experiments within each run,
-- and the best known config per organization.

-- Optimization runs: one per optimizer session
CREATE TABLE public.optimization_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  test_set_id uuid REFERENCES public.eval_test_sets(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'complete', 'error')),
  baseline_config jsonb NOT NULL DEFAULT '{}',
  baseline_score numeric(7,6),
  best_config jsonb,
  best_score numeric(7,6),
  composite_weights jsonb NOT NULL DEFAULT '{}',
  experiments_run integer NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamptz DEFAULT now() NOT NULL,
  completed_at timestamptz
);

CREATE INDEX optimization_runs_org_idx ON public.optimization_runs(organization_id);

ALTER TABLE public.optimization_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage org optimization runs"
  ON public.optimization_runs FOR ALL
  USING (organization_id IN (SELECT public.get_user_organizations()));

-- Individual experiment results within a run
CREATE TABLE public.optimization_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.optimization_runs(id) ON DELETE CASCADE NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  experiment_index integer NOT NULL,
  config jsonb NOT NULL,
  config_delta jsonb NOT NULL DEFAULT '{}',
  composite_score numeric(7,6) NOT NULL,
  delta numeric(8,6) NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('kept', 'discarded', 'error')),
  retrieval_metrics jsonb,
  judge_scores jsonb,
  reasoning text,
  error_message text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX optimization_experiments_run_idx ON public.optimization_experiments(run_id);
CREATE INDEX optimization_experiments_org_idx ON public.optimization_experiments(organization_id);

ALTER TABLE public.optimization_experiments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage org optimization experiments"
  ON public.optimization_experiments FOR ALL
  USING (organization_id IN (SELECT public.get_user_organizations()));

-- Best known config per organization (accumulated wins)
CREATE TABLE public.optimization_configs (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  config jsonb NOT NULL,
  composite_score numeric(7,6),
  composite_weights jsonb NOT NULL DEFAULT '{}',
  run_id uuid REFERENCES public.optimization_runs(id) ON DELETE SET NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.optimization_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage org optimization configs"
  ON public.optimization_configs FOR ALL
  USING (organization_id IN (SELECT public.get_user_organizations()));
