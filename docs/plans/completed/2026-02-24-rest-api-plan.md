# REST API Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a full CRUD REST API (`/api/v1/`) with API key auth so developers can build custom frontends against the RAG boilerplate.

**Architecture:** New `/api/v1/` route handlers in the existing Next.js app, sharing all `lib/rag/*` code. Auth via org-scoped API keys (SHA-256 hashed, stored in `api_keys` table). Admin client for all DB queries (no user session). SSE + AI SDK dual-format chat streaming.

**Tech Stack:** Next.js Route Handlers, Supabase (service role client), Vitest

**Design doc:** `docs/plans/2026-02-24-rest-api-design.md`

---

### Task 1: Database Migration — `api_keys` Table

**Files:**
- Create: Supabase migration (via MCP tool)

**Step 1: Apply the migration**

Use the `mcp__supabase-mcp-server__apply_migration` tool with project_id `xjzhiprdbzvmijvymkbn` and name `create_api_keys_table`:

```sql
-- API keys for external API access (org-scoped)
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast hash lookups during auth
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);

-- RLS: org members can manage their org's keys
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view their org API keys"
  ON api_keys FOR SELECT
  USING (organization_id IN (SELECT get_user_organizations()));

CREATE POLICY "Org members can insert API keys for their org"
  ON api_keys FOR INSERT
  WITH CHECK (organization_id IN (SELECT get_user_organizations()));

CREATE POLICY "Org members can delete their org API keys"
  ON api_keys FOR DELETE
  USING (organization_id IN (SELECT get_user_organizations()));
```

**Step 2: Regenerate types**

Run: `pnpm db:types`

Verify: `api_keys` appears in `types/database.types.ts`

**Step 3: Commit**

```bash
git add supabase/migrations/ types/database.types.ts
git commit -m "feat: add api_keys table migration"
```

---

### Task 2: API Auth Helper + Response Utilities

**Files:**
- Create: `lib/api/auth.ts`
- Create: `lib/api/response.ts`
- Create: `tests/unit/api-auth.test.ts`

**Step 1: Write the failing tests**

Create `tests/unit/api-auth.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock admin client
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockFrom,
    rpc: mockRpc,
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
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/api-auth.test.ts`

