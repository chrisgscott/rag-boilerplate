-- Phase 4: Test case generation — extend eval_test_cases with generation metadata

ALTER TABLE public.eval_test_cases
  ADD COLUMN IF NOT EXISTS split text NOT NULL DEFAULT 'optimization'
    CHECK (split IN ('optimization', 'validation')),
  ADD COLUMN IF NOT EXISTS generation_mode text NOT NULL DEFAULT 'manual'
    CHECK (generation_mode IN ('bootstrap', 'query_log', 'manual')),
  ADD COLUMN IF NOT EXISTS grounding_score numeric(3,1)
    CHECK (grounding_score >= 1.0 AND grounding_score <= 5.0),
  ADD COLUMN IF NOT EXISTS source_chunk_id bigint REFERENCES public.document_chunks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'validated'
    CHECK (status IN ('pending', 'validated', 'flagged', 'rejected'));

-- Index for optimizer queries (only validated optimization cases)
CREATE INDEX IF NOT EXISTS eval_test_cases_optimizer_idx
  ON public.eval_test_cases(test_set_id, status, split)
  WHERE status = 'validated' AND split = 'optimization';
