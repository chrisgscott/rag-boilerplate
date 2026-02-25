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
const mockRpc = vi.fn();

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

describe("GET /api/v1/documents", () => {
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

    const { GET } = await import("@/app/api/v1/documents/route");
    const req = new Request("http://localhost/api/v1/documents");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns list of documents on success", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });
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
                status: "ready",
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
    const req = new Request("http://localhost/api/v1/documents", {
      headers: { Authorization: "Bearer sk-test" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("doc-1");
  });
});

describe("POST /api/v1/documents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when no file provided", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });

    const { POST } = await import("@/app/api/v1/documents/route");
    const formData = new FormData();
    const req = new Request("http://localhost/api/v1/documents", {
      method: "POST",
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 413 for files exceeding size limit", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });

    const { POST } = await import("@/app/api/v1/documents/route");
    // Create a file object with a large reported size
    const largeFile = new File(["data"], "large.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(largeFile, "size", { value: 60 * 1024 * 1024 }); // 60MB
    const formData = new FormData();
    formData.append("file", largeFile);
    // Mock formData() so the overridden size survives (Request serialization resets it)
    const req = new Request("http://localhost/api/v1/documents", {
      method: "POST",
    });
    vi.spyOn(req, "formData").mockResolvedValue(formData);
    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  it("returns 422 for unsupported file type", async () => {
    mockAuth.mockResolvedValue({
      data: { organizationId: "org-1", apiKeyId: "key-1" },
    });

    const { POST } = await import("@/app/api/v1/documents/route");
    const formData = new FormData();
    formData.append(
      "file",
      new File(["data"], "image.png", { type: "image/png" })
    );
    const req = new Request("http://localhost/api/v1/documents", {
      method: "POST",
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });
});