Expected: FAIL (modules don't exist yet)

**Step 3: Implement `lib/api/response.ts`**

```typescript
import { NextResponse } from "next/server";

export function apiSuccess(data: unknown, status = 200): Response {
  return NextResponse.json({ data }, { status });
}

export function apiError(
  code: string,
  message: string,
  status: number
): Response {
  return NextResponse.json({ error: { code, message } }, { status });
}
```

**Step 4: Implement `lib/api/auth.ts`**

```typescript
import { createAdminClient } from "@/lib/supabase/admin";

export type ApiAuthResult = {
  data?: { organizationId: string; apiKeyId: string };
  error?: Response;
};

/**
 * Authenticate an API request using a Bearer API key.
 * Hashes the key and looks it up in the api_keys table.
 * Returns { organizationId, apiKeyId } on success or an error Response.
 */
export async function authenticateApiKey(req: Request): Promise<ApiAuthResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      error: new Response(
        JSON.stringify({ error: { code: "unauthorized", message: "Missing or invalid Authorization header" } }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  const key = authHeader.slice(7); // Strip "Bearer "
  if (!key.startsWith("sk-") || key.length < 10) {
    return {
      error: new Response(
        JSON.stringify({ error: { code: "unauthorized", message: "Invalid API key format" } }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  // Hash the key
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(key));
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Look up in database
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("api_keys")
    .select("id, organization_id")
    .eq("key_hash", keyHash)
    .single();

  if (error || !data) {
    return {
      error: new Response(
        JSON.stringify({ error: { code: "unauthorized", message: "Invalid API key" } }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      ),
    };
  }

  // Update last_used_at (fire-and-forget)
  admin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => {})
    .catch(() => {});

  return {
    data: {
      organizationId: data.organization_id,
      apiKeyId: data.id,
    },
  };
}
```

**Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/api-auth.test.ts`

Expected: ALL PASS

**Step 6: Run all existing tests to verify no regressions**

Run: `pnpm vitest run`

Expected: All 72+ tests pass

**Step 7: Commit**

```bash
git add lib/api/auth.ts lib/api/response.ts tests/unit/api-auth.test.ts
git commit -m "feat: add API key auth helper and response utilities"
```

---

### Task 3: Documents API — List and Upload

**Files:**
- Create: `app/api/v1/documents/route.ts`
- Create: `tests/unit/api-documents.test.ts`

**Step 1: Write the failing tests**

Create `tests/unit/api-documents.test.ts`:

```typescript
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
      error: new Response(JSON.stringify({ error: { code: "unauthorized", message: "Invalid" } }), { status: 401 }),
    });

    const { GET } = await import("@/app/api/v1/documents/route");
    const req = new Request("http://localhost/api/v1/documents");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns list of documents on success", async () => {
    mockAuth.mockResolvedValue({ data: { organizationId: "org-1", apiKeyId: "key-1" } });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [
              { id: "doc-1", name: "lease.pdf", mime_type: "application/pdf", file_size: 1024, status: "ready", created_at: "2026-01-01T00:00:00Z" },
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
    mockAuth.mockResolvedValue({ data: { organizationId: "org-1", apiKeyId: "key-1" } });

    const { POST } = await import("@/app/api/v1/documents/route");
    const formData = new FormData();
    const req = new Request("http://localhost/api/v1/documents", {
      method: "POST",
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 422 for unsupported file type", async () => {
    mockAuth.mockResolvedValue({ data: { organizationId: "org-1", apiKeyId: "key-1" } });

    const { POST } = await import("@/app/api/v1/documents/route");
    const formData = new FormData();
    formData.append("file", new File(["data"], "image.png", { type: "image/png" }));
    const req = new Request("http://localhost/api/v1/documents", {
      method: "POST",
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/api-documents.test.ts`

Expected: FAIL

**Step 3: Implement the route handler**

Create `app/api/v1/documents/route.ts`:

```typescript
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";

const ALLOWED_TYPES = [
  "application/pdf",
  "text/markdown",
  "text/plain",
  "text/html",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export async function GET(req: Request) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("documents")
    .select("id, name, mime_type, file_size, status, created_at, updated_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) return apiError("internal_error", "Failed to list documents", 500);

  return apiSuccess(
    (data ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      mimeType: d.mime_type,
      fileSize: d.file_size,
      status: d.status,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }))
  );
}

export async function POST(req: Request) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return apiError("bad_request", "Expected multipart/form-data", 400);
  }

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    return apiError("bad_request", "No file provided", 400);
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return apiError(
      "unsupported_file_type",
      "File type not supported. Upload PDF, Markdown, plain text, HTML, or DOCX files.",
      422
    );
  }

  const admin = createAdminClient();
  const fileBuffer = await file.arrayBuffer();

  // Content hash for delta processing
  const hashBuffer = await crypto.subtle.digest("SHA-256", fileBuffer);
  const contentHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const documentId = crypto.randomUUID();
  const storagePath = `${organizationId}/${documentId}/${file.name}`;

  // Upload to storage
  const { error: uploadError } = await admin.storage
    .from("documents")
    .upload(storagePath, fileBuffer, { contentType: file.type });

  if (uploadError) {
    return apiError("internal_error", "Failed to upload file", 500);
  }

  // Create document record (no uploaded_by for API key auth — no user)
  const { error: insertError } = await admin.from("documents").insert({
    id: documentId,
    organization_id: organizationId,
    name: file.name,
    storage_path: storagePath,
    mime_type: file.type,
    file_size: file.size,
    content_hash: contentHash,
  });

  if (insertError) {
    await admin.storage.from("documents").remove([storagePath]);
    return apiError("internal_error", "Failed to create document record", 500);
  }

  // Enqueue ingestion
  await admin.rpc("enqueue_ingestion", { p_document_id: documentId }).catch(() => {});

  return apiSuccess(
    { id: documentId, name: file.name, status: "pending", createdAt: new Date().toISOString() },
    201
  );
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/api-documents.test.ts`

Expected: ALL PASS

**Step 5: Run all tests**

Run: `pnpm vitest run`

Expected: All pass

**Step 6: Commit**

```bash
git add app/api/v1/documents/route.ts tests/unit/api-documents.test.ts
git commit -m "feat: add documents list and upload API endpoints"
```

---

### Task 4: Documents API — Get Detail and Delete

**Files:**
- Create: `app/api/v1/documents/[id]/route.ts`
- Modify: `tests/unit/api-documents.test.ts` (add tests)

**Step 1: Add failing tests to `tests/unit/api-documents.test.ts`**

Append these tests to the existing file:

```typescript
describe("GET /api/v1/documents/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when document not found", async () => {
    mockAuth.mockResolvedValue({ data: { organizationId: "org-1", apiKeyId: "key-1" } });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: "Not found" } }),
          }),
        }),
      }),
    });

    const { GET } = await import("@/app/api/v1/documents/[id]/route");
    const req = new Request("http://localhost/api/v1/documents/nonexistent");
    const res = await GET(req, { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
  });

  it("returns document details on success", async () => {
    mockAuth.mockResolvedValue({ data: { organizationId: "org-1", apiKeyId: "key-1" } });
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
                status: "ready",
                chunk_count: 15,
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
    expect(body.data.id).toBe("doc-1");
  });
});

