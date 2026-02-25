import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock auth
vi.mock("@/lib/api/auth", () => ({
  authenticateApiKey: vi.fn(),
}));

// Mock admin client
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

import { authenticateApiKey } from "@/lib/api/auth";
import type { Mock } from "vitest";

const mockAuth = authenticateApiKey as Mock;

describe("GET /api/v1/conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when auth fails", async () => {
    mockAuth.mockResolvedValue({
      error: new Response(
        JSON.stringify({
          error: { code: "unauthorized", message: "Invalid" },
        }),
        { status: 401 }
      ),
    });

    const { GET } = await import("@/app/api/v1/conversations/route");
    const req = new Request("http://localhost/api/v1/conversations");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns conversations list", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [
              {
                id: "conv-1",
                title: "Chat about lease",
                updated_at: "2026-01-01T00:00:00Z",
              },
            ],
            error: null,
          }),
        }),
      }),
    });

    const { GET } = await import("@/app/api/v1/conversations/route");
    const req = new Request("http://localhost/api/v1/conversations");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].title).toBe("Chat about lease");
    expect(body.data[0].updatedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("returns 500 on database error", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "DB error" },
          }),
        }),
      }),
    });

    const { GET } = await import("@/app/api/v1/conversations/route");
    const req = new Request("http://localhost/api/v1/conversations");
    const res = await GET(req);
    expect(res.status).toBe(500);
  });
});

describe("GET /api/v1/conversations/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when auth fails", async () => {
    mockAuth.mockResolvedValue({
      error: new Response(
        JSON.stringify({
          error: { code: "unauthorized", message: "Invalid" },
        }),
        { status: 401 }
      ),
    });

    const { GET } = await import("@/app/api/v1/conversations/[id]/route");
    const req = new Request("http://localhost/api/v1/conversations/conv-1");
    const res = await GET(req, { params: Promise.resolve({ id: "conv-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when conversation not found", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "Not found" },
            }),
          }),
        }),
      }),
    });

    const { GET } = await import("@/app/api/v1/conversations/[id]/route");
    const req = new Request("http://localhost/api/v1/conversations/missing");
    const res = await GET(req, { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns conversation with messages on success", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // conversations query
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: "conv-1",
                    title: "Chat about lease",
                    created_at: "2026-01-01T00:00:00Z",
                    updated_at: "2026-01-02T00:00:00Z",
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      } else {
        // messages query
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "msg-1",
                    role: "user",
                    content: "What is the pet policy?",
                    sources: null,
                    created_at: "2026-01-01T00:00:01Z",
                  },
                  {
                    id: "msg-2",
                    role: "assistant",
                    content: "Pets are allowed with a deposit.",
                    sources: [{ document_id: "doc-1", chunk_index: 0 }],
                    created_at: "2026-01-01T00:00:02Z",
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
    });

    const { GET } = await import("@/app/api/v1/conversations/[id]/route");
    const req = new Request("http://localhost/api/v1/conversations/conv-1");
    const res = await GET(req, { params: Promise.resolve({ id: "conv-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe("conv-1");
    expect(body.data.title).toBe("Chat about lease");
    expect(body.data.messages).toHaveLength(2);
    expect(body.data.messages[0].role).toBe("user");
    expect(body.data.messages[1].sources).toEqual([
      { document_id: "doc-1", chunk_index: 0 },
    ]);
  });

  it("returns 500 when messages query fails", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: "conv-1",
                    title: "Chat",
                    created_at: "2026-01-01T00:00:00Z",
                    updated_at: "2026-01-01T00:00:00Z",
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      } else {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "DB error" },
              }),
            }),
          }),
        };
      }
    });

    const { GET } = await import("@/app/api/v1/conversations/[id]/route");
    const req = new Request("http://localhost/api/v1/conversations/conv-1");
    const res = await GET(req, { params: Promise.resolve({ id: "conv-1" }) });
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/v1/conversations/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when auth fails", async () => {
    mockAuth.mockResolvedValue({
      error: new Response(
        JSON.stringify({
          error: { code: "unauthorized", message: "Invalid" },
        }),
        { status: 401 }
      ),
    });

    const { DELETE } = await import(
      "@/app/api/v1/conversations/[id]/route"
    );
    const req = new Request("http://localhost/api/v1/conversations/conv-1", {
      method: "DELETE",
    });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 when conversation not found", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "Not found" },
            }),
          }),
        }),
      }),
    });

    const { DELETE } = await import(
      "@/app/api/v1/conversations/[id]/route"
    );
    const req = new Request("http://localhost/api/v1/conversations/missing", {
      method: "DELETE",
    });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns success when conversation is deleted", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: "conv-1" },
              error: null,
            }),
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }));

    const { DELETE } = await import(
      "@/app/api/v1/conversations/[id]/route"
    );
    const req = new Request("http://localhost/api/v1/conversations/conv-1", {
      method: "DELETE",
    });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);
  });

  it("returns 500 when delete fails", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: "conv-1" },
              error: null,
            }),
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          error: { message: "FK constraint" },
        }),
      }),
    }));

    const { DELETE } = await import(
      "@/app/api/v1/conversations/[id]/route"
    );
    const req = new Request("http://localhost/api/v1/conversations/conv-1", {
      method: "DELETE",
    });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(500);
  });
});

