-- Phase 2: Storage RLS policies for document uploads
-- Bucket "documents" is configured in config.toml
-- Storage path convention: {organization_id}/{document_id}/{filename}
-- The first path segment (folder) is the organization_id

-- Users can upload files to their organization's folder
CREATE POLICY "Users can upload to their org folder"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_organizations())
  );

-- Users can view files in their organization's folder
CREATE POLICY "Users can view their org files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_organizations())
  );

-- Users can delete files in their organization's folder
CREATE POLICY "Users can delete their org files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1]::uuid IN (SELECT public.get_user_organizations())
  );