describe("DELETE /api/v1/documents/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when document not found", async () => {
    mockAuth.mockResolvedValue({ data: { organizationId: "org-1", apiKeyId: "key-1" } });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: "Not found" } }),
          }),
        }),
      }),
    });

    const { DELETE } = await import("@/app/api/v1/documents/[id]/route");
    const req = new Request("http://localhost/api/v1/documents/nonexistent", { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/api-documents.test.ts`

Expected: FAIL

**Step 3: Implement the route handler**

Create `app/api/v1/documents/[id]/route.ts`:

```typescript
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;
  const { id } = await params;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("documents")
    .select("id, name, mime_type, file_size, status, chunk_count, created_at, updated_at")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .single();

  if (error || !data) return apiError("not_found", "Document not found", 404);

  return apiSuccess({
    id: data.id,
    name: data.name,
    mimeType: data.mime_type,
    fileSize: data.file_size,
    status: data.status,
    chunkCount: data.chunk_count,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;
  const { id } = await params;
  const admin = createAdminClient();

  // Get document to check ownership and get storage path
  const { data: doc, error: fetchError } = await admin
    .from("documents")
    .select("storage_path, status")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .single();

  if (fetchError || !doc) return apiError("not_found", "Document not found", 404);

  if (doc.status === "processing") {
    return apiError("bad_request", "Cannot delete a document while it is being processed", 400);
  }

  // Delete storage file
  await admin.storage.from("documents").remove([doc.storage_path]);

  // Delete document record (chunks cascade via FK)
  const { error } = await admin.from("documents").delete().eq("id", id);

  if (error) return apiError("internal_error", "Failed to delete document", 500);

  return apiSuccess({ deleted: true });
}
```

**Step 4: Run tests**

Run: `pnpm vitest run tests/unit/api-documents.test.ts`

Expected: ALL PASS

**Step 5: Run all tests**

Run: `pnpm vitest run`

Expected: All pass

**Step 6: Commit**

```bash
git add app/api/v1/documents/[id]/route.ts tests/unit/api-documents.test.ts
git commit -m "feat: add document detail and delete API endpoints"
```

---

### Task 5: Conversations API — List, Get, Delete

**Files:**
- Create: `app/api/v1/conversations/route.ts`
- Create: `app/api/v1/conversations/[id]/route.ts`
- Create: `tests/unit/api-conversations.test.ts`

**Step 1: Write failing tests**

Create `tests/unit/api-conversations.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/api/auth", () => ({
  authenticateApiKey: vi.fn(),
}));

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
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when auth fails", async () => {
    mockAuth.mockResolvedValue({
      error: new Response(JSON.stringify({ error: { code: "unauthorized" } }), { status: 401 }),
    });

    const { GET } = await import("@/app/api/v1/conversations/route");
    const req = new Request("http://localhost/api/v1/conversations");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns conversations list", async () => {
    mockAuth.mockResolvedValue({ data: { organizationId: "org-1", apiKeyId: "key-1" } });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [
              { id: "conv-1", title: "Chat about lease", updated_at: "2026-01-01T00:00:00Z" },
            ],
            error: null,
          }),
        }),
      }),
    });

    const { GET } = await import("@/app/api/v1/conversations/route");
    const req = new Request("http://localhost/api/v1/conversations");
    const res = await GET(req);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].title).toBe("Chat about lease");
  });
});

