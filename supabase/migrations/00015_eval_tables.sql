-- Phase 5: Evaluation tables

-- Test sets: named groups of test cases
CREATE TABLE public.eval_test_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX eval_test_sets_org_idx ON public.eval_test_sets(organization_id);

ALTER TABLE public.eval_test_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage org test sets"
  ON public.eval_test_sets FOR ALL
  USING (organization_id IN (SELECT public.get_user_organizations()));

-- Test cases: individual questions with expected answers/sources
CREATE TABLE public.eval_test_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_set_id uuid REFERENCES public.eval_test_sets(id) ON DELETE CASCADE NOT NULL,
  question text NOT NULL,
  expected_answer text,
  expected_source_ids uuid[],
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX eval_test_cases_set_idx ON public.eval_test_cases(test_set_id);

ALTER TABLE public.eval_test_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage test cases in org test sets"
  ON public.eval_test_cases FOR ALL
  USING (test_set_id IN (
    SELECT id FROM public.eval_test_sets
    WHERE organization_id IN (SELECT public.get_user_organizations())
  ));

-- Eval results: run outcomes with retrieval + answer quality scores
CREATE TABLE public.eval_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_set_id uuid REFERENCES public.eval_test_sets(id) ON DELETE CASCADE NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  precision_at_k numeric(5,4),
  recall_at_k numeric(5,4),
  mrr numeric(5,4),
  avg_faithfulness numeric(3,2),
  avg_relevance numeric(3,2),
  avg_completeness numeric(3,2),
  per_case_results jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'complete', 'error')),
  error_message text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX eval_results_set_idx ON public.eval_results(test_set_id);
CREATE INDEX eval_results_org_idx ON public.eval_results(organization_id);

ALTER TABLE public.eval_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage org eval results"
  ON public.eval_results FOR ALL
  USING (organization_id IN (SELECT public.get_user_organizations()));
