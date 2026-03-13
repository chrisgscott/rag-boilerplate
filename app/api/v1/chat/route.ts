import { streamText, generateText, convertToModelMessages } from "ai";
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { hybridSearch } from "@/lib/rag/search";
import { buildSystemPrompt } from "@/lib/rag/prompt";
import { getLLMProvider, getModelId } from "@/lib/rag/provider";
import { trackUsage } from "@/lib/rag/cost-tracker";
import { embedQuery } from "@/lib/rag/embedder";
import { isCacheEnabled, lookupCache } from "@/lib/rag/cache";
import {
  type ChatSource,
  sourcesForHeader,
  createOnFinishHandler,
  createSSEResponse,
  createAiSdkResponse,
  createSSEStreamResponse,
} from "@/lib/api/chat-helpers";

const REFUSAL_MESSAGE =
  "I don't have enough information in the available documents to answer that question.";

function getSimilarityThreshold(): number {
  return parseFloat(process.env.SIMILARITY_THRESHOLD ?? "0.3");
}

export async function POST(req: Request) {
  // 1. Auth
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;

  // 2. Parse body
  let body: {
    messages?: { role: string; content: string }[];
    conversationId?: string;
    stream?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return apiError("bad_request", "Invalid JSON body", 400);
  }

  const {
    messages,
    conversationId: existingConversationId,
    stream: shouldStream = true,
  } = body;

  if (!messages?.length) {
    return apiError(
      "bad_request",
      "messages array is required and must not be empty",
      400
    );
  }

  const admin = createAdminClient();

  // 3. Fetch org system prompt and cache version
  const { data: org } = await admin
    .from("organizations")
    .select("system_prompt, cache_version")
    .eq("id", organizationId)
    .single();

  const orgSystemPrompt = org?.system_prompt ?? null;
  const cacheVersion = org?.cache_version ?? 1;

  // 4. Get or create conversation
  let conversationId = existingConversationId;

  if (conversationId) {
    const { data: existingConv } = await admin
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("organization_id", organizationId)
      .single();
    if (!existingConv) return apiError("not_found", "Conversation not found", 404);
  }

  if (!conversationId) {
    const firstUserMessage = messages.find(
      (m: { role: string }) => m.role === "user"
    );
    const title = (firstUserMessage?.content ?? "New conversation").substring(
      0,
      50
    );

    const { data: conversation, error: convError } = await admin
      .from("conversations")
      .insert({ organization_id: organizationId, title })
      .select("id")
      .single();

    if (convError || !conversation) {
      return apiError("internal_error", "Failed to create conversation", 500);
    }

    conversationId = conversation.id;
  }

  // 5. Get last message ID for parent chain
  const { data: lastMsg } = await admin
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .order("id", { ascending: false })
    .limit(1)
    .single();

  const lastMessageId = lastMsg?.id ?? null;

  // 6. Save user message
  const latestMessage = messages[messages.length - 1];
  const { data: userMsg } = await admin
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

  // Determine response format early (needed for cache hit + refusal paths)
  const acceptHeader = req.headers.get("accept") ?? "";
  const useAiSdkFormat = acceptHeader.includes("text/x-vercel-ai-data-stream");

  // 6b. Semantic cache check
  const cacheEnabled = isCacheEnabled();
  let queryEmbedding: { embedding: number[]; tokenCount: number } | null = null;

  if (cacheEnabled) {
    queryEmbedding = await embedQuery(latestMessage.content);

    const cached = await lookupCache(admin, queryEmbedding.embedding, organizationId, cacheVersion);

    if (cached) {
      // Save cached response as assistant message
      await admin.from("messages").insert({
        conversation_id: conversationId,
        parent_message_id: userMessageId,
        role: "assistant",
        content: cached.responseText,
        sources: cached.sources,
        model: cached.model,
      });

      // Track usage with zero LLM cost
      trackUsage(admin, {
        organizationId,
        userId: null,
        queryText: latestMessage.content,
        embeddingTokens: queryEmbedding.tokenCount,
        llmInputTokens: 0,
        llmOutputTokens: 0,
        model: cached.model,
        chunksRetrieved: 0,
      }).catch(() => {});

      const cachedSources = (cached.sources as ChatSource[]).map((s) => ({
        documentId: s.documentId,
        documentName: s.documentName,
        chunkId: s.chunkId,
        chunkIndex: s.chunkIndex,
        content: s.content,
        similarity: s.similarity,
      }));

      if (!shouldStream) {
        return apiSuccess({
          conversationId,
          message: cached.responseText,
          sources: cachedSources,
          cached: true,
        });
      }

      if (useAiSdkFormat) {
        return createAiSdkResponse(cached.responseText, {
          "x-conversation-id": conversationId!,
          "x-sources": JSON.stringify(sourcesForHeader(cachedSources)),
          "x-cache-status": "hit",
        });
      }

      return createSSEResponse(cached.responseText, cachedSources, conversationId!, { cached: true }, { "x-cache-status": "hit" });
    }
  }

  // 7. Search
  const searchResponse = await hybridSearch(admin, {
    query: latestMessage.content,
    organizationId,
    ...(queryEmbedding ? { precomputedEmbedding: queryEmbedding } : {}),
  });

  // 8. Threshold gate
  const similarityThreshold = getSimilarityThreshold();
  const relevantResults = searchResponse.results.filter(
    (r: { similarity: number }) => r.similarity >= similarityThreshold
  );

  if (relevantResults.length === 0) {
    // Save refusal
    await admin.from("messages").insert({
      conversation_id: conversationId,
      parent_message_id: userMessageId,
      role: "assistant",
      content: REFUSAL_MESSAGE,
    });

    if (!shouldStream) {
      return apiSuccess({ conversationId, message: REFUSAL_MESSAGE, sources: [] });
    }

    if (useAiSdkFormat) {
      return createAiSdkResponse(REFUSAL_MESSAGE, {
        "x-conversation-id": conversationId!,
        "x-sources": "[]",
      });
    }

    return createSSEResponse(REFUSAL_MESSAGE, [], conversationId!);
  }

  // 9. Build system prompt
  const systemPrompt = buildSystemPrompt(relevantResults, orgSystemPrompt);

  // 10. Format sources
  const sources: ChatSource[] = relevantResults.map(
    (r: {
      documentId: string;
      documentName: string;
      chunkId: number;
      chunkIndex: number;
      content: string;
      similarity: number;
    }) => ({
      documentId: r.documentId,
      documentName: r.documentName,
      chunkId: r.chunkId,
      chunkIndex: r.chunkIndex,
      content: r.content,
      similarity: r.similarity,
    })
  );

  const provider = getLLMProvider();
  const modelId = getModelId();

  // Convert simple { role, content } messages to UIMessage format for AI SDK
  const uiMessages = messages.map((m, i) => ({
    id: String(i),
    role: m.role as "user" | "assistant" | "system",
    parts: [{ type: "text" as const, text: m.content }],
  }));

  let modelMessages;
  try {
    modelMessages = await convertToModelMessages(uiMessages);
  } catch {
    return apiError("bad_request", "Invalid message format", 400);
  }

  const onFinish = createOnFinishHandler({
    admin,
    conversationId: conversationId!,
    userMessageId,
    sources,
    organizationId,
    queryTokenCount: searchResponse.queryTokenCount,
    modelId,
    cacheEnabled,
    queryEmbedding,
    latestMessageContent: latestMessage.content,
    cacheVersion,
  });

  // 12a. Non-streaming response
  if (!shouldStream) {
    const result = await generateText({
      model: provider(modelId),
      system: systemPrompt,
      messages: modelMessages,
    });

    await onFinish({ text: result.text, usage: result.usage });

    return apiSuccess({ conversationId, message: result.text, sources });
  }

  // 12b. AI SDK format
  if (useAiSdkFormat) {
    const result = streamText({
      model: provider(modelId),
      system: systemPrompt,
      messages: modelMessages,
      onFinish,
    });

    return result.toUIMessageStreamResponse({
      headers: {
        "x-conversation-id": conversationId!,
        "x-sources": JSON.stringify(sourcesForHeader(sources)),
        ...(cacheEnabled ? { "x-cache-status": "miss" } : {}),
      },
    });
  }

  // 12c. Standard SSE format (default)
  const result = streamText({
    model: provider(modelId),
    system: systemPrompt,
    messages: modelMessages,
    onFinish,
  });

  return createSSEStreamResponse(
    result.textStream,
    sources,
    conversationId!,
    cacheEnabled ? { "x-cache-status": "miss" } : undefined,
  );
}