describe("GET /api/v1/conversations/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when conversation not found", async () => {
    mockAuth.mockResolvedValue({ data: { organizationId: "org-1", apiKeyId: "key-1" } });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: "Not found" } }),
          }),
        }),
      }),
    });

    const { GET } = await import("@/app/api/v1/conversations/[id]/route");
    const req = new Request("http://localhost/api/v1/conversations/missing");
    const res = await GET(req, { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/conversations/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when conversation not found", async () => {
    mockAuth.mockResolvedValue({ data: { organizationId: "org-1", apiKeyId: "key-1" } });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: "Not found" } }),
          }),
        }),
      }),
    });

    const { DELETE } = await import("@/app/api/v1/conversations/[id]/route");
    const req = new Request("http://localhost/api/v1/conversations/missing", { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/api-conversations.test.ts`

Expected: FAIL

**Step 3: Implement `app/api/v1/conversations/route.ts`**

```typescript
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("conversations")
    .select("id, title, updated_at")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false });

  if (error) return apiError("internal_error", "Failed to list conversations", 500);

  return apiSuccess(
    (data ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updated_at,
    }))
  );
}
```

**Step 4: Implement `app/api/v1/conversations/[id]/route.ts`**

```typescript
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;
  const { id } = await params;
  const admin = createAdminClient();

  // Get conversation
  const { data: conv, error: convError } = await admin
    .from("conversations")
    .select("id, title, created_at, updated_at")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .single();

  if (convError || !conv) return apiError("not_found", "Conversation not found", 404);

  // Get messages
  const { data: messages, error: msgError } = await admin
    .from("messages")
    .select("id, role, content, sources, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (msgError) return apiError("internal_error", "Failed to load messages", 500);

  return apiSuccess({
    id: conv.id,
    title: conv.title,
    createdAt: conv.created_at,
    updatedAt: conv.updated_at,
    messages: (messages ?? []).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      sources: m.sources,
      createdAt: m.created_at,
    })),
  });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;
  const { id } = await params;
  const admin = createAdminClient();

  // Verify conversation belongs to org
  const { data: conv, error: fetchError } = await admin
    .from("conversations")
    .select("id")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .single();

  if (fetchError || !conv) return apiError("not_found", "Conversation not found", 404);

  const { error } = await admin.from("conversations").delete().eq("id", id);

  if (error) return apiError("internal_error", "Failed to delete conversation", 500);

  return apiSuccess({ deleted: true });
}
```

**Step 5: Run tests**

Run: `pnpm vitest run tests/unit/api-conversations.test.ts`

Expected: ALL PASS

**Step 6: Run all tests**

Run: `pnpm vitest run`

Expected: All pass

**Step 7: Commit**

```bash
git add app/api/v1/conversations/ tests/unit/api-conversations.test.ts
git commit -m "feat: add conversations list, detail, and delete API endpoints"
```

---

### Task 6: Feedback API

**Files:**
- Create: `app/api/v1/conversations/[id]/feedback/route.ts`
- Modify: `tests/unit/api-conversations.test.ts` (add tests)

**Step 1: Add failing tests**

Append to `tests/unit/api-conversations.test.ts`:

```typescript
describe("POST /api/v1/conversations/:id/feedback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when messageId or rating missing", async () => {
    mockAuth.mockResolvedValue({ data: { organizationId: "org-1", apiKeyId: "key-1" } });

    const { POST } = await import("@/app/api/v1/conversations/[id]/feedback/route");
    const req = new Request("http://localhost/api/v1/conversations/conv-1/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "conv-1" }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when rating is not 1 or 5", async () => {
    mockAuth.mockResolvedValue({ data: { organizationId: "org-1", apiKeyId: "key-1" } });

    const { POST } = await import("@/app/api/v1/conversations/[id]/feedback/route");
    const req = new Request("http://localhost/api/v1/conversations/conv-1/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: 1, rating: 3 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "conv-1" }) });
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/api-conversations.test.ts`

Expected: FAIL

**Step 3: Implement the route handler**

Create `app/api/v1/conversations/[id]/feedback/route.ts`:

```typescript
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteParams) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;
  const { id: conversationId } = await params;

  let body: { messageId?: number; rating?: number; comment?: string };
  try {
    body = await req.json();
  } catch {
    return apiError("bad_request", "Invalid JSON body", 400);
  }

  const { messageId, rating, comment } = body;

  if (!messageId || !rating) {
    return apiError("bad_request", "messageId and rating are required", 400);
  }

  if (rating !== 1 && rating !== 5) {
    return apiError("bad_request", "rating must be 1 (thumbs down) or 5 (thumbs up)", 400);
  }

  const admin = createAdminClient();

  // Verify conversation belongs to org
  const { data: conv } = await admin
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("organization_id", organizationId)
    .single();

  if (!conv) return apiError("not_found", "Conversation not found", 404);

  // Upsert feedback (no user_id for API key auth — use a placeholder)
  const { error } = await admin.from("message_feedback").upsert(
    {
      message_id: messageId,
      organization_id: organizationId,
      user_id: "00000000-0000-0000-0000-000000000000", // API key placeholder
      rating,
      comment: comment ?? null,
    },
    { onConflict: "message_id,user_id" }
  );

  if (error) return apiError("internal_error", "Failed to submit feedback", 500);

  return apiSuccess({ submitted: true });
}
```

**Step 4: Run tests**

Run: `pnpm vitest run tests/unit/api-conversations.test.ts`

Expected: ALL PASS

**Step 5: Run all tests**

Run: `pnpm vitest run`

Expected: All pass

**Step 6: Commit**

```bash
git add app/api/v1/conversations/[id]/feedback/route.ts tests/unit/api-conversations.test.ts
git commit -m "feat: add message feedback API endpoint"
```

---

### Task 7: Chat API — Streaming (SSE + AI SDK)

This is the most complex task. The chat endpoint supports three response modes:
1. Standard SSE streaming (default)
2. AI SDK UIMessage streaming (`Accept: text/x-vercel-ai-data-stream`)
3. Non-streaming JSON (`stream: false` in request body)

**Files:**
- Create: `app/api/v1/chat/route.ts`
- Create: `tests/unit/api-chat.test.ts`

**Step 1: Write failing tests**

Create `tests/unit/api-chat.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/api/auth", () => ({
  authenticateApiKey: vi.fn(),
}));

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockFrom,
    rpc: vi.fn(),
  })),
}));

