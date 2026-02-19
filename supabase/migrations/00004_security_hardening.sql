-- Phase 1 Security Hardening
-- Fixes identified in security review checkpoint

-- C1: Add search_path restriction to SECURITY DEFINER functions
-- Prevents search_path hijacking attacks on superuser-owned functions

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_user_organizations()
RETURNS SETOF uuid AS $$
  SELECT organization_id
  FROM public.organization_members
  WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- I1: Tighten self-insertion policy on organization_members
-- Old policy allowed any authenticated user to join any org.
-- New policy only allows self-insertion when there are no existing members
-- (i.e., the user is creating a brand new org and adding themselves as first member).

DROP POLICY IF EXISTS "Users can add themselves as members" ON public.organization_members;

CREATE POLICY "Users can add themselves to new orgs"
  ON public.organization_members FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_members existing
      WHERE existing.organization_id = organization_members.organization_id
    )
  );

-- I1b: Add explicit WITH CHECK to owner management policy
DROP POLICY IF EXISTS "Org owners can manage members" ON public.organization_members;

CREATE POLICY "Org owners can manage members"
  ON public.organization_members FOR ALL
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid() AND om.role = 'owner'
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid() AND om.role = 'owner'
    )
  );

-- I2: Document deferred org UPDATE/DELETE policies
-- UPDATE/DELETE policies for organizations intentionally deferred to Phase 6.
-- Owners will need org management policies when Settings page is implemented.

-- S2: Add explicit WITH CHECK to profiles UPDATE
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
