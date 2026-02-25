import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/api/auth", () => ({
  authenticateApiKey: vi.fn(),
}));

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockFrom,
    rpc: mockRpc,
  })),
}));

vi.mock("@/lib/rag/search", () => ({
  hybridSearch: vi.fn(),
}));

vi.mock("@/lib/rag/cost-tracker", () => ({
  trackUsage: vi.fn().mockResolvedValue(undefined),
}));

const mockStreamText = vi.fn();
const mockGenerateText = vi.fn();
vi.mock("ai", () => ({
  streamText: mockStreamText,
  generateText: mockGenerateText,
  convertToModelMessages: vi.fn((msgs: unknown) => Promise.resolve(msgs)),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => vi.fn(() => "mock-model")),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn(() => "mock-model")),
}));

vi.mock("@/lib/rag/prompt", () => ({
  buildSystemPrompt: vi.fn(() => "mock system prompt"),
}));

vi.mock("@/lib/rag/provider", () => ({
  getLLMProvider: vi.fn(() => vi.fn(() => "mock-model")),
  getModelId: vi.fn(() => "gpt-4o"),
}));

import { authenticateApiKey } from "@/lib/api/auth";
import { hybridSearch } from "@/lib/rag/search";
import type { Mock } from "vitest";

const mockAuth = authenticateApiKey as Mock;
const mockHybridSearch = hybridSearch as Mock;

function createChatRequest(
  body: Record<string, unknown>,
  headers?: Record<string, string>
): Request {
  return new Request("http://localhost/api/v1/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer sk-test-key-1234",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/** Set up default mock for Supabase admin client .from() calls */
function setupDefaultFromMock() {
  mockFrom.mockImplementation((table: string) => {
    if (table === "organizations") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { system_prompt: null },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "conversations") {
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: "conv-1" },
              error: null,
            }),
          }),
        }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: "existing-conv-1" },
                error: null,
              }),
            }),
          }),
        }),
      };
    }
    if (table === "messages") {
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 1 },
              error: null,
            }),
          }),
          catch: vi.fn(),
        }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };
    }
    return {};
  });
}