vi.mock("@/lib/rag/search", () => ({
  hybridSearch: vi.fn(),
}));

vi.mock("@/lib/rag/cost-tracker", () => ({
  trackUsage: vi.fn().mockResolvedValue(undefined),
}));

const mockStreamText = vi.fn();
vi.mock("ai", () => ({
  streamText: mockStreamText,
  generateText: vi.fn(),
  convertToModelMessages: vi.fn((msgs: any) => Promise.resolve(msgs)),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => vi.fn(() => "mock-model")),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn(() => "mock-model")),
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
      Authorization: "Bearer sk-test",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/chat", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, LLM_PROVIDER: "openai" };

    // Default mock: no org system prompt
    mockFrom.mockImplementation((table: string) => {
      if (table === "organizations") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { system_prompt: null }, error: null }),
            }),
          }),
        };
      }
      if (table === "conversations") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: "conv-1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "messages") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 1 }, error: null }),
            }),
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 401 when auth fails", async () => {
    mockAuth.mockResolvedValue({
      error: new Response(JSON.stringify({ error: { code: "unauthorized" } }), { status: 401 }),
    });

    const { POST } = await import("@/app/api/v1/chat/route");
    const req = createChatRequest({ messages: [{ role: "user", content: "hello" }] });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when messages array is missing", async () => {
    mockAuth.mockResolvedValue({ data: { organizationId: "org-1", apiKeyId: "key-1" } });

    const { POST } = await import("@/app/api/v1/chat/route");
    const req = createChatRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when messages array is empty", async () => {
    mockAuth.mockResolvedValue({ data: { organizationId: "org-1", apiKeyId: "key-1" } });

    const { POST } = await import("@/app/api/v1/chat/route");
    const req = createChatRequest({ messages: [] });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns refusal when no relevant results found", async () => {
    mockAuth.mockResolvedValue({ data: { organizationId: "org-1", apiKeyId: "key-1" } });
    mockHybridSearch.mockResolvedValue({ results: [], queryTokenCount: 5 });

    const { POST } = await import("@/app/api/v1/chat/route");
    const req = createChatRequest(
      { messages: [{ role: "user", content: "random question" }], stream: false }
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.message).toContain("don't have enough information");
  });

  it("calls streamText with system prompt when results are relevant", async () => {
    mockAuth.mockResolvedValue({ data: { organizationId: "org-1", apiKeyId: "key-1" } });
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
      toUIMessageStreamResponse: () => new Response("stream", { headers: { "Content-Type": "text/event-stream" } }),
      textStream: (async function* () { yield "The lease is 12 months."; })(),
      text: Promise.resolve("The lease is 12 months."),
      usage: Promise.resolve({ inputTokens: 100, outputTokens: 20 }),
    });

    const { POST } = await import("@/app/api/v1/chat/route");
    const req = createChatRequest(
      { messages: [{ role: "user", content: "What is the lease term?" }] },
      { Accept: "text/event-stream" }
    );
    const res = await POST(req);

    // Should return SSE stream
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/api-chat.test.ts`

Expected: FAIL

**Step 3: Implement the route handler**

Create `app/api/v1/chat/route.ts`:

```typescript
import { streamText, convertToModelMessages } from "ai";
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { hybridSearch } from "@/lib/rag/search";
import { buildSystemPrompt } from "@/lib/rag/prompt";
import { getLLMProvider, getModelId } from "@/lib/rag/provider";
import { trackUsage } from "@/lib/rag/cost-tracker";

const REFUSAL_MESSAGE =
  "I don't have enough information in the available documents to answer that question.";

function getSimilarityThreshold(): number {
  return parseFloat(process.env.SIMILARITY_THRESHOLD ?? "0.3");
}

