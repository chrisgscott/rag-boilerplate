import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock admin client
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";

// --- Auth Tests ---

describe("authenticateApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when Authorization header is missing", async () => {
    const req = new Request("http://localhost/api/v1/documents");
    const result = await authenticateApiKey(req);
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(401);
  });

  it("returns 401 when Authorization header has wrong scheme", async () => {
    const req = new Request("http://localhost/api/v1/documents", {
      headers: { Authorization: "Basic abc123" },
    });
    const result = await authenticateApiKey(req);
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(401);
  });

  it("returns 401 when key does not start with sk-", async () => {
    const req = new Request("http://localhost/api/v1/documents", {
      headers: { Authorization: "Bearer not-a-valid-key" },
    });
    const result = await authenticateApiKey(req);
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(401);
  });

  it("returns 401 when key hash not found in database", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: "Not found" } }),
        }),
      }),
    });

    const req = new Request("http://localhost/api/v1/documents", {
      headers: { Authorization: "Bearer sk-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" },
    });
    const result = await authenticateApiKey(req);
    expect(result.error).toBeDefined();
    expect(result.error!.status).toBe(401);
  });

  it("returns organizationId and apiKeyId on valid key", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: "key-1", organization_id: "org-1" },
            error: null,
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    const req = new Request("http://localhost/api/v1/documents", {
      headers: { Authorization: "Bearer sk-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" },
    });
    const result = await authenticateApiKey(req);
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({
      organizationId: "org-1",
      apiKeyId: "key-1",
    });
  });

  it("updates last_used_at on successful auth (fire-and-forget)", async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "api_keys") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: "key-1", organization_id: "org-1" },
                error: null,
              }),
            }),
          }),
          update: mockUpdate,
        };
      }
      return {};
    });

    const req = new Request("http://localhost/api/v1/documents", {
      headers: { Authorization: "Bearer sk-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" },
    });
    await authenticateApiKey(req);

    // Give fire-and-forget a tick to execute
    await new Promise((r) => setTimeout(r, 10));
    expect(mockUpdate).toHaveBeenCalled();
  });
});

// --- Response Helper Tests ---

describe("apiSuccess", () => {
  it("wraps data in { data } envelope", async () => {
    const res = apiSuccess({ id: "1", name: "test" });
    const body = await res.json();
    expect(body).toEqual({ data: { id: "1", name: "test" } });
    expect(res.status).toBe(200);
  });

  it("accepts custom status code", async () => {
    const res = apiSuccess({ id: "1" }, 201);
    expect(res.status).toBe(201);
  });
});

describe("apiError", () => {
  it("wraps error in { error: { code, message } } envelope", async () => {
    const res = apiError("not_found", "Document not found", 404);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: "not_found", message: "Document not found" },
    });
    expect(res.status).toBe(404);
  });
});
