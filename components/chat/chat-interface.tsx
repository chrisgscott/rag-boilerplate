"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { toast } from "sonner";
import { BookIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
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
  PromptInputFooter,
} from "@/components/ai/prompt-input";
import { MessageFeedback } from "./message-feedback";
import {
  Sources,
  SourcesTrigger,
  SourcesContent,
  Source,
} from "@/components/ai/sources";

type InitialMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: unknown[] | null;
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

/** Hook to lazy-load a signed Storage URL for a page image path. */
function useSignedUrl(storagePath: string | undefined) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null); // Reset stale URL when path changes
    if (!storagePath) return;
    let cancelled = false;
    const supabase = createBrowserSupabase();
    supabase.storage
      .from("documents")
      .createSignedUrl(storagePath, 3600)
      .then(({ data }) => {
        if (!cancelled && data) setUrl(data.signedUrl);
      });
    return () => { cancelled = true; };
  }, [storagePath]);

  return url;
}

/** Small thumbnail that lazy-loads a signed Storage URL for a page image. */
function SourceThumbnail({ storagePath }: { storagePath: string }) {
  const url = useSignedUrl(storagePath);

  if (!url) return <BookIcon className="h-4 w-4 shrink-0" />;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt="Page preview"
      className="h-8 w-8 shrink-0 rounded object-cover"
    />
  );
}

type PageImageInfo = { pageNumber: string; storagePath: string; documentName?: string };

/** A single clickable thumbnail card in the gallery. */
function PageImageCard({
  image,
  onClick,
}: {
  image: PageImageInfo;
  onClick: () => void;
}) {
  const url = useSignedUrl(image.storagePath);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group/card flex-none w-24 rounded-lg border border-border bg-muted/50 overflow-hidden transition-colors hover:border-primary/50 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative w-full aspect-[4/3] bg-muted">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={`Page ${image.pageNumber}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <Skeleton className="h-full w-full" />
        )}
      </div>
      <div className="px-1.5 py-1 text-[10px] text-muted-foreground truncate text-center">
        Page {image.pageNumber}
      </div>
    </button>
  );
}

