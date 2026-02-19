"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ChatHeader } from "./chat-header";
import { ConversationList } from "./conversation-list";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
} from "@/components/ai/prompt-input";

type InitialMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
};

/**
 * Extract text content from a UIMessage.
 * UIMessage uses `parts` array in AI SDK v5+.
 * Falls back to joining text parts, or empty string.
 */
function getMessageText(msg: UIMessage): string {
  if (!msg.parts || msg.parts.length === 0) return "";
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/**
 * Convert initial messages (from DB with content strings) to UIMessage format
 * compatible with the AI SDK v5 useChat hook.
 */
function toUIMessages(messages: InitialMessage[]): UIMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    parts: [{ type: "text" as const, text: m.content }],
  }));
}

export function ChatInterface({
  conversationId,
  initialMessages,
  conversationTitle,
}: {
  conversationId: string | null;
  initialMessages: InitialMessage[];
  conversationTitle: string | null;
}) {
  const router = useRouter();
  const [currentConversationId, setCurrentConversationId] =
    useState(conversationId);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Ref so the body/fetch functions always read the latest value
  const convIdRef = useRef(currentConversationId);
  convIdRef.current = currentConversationId;

  // Memoize the transport so it is stable across re-renders
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({ conversationId: convIdRef.current }),
        // Custom fetch to intercept the x-conversation-id header
        fetch: async (input, init) => {
          const response = await globalThis.fetch(input, init);
          const newConvId = response.headers.get("x-conversation-id");
          if (newConvId && !convIdRef.current) {
            convIdRef.current = newConvId;
            setCurrentConversationId(newConvId);
            window.history.replaceState(null, "", `/chat?id=${newConvId}`);
          }
          return response;
        },
        // Transform UIMessages to include `content` field expected by the route handler.
        // The route reads `messages[].content` (flat string), but the SDK sends `parts`.
        prepareSendMessagesRequest: ({ messages: msgs, body }) => {
          const transformedMessages = msgs.map((msg) => ({
            ...msg,
            content: getMessageText(msg),
          }));
          return {
            body: {
              ...(typeof body === "object" && body !== null ? body : {}),
              messages: transformedMessages,
            },
          };
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- convIdRef is stable
    []
  );

  const { messages, sendMessage, status, setMessages } = useChat({
    transport,
    messages: toUIMessages(initialMessages),
    onError: () => {
      toast.error("Failed to send message. Please try again.");
    },
  });

  const handleNewChat = () => {
    convIdRef.current = null;
    setCurrentConversationId(null);
    setMessages([]);
    router.push("/chat");
  };

  const handleSelectConversation = (id: string) => {
    setHistoryOpen(false);
    router.push(`/chat?id=${id}`);
  };

  const handleSubmit = useCallback(
    ({ text }: { text: string }) => {
      if (!text.trim()) return;
      sendMessage({ text });
    },
    [sendMessage]
  );

  const title =
    conversationTitle ?? (currentConversationId ? "Chat" : "New Chat");

  const isStreaming = status === "streaming" || status === "submitted";

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col -m-6">
      <ChatHeader
        title={title}
        onHistoryClick={() => setHistoryOpen(true)}
        onNewChat={handleNewChat}
      />

      <Conversation>
        <ConversationContent>
          {messages.length === 0 && !isStreaming ? (
            <ConversationEmptyState
              title="Ask a question"
              description="Ask a question about your documents to get started."
            />
          ) : (
            messages.map((msg) => (
              <Message key={msg.id} from={msg.role}>
                <MessageContent>
                  {msg.role === "assistant" ? (
                    <MessageResponse>{getMessageText(msg)}</MessageResponse>
                  ) : (
                    <p className="whitespace-pre-wrap">{getMessageText(msg)}</p>
                  )}
                </MessageContent>
              </Message>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t bg-background px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputTextarea placeholder="Ask a question about your documents..." />
            <PromptInputSubmit status={status} />
          </PromptInput>
        </div>
      </div>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="left">
          <SheetHeader>
            <SheetTitle>Conversation History</SheetTitle>
          </SheetHeader>
          <ConversationList onSelect={handleSelectConversation} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
