import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/auth", () => ({
  authenticateApiKey: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { GET } from "@/app/api/v1/classifications/route";
import { PUT } from "@/app/api/v1/classifications/[id]/route";
import { GET as GET_STATS } from "@/app/api/v1/classifications/stats/route";
import { PUT as PUT_BULK } from "@/app/api/v1/classifications/bulk/route";
import { authenticateApiKey } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";

function mockAuth(organizationId = "org-1") {
  (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
    data: { organizationId, apiKeyId: "key-1" },
  });
}

function mockAuthError() {
  (authenticateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
    error: new Response(
      JSON.stringify({ error: { code: "unauthorized" } }),
      { status: 401 }
    ),
  });
}

describe("GET /api/v1/classifications", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns proposals filtered by org", async () => {
    mockAuth();
    const admin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              range: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 1,
                    document_id: "doc-1",
                    semantic_unit_id: null,
                    content: "test",
                    headings: [],
                    proposed_labels: { section: "PP" },
                    confidence: 0.9,
                    status: "pending",
                    reviewer_labels: null,
                    reviewed_at: null,
                    created_at: "2026-01-01",
                  },
                ],
                error: null,
              }),
            }),
          }),
        }),
      }),
    };
    (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin);

    const req = new Request("http://localhost/api/v1/classifications");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].proposedLabels.section).toBe("PP");
  });

  it("returns 401 without auth", async () => {
    mockAuthError();
    const req = new Request("http://localhost/api/v1/classifications");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/v1/classifications/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates proposal status", async () => {
    mockAuth();
    const admin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 1, organization_id: "org-1" },
                error: null,
              }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };
    (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin);

    const req = new Request("http://localhost/api/v1/classifications/1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });

    const res = await PUT(req, {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects invalid status", async () => {
    mockAuth();
    const admin = { from: vi.fn() };
    (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin);

    const req = new Request("http://localhost/api/v1/classifications/1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "invalid" }),
    });

    const res = await PUT(req, {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/classifications/stats", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns aggregate counts by status", async () => {
    mockAuth();
    const admin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [
              { status: "pending" },
              { status: "pending" },
              { status: "approved" },
            ],
            error: null,
          }),
        }),
      }),
    };
    (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin);

    const req = new Request("http://localhost/api/v1/classifications/stats");
    const res = await GET_STATS(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.pending).toBe(2);
    expect(body.data.approved).toBe(1);
  });
});

describe("PUT /api/v1/classifications/bulk", () => {
  beforeEach(() => vi.clearAllMocks());

  it("bulk updates proposal statuses", async () => {
    mockAuth();
    const admin = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      }),
    };
    (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin);

    const req = new Request("http://localhost/api/v1/classifications/bulk", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [1, 2, 3], status: "approved" }),
    });

    const res = await PUT_BULK(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.updated).toBe(3);
  });

  it("rejects empty ids array", async () => {
    mockAuth();
    const req = new Request("http://localhost/api/v1/classifications/bulk", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [], status: "approved" }),
    });

    const res = await PUT_BULK(req);
    expect(res.status).toBe(400);
  });

  it("rejects more than 100 ids", async () => {
    mockAuth();
    const ids = Array.from({ length: 101 }, (_, i) => i);
    const req = new Request("http://localhost/api/v1/classifications/bulk", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, status: "approved" }),
    });

    const res = await PUT_BULK(req);
    expect(res.status).toBe(400);
  });
});
