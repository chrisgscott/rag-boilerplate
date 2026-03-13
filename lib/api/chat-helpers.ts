import type { SupabaseClient } from "@supabase/supabase-js";
import { trackUsage } from "@/lib/rag/cost-tracker";
import { isCacheEnabled, writeCache } from "@/lib/rag/cache";

export type ChatSource = {
  documentId: string;
  documentName: string;
  chunkId: number;
  chunkIndex: number;
  content: string;
  similarity: number;
};

/** Strip content from sources for header/response metadata. */
export function sourcesForHeader(sources: ChatSource[]) {
  return sources.map(({ content: _content, ...rest }) => rest);
}

/** Build the onFinish handler shared by AI SDK and SSE streaming paths. */
export function createOnFinishHandler({
  admin,
  conversationId,
  userMessageId,
  sources,
  organizationId,
  queryTokenCount,
  modelId,
  cacheEnabled,
  queryEmbedding,
  latestMessageContent,
  cacheVersion,
}: {
  admin: SupabaseClient;
  conversationId: string;
  userMessageId: number | null;
  sources: ChatSource[];
  organizationId: string;
  queryTokenCount: number;
  modelId: string;
  cacheEnabled: boolean;
  queryEmbedding: { embedding: number[]; tokenCount: number } | null;
  latestMessageContent: string;
  cacheVersion: number;
}) {
  return async ({ text, usage }: { text: string; usage?: { inputTokens?: number; outputTokens?: number } }) => {
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
      queryText: latestMessageContent,
      embeddingTokens: queryTokenCount,
      llmInputTokens: usage?.inputTokens ?? 0,
      llmOutputTokens: usage?.outputTokens ?? 0,
      model: modelId,
      chunksRetrieved: sources.length,
    }).catch(() => {});

    if (cacheEnabled && queryEmbedding) {
      void Promise.resolve(
        writeCache(admin, queryEmbedding.embedding, latestMessageContent, organizationId, cacheVersion, text, sources, modelId)
      ).catch(() => {});
    }
  };
}

const encoder = new TextEncoder();

/** Create an SSE event string. */
function sseEvent(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Create a complete SSE response with text, sources, and done events. */
export function createSSEResponse(
  text: string,
  sources: ChatSource[],
  conversationId: string,
  extraDoneFields?: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(sseEvent("text-delta", { content: text }));
      controller.enqueue(sseEvent("sources", sources));
      controller.enqueue(sseEvent("done", { conversationId, ...extraDoneFields }));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      ...extraHeaders,
    },
  });
}

/** Create an AI SDK data stream response with a single text chunk. */
export function createAiSdkResponse(
  text: string,
  headers: Record<string, string>,
): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`0:${JSON.stringify(text)}\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/x-vercel-ai-data-stream",
      ...headers,
    },
  });
}

/** Create a streaming SSE response from a textStream async iterable. */
export function createSSEStreamResponse(
  textStream: AsyncIterable<string>,
  sources: ChatSource[],
  conversationId: string,
  extraHeaders?: Record<string, string>,
): Response {
  const sseStream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of textStream) {
          controller.enqueue(sseEvent("text-delta", { content: chunk }));
        }
        controller.enqueue(sseEvent("sources", sources));
        controller.enqueue(sseEvent("done", { conversationId }));
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
      ...extraHeaders,
    },
  });
}
