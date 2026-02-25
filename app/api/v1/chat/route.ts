import { streamText, generateText, convertToModelMessages } from "ai";
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";
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

  // 3. Fetch org system prompt
  const { data: org } = await admin
    .from("organizations")
    .select("system_prompt")
    .eq("id", organizationId)
    .single();

  const orgSystemPrompt = org?.system_prompt ?? null;

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

  // 7. Search
  const searchResponse = await hybridSearch(admin, {
    query: latestMessage.content,
    organizationId,
  });

  // 8. Threshold gate
  const similarityThreshold = getSimilarityThreshold();
  const relevantResults = searchResponse.results.filter(
    (r: { similarity: number }) => r.similarity >= similarityThreshold
  );

  // Determine response format early (needed for refusal path too)
  const acceptHeader = req.headers.get("accept") ?? "";
  const useAiSdkFormat = acceptHeader.includes("text/x-vercel-ai-data-stream");

  if (relevantResults.length === 0) {
    // Save refusal
    await admin.from("messages").insert({
      conversation_id: conversationId,
      parent_message_id: userMessageId,
      role: "assistant",
      content: REFUSAL_MESSAGE,
    });

    if (!shouldStream) {
      return apiSuccess({
        conversationId,
        message: REFUSAL_MESSAGE,
        sources: [],
      });
    }

    if (useAiSdkFormat) {
      // AI SDK data stream format refusal
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`0:${JSON.stringify(REFUSAL_MESSAGE)}\n`));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/x-vercel-ai-data-stream",
          "x-conversation-id": conversationId!,
          "x-sources": "[]",
        },
      });
    }

    // SSE refusal (default)
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `event: text-delta\ndata: ${JSON.stringify({ content: REFUSAL_MESSAGE })}\n\n`
          )
        );
        controller.enqueue(encoder.encode(`event: sources\ndata: []\n\n`));
        controller.enqueue(
          encoder.encode(
            `event: done\ndata: ${JSON.stringify({ conversationId })}\n\n`
          )
        );
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  }

  // 9. Build system prompt
  const systemPrompt = buildSystemPrompt(relevantResults, orgSystemPrompt);

  // 10. Format sources
  const sources = relevantResults.map(
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

  let modelMessages;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modelMessages = await convertToModelMessages(messages as any);
  } catch {
    return apiError("bad_request", "Invalid message format", 400);
  }

  // 12a. Non-streaming response
  if (!shouldStream) {
    const result = await generateText({
      model: provider(modelId),
      system: systemPrompt,
      messages: modelMessages,
    });

    // Save assistant message (best-effort)
    try {
      await admin.from("messages").insert({
        conversation_id: conversationId,
        parent_message_id: userMessageId,
        role: "assistant",
        content: result.text,
        sources,
      });
    } catch {
      // ignore
    }

    // Track usage (fire-and-forget)
    trackUsage(admin, {
      organizationId,
      userId: null,
      queryText: latestMessage.content,
      embeddingTokens: searchResponse.queryTokenCount,
      llmInputTokens: result.usage?.inputTokens ?? 0,
      llmOutputTokens: result.usage?.outputTokens ?? 0,
      model: modelId,
      chunksRetrieved: relevantResults.length,
    }).catch(() => {});

    return apiSuccess({ conversationId, message: result.text, sources });
  }

  // 12b. AI SDK format
  if (useAiSdkFormat) {
    const result = streamText({
      model: provider(modelId),
      system: systemPrompt,
      messages: modelMessages,
      onFinish: async ({ text, usage }) => {
        try {
          await admin.from("messages").insert({
            conversation_id: conversationId,
            parent_message_id: userMessageId,
            role: "assistant",
            content: text,
            sources,
          });
        } catch {
          // ignore
        }

        trackUsage(admin, {
          organizationId,
          userId: null,
          queryText: latestMessage.content,
          embeddingTokens: searchResponse.queryTokenCount,
          llmInputTokens: usage?.inputTokens ?? 0,
          llmOutputTokens: usage?.outputTokens ?? 0,
          model: modelId,
          chunksRetrieved: relevantResults.length,
        }).catch(() => {});
      },
    });

    return result.toUIMessageStreamResponse({
      headers: {
        "x-conversation-id": conversationId!,
        "x-sources": JSON.stringify(
          sources.map(({ content: _content, ...rest }) => rest)
        ),
      },
    });
  }

  // 12c. Standard SSE format (default)
  const result = streamText({
    model: provider(modelId),
    system: systemPrompt,
    messages: modelMessages,
    onFinish: async ({ text, usage }) => {
      try {
        await admin.from("messages").insert({
          conversation_id: conversationId,
          parent_message_id: userMessageId,
          role: "assistant",
          content: text,
          sources,
        });
      } catch {
        // ignore
      }

      trackUsage(admin, {
        organizationId,
        userId: null,
        queryText: latestMessage.content,
        embeddingTokens: searchResponse.queryTokenCount,
        llmInputTokens: usage?.inputTokens ?? 0,
        llmOutputTokens: usage?.outputTokens ?? 0,
        model: modelId,
        chunksRetrieved: relevantResults.length,
      }).catch(() => {});
    },
  });

  const encoder = new TextEncoder();
  const textStream = result.textStream;

  const sseStream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of textStream) {
          controller.enqueue(
            encoder.encode(
              `event: text-delta\ndata: ${JSON.stringify({ content: chunk })}\n\n`
            )
          );
        }
        // Send sources after text is complete
        controller.enqueue(
          encoder.encode(
            `event: sources\ndata: ${JSON.stringify(sources)}\n\n`
          )
        );
        controller.enqueue(
          encoder.encode(
            `event: done\ndata: ${JSON.stringify({ conversationId })}\n\n`
          )
        );
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(sseStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