export async function POST(req: Request) {
  // 1. Auth
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;

  // 2. Parse body
  let body: { messages?: any[]; conversationId?: string; stream?: boolean };
  try {
    body = await req.json();
  } catch {
    return apiError("bad_request", "Invalid JSON body", 400);
  }

  const { messages, conversationId: existingConversationId, stream: shouldStream = true } = body;

  if (!messages?.length) {
    return apiError("bad_request", "messages array is required and must not be empty", 400);
  }

  const admin = createAdminClient();

  // 3. Fetch org system prompt
  const { data: org } = await admin
    .from("organizations")
    .select("system_prompt")
    .eq("id", organizationId)
    .single();

  const orgSystemPrompt = org?.system_prompt ?? null;

  // 4. Get or create conversation
  let conversationId = existingConversationId;

  if (!conversationId) {
    const firstUserMessage = messages.find((m: { role: string }) => m.role === "user");
    const title = (firstUserMessage?.content ?? "New conversation").substring(0, 50);

    const { data: conversation, error: convError } = await admin
      .from("conversations")
      .insert({ organization_id: organizationId, title })
      .select("id")
      .single();

    if (convError || !conversation) {
      return apiError("internal_error", "Failed to create conversation", 500);
    }

    conversationId = conversation.id;
  }

  // 5. Get last message ID for parent chain
  const { data: lastMsg } = await admin
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .order("id", { ascending: false })
    .limit(1)
    .single();

  const lastMessageId = lastMsg?.id ?? null;

  // 6. Save user message
  const latestMessage = messages[messages.length - 1];
  const { data: userMsg } = await admin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      parent_message_id: lastMessageId,
      role: "user",
      content: latestMessage.content,
    })
    .select("id")
    .single();

  const userMessageId = userMsg?.id ?? null;

  // 7. Search
  const searchResponse = await hybridSearch(admin, {
    query: latestMessage.content,
    organizationId,
  });

  // 8. Threshold gate
  const similarityThreshold = getSimilarityThreshold();
  const relevantResults = searchResponse.results.filter(
    (r) => r.similarity >= similarityThreshold
  );

  if (relevantResults.length === 0) {
    // Save refusal
    await admin.from("messages").insert({
      conversation_id: conversationId,
      parent_message_id: userMessageId,
      role: "assistant",
      content: REFUSAL_MESSAGE,
    });

    if (!shouldStream) {
      return apiSuccess({ conversationId, message: REFUSAL_MESSAGE, sources: [] });
    }

    // SSE refusal
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event: text-delta\ndata: ${JSON.stringify({ content: REFUSAL_MESSAGE })}\n\n`));
        controller.enqueue(encoder.encode(`event: sources\ndata: []\n\n`));
        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ conversationId })}\n\n`));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  }

  // 9. Build system prompt
  const systemPrompt = buildSystemPrompt(relevantResults, orgSystemPrompt);

  // 10. Format sources
  const sources = relevantResults.map((r) => ({
    documentId: r.documentId,
    documentName: r.documentName,
    chunkId: r.chunkId,
    chunkIndex: r.chunkIndex,
    content: r.content,
    similarity: r.similarity,
  }));

  // 11. Determine response format
  const acceptHeader = req.headers.get("accept") ?? "";
  const useAiSdkFormat = acceptHeader.includes("text/x-vercel-ai-data-stream");

  const provider = getLLMProvider();
  const modelId = getModelId();

  let modelMessages;
  try {
    modelMessages = await convertToModelMessages(messages);
  } catch {
    return apiError("bad_request", "Invalid message format", 400);
  }

  // 12a. Non-streaming response
  if (!shouldStream) {
    const { generateText } = await import("ai");
    const result = await generateText({
      model: provider(modelId),
      system: systemPrompt,
      messages: modelMessages,
    });

    // Save assistant message
    await admin.from("messages").insert({
      conversation_id: conversationId,
      parent_message_id: userMessageId,
      role: "assistant",
      content: result.text,
      sources,
    });

    // Track usage (fire-and-forget)
    trackUsage(admin, {
      organizationId,
      userId: "api",
      queryText: latestMessage.content,
      embeddingTokens: searchResponse.queryTokenCount,
      llmInputTokens: result.usage?.inputTokens ?? 0,
      llmOutputTokens: result.usage?.outputTokens ?? 0,
      model: modelId,
      chunksRetrieved: relevantResults.length,
    }).catch(() => {});

    return apiSuccess({ conversationId, message: result.text, sources });
  }

  // 12b. AI SDK format
  if (useAiSdkFormat) {
    const result = streamText({
      model: provider(modelId),
      system: systemPrompt,
      messages: modelMessages,
      onFinish: async ({ text, usage }) => {
        await admin.from("messages").insert({
          conversation_id: conversationId,
          parent_message_id: userMessageId,
          role: "assistant",
          content: text,
          sources,
        }).catch(() => {});

        trackUsage(admin, {
          organizationId,
          userId: "api",
          queryText: latestMessage.content,
          embeddingTokens: searchResponse.queryTokenCount,
          llmInputTokens: usage?.inputTokens ?? 0,
          llmOutputTokens: usage?.outputTokens ?? 0,
          model: modelId,
          chunksRetrieved: relevantResults.length,
        }).catch(() => {});
      },
    });

    return result.toUIMessageStreamResponse({
      headers: {
        "x-conversation-id": conversationId,
        "x-sources": JSON.stringify(sources.map(({ content, ...rest }) => rest)),
      },
    });
  }

  // 12c. Standard SSE format (default)
  const result = streamText({
    model: provider(modelId),
    system: systemPrompt,
    messages: modelMessages,
    onFinish: async ({ text, usage }) => {
      await admin.from("messages").insert({
        conversation_id: conversationId,
        parent_message_id: userMessageId,
        role: "assistant",
        content: text,
        sources,
      }).catch(() => {});

      trackUsage(admin, {
        organizationId,
        userId: "api",
        queryText: latestMessage.content,
        embeddingTokens: searchResponse.queryTokenCount,
        llmInputTokens: usage?.inputTokens ?? 0,
        llmOutputTokens: usage?.outputTokens ?? 0,
        model: modelId,
        chunksRetrieved: relevantResults.length,
      }).catch(() => {});
    },
  });

  const encoder = new TextEncoder();
  const textStream = result.textStream;

  const sseStream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of textStream) {
          controller.enqueue(
            encoder.encode(`event: text-delta\ndata: ${JSON.stringify({ content: chunk })}\n\n`)
          );
        }
        // Send sources after text is complete
        controller.enqueue(
          encoder.encode(`event: sources\ndata: ${JSON.stringify(sources)}\n\n`)
        );
        controller.enqueue(
          encoder.encode(`event: done\ndata: ${JSON.stringify({ conversationId })}\n\n`)
        );
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(sseStream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}
```

**Step 4: Run tests**

Run: `pnpm vitest run tests/unit/api-chat.test.ts`

Expected: ALL PASS

**Step 5: Run all tests**

Run: `pnpm vitest run`

Expected: All pass

**Step 6: Commit**

```bash
git add app/api/v1/chat/route.ts tests/unit/api-chat.test.ts
git commit -m "feat: add chat API endpoint with SSE and AI SDK streaming"
```

---

### Task 8: Dashboard API Key Management

**Files:**
- Modify: `app/(dashboard)/settings/actions.ts` (add createApiKey, listApiKeys, revokeApiKey)
- Create: `components/settings/api-keys-section.tsx`
- Modify: `app/(dashboard)/settings/page.tsx` (add ApiKeysSection)

**Step 1: Add Server Actions to `app/(dashboard)/settings/actions.ts`**

Append these to the existing file:

```typescript
// --- API Key Management ---

