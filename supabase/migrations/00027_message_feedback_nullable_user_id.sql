-- Make user_id nullable on message_feedback to support API key auth
-- (API key requests have no auth.users entry)
ALTER TABLE public.message_feedback ALTER COLUMN user_id DROP NOT NULL;
