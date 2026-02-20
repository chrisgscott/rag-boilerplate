-- Fix infinite recursion in organization_members RLS policies.
-- The "Org owners can manage members" policy directly queries organization_members,
-- causing recursion when any policy on organizations or organization_members
-- needs to check ownership. Use a SECURITY DEFINER function to bypass RLS.

CREATE OR REPLACE FUNCTION public.get_user_owner_organizations()
RETURNS SETOF uuid AS $$
  SELECT organization_id
  FROM public.organization_members
  WHERE user_id = auth.uid() AND role = 'owner'
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- Fix organization_members FOR ALL policy (was directly querying itself)
DROP POLICY IF EXISTS "Org owners can manage members" ON public.organization_members;

CREATE POLICY "Org owners can manage members"
  ON public.organization_members FOR ALL
  USING (organization_id IN (SELECT public.get_user_owner_organizations()))
  WITH CHECK (organization_id IN (SELECT public.get_user_owner_organizations()));

-- Fix organizations UPDATE policy
DROP POLICY IF EXISTS "Org owners can update organizations" ON public.organizations;

CREATE POLICY "Org owners can update organizations"
  ON public.organizations FOR UPDATE
  USING (id IN (SELECT public.get_user_owner_organizations()))
  WITH CHECK (id IN (SELECT public.get_user_owner_organizations()));

-- Fix organizations DELETE policy
DROP POLICY IF EXISTS "Org owners can delete organizations" ON public.organizations;

CREATE POLICY "Org owners can delete organizations"
  ON public.organizations FOR DELETE
  USING (id IN (SELECT public.get_user_owner_organizations()));