export type ApiKeyData = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
};

export async function getApiKeys(): Promise<ApiKeyData[]> {
  const { supabase } = await getCurrentOrg();

  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, last_used_at, created_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error("Failed to load API keys");

  return (data ?? []).map((k) => ({
    id: k.id,
    name: k.name,
    keyPrefix: k.key_prefix,
    lastUsedAt: k.last_used_at,
    createdAt: k.created_at,
  }));
}

export async function createApiKey(name: string): Promise<{ key: string } | { error: string }> {
  const { supabase, organizationId } = await getCurrentOrg();

  if (!name?.trim()) return { error: "Name is required" };

  // Generate key: sk-<32 random hex chars>
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  const hex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const key = `sk-${hex}`;
  const keyPrefix = key.substring(0, 10); // "sk-" + first 7 hex chars

  // Hash the key
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(key));
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { error } = await supabase.from("api_keys").insert({
    organization_id: organizationId,
    name: name.trim(),
    key_hash: keyHash,
    key_prefix: keyPrefix,
  });

  if (error) return { error: "Failed to create API key" };

  revalidatePath("/settings");
  return { key };
}

export async function revokeApiKey(keyId: string) {
  const { supabase } = await getCurrentOrg();

  const { error } = await supabase.from("api_keys").delete().eq("id", keyId);

  if (error) return { error: "Failed to revoke API key" };

  revalidatePath("/settings");
  return { success: true };
}
```

**Step 2: Create `components/settings/api-keys-section.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createApiKey, revokeApiKey, type ApiKeyData } from "@/app/(dashboard)/settings/actions";
import { Copy, Trash2, Plus, Key } from "lucide-react";