describe("POST /api/v1/chat", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv, LLM_PROVIDER: "openai" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 401 when auth fails", async () => {
    mockAuth.mockResolvedValue({
      error: new Response(
        JSON.stringify({ error: { code: "unauthorized" } }),
        { status: 401 }
      ),
    });

    const { POST } = await import("@/app/api/v1/chat/route");
    const req = createChatRequest({
      messages: [{ role: "user", content: "hello" }],
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when messages array is missing", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });

    const { POST } = await import("@/app/api/v1/chat/route");
    const req = createChatRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when messages array is empty", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });

    const { POST } = await import("@/app/api/v1/chat/route");
    const req = createChatRequest({ messages: [] });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns refusal when no relevant results found (non-streaming)", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    setupDefaultFromMock();
    mockHybridSearch.mockResolvedValue({ results: [], queryTokenCount: 5 });

    const { POST } = await import("@/app/api/v1/chat/route");
    const req = createChatRequest({
      messages: [{ role: "user", content: "random question" }],
      stream: false,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.message).toContain("don't have enough information");
  });

  it("returns SSE refusal when no relevant results found (streaming)", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    setupDefaultFromMock();
    mockHybridSearch.mockResolvedValue({ results: [], queryTokenCount: 5 });

    const { POST } = await import("@/app/api/v1/chat/route");
    const req = createChatRequest({
      messages: [{ role: "user", content: "random question" }],
    });
    const res = await POST(req);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: text-delta");
    expect(text).toContain("don't have enough information");
    expect(text).toContain("event: done");
  });

  it("returns AI SDK format refusal when Accept header requests it (streaming)", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    setupDefaultFromMock();
    mockHybridSearch.mockResolvedValue({ results: [], queryTokenCount: 5 });

    const { POST } = await import("@/app/api/v1/chat/route");
    const req = createChatRequest(
      { messages: [{ role: "user", content: "random question" }] },
      { Accept: "text/x-vercel-ai-data-stream" }
    );
    const res = await POST(req);
    expect(res.headers.get("content-type")).toBe(
      "text/x-vercel-ai-data-stream"
    );
    expect(res.headers.get("x-conversation-id")).toBe("conv-1");
    expect(res.headers.get("x-sources")).toBe("[]");
    const text = await res.text();
    expect(text).toContain("don't have enough information");
  });

  it("calls streamText and returns SSE stream when results are relevant", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    setupDefaultFromMock();
    mockHybridSearch.mockResolvedValue({
      results: [
        {
          chunkId: 1,
          chunkIndex: 0,
          documentId: "doc-1",
          documentName: "lease.pdf",
          content: "The lease term is 12 months.",
          metadata: {},
          similarity: 0.92,
          ftsRank: 0.8,
          rrfScore: 0.85,
        },
      ],
      queryTokenCount: 5,
    });

    mockStreamText.mockReturnValue({
      textStream: (async function* () {
        yield "The lease is 12 months.";
      })(),
      text: Promise.resolve("The lease is 12 months."),
      usage: Promise.resolve({ inputTokens: 100, outputTokens: 20 }),
    });

    const { POST } = await import("@/app/api/v1/chat/route");
    const req = createChatRequest({
      messages: [{ role: "user", content: "What is the lease term?" }],
    });
    const res = await POST(req);

    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: text-delta");
    expect(text).toContain("The lease is 12 months.");
    expect(text).toContain("event: sources");
    expect(text).toContain("event: done");
  });

  it("returns AI SDK format when Accept header is text/x-vercel-ai-data-stream", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    setupDefaultFromMock();
    mockHybridSearch.mockResolvedValue({
      results: [
        {
          chunkId: 1,
          chunkIndex: 0,
          documentId: "doc-1",
          documentName: "lease.pdf",
          content: "The lease term is 12 months.",
          metadata: {},
          similarity: 0.92,
          ftsRank: 0.8,
          rrfScore: 0.85,
        },
      ],
      queryTokenCount: 5,
    });

    const mockResponse = new Response("ai-sdk-stream", {
      headers: {
        "Content-Type": "text/x-vercel-ai-data-stream",
        "x-conversation-id": "conv-1",
      },
    });

    mockStreamText.mockReturnValue({
      toUIMessageStreamResponse: vi.fn().mockReturnValue(mockResponse),
      textStream: (async function* () {
        yield "The lease is 12 months.";
      })(),
      text: Promise.resolve("The lease is 12 months."),
      usage: Promise.resolve({ inputTokens: 100, outputTokens: 20 }),
    });

    const { POST } = await import("@/app/api/v1/chat/route");
    const req = createChatRequest(
      { messages: [{ role: "user", content: "What is the lease term?" }] },
      { Accept: "text/x-vercel-ai-data-stream" }
    );
    const res = await POST(req);

    expect(mockStreamText).toHaveBeenCalled();
    // Should use the toUIMessageStreamResponse path
    expect(
      mockStreamText.mock.results[0].value.toUIMessageStreamResponse
    ).toHaveBeenCalled();
  });

  it("returns non-streaming JSON when stream is false", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    setupDefaultFromMock();
    mockHybridSearch.mockResolvedValue({
      results: [
        {
          chunkId: 1,
          chunkIndex: 0,
          documentId: "doc-1",
          documentName: "lease.pdf",
          content: "The lease term is 12 months.",
          metadata: {},
          similarity: 0.92,
          ftsRank: 0.8,
          rrfScore: 0.85,
        },
      ],
      queryTokenCount: 5,
    });

    mockGenerateText.mockResolvedValue({
      text: "The lease term is 12 months.",
      usage: { inputTokens: 100, outputTokens: 20 },
    });

    const { POST } = await import("@/app/api/v1/chat/route");
    const req = createChatRequest({
      messages: [{ role: "user", content: "What is the lease term?" }],
      stream: false,
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.message).toBe("The lease term is 12 months.");
    expect(body.data.conversationId).toBe("conv-1");
    expect(body.data.sources).toHaveLength(1);
    expect(body.data.sources[0].documentName).toBe("lease.pdf");
  });

  it("includes conversationId when provided", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    setupDefaultFromMock();
    mockHybridSearch.mockResolvedValue({ results: [], queryTokenCount: 5 });

    const { POST } = await import("@/app/api/v1/chat/route");
    const req = createChatRequest({
      messages: [{ role: "user", content: "hello" }],
      conversationId: "existing-conv-1",
      stream: false,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.conversationId).toBe("existing-conv-1");
  });

  it("returns 404 when conversationId does not belong to org", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });

    // Override the conversations mock to return null (not found / wrong org)
    mockFrom.mockImplementation((table: string) => {
      if (table === "organizations") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { system_prompt: null },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "conversations") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: "PGRST116", message: "not found" },
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const { POST } = await import("@/app/api/v1/chat/route");
    const req = createChatRequest({
      messages: [{ role: "user", content: "hello" }],
      conversationId: "wrong-org-conv-id",
      stream: false,
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("filters results below similarity threshold", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    setupDefaultFromMock();
    mockHybridSearch.mockResolvedValue({
      results: [
        {
          chunkId: 1,
          chunkIndex: 0,
          documentId: "doc-1",
          documentName: "lease.pdf",
          content: "Some content",
          metadata: {},
          similarity: 0.1, // Below 0.3 threshold
          ftsRank: 0.5,
          rrfScore: 0.3,
        },
      ],
      queryTokenCount: 5,
    });

    const { POST } = await import("@/app/api/v1/chat/route");
    const req = createChatRequest({
      messages: [{ role: "user", content: "random" }],
      stream: false,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Should get refusal because the only result is below threshold
    expect(body.data.message).toContain("don't have enough information");
  });
});
