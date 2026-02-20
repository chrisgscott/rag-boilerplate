import {
  streamText,
  createUIMessageStream,
  createUIMessageStreamResponse,
  convertToModelMessages,
} from "ai";
import { createClient } from "@/lib/supabase/server";
import { hybridSearch } from "@/lib/rag/search";
import { buildSystemPrompt } from "@/lib/rag/prompt";
import { getLLMProvider, getModelId } from "@/lib/rag/provider";
import { trackUsage } from "@/lib/rag/cost-tracker";

const REFUSAL_MESSAGE =
  "I don't have enough information in the available documents to answer that question.";

function getSimilarityThreshold(): number {
  return parseFloat(process.env.SIMILARITY_THRESHOLD ?? "0.3");
}

export async function POST(req: Request) {
  // 1. Parse request
  const { messages, conversationId: existingConversationId } = await req.json();

  if (!messages?.length) {
    return new Response("Messages required", { status: 400 });
  }

  // 2. Auth
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 3. Get org ID
  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .single();

  if (!profile?.current_organization_id) {
    return new Response("No organization found", { status: 400 });
  }

  const organizationId = profile.current_organization_id;

  // Fetch org-level system prompt (if configured)
  const { data: org } = await supabase
    .from("organizations")
    .select("system_prompt")
    .eq("id", organizationId)
    .single();

  const orgSystemPrompt = org?.system_prompt ?? null;

  // 4. Get or create conversation
  let conversationId = existingConversationId;

  if (!conversationId) {
    const firstUserMessage = messages.find(
      (m: { role: string }) => m.role === "user"
    );
    const title = (firstUserMessage?.content ?? "New conversation").substring(
      0,
      50
    );

    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .insert({
        organization_id: organizationId,
        user_id: user.id,
        title,
      })
      .select("id")
      .single();

    if (convError || !conversation) {
      return new Response("Failed to create conversation", { status: 500 });
    }

    conversationId = conversation.id;
  }

  // 5. Get last message ID for parent_message_id chain
  const { data: lastMsg } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .order("id", { ascending: false })
    .limit(1)
    .single();

  const lastMessageId = lastMsg?.id ?? null;

  // 6. Save user message
  const latestMessage = messages[messages.length - 1];
  const { data: userMsg } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      parent_message_id: lastMessageId,
      role: "user",
      content: latestMessage.content,
    })
    .select("id")
    .single();

  const userMessageId = userMsg?.id ?? null;

  // 7. Search
  const searchResponse = await hybridSearch(supabase, {
    query: latestMessage.content,
    organizationId,
  });

  // 8. Threshold gate
  const similarityThreshold = getSimilarityThreshold();
  const relevantResults = searchResponse.results.filter(
    (r: { similarity: number }) => r.similarity >= similarityThreshold
  );

  if (relevantResults.length === 0) {
    // Save refusal as assistant message
    await supabase.from("messages").insert({
      conversation_id: conversationId,
      parent_message_id: userMessageId,
      role: "assistant",
      content: REFUSAL_MESSAGE,
    });

    // Return canned refusal — no LLM call
    // Format compatible with AI SDK useChat UIMessage stream protocol
    const refusalStream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: "text-start", id: "refusal" });
        writer.write({
          type: "text-delta",
          id: "refusal",
          delta: REFUSAL_MESSAGE,
        });
        writer.write({ type: "finish-step" });
        writer.write({ type: "finish", finishReason: "stop" });
      },
    });

    return createUIMessageStreamResponse({
      stream: refusalStream,
      headers: {
        "x-conversation-id": conversationId,
      },
    });
  }

  // 9. Build system prompt
  const systemPrompt = buildSystemPrompt(relevantResults, orgSystemPrompt);

  // 10. Stream response
  const provider = getLLMProvider();
  const modelId = getModelId();

  // Convert incoming messages (which may be UIMessage format with parts)
  // to ModelMessage format expected by streamText
  let modelMessages;
  try {
    modelMessages = await convertToModelMessages(messages);
  } catch {
    return new Response("Invalid message format", { status: 400 });
  }

  const result = streamText({
    model: provider(modelId),
    system: systemPrompt,
    messages: modelMessages,
    onFinish: async ({ text, usage }) => {
      try {
        // Save assistant message
        await supabase.from("messages").insert({
          conversation_id: conversationId,
          parent_message_id: userMessageId,
          role: "assistant",
          content: text,
          parts: [{ type: "text", text }],
          sources: relevantResults.map((r) => ({
            documentId: r.documentId,
            documentName: r.documentName,
            chunkId: r.chunkId,
            content: r.content,
            similarity: r.similarity,
            rrfScore: r.rrfScore,
          })),
          token_count:
            (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
          model: modelId,
        });

        // Track usage and cost (fire-and-forget)
        trackUsage(supabase, {
          organizationId,
          userId: user.id,
          queryText: latestMessage.content,
          embeddingTokens: searchResponse.queryTokenCount,
          llmInputTokens: usage?.inputTokens ?? 0,
          llmOutputTokens: usage?.outputTokens ?? 0,
          model: modelId,
          chunksRetrieved: relevantResults.length,
        }).catch((e) => {
          console.error("Failed to track usage:", e);
        });
      } catch (e) {
        console.error("Failed to save assistant message:", e);
      }
    },
  });

  return result.toUIMessageStreamResponse({
    headers: {
      "x-conversation-id": conversationId,
    },
  });
}