export function ApiKeysSection({ keys: initialKeys }: { keys: ApiKeyData[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    if (!newKeyName.trim()) return;
    setCreating(true);
    const result = await createApiKey(newKeyName);
    setCreating(false);

    if ("key" in result) {
      setCreatedKey(result.key);
      setNewKeyName("");
      // Refresh the list by adding a placeholder — will be replaced on next server render
      setKeys((prev) => [
        {
          id: crypto.randomUUID(),
          name: newKeyName,
          keyPrefix: result.key.substring(0, 10),
          lastUsedAt: null,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
    }
  }

  async function handleRevoke(keyId: string) {
    await revokeApiKey(keyId);
    setKeys((prev) => prev.filter((k) => k.id !== keyId));
  }

  function handleCopy() {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Key className="h-5 w-5" /> API Keys
        </h2>
        <p className="text-sm text-muted-foreground">
          Create API keys for external applications to access the REST API.
        </p>
      </div>

      {/* Create new key */}
      <div className="flex gap-2">
        <Input
          placeholder="Key name (e.g., Production, Mobile App)"
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />
        <Button onClick={handleCreate} disabled={creating || !newKeyName.trim()}>
          <Plus className="h-4 w-4 mr-1" /> Create
        </Button>
      </div>

      {/* Show created key (once only) */}
      {createdKey && (
        <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-4 space-y-2">
          <p className="text-sm font-medium">
            Copy your API key now. It won't be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono">
              {createdKey}
            </code>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="h-4 w-4 mr-1" /> {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCreatedKey(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Keys table */}
      {keys.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Last Used</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((k) => (
              <TableRow key={k.id}>
                <TableCell className="font-medium">{k.name}</TableCell>
                <TableCell>
                  <code className="text-sm text-muted-foreground">{k.keyPrefix}...</code>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {k.lastUsedAt
                    ? new Date(k.lastUsedAt).toLocaleDateString()
                    : "Never"}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {new Date(k.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRevoke(k.id)}
                    title="Revoke key"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground py-4">
          No API keys yet. Create one to start using the REST API.
        </p>
      )}
    </div>
  );
}
```

**Step 3: Update `app/(dashboard)/settings/page.tsx`**

Replace the entire file with:

```tsx
import { getModelRates, getSystemPrompt, getApiKeys } from "./actions";
import { ModelRatesTable } from "@/components/settings/model-rates-table";
import { SystemPromptEditor } from "@/components/settings/system-prompt-editor";
import { ApiKeysSection } from "@/components/settings/api-keys-section";

export default async function SettingsPage() {
  const [rates, systemPrompt, apiKeys] = await Promise.all([
    getModelRates(),
    getSystemPrompt(),
    getApiKeys(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage model rates and configuration.
        </p>
      </div>
      <ApiKeysSection keys={apiKeys} />
      <SystemPromptEditor initialPrompt={systemPrompt} />
      <ModelRatesTable rates={rates} />
    </div>
  );
}
```

**Step 4: Run all tests**

Run: `pnpm vitest run`

Expected: All pass

**Step 5: Build check**

Run: `pnpm build`

Expected: Clean build (no TS errors)

**Step 6: Commit**

```bash
git add app/(dashboard)/settings/actions.ts app/(dashboard)/settings/page.tsx components/settings/api-keys-section.tsx
git commit -m "feat: add API key management UI in settings"
```

---

### Task 9: Build Verification & Cleanup

**Files:**
- No new files

**Step 1: Run all TypeScript tests**

Run: `pnpm vitest run`

Expected: All tests pass (72 existing + new API tests)

**Step 2: Run build**

Run: `pnpm build`

Expected: Clean build, no errors

**Step 3: Run type check**

Run: `pnpm tsc --noEmit`

Expected: No type errors

**Step 4: Verify route structure**

Check that all API routes are accessible by reviewing the build output. You should see:

```
/api/v1/chat
/api/v1/documents
/api/v1/documents/[id]
/api/v1/conversations
/api/v1/conversations/[id]
/api/v1/conversations/[id]/feedback
```

**Step 5: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: build verification cleanup"
```

(Skip this commit if no changes were needed.)

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | `api_keys` migration | Supabase migration |
| 2 | Auth helper + response utils | `lib/api/auth.ts`, `lib/api/response.ts`, tests |
| 3 | Documents list + upload | `app/api/v1/documents/route.ts`, tests |
| 4 | Document detail + delete | `app/api/v1/documents/[id]/route.ts`, tests |
| 5 | Conversations CRUD | `app/api/v1/conversations/` routes, tests |
| 6 | Feedback endpoint | `app/api/v1/conversations/[id]/feedback/route.ts`, tests |
| 7 | Chat with SSE + AI SDK | `app/api/v1/chat/route.ts`, tests |
| 8 | Dashboard key management | Settings actions + `ApiKeysSection` component |
| 9 | Build verification | Verify all tests, build, types |
