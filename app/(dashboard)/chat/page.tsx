import { createClient } from "@/lib/supabase/server";
import { ChatInterface } from "@/components/chat/chat-interface";
import type { Json } from "@/types/database.types";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;

  let conversationTitle: string | null = null;
  let initialMessages: {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    sources?: Json[] | null;
  }[] = [];

  if (id) {
    const supabase = await createClient();

    const { data: conversation } = await supabase
      .from("conversations")
      .select("title")
      .eq("id", id)
      .single();

    conversationTitle = conversation?.title ?? null;

    const { data: messages } = await supabase
      .from("messages")
      .select("id, role, content, sources, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });

    initialMessages =
      messages?.map((m) => ({
        id: m.id.toString(),
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
        sources: m.sources as Json[] | null,
      })) ?? [];
  }

  return (
    <ChatInterface
      conversationId={id ?? null}
      initialMessages={initialMessages}
      conversationTitle={conversationTitle}
    />
  );
}
