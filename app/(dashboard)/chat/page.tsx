import { createClient } from "@/lib/supabase/server";
import { ChatInterface } from "@/components/chat/chat-interface";

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
      .select("id, role, content, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });

    initialMessages =
      messages?.map((m) => ({
        id: m.id.toString(),
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
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
