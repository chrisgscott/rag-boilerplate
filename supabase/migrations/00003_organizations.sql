-- Organizations and membership tables + helper function

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE public.organization_members (
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role text DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);

-- Now add the FK from profiles → organizations
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_current_organization_id_fkey
  FOREIGN KEY (current_organization_id) REFERENCES public.organizations(id);

-- Helper function for RLS policies
-- SECURITY DEFINER is intentional here: this function is called within RLS policies
-- and needs to read organization_members without being subject to RLS itself.
CREATE OR REPLACE FUNCTION public.get_user_organizations()
RETURNS SETOF uuid AS $$
  SELECT organization_id
  FROM public.organization_members
  WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- RLS
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their organizations"
  ON public.organizations FOR SELECT
  USING (id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Authenticated users can create organizations"
  ON public.organizations FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view org members"
  ON public.organization_members FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Org owners can manage members"
  ON public.organization_members FOR ALL
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid() AND om.role = 'owner'
    )
  );

-- Allow authenticated users to insert themselves as org members (for org creation flow)
CREATE POLICY "Users can add themselves as members"
  ON public.organization_members FOR INSERT
  WITH CHECK (auth.uid() = user_id);