describe("POST /api/v1/conversations/:id/feedback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when auth fails", async () => {
    mockAuth.mockResolvedValue({
      error: new Response(
        JSON.stringify({
          error: { code: "unauthorized", message: "Invalid" },
        }),
        { status: 401 }
      ),
    });

    const { POST } = await import(
      "@/app/api/v1/conversations/[id]/feedback/route"
    );
    const req = new Request(
      "http://localhost/api/v1/conversations/conv-1/feedback",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: 1, rating: 5 }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when messageId or rating missing", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });

    const { POST } = await import(
      "@/app/api/v1/conversations/[id]/feedback/route"
    );
    const req = new Request(
      "http://localhost/api/v1/conversations/conv-1/feedback",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when rating is not 1 or 5", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });

    const { POST } = await import(
      "@/app/api/v1/conversations/[id]/feedback/route"
    );
    const req = new Request(
      "http://localhost/api/v1/conversations/conv-1/feedback",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: 1, rating: 3 }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when conversation not found", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "Not found" },
            }),
          }),
        }),
      }),
    });

    const { POST } = await import(
      "@/app/api/v1/conversations/[id]/feedback/route"
    );
    const req = new Request(
      "http://localhost/api/v1/conversations/missing/feedback",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: 1, rating: 5 }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: "missing" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns success when feedback is submitted", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // conversations query
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: "conv-1" },
                  error: null,
                }),
              }),
            }),
          }),
        };
      } else {
        // message_feedback insert
        return {
          insert: vi.fn().mockResolvedValue({
            error: null,
          }),
        };
      }
    });

    const { POST } = await import(
      "@/app/api/v1/conversations/[id]/feedback/route"
    );
    const req = new Request(
      "http://localhost/api/v1/conversations/conv-1/feedback",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: 1, rating: 5, comment: "Great!" }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.submitted).toBe(true);
  });

  it("returns 500 when insert fails", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: "conv-1" },
                  error: null,
                }),
              }),
            }),
          }),
        };
      } else {
        return {
          insert: vi.fn().mockResolvedValue({
            error: { message: "DB error" },
          }),
        };
      }
    });

    const { POST } = await import(
      "@/app/api/v1/conversations/[id]/feedback/route"
    );
    const req = new Request(
      "http://localhost/api/v1/conversations/conv-1/feedback",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: 1, rating: 1 }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: "conv-1" }),
    });
    expect(res.status).toBe(500);
  });
});