/** Horizontal gallery of page image thumbnails with Dialog lightbox. */
function PageImageGallery({ images }: { images: PageImageInfo[] }) {
  const [selectedImage, setSelectedImage] = useState<PageImageInfo | null>(null);
  const selectedUrl = useSignedUrl(selectedImage?.storagePath);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Reset loaded state when the selected image changes
  useEffect(() => {
    setImageLoaded(false);
  }, [selectedImage?.storagePath]);

  if (images.length === 0) return null;

  return (
    <>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {images.map((img) => (
          <PageImageCard
            key={`${img.storagePath}`}
            image={img}
            onClick={() => setSelectedImage(img)}
          />
        ))}
      </div>

      <Dialog open={!!selectedImage} onOpenChange={(open) => !open && setSelectedImage(null)}>
        <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-4 pb-2">
            <DialogTitle className="text-sm font-medium">
              Page {selectedImage?.pageNumber}
              {selectedImage?.documentName && (
                <span className="ml-2 text-muted-foreground font-normal">
                  — {selectedImage.documentName}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="px-4 pb-4">
            {!imageLoaded && (
              <Skeleton className="w-full aspect-[3/4] rounded-md" />
            )}
            {selectedUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selectedUrl}
                alt={`Page ${selectedImage?.pageNumber}`}
                className={`w-full rounded-md ${imageLoaded ? "" : "hidden"}`}
                onLoad={() => setImageLoaded(true)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
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

  type SourceData = {
    documentId: string;
    documentName?: string;
    chunkId: number;
    chunkIndex?: number;
    pageImagePaths?: Record<string, string>;
  };

  // Map message IDs to their stored sources for historical messages
  const sourcesMap = useMemo(() => {
    const map = new Map<string, SourceData[]>();
    for (const msg of initialMessages) {
      if (msg.sources && msg.sources.length > 0) {
        map.set(msg.id, msg.sources as SourceData[]);
      }
    }
    return map;
  }, [initialMessages]);

  // Sources for messages created during this session (streamed via header)
  const [runtimeSources, setRuntimeSources] = useState<Map<string, SourceData[]>>(new Map());
  const pendingSourcesRef = useRef<SourceData[] | null>(null);

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
          const sourcesHeader = response.headers.get("x-sources");
          if (sourcesHeader) {
            try {
              pendingSourcesRef.current = JSON.parse(sourcesHeader);
            } catch {
              pendingSourcesRef.current = null;
            }
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

  // When streaming finishes, attach pending sources to the last assistant message
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current === "streaming" && status === "ready") {
      if (pendingSourcesRef.current && messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role === "assistant") {
          const sources = pendingSourcesRef.current;
          pendingSourcesRef.current = null;
          setRuntimeSources((prev) => {
            const next = new Map(prev);
            next.set(lastMsg.id, sources);
            return next;
          });
        }
      }
    }
    prevStatusRef.current = status;
  }, [status, messages]);

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

  const suggestions = [
    "What are the key terms in my lease?",
    "Summarize the HOA rules",
    "How much is rent?",
    "What are the move-in requirements?",
  ];

  return (
    <div className="flex flex-1 min-h-0 flex-col -mx-4 -mb-4">
      <ChatHeader
        title={title}
        onHistoryClick={() => setHistoryOpen(true)}
        onNewChat={handleNewChat}
      />

      <Conversation className="flex-1">
        <ConversationContent className="mx-auto max-w-3xl px-4">
          {messages.length === 0 && !isStreaming ? (
            <ConversationEmptyState
              title="Ask a question"
              description="Ask a question about your documents to get started."
            >
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent"
                    onClick={() => handleSubmit({ text: s })}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </ConversationEmptyState>
          ) : (
            messages.map((msg) => {
              const msgSources = msg.role === "assistant"
                ? (sourcesMap.get(msg.id) ?? runtimeSources.get(msg.id))
                : undefined;

              // Collect unique page images across all sources for this message
              const pageImagesForMsg: PageImageInfo[] = [];
              if (msgSources) {
                const seen = new Set<string>();
                for (const source of msgSources) {
                  if (source.pageImagePaths) {
                    for (const [pageNo, path] of Object.entries(source.pageImagePaths)) {
                      if (!seen.has(path)) {
                        seen.add(path);
                        pageImagesForMsg.push({
                          pageNumber: pageNo,
                          storagePath: path,
                          documentName: source.documentName,
                        });
                      }
                    }
                  }
                }
              }

              return (
                <Message key={msg.id} from={msg.role}>
                  <div className="group relative">
                    <MessageContent>
                      {msg.role === "assistant" ? (
                        <MessageResponse>{getMessageText(msg)}</MessageResponse>
                      ) : (
                        <p className="whitespace-pre-wrap">{getMessageText(msg)}</p>
                      )}
                    </MessageContent>
                    {msg.role === "assistant" && pageImagesForMsg.length > 0 && (
                      <PageImageGallery images={pageImagesForMsg} />
                    )}
                    {msg.role === "assistant" && !isStreaming && (
                      <MessageFeedback messageId={Number(msg.id)} />
                    )}
                    {msg.role === "assistant" && msgSources && msgSources.length > 0 && (
                      <Sources>
                        <SourcesTrigger count={msgSources.length} />
                        <SourcesContent>
                          {msgSources.map((source, idx) => {
                            const chunkNum = source.chunkIndex != null
                              ? source.chunkIndex + 1
                              : undefined;
                            const hash = chunkNum != null ? `#chunk-${chunkNum}` : "";
                            const firstImagePath = source.pageImagePaths
                              ? Object.values(source.pageImagePaths)[0]
                              : undefined;
                            return (
                              <Source
                                key={idx}
                                href={`/documents/${source.documentId}${hash}`}
                                title={source.documentName ?? `Source ${idx + 1}`}
                              >
                                {firstImagePath ? (
                                  <>
                                    <SourceThumbnail storagePath={firstImagePath} />
                                    <span className="block font-medium">
                                      {source.documentName ?? `Source ${idx + 1}`}
                                    </span>
                                  </>
                                ) : undefined}
                              </Source>
                            );
                          })}
                        </SourcesContent>
                      </Sources>
                    )}
                  </div>
                </Message>
              );
            })
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t bg-background px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputTextarea placeholder="Ask a question about your documents..." />
            <PromptInputFooter>
              <div />
              <PromptInputSubmit status={status} />
            </PromptInputFooter>
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
