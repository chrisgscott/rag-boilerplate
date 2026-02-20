-- Add system_prompt and is_demo columns to organizations
ALTER TABLE public.organizations
  ADD COLUMN system_prompt text,
  ADD COLUMN is_demo boolean NOT NULL DEFAULT false;

-- Index for quick demo org lookup
CREATE INDEX idx_organizations_is_demo ON public.organizations (is_demo) WHERE is_demo = true;
