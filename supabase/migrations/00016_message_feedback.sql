-- Phase 5: User feedback on chat messages

CREATE TABLE public.message_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id bigint REFERENCES public.messages(id) ON DELETE CASCADE NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL NOT NULL,
  rating integer NOT NULL CHECK (rating IN (1, 5)),
  comment text,
  converted_to_test_case_id uuid REFERENCES public.eval_test_cases(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (message_id, user_id)
);

CREATE INDEX message_feedback_org_idx ON public.message_feedback(organization_id);
CREATE INDEX message_feedback_message_idx ON public.message_feedback(message_id);

ALTER TABLE public.message_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage org message feedback"
  ON public.message_feedback FOR ALL
  USING (organization_id IN (SELECT public.get_user_organizations()));
