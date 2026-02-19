-- Phase 4: Messages table
-- Tree-ready schema: parent_message_id enables branching later
-- parts jsonb: enables agentic RAG tool calls later

CREATE TABLE public.messages (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE NOT NULL,
  parent_message_id bigint REFERENCES public.messages(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  parts jsonb,
  sources jsonb,
  token_count integer,
  model text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX messages_conversation_idx ON public.messages(conversation_id);
CREATE INDEX messages_parent_idx ON public.messages(parent_message_id);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- RLS via conversation's organization (join through conversations table)
CREATE POLICY "Users can view messages in org conversations"
  ON public.messages FOR SELECT
  USING (conversation_id IN (
    SELECT id FROM public.conversations
    WHERE organization_id IN (SELECT public.get_user_organizations())
  ));

CREATE POLICY "Users can create messages in org conversations"
  ON public.messages FOR INSERT
  WITH CHECK (conversation_id IN (
    SELECT id FROM public.conversations
    WHERE organization_id IN (SELECT public.get_user_organizations())
  ));

CREATE POLICY "Users can delete messages in org conversations"
  ON public.messages FOR DELETE
  USING (conversation_id IN (
    SELECT id FROM public.conversations
    WHERE organization_id IN (SELECT public.get_user_organizations())
  ));

-- No UPDATE policy — messages are immutable once created
