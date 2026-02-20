-- Grant service_role access to pgmq schema so admin operations
-- (using service role client) can call enqueue_ingestion → pgmq.send()
GRANT USAGE ON SCHEMA pgmq TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA pgmq TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA pgmq TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq TO service_role;

-- Also grant execute on enqueue_ingestion to service_role
GRANT EXECUTE ON FUNCTION public.enqueue_ingestion(uuid) TO service_role;
