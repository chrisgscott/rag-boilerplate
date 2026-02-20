-- Allow org owners to update their organization
CREATE POLICY "Org owners can update organizations"
  ON public.organizations FOR UPDATE
  USING (
    id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid() AND om.role = 'owner'
    )
  )
  WITH CHECK (
    id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid() AND om.role = 'owner'
    )
  );

-- Allow org owners to delete their organization
CREATE POLICY "Org owners can delete organizations"
  ON public.organizations FOR DELETE
  USING (
    id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid() AND om.role = 'owner'
    )
  );
