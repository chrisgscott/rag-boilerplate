-- Allow image/webp uploads in documents bucket (for VLM page images)
UPDATE storage.buckets
SET allowed_mime_types = CASE
  WHEN NOT ('image/webp' = ANY(allowed_mime_types))
  THEN array_append(allowed_mime_types, 'image/webp')
  ELSE allowed_mime_types
END
WHERE name = 'documents';
