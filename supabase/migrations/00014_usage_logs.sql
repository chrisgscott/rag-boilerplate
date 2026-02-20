-- Phase 5: Usage logs and model rates for cost tracking

-- Model rates: per-org token pricing
CREATE TABLE public.model_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  model_id text NOT NULL,
  input_rate numeric(12,10) NOT NULL DEFAULT 0,
  output_rate numeric(12,10) NOT NULL DEFAULT 0,
  embedding_rate numeric(12,10),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (organization_id, model_id)
);

CREATE INDEX model_rates_org_idx ON public.model_rates(organization_id);

CREATE TRIGGER model_rates_updated_at
  BEFORE UPDATE ON public.model_rates
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

ALTER TABLE public.model_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage org model rates"
  ON public.model_rates FOR ALL
  USING (organization_id IN (SELECT public.get_user_organizations()));

-- Usage logs: per-query cost tracking
CREATE TABLE public.usage_logs (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  query_text text,
  embedding_tokens integer DEFAULT 0,
  llm_input_tokens integer DEFAULT 0,
  llm_output_tokens integer DEFAULT 0,
  embedding_cost numeric(10,6) DEFAULT 0,
  llm_cost numeric(10,6) DEFAULT 0,
  total_cost numeric(10,6) GENERATED ALWAYS AS (embedding_cost + llm_cost) STORED,
  model text,
  chunks_retrieved integer,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX usage_logs_org_idx ON public.usage_logs(organization_id);
CREATE INDEX usage_logs_created_at_idx ON public.usage_logs(created_at);

ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org usage"
  ON public.usage_logs FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can insert org usage"
  ON public.usage_logs FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.get_user_organizations()));
