-- Fix profiles.current_organization_id FK to SET NULL on org deletion
-- Without this, deleting an org fails if any profile references it
ALTER TABLE public.profiles
  DROP CONSTRAINT profiles_current_organization_id_fkey,
  ADD CONSTRAINT profiles_current_organization_id_fkey
    FOREIGN KEY (current_organization_id)
    REFERENCES public.organizations(id)
    ON DELETE SET NULL;
