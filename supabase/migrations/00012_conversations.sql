-- Phase 4: Conversations table
-- Stores chat conversations scoped to organizations

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX conversations_org_idx ON public.conversations(organization_id);
CREATE INDEX conversations_user_idx ON public.conversations(user_id);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org conversations"
  ON public.conversations FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can create org conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can update org conversations"
  ON public.conversations FOR UPDATE
  USING (organization_id IN (SELECT public.get_user_organizations()))
  WITH CHECK (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can delete org conversations"
  ON public.conversations FOR DELETE
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE TRIGGER handle_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
