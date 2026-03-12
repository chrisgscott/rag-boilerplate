import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/api/auth", () => ({
  authenticateApiKey: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { POST, GET } from "@/app/api/v1/optimize/route";
import { GET as GET_BY_ID } from "@/app/api/v1/optimize/[id]/route";
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

describe("POST /api/v1/optimize", () => {
  beforeEach(() => vi.clearAllMocks());

  afterEach(() => {
    delete process.env.AUTO_OPTIMIZE_ENABLED;
  });

  it("returns 401 without auth", async () => {
    mockAuthError();
    const req = new Request("http://localhost/api/v1/optimize", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 when AUTO_OPTIMIZE_ENABLED is not true", async () => {
    mockAuth();
    process.env.AUTO_OPTIMIZE_ENABLED = "false";
    const req = new Request("http://localhost/api/v1/optimize", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  it("returns 409 when an optimization session is already running", async () => {
    mockAuth();
    process.env.AUTO_OPTIMIZE_ENABLED = "true";

    const admin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: "run-123" },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    };
    (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin);

    const req = new Request("http://localhost/api/v1/optimize", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("conflict");
  });

  it("returns 201 with sessionId on success", async () => {
    mockAuth();
    process.env.AUTO_OPTIMIZE_ENABLED = "true";

    // First call: check for active run (returns null)
    // Second call: insert new run (returns the new run)
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const singleMock = vi.fn().mockResolvedValue({
      data: { id: "new-run-456" },
      error: null,
    });

    const selectChain = {
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: maybeSingleMock,
          }),
        }),
      }),
    };

    const insertChain = {
      select: vi.fn().mockReturnValue({
        single: singleMock,
      }),
    };

    const fromMock = vi.fn((table: string) => {
      if (table === "optimization_runs") {
        return {
          select: vi.fn().mockReturnValue(selectChain.eq),
          insert: vi.fn().mockReturnValue(insertChain),
        };
      }
      return {};
    });

    // Use a simpler approach: mock from() to return different things per call
    let callCount = 0;
    const admin = {
      from: vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          // First call: select to check active run
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: null,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        } else {
          // Second call: insert new run
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: "new-run-456" },
                  error: null,
                }),
              }),
            }),
          };
        }
      }),
    };

    void fromMock; // suppress unused variable warning

    (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin);

    const req = new Request("http://localhost/api/v1/optimize", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.sessionId).toBe("new-run-456");
    expect(body.data.status).toBe("running");
  });
});

describe("GET /api/v1/optimize", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns latest session and best config", async () => {
    mockAuth();

    const latestSession = {
      id: "run-1",
      organization_id: "org-1",
      status: "completed",
      started_at: "2026-03-12T00:00:00Z",
    };
    const bestConfig = {
      id: "config-1",
      organization_id: "org-1",
      vector_weight: 0.7,
      bm25_weight: 0.3,
    };

    let callCount = 0;
    const admin = {
      from: vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          // First call: get latest session from optimization_runs
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: latestSession,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        } else {
          // Second call: get best config from optimization_configs
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: bestConfig,
                  error: null,
                }),
              }),
            }),
          };
        }
      }),
    };
    (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin);

    const req = new Request("http://localhost/api/v1/optimize");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.latestSession.id).toBe("run-1");
    expect(body.data.bestConfig.id).toBe("config-1");
  });

  it("returns null for latestSession and bestConfig when none exist", async () => {
    mockAuth();

    let callCount = 0;
    const admin = {
      from: vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: null,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        } else {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              }),
            }),
          };
        }
      }),
    };
    (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin);

    const req = new Request("http://localhost/api/v1/optimize");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.latestSession).toBeNull();
    expect(body.data.bestConfig).toBeNull();
  });
});

describe("GET /api/v1/optimize/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns session and experiments for valid org", async () => {
    mockAuth();

    const session = {
      id: "run-1",
      organization_id: "org-1",
      status: "completed",
    };
    const experiments = [
      { id: "exp-1", run_id: "run-1", experiment_index: 0 },
      { id: "exp-2", run_id: "run-1", experiment_index: 1 },
    ];

    let callCount = 0;
    const admin = {
      from: vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          // First call: get the session from optimization_runs
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: session,
                    error: null,
                  }),
                }),
              }),
            }),
          };
        } else {
          // Second call: get experiments from optimization_experiments
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: experiments,
                  error: null,
                }),
              }),
            }),
          };
        }
      }),
    };
    (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin);

    const req = new Request("http://localhost/api/v1/optimize/run-1");
    const res = await GET_BY_ID(req, {
      params: Promise.resolve({ id: "run-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.session.id).toBe("run-1");
    expect(body.data.experiments).toHaveLength(2);
  });

  it("returns 404 for session belonging to a different org", async () => {
    mockAuth("org-1");

    const admin = {
      from: vi.fn().mockReturnValue({
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
      }),
    };
    (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(admin);

    const req = new Request("http://localhost/api/v1/optimize/run-other-org");
    const res = await GET_BY_ID(req, {
      params: Promise.resolve({ id: "run-other-org" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });
});
