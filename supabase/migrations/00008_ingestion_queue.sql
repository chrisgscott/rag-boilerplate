-- Phase 2.5: pgmq ingestion queue + enqueue RPC
-- Enables reliable async document processing with retries and DLQ

-- Enable pgmq extension
CREATE EXTENSION IF NOT EXISTS pgmq;

-- Create the ingestion queue
SELECT pgmq.create('ingestion_jobs');

-- Create a dead letter queue for permanently failed jobs
SELECT pgmq.create('ingestion_jobs_dlq');

-- RPC wrapper: enqueue an ingestion job (called from Next.js via supabase.rpc())
-- Uses SECURITY INVOKER so RLS on documents table applies
CREATE OR REPLACE FUNCTION public.enqueue_ingestion(p_document_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid;
  v_msg_id bigint;
BEGIN
  -- Verify calling user has access to this document (RLS enforced)
  SELECT organization_id INTO v_org_id
  FROM public.documents
  WHERE id = p_document_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Document not found or access denied';
  END IF;

  -- Enqueue the job
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

-- Grant to authenticated users
GRANT EXECUTE ON FUNCTION public.enqueue_ingestion(uuid) TO authenticated;
