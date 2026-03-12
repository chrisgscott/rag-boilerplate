import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock auth
vi.mock("@/lib/api/auth", () => ({
  authenticateApiKey: vi.fn(),
}));

// Mock admin client
const mockFrom = vi.fn();
const mockStorage = {
  from: vi.fn().mockReturnValue({
    upload: vi.fn().mockResolvedValue({ error: null }),
    remove: vi.fn().mockResolvedValue({ error: null }),
  }),
};
const mockRpc = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockFrom,
    storage: mockStorage,
    rpc: mockRpc,
  })),
}));

import { authenticateApiKey } from "@/lib/api/auth";
import type { Mock } from "vitest";

const mockAuth = authenticateApiKey as Mock;

describe("POST /api/v1/documents — metadata handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: auth succeeds
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
    // Default: insert succeeds
    mockFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    });
    // Reset storage mock
    mockStorage.from.mockReturnValue({
      upload: vi.fn().mockResolvedValue({ error: null }),
      remove: vi.fn().mockResolvedValue({ error: null }),
    });
  });

  it("accepts valid metadata JSON object", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert: insertMock });

    const { POST } = await import("@/app/api/v1/documents/route");
    const formData = new FormData();
    formData.append("file", new File(["content"], "lease.pdf", { type: "application/pdf" }));
    formData.append("metadata", JSON.stringify({ source: "upload", category: "lease" }));

    const req = new Request("http://localhost/api/v1/documents", { method: "POST" });
    vi.spyOn(req, "formData").mockResolvedValue(formData);

    const res = await POST(req);
    expect(res.status).toBe(201);

    // Verify metadata was passed to insert
    const insertPayload = insertMock.mock.calls[0][0];
    expect(insertPayload.metadata).toEqual({ source: "upload", category: "lease" });
  });

  it("returns 400 for invalid (non-parseable) metadata JSON", async () => {
    const { POST } = await import("@/app/api/v1/documents/route");
    const formData = new FormData();
    formData.append("file", new File(["content"], "lease.pdf", { type: "application/pdf" }));
    formData.append("metadata", "{ not valid json }");

    const req = new Request("http://localhost/api/v1/documents", { method: "POST" });
    vi.spyOn(req, "formData").mockResolvedValue(formData);

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
  });

  it("returns 400 when metadata is a JSON array (not an object)", async () => {
    const { POST } = await import("@/app/api/v1/documents/route");
    const formData = new FormData();
    formData.append("file", new File(["content"], "lease.pdf", { type: "application/pdf" }));
    formData.append("metadata", JSON.stringify(["item1", "item2"]));

    const req = new Request("http://localhost/api/v1/documents", { method: "POST" });
    vi.spyOn(req, "formData").mockResolvedValue(formData);

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
  });

  it("returns 400 when metadata is JSON null (not an object)", async () => {
    const { POST } = await import("@/app/api/v1/documents/route");
    const formData = new FormData();
    formData.append("file", new File(["content"], "lease.pdf", { type: "application/pdf" }));
    formData.append("metadata", "null");

    const req = new Request("http://localhost/api/v1/documents", { method: "POST" });
    vi.spyOn(req, "formData").mockResolvedValue(formData);

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
  });

  it("works without metadata field (backward compatible)", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert: insertMock });

    const { POST } = await import("@/app/api/v1/documents/route");
    const formData = new FormData();
    formData.append("file", new File(["content"], "lease.pdf", { type: "application/pdf" }));
    // No metadata field

    const req = new Request("http://localhost/api/v1/documents", { method: "POST" });
    vi.spyOn(req, "formData").mockResolvedValue(formData);

    const res = await POST(req);
    expect(res.status).toBe(201);

    // Verify insert was called and metadata is not present (or is default)
    const insertPayload = insertMock.mock.calls[0][0];
    expect(insertPayload.metadata).toBeUndefined();
  });
});

describe("GET /api/v1/documents — metadata in list response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
  });

  it("includes metadata in document list", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [
              {
                id: "doc-1",
                name: "lease.pdf",
                mime_type: "application/pdf",
                file_size: 1024,
                status: "complete",
                metadata: { source: "upload", category: "lease" },
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-01T00:00:00Z",
              },
            ],
            error: null,
          }),
        }),
      }),
    });

    const { GET } = await import("@/app/api/v1/documents/route");
    const req = new Request("http://localhost/api/v1/documents");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].metadata).toEqual({ source: "upload", category: "lease" });
  });

  it("returns empty object when metadata is null", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [
              {
                id: "doc-1",
                name: "lease.pdf",
                mime_type: "application/pdf",
                file_size: 1024,
                status: "complete",
                metadata: null,
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-01T00:00:00Z",
              },
            ],
            error: null,
          }),
        }),
      }),
    });

    const { GET } = await import("@/app/api/v1/documents/route");
    const req = new Request("http://localhost/api/v1/documents");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].metadata).toEqual({});
  });
});

describe("GET /api/v1/documents/:id — metadata in detail response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
  });

  it("includes metadata in document detail", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: "doc-1",
                name: "lease.pdf",
                mime_type: "application/pdf",
                file_size: 1024,
                status: "complete",
                chunk_count: 15,
                metadata: { source: "upload", year: 2026 },
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-01T00:00:00Z",
              },
              error: null,
            }),
          }),
        }),
      }),
    });

    const { GET } = await import("@/app/api/v1/documents/[id]/route");
    const req = new Request("http://localhost/api/v1/documents/doc-1");
    const res = await GET(req, { params: Promise.resolve({ id: "doc-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.metadata).toEqual({ source: "upload", year: 2026 });
  });

  it("returns empty object when metadata is null", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: "doc-1",
                name: "lease.pdf",
                mime_type: "application/pdf",
                file_size: 1024,
                status: "complete",
                chunk_count: 15,
                metadata: null,
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-01T00:00:00Z",
              },
              error: null,
            }),
          }),
        }),
      }),
    });

    const { GET } = await import("@/app/api/v1/documents/[id]/route");
    const req = new Request("http://localhost/api/v1/documents/doc-1");
    const res = await GET(req, { params: Promise.resolve({ id: "doc-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.metadata).toEqual({});
  });
});
