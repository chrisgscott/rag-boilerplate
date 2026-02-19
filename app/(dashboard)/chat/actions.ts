"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Json } from "@/types/database.types";

async function getCurrentOrg() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .single();

  if (!profile?.current_organization_id) {
    throw new Error("No active organization");
  }

  return { supabase, user, organizationId: profile.current_organization_id };
}

export type ConversationSummary = {
  id: string;
  title: string | null;
  updatedAt: string;
};

export type MessageData = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources: Json[] | null;
  createdAt: string;
};

/**
 * Load all conversations for the current user's organization.
 * Ordered by most recently updated first.
 */
export async function getConversations(): Promise<ConversationSummary[]> {
  const { supabase } = await getCurrentOrg();

  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error("Failed to load conversations");
  }

  return (data ?? []).map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updated_at,
  }));
}

/**
 * Load a conversation's messages.
 * Returns messages ordered by creation time (ascending).
 */
export async function getConversationMessages(
  conversationId: string
): Promise<{ title: string | null; messages: MessageData[] }> {
  const { supabase } = await getCurrentOrg();

  // Load conversation (RLS ensures org access)
  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select("title")
    .eq("id", conversationId)
    .single();

  if (convError || !conversation) {
    throw new Error("Conversation not found");
  }

  // Load messages
  const { data: messages, error } = await supabase
    .from("messages")
    .select("id, role, content, sources, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error("Failed to load messages");
  }

  return {
    title: conversation.title ?? null,
    messages: (messages ?? []).map((m) => ({
      id: m.id.toString(),
      role: m.role as MessageData["role"],
      content: m.content,
      sources: m.sources as Json[] | null,
      createdAt: m.created_at,
    })),
  };
}

/**
 * Delete a conversation and all its messages (cascade).
 */
export async function deleteConversation(conversationId: string) {
  const { supabase } = await getCurrentOrg();

  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", conversationId);

  if (error) {
    console.error("Conversation delete failed:", error);
    return { error: "Failed to delete conversation" };
  }

  revalidatePath("/chat");
  return { success: true };
}
