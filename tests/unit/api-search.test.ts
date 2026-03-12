import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/api/auth", () => ({
  authenticateApiKey: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({})),
}));

vi.mock("@/lib/rag/search", () => ({
  hybridSearch: vi.fn(),
}));

import { authenticateApiKey } from "@/lib/api/auth";
import { hybridSearch } from "@/lib/rag/search";
import type { Mock } from "vitest";

const mockAuth = authenticateApiKey as Mock;
const mockHybridSearch = hybridSearch as Mock;

function createSearchRequest(
  body: Record<string, unknown>,
  headers?: Record<string, string>
): Request {
  return new Request("http://localhost/api/v1/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer sk-test-key-1234",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const mockResults = [
  {
    chunkId: 1,
    chunkIndex: 0,
    documentId: "doc-1",
    documentName: "lease.pdf",
    content: "The lease term is 12 months.",
    metadata: { page: 1 },
    similarity: 0.92,
    ftsRank: 0.8,
    rrfScore: 0.85,
  },
  {
    chunkId: 2,
    chunkIndex: 1,
    documentId: "doc-1",
    documentName: "lease.pdf",
    content: "Rent is due on the 1st of each month.",
    metadata: { page: 2 },
    similarity: 0.78,
    ftsRank: 0.6,
    rrfScore: 0.72,
  },
];

describe("POST /api/v1/search", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns 401 when auth fails", async () => {
    mockAuth.mockResolvedValue({
      error: new Response(
        JSON.stringify({ error: { code: "unauthorized" } }),
        { status: 401 }
      ),
    });

    const { POST } = await import("@/app/api/v1/search/route");
    const req = createSearchRequest({ query: "What is the lease term?" });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when query is missing", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });

    const { POST } = await import("@/app/api/v1/search/route");
    const req = createSearchRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
  });

  it("returns 400 when query is an empty string", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });

    const { POST } = await import("@/app/api/v1/search/route");
    const req = createSearchRequest({ query: "" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
  });

  it("returns 400 when query is whitespace-only", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });

    const { POST } = await import("@/app/api/v1/search/route");
    const req = createSearchRequest({ query: "   " });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
  });

  it("returns 400 when body is not valid JSON", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });

    const { POST } = await import("@/app/api/v1/search/route");
    const req = new Request("http://localhost/api/v1/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-test-key-1234",
      },
      body: "not-valid-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
  });

  it("returns search results without LLM generation", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    mockHybridSearch.mockResolvedValue({
      results: mockResults,
      queryTokenCount: 8,
    });

    const { POST } = await import("@/app/api/v1/search/route");
    const req = createSearchRequest({ query: "What is the lease term?" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.results).toHaveLength(2);
    expect(body.data.results[0].chunkId).toBe(1);
    expect(body.data.results[0].documentName).toBe("lease.pdf");
    expect(body.data.results[0].content).toBe("The lease term is 12 months.");
    expect(body.data.results[0].similarity).toBe(0.92);
    expect(body.data.results[0].rrfScore).toBe(0.85);
    expect(body.data.queryTokenCount).toBe(8);
  });

  it("does not include LLM-generated answer in response", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    mockHybridSearch.mockResolvedValue({
      results: mockResults,
      queryTokenCount: 8,
    });

    const { POST } = await import("@/app/api/v1/search/route");
    const req = createSearchRequest({ query: "What is the lease term?" });
    const res = await POST(req);
    const body = await res.json();

    // No LLM answer field — just results and token count
    expect(body.data.message).toBeUndefined();
    expect(body.data.answer).toBeUndefined();
    expect(body.data).not.toHaveProperty("conversationId");
  });

  it("uses default topK of 5 when not specified", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    mockHybridSearch.mockResolvedValue({ results: [], queryTokenCount: 4 });

    const { POST } = await import("@/app/api/v1/search/route");
    const req = createSearchRequest({ query: "lease term" });
    await POST(req);

    expect(mockHybridSearch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ matchCount: 5 })
    );
  });

  it("passes custom topK to hybridSearch", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    mockHybridSearch.mockResolvedValue({ results: [], queryTokenCount: 4 });

    const { POST } = await import("@/app/api/v1/search/route");
    const req = createSearchRequest({ query: "lease term", topK: 10 });
    await POST(req);

    expect(mockHybridSearch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ matchCount: 10 })
    );
  });

  it("passes filters to hybridSearch when provided", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    mockHybridSearch.mockResolvedValue({ results: [], queryTokenCount: 4 });

    const { POST } = await import("@/app/api/v1/search/route");
    const req = createSearchRequest({
      query: "rent amount",
      filters: {
        documentIds: ["doc-1", "doc-2"],
        mimeTypes: ["application/pdf"],
        dateFrom: "2024-01-01",
        dateTo: "2024-12-31",
      },
    });
    await POST(req);

    expect(mockHybridSearch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        filters: {
          documentIds: ["doc-1", "doc-2"],
          mimeTypes: ["application/pdf"],
          dateFrom: "2024-01-01",
          dateTo: "2024-12-31",
        },
      })
    );
  });

  it("passes organizationId from auth to hybridSearch", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-xyz", apiKeyId: "key-1" },
    });
    mockHybridSearch.mockResolvedValue({ results: [], queryTokenCount: 4 });

    const { POST } = await import("@/app/api/v1/search/route");
    const req = createSearchRequest({ query: "what are the rules?" });
    await POST(req);

    expect(mockHybridSearch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: "org-xyz" })
    );
  });

  it("returns 500 when hybridSearch throws", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    mockHybridSearch.mockRejectedValue(new Error("Database connection failed"));

    const { POST } = await import("@/app/api/v1/search/route");
    const req = createSearchRequest({ query: "lease term" });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
  });

  it("returns empty results array when no chunks match", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    mockHybridSearch.mockResolvedValue({ results: [], queryTokenCount: 3 });

    const { POST } = await import("@/app/api/v1/search/route");
    const req = createSearchRequest({ query: "quantum computing" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.results).toEqual([]);
    expect(body.data.queryTokenCount).toBe(3);
  });

  it("maps all expected result fields to response", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    mockHybridSearch.mockResolvedValue({
      results: [mockResults[0]],
      queryTokenCount: 5,
    });

    const { POST } = await import("@/app/api/v1/search/route");
    const req = createSearchRequest({ query: "lease term" });
    const res = await POST(req);
    const body = await res.json();

    const result = body.data.results[0];
    expect(result).toHaveProperty("chunkId", 1);
    expect(result).toHaveProperty("chunkIndex", 0);
    expect(result).toHaveProperty("documentId", "doc-1");
    expect(result).toHaveProperty("documentName", "lease.pdf");
    expect(result).toHaveProperty("content", "The lease term is 12 months.");
    expect(result).toHaveProperty("metadata", { page: 1 });
    expect(result).toHaveProperty("similarity", 0.92);
    expect(result).toHaveProperty("rrfScore", 0.85);
  });
});
