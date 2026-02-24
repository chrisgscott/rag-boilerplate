-- Fix: enqueue_ingestion fails with "permission denied for schema pgmq"
-- because SECURITY INVOKER runs as the authenticated role which lacks
-- USAGE on the pgmq schema. Switch to SECURITY DEFINER with an explicit
-- org membership check so the function can call pgmq.send().

CREATE OR REPLACE FUNCTION public.enqueue_ingestion(p_document_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_org_id uuid;
  v_msg_id bigint;
BEGIN
  -- Manually verify the calling user has access to this document's org
  SELECT d.organization_id INTO v_org_id
  FROM public.documents d
  JOIN public.organization_members om
    ON om.organization_id = d.organization_id
  WHERE d.id = p_document_id
    AND om.user_id = auth.uid();

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Document not found or access denied';
  END IF;

  -- Enqueue the job (DEFINER context has pgmq schema access)
  SELECT * INTO v_msg_id
  FROM pgmq.send(
    queue_name := 'ingestion_jobs',
    msg := jsonb_build_object(
      'document_id', p_document_id,
      'organization_id', v_org_id,
      'requested_at', now()
    )
  );

  RETURN v_msg_id;
END;
$$;
