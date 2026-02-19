-- Phase 2.5: pg_cron stale ingestion cleanup
-- Marks documents stuck in "processing" for >10 minutes as "error"
-- Runs every 5 minutes as a safety net for crashed workers

-- Enable pg_cron (pre-installed on Supabase hosted)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Housekeeping function: mark stale documents as error
CREATE OR REPLACE FUNCTION public.cleanup_stale_ingestion_jobs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.documents
  SET status = 'error',
      error_message = 'Processing timed out after 10 minutes'
  WHERE status = 'processing'
    AND updated_at < now() - interval '10 minutes';
END;
$$;

-- Schedule: run every 5 minutes
SELECT cron.schedule(
  'cleanup-stale-ingestion',
  '*/5 * * * *',
  'SELECT public.cleanup_stale_ingestion_jobs()'
);
