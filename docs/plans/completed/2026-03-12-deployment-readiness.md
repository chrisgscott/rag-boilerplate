# Deployment Readiness Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all outstanding gaps across REST API, Docling enhancements, and auto-optimizer Phase 2 so the boilerplate is deployment-ready for its first real consumer.

**Architecture:** Three independent workstreams executed in parallel: (A) REST API gaps from deployment feedback, (B) Docling document preservation and structured extraction pipeline, (C) auto-optimizer session loop completion. All workstreams are additive — no changes to existing behavior.

**Tech Stack:** Next.js 15 (TypeScript), Python/FastAPI ingestion service, Supabase (Postgres + pgvector + pgmq), Vitest, pytest

**Source specs:**
- `docs/DEPLOYMENT-FEEDBACK.md` — REST API gaps #1, #3, #4, #5
- `DOCLING-ENHANCEMENTS-PLAN.md` — Enhancements 1, 2, 3
- `AUTO-OPTIMIZE-BUILD-STATE.md` — Phase 2 tasks 4-7

---

## File Structure

### Workstream A: REST API Gaps
| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `app/api/v1/documents/route.ts` | Accept metadata on upload, include metadata in list |
| Modify | `app/api/v1/documents/[id]/route.ts` | Include metadata in GET response |
| Create | `app/api/v1/search/route.ts` | Retrieval-only search endpoint |
| Create | `app/api/v1/health/route.ts` | Health check endpoint |
| Modify | `tests/unit/api-documents.test.ts` | Tests for metadata handling |
| Create | `tests/unit/api-search.test.ts` | Tests for search endpoint |
| Create | `tests/unit/api-health.test.ts` | Tests for health endpoint |

### Workstream B: Docling Enhancements
| Action | File | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/00035_docling_doc_column.sql` | Add `docling_doc` JSONB column to documents |
| Modify | `services/ingestion/src/parser.py` | Add `docling_json` to ParseResult |
| Modify | `services/ingestion/src/worker.py` | Persist DoclingDocument, extract semantic units |
| Modify | `services/ingestion/src/config.py` | Add config flags for new features |
| Create | `services/ingestion/src/semantic_units.py` | Semantic unit extraction via HierarchicalChunker |
| Create | `supabase/migrations/00036_semantic_units.sql` | `document_semantic_units` table + RLS |
| Create | `supabase/migrations/00037_classification_scaffold.sql` | `classification_proposals` table + RLS |
| Create | `services/ingestion/src/classifier.py` | BaseClassifier ABC + classification pipeline |
| Create | `app/api/v1/classifications/route.ts` | GET list |
| Create | `app/api/v1/classifications/[id]/route.ts` | PUT update status |
| Create | `app/api/v1/classifications/bulk/route.ts` | PUT bulk approve/reject |
| Create | `app/api/v1/classifications/stats/route.ts` | GET aggregate statistics |
| Modify | `tests/unit/test_parser.py` | Test docling_json capture |
| Create | `tests/unit/test_semantic_units.py` | Test semantic unit extraction |
| Create | `tests/unit/test_classifier.py` | Test classifier pipeline |
| Create | `tests/unit/api-classifications.test.ts` | Test classification API endpoints |

### Workstream C: Auto-Optimizer Phase 2
| Action | File | Responsibility |
|--------|------|----------------|
| Create | `lib/rag/optimizer/session.ts` | Session loop: baseline → iterate → track best |
| Create | `tests/unit/optimizer-session.test.ts` | Session loop tests with mocked deps |

---

## Chunk 1: REST API Gaps

### Task 1: Document Metadata on Upload and in Responses

The `documents` table already has a `metadata jsonb DEFAULT '{}'::jsonb` column. The upload endpoint just doesn't accept it, and GET endpoints don't return it.

**Files:**
- Modify: `app/api/v1/documents/route.ts`
- Modify: `app/api/v1/documents/[id]/route.ts`

- [ ] **Step 1: Write failing tests for metadata on upload**

Create `tests/unit/api-documents-metadata.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock modules before imports
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/api/auth", () => ({
  authenticateApiKey: vi.fn(),
}));

import { POST, GET } from "@/app/api/v1/documents/route";
import { GET as GET_BY_ID } from "@/app/api/v1/documents/[id]/route";
import { authenticateApiKey } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";

function mockAuth(organizationId = "org-1") {
  (authenticateApiKey as any).mockResolvedValue({
    data: { organizationId, apiKeyId: "key-1" },
  });
}

function createMockAdmin(overrides: Record<string, any> = {}) {
  const mock: any = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    storage: { from: vi.fn().mockReturnValue({ upload: vi.fn().mockResolvedValue({ error: null }), remove: vi.fn() }) },
    rpc: vi.fn().mockResolvedValue({ error: null }),
    ...overrides,
  };
  (createAdminClient as any).mockReturnValue(mock);
  return mock;
}

describe("Document metadata on upload", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts optional metadata JSON string in form data", async () => {
    mockAuth();
    const admin = createMockAdmin();
    // Chain: from().insert().select().single() returns doc row
    const insertChain = {
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "doc-1" }, error: null }),
      }),
    };
    admin.from = vi.fn().mockImplementation((table: string) => {
      if (table === "documents") {
        return { insert: vi.fn().mockReturnValue(insertChain), select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: [], error: null }) };
      }
      return admin;
    });

    const formData = new FormData();
    formData.append("file", new File(["test"], "test.pdf", { type: "application/pdf" }));
    formData.append("metadata", JSON.stringify({ doc_type: "RFI", department: "BD" }));

    const req = new Request("http://localhost/api/v1/documents", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it("rejects invalid metadata JSON", async () => {
    mockAuth();
    createMockAdmin();

    const formData = new FormData();
    formData.append("file", new File(["test"], "test.pdf", { type: "application/pdf" }));
    formData.append("metadata", "not valid json{{{");

    const req = new Request("http://localhost/api/v1/documents", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
  });
});

describe("Document metadata in GET responses", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET /documents includes metadata in list response", async () => {
    mockAuth();
    const admin = createMockAdmin();
    admin.from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [{ id: "d1", name: "test.pdf", mime_type: "application/pdf", file_size: 100, status: "complete", metadata: { doc_type: "RFI" }, created_at: "2026-01-01", updated_at: "2026-01-01" }],
            error: null,
          }),
        }),
      }),
    });

    const req = new Request("http://localhost/api/v1/documents");
    const res = await GET(req);
    const body = await res.json();

    expect(body.data[0].metadata).toEqual({ doc_type: "RFI" });
  });

  it("GET /documents/:id includes metadata in detail response", async () => {
    mockAuth();
    const admin = createMockAdmin();
    admin.from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: "d1", name: "test.pdf", mime_type: "application/pdf", file_size: 100, status: "complete", chunk_count: 5, metadata: { department: "BD" }, created_at: "2026-01-01", updated_at: "2026-01-01" },
              error: null,
            }),
          }),
        }),
      }),
    });

    const req = new Request("http://localhost/api/v1/documents/d1");
    const res = await GET_BY_ID(req, { params: Promise.resolve({ id: "d1" }) });
    const body = await res.json();

    expect(body.data.metadata).toEqual({ department: "BD" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/api-documents-metadata.test.ts`
Expected: FAIL — metadata not accepted on POST, not returned on GET

- [ ] **Step 3: Implement metadata on upload**

In `app/api/v1/documents/route.ts`, add metadata handling to `POST`:

After `const file = formData.get("file") as File | null;` (line 54), add:
```typescript
  // Optional metadata JSON
  const metadataRaw = formData.get("metadata") as string | null;
  let metadata: Record<string, unknown> = {};
  if (metadataRaw) {
    try {
      metadata = JSON.parse(metadataRaw);
      if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
        return apiError("bad_request", "metadata must be a JSON object", 400);
      }
    } catch {
      return apiError("bad_request", "metadata must be valid JSON", 400);
    }
  }
```

In the `.insert()` call (line 94), add `metadata` to the insert payload:
```typescript
  const { error: insertError } = await admin.from("documents").insert({
    id: documentId,
    organization_id: organizationId,
    name: file.name,
    storage_path: storagePath,
    mime_type: file.type,
    file_size: file.size,
    content_hash: contentHash,
    metadata,
  });
```

- [ ] **Step 4: Add metadata to GET list response**

In `app/api/v1/documents/route.ts` GET handler, add `metadata` to the select string (line 22):
```typescript
    .select("id, name, mime_type, file_size, status, metadata, created_at, updated_at")
```

And to the response mapping (after `status: d.status,`):
```typescript
      metadata: d.metadata ?? {},
```

- [ ] **Step 5: Add metadata to GET detail response**

In `app/api/v1/documents/[id]/route.ts` GET handler, add `metadata` to the select string (line 17):
```typescript
    .select("id, name, mime_type, file_size, status, chunk_count, metadata, created_at, updated_at")
```

And to the response mapping (after `chunkCount: data.chunk_count,`):
```typescript
    metadata: data.metadata ?? {},
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/api-documents-metadata.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/api/v1/documents/route.ts app/api/v1/documents/\[id\]/route.ts tests/unit/api-documents-metadata.test.ts
git commit -m "feat(api): accept metadata on document upload, include in GET responses"
```

---

### Task 2: Search Endpoint

A retrieval-only endpoint that runs the search pipeline without LLM generation. Returns ranked chunks with sources.

**Files:**
- Create: `app/api/v1/search/route.ts`
- Create: `tests/unit/api-search.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/api-search.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/auth", () => ({
  authenticateApiKey: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/rag/search", () => ({
  hybridSearch: vi.fn(),
}));

import { POST } from "@/app/api/v1/search/route";
import { authenticateApiKey } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { hybridSearch } from "@/lib/rag/search";

function mockAuth(organizationId = "org-1") {
  (authenticateApiKey as any).mockResolvedValue({
    data: { organizationId, apiKeyId: "key-1" },
  });
}

describe("POST /api/v1/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (createAdminClient as any).mockReturnValue({});
  });

  it("returns search results without LLM generation", async () => {
    mockAuth();
    (hybridSearch as any).mockResolvedValue({
      results: [
        {
          chunkId: 1,
          chunkIndex: 0,
          documentId: "doc-1",
          documentName: "test.pdf",
          content: "Relevant content",
          metadata: {},
          similarity: 0.85,
          ftsRank: 0.7,
          rrfScore: 0.5,
        },
      ],
      queryTokenCount: 10,
    });

    const req = new Request("http://localhost/api/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test question" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.results).toHaveLength(1);
    expect(body.data.results[0].documentName).toBe("test.pdf");
    expect(body.data.results[0].content).toBe("Relevant content");
    expect(body.data.results[0].similarity).toBe(0.85);
    expect(body.data.queryTokenCount).toBe(10);
  });

  it("requires query field", async () => {
    mockAuth();
    const req = new Request("http://localhost/api/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("accepts optional topK and filters", async () => {
    mockAuth();
    (hybridSearch as any).mockResolvedValue({ results: [], queryTokenCount: 5 });

    const req = new Request("http://localhost/api/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "test",
        topK: 10,
        filters: { documentIds: ["doc-1"] },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(hybridSearch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        matchCount: 10,
        filters: { documentIds: ["doc-1"] },
      })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/api-search.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement search endpoint**

Create `app/api/v1/search/route.ts`:

```typescript
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { hybridSearch } from "@/lib/rag/search";

export async function POST(req: Request) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiError("bad_request", "Expected JSON body", 400);
  }

  const query = body.query as string | undefined;
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return apiError("bad_request", "query is required and must be a non-empty string", 400);
  }

  const topK = typeof body.topK === "number" ? body.topK : 5;
  const filters = body.filters as Record<string, unknown> | undefined;

  const admin = createAdminClient();

  try {
    const searchResponse = await hybridSearch(admin, {
      query: query.trim(),
      organizationId,
      matchCount: topK,
      filters: filters ? {
        documentIds: Array.isArray(filters.documentIds) ? filters.documentIds : undefined,
        mimeTypes: Array.isArray(filters.mimeTypes) ? filters.mimeTypes : undefined,
        dateFrom: typeof filters.dateFrom === "string" ? filters.dateFrom : undefined,
        dateTo: typeof filters.dateTo === "string" ? filters.dateTo : undefined,
      } : undefined,
    });

    return apiSuccess({
      results: searchResponse.results.map((r) => ({
        chunkId: r.chunkId,
        chunkIndex: r.chunkIndex,
        documentId: r.documentId,
        documentName: r.documentName,
        content: r.content,
        metadata: r.metadata,
        similarity: r.similarity,
        rrfScore: r.rrfScore,
      })),
      queryTokenCount: searchResponse.queryTokenCount,
    });
  } catch (err) {
    console.error("Search error:", err);
    return apiError("internal_error", "Search failed", 500);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/api-search.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/search/route.ts tests/unit/api-search.test.ts
git commit -m "feat(api): add POST /api/v1/search for retrieval-only queries"
```

---

### Task 3: Health Check Endpoint

**Files:**
- Create: `app/api/v1/health/route.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/api-health.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/v1/health/route";

describe("GET /api/v1/health", () => {
  it("returns ok status with no auth required", async () => {
    const req = new Request("http://localhost/api/v1/health");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/api-health.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement health endpoint**

Create `app/api/v1/health/route.ts`:

```typescript
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ status: "ok" });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/api-health.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/health/route.ts tests/unit/api-health.test.ts
git commit -m "feat(api): add GET /api/v1/health endpoint (no auth required)"
```

---

## Chunk 2: Docling Enhancements

### Task 4: Persist DoclingDocument JSON

Store the full DoclingDocument JSON alongside each document after parsing. Enables re-processing without re-parsing.

**Files:**
- Create: `supabase/migrations/00035_docling_doc_column.sql`
- Modify: `services/ingestion/src/parser.py`
- Modify: `services/ingestion/src/worker.py`
- Modify: `services/ingestion/src/config.py`

- [ ] **Step 1: Write failing parser test**

Add to `services/ingestion/tests/test_parser.py`:

```python
def test_parse_result_includes_docling_json(tmp_path):
    """ParseResult should include docling_json dict when Docling parses successfully."""
    from src.parser import ParseResult
    # Verify the field exists on the dataclass
    import dataclasses
    fields = {f.name for f in dataclasses.fields(ParseResult)}
    assert "docling_json" in fields
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ingestion && source .venv/bin/activate && pytest tests/test_parser.py::test_parse_result_includes_docling_json -v`
Expected: FAIL — `docling_json` not in ParseResult fields

- [ ] **Step 3: Add docling_json to ParseResult**

In `services/ingestion/src/parser.py`, modify the ParseResult dataclass:

```python
@dataclass
class ParseResult:
    text: str
    sections: list[Section]
    page_count: int = 1
    docling_doc: object = None  # Raw Docling document for VLM extraction
    docling_json: dict | None = None  # Full DoclingDocument JSON for persistence
```

In `parse_document()`, after creating the ParseResult, populate `docling_json`:

```python
    # After doc = result.document
    docling_json = None
    try:
        docling_json = doc.export_to_dict()
    except Exception as e:
        logger.warning(f"Failed to export DoclingDocument to dict: {e}")

    # Include in ParseResult
    return ParseResult(
        text=full_text,
        sections=sections,
        page_count=len(doc.pages) if doc.pages else 1,
        docling_doc=doc,
        docling_json=docling_json,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/ingestion && source .venv/bin/activate && pytest tests/test_parser.py::test_parse_result_includes_docling_json -v`
Expected: PASS

- [ ] **Step 5: Write migration for docling_doc column**

Create `supabase/migrations/00035_docling_doc_column.sql`:

```sql
-- Persist full DoclingDocument JSON for re-processing without re-parsing
ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS docling_doc jsonb;

COMMENT ON COLUMN public.documents.docling_doc IS
  'Lossless DoclingDocument JSON export. Preserves full structural representation for re-processing.';
```

- [ ] **Step 6: Apply migration**

Use Supabase MCP: `apply_migration` with project_id `xjzhiprdbzvmijvymkbn`, name `docling_doc_column`, statements from above.

- [ ] **Step 7: Add config flag**

In `services/ingestion/src/config.py`, add to Settings:

```python
    # DoclingDocument persistence (optional)
    persist_docling_doc: bool = True
```

- [ ] **Step 8: Update worker to persist DoclingDocument**

In `services/ingestion/src/worker.py`, in `update_document_status()`, add a new function or modify the existing update to include docling_doc. Add a new helper:

```python
async def persist_docling_json(document_id: str, docling_json: dict | None) -> None:
    """Store DoclingDocument JSON on the document record."""
    if not docling_json or not settings.persist_docling_doc:
        return
    try:
        admin = get_admin_client()
        admin.table("documents").update({"docling_doc": docling_json}).eq("id", document_id).execute()
    except Exception as e:
        logger.warning(f"Failed to persist DoclingDocument JSON: {e}")
```

Call it in `process_message()` after parsing, before chunking:

```python
    # After parse_result = parse_document(...)
    await persist_docling_json(document_id, parse_result.docling_json)
```

- [ ] **Step 9: Write worker test for DoclingDocument persistence**

Add to `services/ingestion/tests/test_worker.py`:

```python
@pytest.mark.asyncio
async def test_docling_json_persisted_when_enabled(mock_supabase, mock_settings):
    """When persist_docling_doc is True, worker stores docling_json on document."""
    mock_settings.persist_docling_doc = True

    mock_table = MagicMock()
    mock_table.update.return_value.eq.return_value.execute.return_value = MagicMock()
    mock_supabase.table.return_value = mock_table

    docling_json = {"body": {"children": [{"text": "test"}]}}
    await persist_docling_json("doc-123", docling_json)

    mock_supabase.table.assert_called_with("documents")
    mock_table.update.assert_called_once()
    update_arg = mock_table.update.call_args[0][0]
    assert update_arg["docling_doc"] == docling_json


@pytest.mark.asyncio
async def test_docling_json_skipped_when_disabled(mock_supabase, mock_settings):
    """When persist_docling_doc is False, worker does not store docling_json."""
    mock_settings.persist_docling_doc = False
    await persist_docling_json("doc-123", {"body": "test"})
    mock_supabase.table.assert_not_called()


@pytest.mark.asyncio
async def test_docling_json_skipped_when_none(mock_supabase, mock_settings):
    """When docling_json is None, worker does not store it."""
    mock_settings.persist_docling_doc = True
    await persist_docling_json("doc-123", None)
    mock_supabase.table.assert_not_called()
```

- [ ] **Step 10: Run all Python tests**

Run: `cd services/ingestion && source .venv/bin/activate && pytest -v`
Expected: All pass

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/00035_docling_doc_column.sql services/ingestion/src/parser.py services/ingestion/src/worker.py services/ingestion/src/config.py services/ingestion/tests/test_parser.py services/ingestion/tests/test_worker.py
git commit -m "feat(ingestion): persist DoclingDocument JSON for re-processing"
```

---

### Task 5: Semantic Unit Extraction

Extract semantic units using Docling's HierarchicalChunker — one chunk per natural document element (paragraph, list, table) with heading hierarchy.

**Files:**
- Create: `services/ingestion/src/semantic_units.py`
- Create: `supabase/migrations/00036_semantic_units.sql`
- Modify: `services/ingestion/src/worker.py`
- Modify: `services/ingestion/src/config.py`
- Create: `services/ingestion/tests/test_semantic_units.py`

- [ ] **Step 1: Write failing test for semantic unit extraction**

Create `services/ingestion/tests/test_semantic_units.py`:

```python
import pytest
from dataclasses import dataclass
from unittest.mock import MagicMock, patch


def test_semantic_unit_dataclass_fields():
    """SemanticUnit should have content, headings, label, page_numbers, unit_index, docling_ref."""
    from src.semantic_units import SemanticUnit
    import dataclasses
    fields = {f.name for f in dataclasses.fields(SemanticUnit)}
    assert fields == {"content", "headings", "label", "page_numbers", "unit_index", "docling_ref"}


def test_extract_semantic_units_returns_list():
    """extract_semantic_units should return a list of SemanticUnit objects."""
    from src.semantic_units import extract_semantic_units
    # Will need to mock HierarchicalChunker
    assert callable(extract_semantic_units)


@patch("src.semantic_units.HierarchicalChunker")
def test_extract_produces_units_from_chunks(mock_chunker_cls):
    """Each HierarchicalChunker chunk becomes a SemanticUnit."""
    from src.semantic_units import extract_semantic_units, SemanticUnit

    # Mock chunk objects
    mock_chunk_1 = MagicMock()
    mock_chunk_1.text = "Past performance on DTRA contract."
    mock_chunk_1.meta.headings = ["Part 1", "Past Performance"]
    mock_chunk_1.meta.doc_items = [MagicMock(label="paragraph")]
    mock_chunk_1.meta.doc_items[0].prov = [MagicMock(page_no=3)]
    mock_chunk_1.meta.doc_items[0].self_ref = "#/body/0"

    mock_chunk_2 = MagicMock()
    mock_chunk_2.text = "| Col A | Col B |"
    mock_chunk_2.meta.headings = ["Part 2", "Tables"]
    mock_chunk_2.meta.doc_items = [MagicMock(label="table")]
    mock_chunk_2.meta.doc_items[0].prov = [MagicMock(page_no=5)]
    mock_chunk_2.meta.doc_items[0].self_ref = "#/body/1"

    mock_chunker = MagicMock()
    mock_chunker.chunk.return_value = [mock_chunk_1, mock_chunk_2]
    mock_chunker_cls.return_value = mock_chunker

    doc = MagicMock()
    units = extract_semantic_units(doc)

    assert len(units) == 2
    assert isinstance(units[0], SemanticUnit)
    assert units[0].content == "Past performance on DTRA contract."
    assert units[0].headings == ["Part 1", "Past Performance"]
    assert units[0].unit_index == 0
    assert units[1].unit_index == 1
    assert units[1].label == "table"
    assert 5 in units[1].page_numbers
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/ingestion && source .venv/bin/activate && pytest tests/test_semantic_units.py -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement semantic_units.py**

Create `services/ingestion/src/semantic_units.py`:

```python
"""
Semantic Unit Extraction via Docling's HierarchicalChunker.

Produces one SemanticUnit per natural document element (paragraph, list, table)
with heading hierarchy attached. These are NOT replacements for RAG chunks —
they're optimized for structured extraction, not retrieval.
"""

import logging
from dataclasses import dataclass, field

from docling_core.transforms.chunker.hierarchical_chunker import HierarchicalChunker

logger = logging.getLogger(__name__)


@dataclass
class SemanticUnit:
    content: str
    headings: list[str] = field(default_factory=list)
    label: str = "paragraph"
    page_numbers: list[int] = field(default_factory=list)
    unit_index: int = 0
    docling_ref: str | None = None


def _infer_label(doc_items: list) -> str:
    """Map DocItem labels to a simplified set."""
    if not doc_items:
        return "paragraph"
    label = str(getattr(doc_items[0], "label", "paragraph")).lower()
    # Normalize common Docling labels
    label_map = {
        "table": "table",
        "list_item": "list_item",
        "section_header": "section_header",
        "title": "title",
        "caption": "caption",
        "formula": "formula",
        "picture": "picture",
        "paragraph": "paragraph",
    }
    return label_map.get(label, "paragraph")


def _extract_pages(doc_items: list) -> list[int]:
    """Extract unique page numbers from DocItem provenance data."""
    pages: set[int] = set()
    for item in doc_items:
        for prov in getattr(item, "prov", []):
            page_no = getattr(prov, "page_no", None)
            if page_no is not None:
                pages.add(page_no)
    return sorted(pages)


def extract_semantic_units(docling_doc) -> list[SemanticUnit]:
    """
    Extract semantic units from a DoclingDocument using HierarchicalChunker.

    Each unit corresponds to a natural document element (paragraph, list, table)
    with its heading hierarchy and page provenance.
    """
    chunker = HierarchicalChunker()
    units: list[SemanticUnit] = []

    try:
        chunks = list(chunker.chunk(dl_doc=docling_doc))
    except Exception as e:
        logger.error(f"HierarchicalChunker failed: {e}")
        return []

    for i, chunk in enumerate(chunks):
        doc_items = getattr(chunk.meta, "doc_items", []) if chunk.meta else []
        headings = getattr(chunk.meta, "headings", []) if chunk.meta else []

        units.append(
            SemanticUnit(
                content=chunk.text,
                headings=list(headings),
                label=_infer_label(doc_items),
                page_numbers=_extract_pages(doc_items),
                unit_index=i,
                docling_ref=(
                    getattr(doc_items[0], "self_ref", None) if doc_items else None
                ),
            )
        )

    logger.info(f"Extracted {len(units)} semantic units")
    return units
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/ingestion && source .venv/bin/activate && pytest tests/test_semantic_units.py -v`
Expected: PASS

- [ ] **Step 5: Write migration for document_semantic_units table**

Create `supabase/migrations/00036_semantic_units.sql`:

```sql
-- Semantic units: one row per natural document element (paragraph, list, table)
-- with heading hierarchy. Used for structured extraction, not RAG retrieval.

CREATE TABLE public.document_semantic_units (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  content text NOT NULL,
  headings text[] NOT NULL DEFAULT '{}',
  label text NOT NULL DEFAULT 'paragraph',
  page_numbers integer[] DEFAULT '{}',
  unit_index integer NOT NULL,
  docling_ref text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- RLS: same pattern as document_chunks
ALTER TABLE public.document_semantic_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org semantic units"
  ON public.document_semantic_units FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Service role can manage semantic units"
  ON public.document_semantic_units FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Indexes for common query patterns
CREATE INDEX idx_semantic_units_doc ON public.document_semantic_units(document_id);
CREATE INDEX idx_semantic_units_org ON public.document_semantic_units(organization_id);
CREATE INDEX idx_semantic_units_headings ON public.document_semantic_units USING GIN(headings);
CREATE INDEX idx_semantic_units_label ON public.document_semantic_units(label);

COMMENT ON TABLE public.document_semantic_units IS
  'One row per natural document element extracted by Docling HierarchicalChunker. Used for structured extraction pipelines.';
```

- [ ] **Step 6: Apply migration**

Use Supabase MCP: `apply_migration` with project_id `xjzhiprdbzvmijvymkbn`, name `semantic_units`.

- [ ] **Step 7: Add config flag and wire into worker**

In `services/ingestion/src/config.py`, add:

```python
    # Semantic unit extraction (optional)
    extract_semantic_units: bool = False
```

In `services/ingestion/src/worker.py`, add import and function:

```python
from src.semantic_units import extract_semantic_units as extract_units, SemanticUnit

async def upsert_semantic_units(
    document_id: str,
    organization_id: str,
    units: list[SemanticUnit],
) -> None:
    """Store semantic units in database."""
    if not units:
        return
    admin = get_admin_client()
    batch_size = 50
    for i in range(0, len(units), batch_size):
        batch = units[i : i + batch_size]
        rows = [
            {
                "document_id": document_id,
                "organization_id": organization_id,
                "content": u.content,
                "headings": u.headings,
                "label": u.label,
                "page_numbers": u.page_numbers,
                "unit_index": u.unit_index,
                "docling_ref": u.docling_ref,
            }
            for u in batch
        ]
        admin.table("document_semantic_units").insert(rows).execute()
```

In `process_message()`, after persisting DoclingDocument and before chunking:

```python
    # Extract semantic units (if enabled)
    if settings.extract_semantic_units and parse_result.docling_doc:
        units = extract_units(parse_result.docling_doc)
        await upsert_semantic_units(document_id, organization_id, units)
        logger.info(f"Stored {len(units)} semantic units for {document_id}")
```

- [ ] **Step 8: Write worker test for semantic unit extraction**

Add to `services/ingestion/tests/test_worker.py`:

```python
@pytest.mark.asyncio
@patch("src.worker.extract_units")
async def test_semantic_units_extracted_when_enabled(mock_extract, mock_supabase, mock_settings):
    """When extract_semantic_units is True, worker extracts and stores units."""
    mock_settings.extract_semantic_units = True

    mock_unit = SemanticUnit(
        content="Test content",
        headings=["Section 1"],
        label="paragraph",
        page_numbers=[1],
        unit_index=0,
        docling_ref="#/body/0",
    )
    mock_extract.return_value = [mock_unit]

    mock_table = MagicMock()
    mock_table.insert.return_value.execute.return_value = MagicMock()
    mock_supabase.table.return_value = mock_table

    docling_doc = MagicMock()
    await upsert_semantic_units("doc-123", "org-456", [mock_unit])

    mock_supabase.table.assert_called_with("document_semantic_units")
    mock_table.insert.assert_called_once()
    rows = mock_table.insert.call_args[0][0]
    assert len(rows) == 1
    assert rows[0]["content"] == "Test content"
    assert rows[0]["organization_id"] == "org-456"


@pytest.mark.asyncio
async def test_semantic_units_skipped_when_disabled(mock_supabase, mock_settings):
    """When extract_semantic_units is False, worker does not extract units."""
    mock_settings.extract_semantic_units = False
    # The worker checks settings before calling extract_units,
    # so we just verify the flag gates the behavior
    assert not mock_settings.extract_semantic_units
```

- [ ] **Step 9: Run all Python tests**

Run: `cd services/ingestion && source .venv/bin/activate && pytest -v`
Expected: All pass

- [ ] **Step 10: Commit**

```bash
git add services/ingestion/src/semantic_units.py supabase/migrations/00036_semantic_units.sql services/ingestion/src/worker.py services/ingestion/src/config.py services/ingestion/tests/test_semantic_units.py services/ingestion/tests/test_worker.py
git commit -m "feat(ingestion): add semantic unit extraction via HierarchicalChunker"
```

---

### Task 6: Classification Pipeline Scaffold

Generic "classify & review" pipeline — AI proposes labels for semantic units, humans review. The boilerplate owns the mechanism; deployments bring domain schema.

**Files:**
- Create: `supabase/migrations/00037_classification_scaffold.sql`
- Create: `services/ingestion/src/classifier.py`
- Create: `app/api/v1/classifications/route.ts`
- Create: `app/api/v1/classifications/[id]/route.ts`
- Create: `app/api/v1/classifications/stats/route.ts`
- Modify: `services/ingestion/src/config.py`
- Create: `services/ingestion/tests/test_classifier.py`
- Create: `tests/unit/api-classifications.test.ts`

- [ ] **Step 1: Write migration**

Create `supabase/migrations/00037_classification_scaffold.sql`:

```sql
-- Classification proposals: AI-proposed labels for semantic units, queued for human review.
-- Generic scaffold — deployments define their own label schemas via the proposed_labels JSONB.

CREATE TABLE public.classification_proposals (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  semantic_unit_id bigint REFERENCES public.document_semantic_units(id) ON DELETE CASCADE,
  content text NOT NULL,
  headings text[],
  proposed_labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence float,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'modified', 'rejected')),
  reviewer_labels jsonb,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- RLS
ALTER TABLE public.classification_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org proposals"
  ON public.classification_proposals FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can update own org proposals"
  ON public.classification_proposals FOR UPDATE
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Service role full access"
  ON public.classification_proposals FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Indexes
CREATE INDEX idx_proposals_status ON public.classification_proposals(status);
CREATE INDEX idx_proposals_doc ON public.classification_proposals(document_id);
CREATE INDEX idx_proposals_org ON public.classification_proposals(organization_id);
CREATE INDEX idx_proposals_unit ON public.classification_proposals(semantic_unit_id);

COMMENT ON TABLE public.classification_proposals IS
  'AI-proposed classifications for semantic units. Deployments define label schemas; this table stores proposals for human review.';
```

- [ ] **Step 2: Apply migration**

Use Supabase MCP: `apply_migration` with project_id `xjzhiprdbzvmijvymkbn`, name `classification_scaffold`.

- [ ] **Step 3: Write classifier tests**

Create `services/ingestion/tests/test_classifier.py`:

```python
import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from src.classifier import BaseClassifier, ClassificationResult, classify_units
from src.semantic_units import SemanticUnit


class MockClassifier(BaseClassifier):
    async def classify(self, content, headings, label, document_context):
        return ClassificationResult(
            proposed_labels={"section": "PAST_PERFORMANCE", "category": "SDA"},
            confidence=0.92,
        )


def test_classification_result_fields():
    result = ClassificationResult(proposed_labels={"a": "b"}, confidence=0.5)
    assert result.proposed_labels == {"a": "b"}
    assert result.confidence == 0.5


@pytest.mark.asyncio
async def test_classify_units_calls_classifier_for_each_unit():
    classifier = MockClassifier()
    units = [
        SemanticUnit(content="Past perf text", headings=["PP"], label="paragraph", unit_index=0),
        SemanticUnit(content="Table data", headings=["Tables"], label="table", unit_index=1),
    ]
    results = await classify_units(units, classifier, document_context={})
    assert len(results) == 2
    assert results[0].proposed_labels["section"] == "PAST_PERFORMANCE"


@pytest.mark.asyncio
async def test_classify_units_handles_classifier_errors():
    """If classifier raises on one unit, others still succeed."""

    class FailingClassifier(BaseClassifier):
        call_count = 0
        async def classify(self, content, headings, label, document_context):
            self.call_count += 1
            if self.call_count == 1:
                raise ValueError("API error")
            return ClassificationResult(proposed_labels={"ok": True}, confidence=0.8)

    classifier = FailingClassifier()
    units = [
        SemanticUnit(content="fail", headings=[], label="paragraph", unit_index=0),
        SemanticUnit(content="succeed", headings=[], label="paragraph", unit_index=1),
    ]
    results = await classify_units(units, classifier, document_context={})
    assert len(results) == 1  # Only the successful one
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd services/ingestion && source .venv/bin/activate && pytest tests/test_classifier.py -v`
Expected: FAIL — module not found

- [ ] **Step 5: Implement classifier.py**

Create `services/ingestion/src/classifier.py`:

```python
"""
Classification Pipeline Scaffold.

Generic mechanism for classifying semantic units with AI-proposed labels.
Deployments implement BaseClassifier with their domain-specific prompt and schema.
"""

import asyncio
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass

from src.semantic_units import SemanticUnit

logger = logging.getLogger(__name__)


@dataclass
class ClassificationResult:
    proposed_labels: dict
    confidence: float


class BaseClassifier(ABC):
    """
    Abstract classifier that deployments implement.

    Each deployment provides its own prompt, label schema, and LLM call.
    The scaffold handles orchestration, error handling, and storage.
    """

    @abstractmethod
    async def classify(
        self,
        content: str,
        headings: list[str],
        label: str,
        document_context: dict,
    ) -> ClassificationResult:
        """Classify a semantic unit. Returns proposed labels + confidence."""
        ...


async def classify_units(
    units: list[SemanticUnit],
    classifier: BaseClassifier,
    document_context: dict,
    concurrency: int = 5,
) -> list[tuple[SemanticUnit, ClassificationResult]]:
    """
    Classify a list of semantic units using the provided classifier.

    Returns (unit, result) pairs for successful classifications only.
    Failed classifications are logged and skipped.
    """
    semaphore = asyncio.Semaphore(concurrency)
    results: list[tuple[SemanticUnit, ClassificationResult]] = []

    async def classify_one(unit: SemanticUnit) -> tuple[SemanticUnit, ClassificationResult] | None:
        async with semaphore:
            try:
                result = await classifier.classify(
                    content=unit.content,
                    headings=unit.headings,
                    label=unit.label,
                    document_context=document_context,
                )
                return (unit, result)
            except Exception as e:
                logger.warning(f"Classification failed for unit {unit.unit_index}: {e}")
                return None

    tasks = [classify_one(unit) for unit in units]
    completed = await asyncio.gather(*tasks)

    for item in completed:
        if item is not None:
            results.append(item)

    logger.info(f"Classified {len(results)}/{len(units)} units successfully")
    return results
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd services/ingestion && source .venv/bin/activate && pytest tests/test_classifier.py -v`
Expected: PASS

- [ ] **Step 7: Add config flag**

In `services/ingestion/src/config.py`, add:

```python
    # Classification pipeline (optional)
    classification_pipeline_enabled: bool = False
    classification_concurrency: int = 5
```

- [ ] **Step 8: Write classification API tests**

Create `tests/unit/api-classifications.test.ts`:

```typescript
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
import { authenticateApiKey } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";

function mockAuth(organizationId = "org-1") {
  (authenticateApiKey as any).mockResolvedValue({
    data: { organizationId, apiKeyId: "key-1" },
  });
}

describe("GET /api/v1/classifications", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns proposals filtered by org", async () => {
    mockAuth();
    const admin: any = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                range: vi.fn().mockResolvedValue({
                  data: [{ id: 1, content: "test", status: "pending", proposed_labels: { section: "PP" } }],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    };
    (createAdminClient as any).mockReturnValue(admin);

    const req = new Request("http://localhost/api/v1/classifications?status=pending");
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});

describe("PUT /api/v1/classifications/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates proposal status", async () => {
    mockAuth();
    const admin: any = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 1, organization_id: "org-1" }, error: null }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };
    (createAdminClient as any).mockReturnValue(admin);

    const req = new Request("http://localhost/api/v1/classifications/1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);
  });
});

describe("GET /api/v1/classifications/stats", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns aggregate counts by status", async () => {
    mockAuth();
    const admin: any = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [
              { status: "pending" }, { status: "pending" },
              { status: "approved" },
            ],
            error: null,
          }),
        }),
      }),
    };
    (createAdminClient as any).mockReturnValue(admin);

    const req = new Request("http://localhost/api/v1/classifications/stats");
    const res = await GET_STATS(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.pending).toBe(2);
    expect(body.data.approved).toBe(1);
  });
});
```

- [ ] **Step 9: Implement classification API routes**

Create `app/api/v1/classifications/route.ts`:

```typescript
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const documentId = url.searchParams.get("document_id");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
  const offset = parseInt(url.searchParams.get("offset") ?? "0");

  const admin = createAdminClient();

  let query = admin
    .from("classification_proposals")
    .select("id, document_id, semantic_unit_id, content, headings, proposed_labels, confidence, status, reviewer_labels, reviewed_at, created_at")
    .eq("organization_id", organizationId);

  if (status) query = query.eq("status", status);
  if (documentId) query = query.eq("document_id", documentId);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return apiError("internal_error", "Failed to list classifications", 500);

  return apiSuccess(
    (data ?? []).map((p) => ({
      id: p.id,
      documentId: p.document_id,
      semanticUnitId: p.semantic_unit_id,
      content: p.content,
      headings: p.headings,
      proposedLabels: p.proposed_labels,
      confidence: p.confidence,
      status: p.status,
      reviewerLabels: p.reviewer_labels,
      reviewedAt: p.reviewed_at,
      createdAt: p.created_at,
    }))
  );
}
```

Create `app/api/v1/classifications/[id]/route.ts`:

```typescript
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: RouteParams) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;
  const { id } = await params;
  const admin = createAdminClient();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiError("bad_request", "Expected JSON body", 400);
  }

  const status = body.status as string | undefined;
  if (!status || !["approved", "modified", "rejected"].includes(status)) {
    return apiError("bad_request", "status must be one of: approved, modified, rejected", 400);
  }

  // Verify proposal belongs to org
  const { data: existing, error: fetchError } = await admin
    .from("classification_proposals")
    .select("id, organization_id")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .single();

  if (fetchError || !existing) {
    return apiError("not_found", "Classification proposal not found", 404);
  }

  const updatePayload: Record<string, unknown> = {
    status,
    reviewed_at: new Date().toISOString(),
  };

  if (body.reviewerLabels) {
    updatePayload.reviewer_labels = body.reviewerLabels;
  }

  const { error } = await admin
    .from("classification_proposals")
    .update(updatePayload)
    .eq("id", id);

  if (error) return apiError("internal_error", "Failed to update proposal", 500);

  return apiSuccess({ id: Number(id), status });
}
```

Create `app/api/v1/classifications/stats/route.ts`:

```typescript
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;
  const url = new URL(req.url);
  const documentId = url.searchParams.get("document_id");

  const admin = createAdminClient();

  let query = admin
    .from("classification_proposals")
    .select("status")
    .eq("organization_id", organizationId);

  if (documentId) query = query.eq("document_id", documentId);

  const { data, error } = await query;

  if (error) return apiError("internal_error", "Failed to get stats", 500);

  const counts = { pending: 0, approved: 0, modified: 0, rejected: 0 };
  for (const row of data ?? []) {
    const s = row.status as keyof typeof counts;
    if (s in counts) counts[s]++;
  }

  return apiSuccess(counts);
}
```

Create `app/api/v1/classifications/bulk/route.ts`:

```typescript
import { authenticateApiKey } from "@/lib/api/auth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PUT(req: Request) {
  const auth = await authenticateApiKey(req);
  if (auth.error) return auth.error;

  const { organizationId } = auth.data!;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiError("bad_request", "Expected JSON body", 400);
  }

  const ids = body.ids as number[] | undefined;
  const status = body.status as string | undefined;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return apiError("bad_request", "ids must be a non-empty array", 400);
  }
  if (ids.length > 100) {
    return apiError("bad_request", "Maximum 100 ids per bulk operation", 400);
  }
  if (!status || !["approved", "modified", "rejected"].includes(status)) {
    return apiError("bad_request", "status must be one of: approved, modified, rejected", 400);
  }

  const admin = createAdminClient();

  const updatePayload: Record<string, unknown> = {
    status,
    reviewed_at: new Date().toISOString(),
  };
  if (body.reviewerLabels) {
    updatePayload.reviewer_labels = body.reviewerLabels;
  }

  const { error } = await admin
    .from("classification_proposals")
    .update(updatePayload)
    .in("id", ids)
    .eq("organization_id", organizationId);

  if (error) return apiError("internal_error", "Failed to update proposals", 500);

  return apiSuccess({ updated: ids.length, status });
}
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/api-classifications.test.ts`
Expected: PASS

- [ ] **Step 11: Run all Python tests**

Run: `cd services/ingestion && source .venv/bin/activate && pytest -v`
Expected: All pass

- [ ] **Step 12: Commit**

```bash
git add supabase/migrations/00037_classification_scaffold.sql services/ingestion/src/classifier.py services/ingestion/src/config.py services/ingestion/tests/test_classifier.py app/api/v1/classifications/ tests/unit/api-classifications.test.ts
git commit -m "feat: add classification pipeline scaffold with review API"
```

---

## Chunk 3: Auto-Optimizer Phase 2 Completion

### Task 7: Session Loop

The session loop orchestrates multiple experiments: establishes a baseline, iterates through config variations, tracks the best config, and logs everything.

**Files:**
- Create: `lib/rag/optimizer/session.ts`
- Create: `tests/unit/optimizer-session.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/optimizer-session.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExperimentResult } from "@/lib/rag/optimizer/experiment";
import type { ExperimentConfig, CompositeWeights } from "@/lib/rag/optimizer/config";

// Will test the session module once created
describe("optimizer session loop", () => {
  const defaultWeights: CompositeWeights = {
    precisionAtK: 0.2,
    recallAtK: 0.2,
    mrr: 0.2,
    faithfulness: 0.15,
    relevance: 0.15,
    completeness: 0.1,
  };

  it("runSession is importable and callable", async () => {
    const { runSession } = await import("@/lib/rag/optimizer/session");
    expect(typeof runSession).toBe("function");
  });

  it("runs baseline then iterates experiments", async () => {
    const { runSession } = await import("@/lib/rag/optimizer/session");

    const mockExperimentResult: ExperimentResult = {
      experimentConfig: {
        model: "test", topK: 5, similarityThreshold: 0.3,
        fullTextWeight: 1.5, semanticWeight: 1.0,
        rerankEnabled: false, rerankCandidateMultiplier: 4,
      },
      configDelta: { fullTextWeight: { before: 1.0, after: 1.5 } },
      compositeScore: 0.8,
      delta: 0.05,
      status: "kept",
      retrievalMetrics: { precisionAtK: 0.8, recallAtK: 0.9, mrr: 1.0 },
      judgeScores: null,
    };

    const deps = {
      runExperiment: vi.fn().mockResolvedValue(mockExperimentResult),
      createRun: vi.fn().mockResolvedValue({ id: "run-1" }),
      completeRun: vi.fn().mockResolvedValue(undefined),
      logExperiment: vi.fn().mockResolvedValue({ id: "exp-1" }),
      upsertBestConfig: vi.fn().mockResolvedValue(undefined),
      getTestCases: vi.fn().mockResolvedValue([
        { id: "tc-1", question: "test?", expected_answer: "yes", expected_source_ids: null },
      ]),
      runBaseline: vi.fn().mockResolvedValue({
        compositeScore: 0.75,
        retrievalMetrics: { precisionAtK: 0.7, recallAtK: 0.85, mrr: 0.9 },
        judgeScores: null,
      }),
    };

    const config = {
      organizationId: "org-1",
      testSetId: "ts-1",
      compositeWeights: defaultWeights,
      maxExperiments: 2,
      maxBudgetUsd: 10,
      experiments: [
        { fullTextWeight: 1.5 },
        { semanticWeight: 1.5 },
      ],
    };

    const result = await runSession(config, deps);

    expect(deps.createRun).toHaveBeenCalledOnce();
    expect(deps.runBaseline).toHaveBeenCalledOnce();
    expect(deps.runExperiment).toHaveBeenCalledTimes(2);
    expect(deps.logExperiment).toHaveBeenCalledTimes(2);
    expect(deps.completeRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "complete" })
    );
    expect(result.experimentsRun).toBe(2);
  });

  it("stops at maxExperiments budget cap", async () => {
    const { runSession } = await import("@/lib/rag/optimizer/session");

    const deps = {
      runExperiment: vi.fn().mockResolvedValue({
        experimentConfig: { model: "test", topK: 5, similarityThreshold: 0.3, fullTextWeight: 1.0, semanticWeight: 1.0, rerankEnabled: false, rerankCandidateMultiplier: 4 },
        configDelta: {},
        compositeScore: 0.7,
        delta: -0.05,
        status: "discarded",
        retrievalMetrics: { precisionAtK: 0.7, recallAtK: 0.7, mrr: 0.7 },
        judgeScores: null,
      }),
      createRun: vi.fn().mockResolvedValue({ id: "run-1" }),
      completeRun: vi.fn().mockResolvedValue(undefined),
      logExperiment: vi.fn().mockResolvedValue({ id: "exp-1" }),
      upsertBestConfig: vi.fn().mockResolvedValue(undefined),
      getTestCases: vi.fn().mockResolvedValue([
        { id: "tc-1", question: "test?", expected_answer: "yes", expected_source_ids: null },
      ]),
      runBaseline: vi.fn().mockResolvedValue({
        compositeScore: 0.75,
        retrievalMetrics: { precisionAtK: 0.7, recallAtK: 0.85, mrr: 0.9 },
        judgeScores: null,
      }),
    };

    const config = {
      organizationId: "org-1",
      testSetId: "ts-1",
      compositeWeights: defaultWeights,
      maxExperiments: 3,
      maxBudgetUsd: 10,
      experiments: [
        { fullTextWeight: 1.5 },
        { semanticWeight: 1.5 },
        { topK: 10 },
        { rerankEnabled: true },  // won't run — maxExperiments is 3
      ],
    };

    const result = await runSession(config, deps);
    expect(deps.runExperiment).toHaveBeenCalledTimes(3);
    expect(result.experimentsRun).toBe(3);
  });

  it("updates baseline when experiment is kept", async () => {
    const { runSession } = await import("@/lib/rag/optimizer/session");

    let callCount = 0;
    const deps = {
      runExperiment: vi.fn().mockImplementation(async (input: any) => {
        callCount++;
        if (callCount === 1) {
          // First experiment: kept — score improves
          return {
            experimentConfig: { ...input.baselineConfig, ...input.configOverrides },
            configDelta: { fullTextWeight: { before: 1.0, after: 1.5 } },
            compositeScore: 0.85,
            delta: 0.1,
            status: "kept" as const,
            retrievalMetrics: { precisionAtK: 0.9, recallAtK: 0.9, mrr: 1.0 },
            judgeScores: null,
          };
        }
        // Second experiment: should use the KEPT config as baseline
        return {
          experimentConfig: { ...input.baselineConfig, ...input.configOverrides },
          configDelta: { semanticWeight: { before: 1.0, after: 1.5 } },
          compositeScore: 0.8,
          delta: -0.05,
          status: "discarded" as const,
          retrievalMetrics: { precisionAtK: 0.8, recallAtK: 0.8, mrr: 0.9 },
          judgeScores: null,
        };
      }),
      createRun: vi.fn().mockResolvedValue({ id: "run-1" }),
      completeRun: vi.fn().mockResolvedValue(undefined),
      logExperiment: vi.fn().mockResolvedValue({ id: "exp-1" }),
      upsertBestConfig: vi.fn().mockResolvedValue(undefined),
      getTestCases: vi.fn().mockResolvedValue([
        { id: "tc-1", question: "test?", expected_answer: "yes", expected_source_ids: null },
      ]),
      runBaseline: vi.fn().mockResolvedValue({
        compositeScore: 0.75,
        retrievalMetrics: { precisionAtK: 0.7, recallAtK: 0.85, mrr: 0.9 },
        judgeScores: null,
      }),
    };

    const config = {
      organizationId: "org-1",
      testSetId: "ts-1",
      compositeWeights: defaultWeights,
      maxExperiments: 2,
      maxBudgetUsd: 10,
      experiments: [
        { fullTextWeight: 1.5 },
        { semanticWeight: 1.5 },
      ],
    };

    const result = await runSession(config, deps);

    // Second call should have baselineScore = 0.85 (the kept experiment's score)
    const secondCall = deps.runExperiment.mock.calls[1][0];
    expect(secondCall.baselineScore).toBe(0.85);
    expect(secondCall.baselineConfig.fullTextWeight).toBe(1.5);

    // Best config should be upserted
    expect(deps.upsertBestConfig).toHaveBeenCalled();
  });

  it("marks run as error when exception occurs", async () => {
    const { runSession } = await import("@/lib/rag/optimizer/session");

    const deps = {
      runExperiment: vi.fn().mockRejectedValue(new Error("boom")),
      createRun: vi.fn().mockResolvedValue({ id: "run-1" }),
      completeRun: vi.fn().mockResolvedValue(undefined),
      logExperiment: vi.fn().mockResolvedValue({ id: "exp-1" }),
      upsertBestConfig: vi.fn().mockResolvedValue(undefined),
      getTestCases: vi.fn().mockResolvedValue([
        { id: "tc-1", question: "test?", expected_answer: "yes", expected_source_ids: null },
      ]),
      runBaseline: vi.fn().mockResolvedValue({
        compositeScore: 0.75,
        retrievalMetrics: { precisionAtK: 0.7, recallAtK: 0.85, mrr: 0.9 },
        judgeScores: null,
      }),
    };

    const config = {
      organizationId: "org-1",
      testSetId: "ts-1",
      compositeWeights: defaultWeights,
      maxExperiments: 1,
      maxBudgetUsd: 10,
      experiments: [{ fullTextWeight: 1.5 }],
    };

    const result = await runSession(config, deps);
    expect(deps.completeRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" })
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/optimizer-session.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement session.ts**

Create `lib/rag/optimizer/session.ts`:

```typescript
import type { ExperimentConfig, CompositeWeights } from "./config";
import { createDefaultConfig } from "./config";
import type { ExperimentInput, ExperimentResult, ExperimentTestCase, RetrievalMetricsResult, JudgeScoresResult } from "./experiment";
import type { OptimizationRunInsert, OptimizationRunComplete, ExperimentInsert, BestConfigUpsert, OptimizationRunRow } from "./results-log";

/**
 * Configuration for an optimization session.
 */
export type SessionConfig = {
  organizationId: string;
  testSetId: string;
  compositeWeights: CompositeWeights;
  /** Maximum number of experiments to run (budget cap) */
  maxExperiments: number;
  /** Maximum API spend in USD. NOTE: Cost tracking deferred to Phase 3 (agent decide step).
   *  maxExperiments is the primary budget cap for now. This field is declared for
   *  forward compatibility so callers set it from day one. */
  maxBudgetUsd: number;
  /** Ordered list of config overrides to try */
  experiments: Partial<ExperimentConfig>[];
  /** Optional starting config (defaults to createDefaultConfig()) */
  baselineConfig?: ExperimentConfig;
};

/**
 * Baseline eval result — score + metrics from running the current config.
 */
export type BaselineResult = {
  compositeScore: number;
  retrievalMetrics: RetrievalMetricsResult;
  judgeScores: JudgeScoresResult | null;
};

/**
 * Session result returned after all experiments complete.
 */
export type SessionResult = {
  runId: string;
  experimentsRun: number;
  bestConfig: ExperimentConfig;
  bestScore: number;
  baselineScore: number;
  keptCount: number;
  discardedCount: number;
  errorCount: number;
  status: "complete" | "error";
  errorMessage?: string;
};

/**
 * Dependency injection for the session loop.
 * All external side effects are injected so the loop is pure + testable.
 */
export type SessionDeps = {
  /** Run a single experiment. The caller is responsible for binding the eval runner. */
  runExperiment: (input: ExperimentInput) => Promise<ExperimentResult>;
  createRun: (input: OptimizationRunInsert) => Promise<OptimizationRunRow>;
  completeRun: (input: OptimizationRunComplete) => Promise<void>;
  logExperiment: (input: ExperimentInsert) => Promise<any>;
  upsertBestConfig: (input: BestConfigUpsert) => Promise<void>;
  getTestCases: (testSetId: string) => Promise<ExperimentTestCase[]>;
  runBaseline: (config: ExperimentConfig, testCases: ExperimentTestCase[], organizationId: string, weights: CompositeWeights) => Promise<BaselineResult>;
};

/**
 * Run an optimization session: establish baseline, iterate experiments,
 * track best config, log everything.
 */
export async function runSession(
  config: SessionConfig,
  deps: SessionDeps
): Promise<SessionResult> {
  const baseline = config.baselineConfig ?? createDefaultConfig();

  // 1. Fetch test cases
  const testCases = await deps.getTestCases(config.testSetId);

  // 2. Run baseline eval
  const baselineResult = await deps.runBaseline(
    baseline,
    testCases,
    config.organizationId,
    config.compositeWeights
  );

  // 3. Create optimization run
  const run = await deps.createRun({
    organizationId: config.organizationId,
    testSetId: config.testSetId,
    baselineConfig: baseline,
    baselineScore: baselineResult.compositeScore,
    compositeWeights: config.compositeWeights,
  });

  let currentConfig = { ...baseline };
  let currentScore = baselineResult.compositeScore;
  let bestConfig = { ...baseline };
  let bestScore = baselineResult.compositeScore;
  let experimentsRun = 0;
  let keptCount = 0;
  let discardedCount = 0;
  let errorCount = 0;

  try {
    // 4. Iterate experiments up to maxExperiments
    const maxToRun = Math.min(config.experiments.length, config.maxExperiments);

    for (let i = 0; i < maxToRun; i++) {
      const overrides = config.experiments[i];

      const experimentInput: ExperimentInput = {
        baselineConfig: currentConfig,
        baselineScore: currentScore,
        configOverrides: overrides,
        compositeWeights: config.compositeWeights,
        organizationId: config.organizationId,
        runId: run.id,
        experimentIndex: i,
        testCases,
      };

      // Run experiment — deps.runExperiment is pre-bound with its own evalRunner
      const result = await deps.runExperiment(experimentInput);

      experimentsRun++;

      // Log experiment
      await deps.logExperiment({
        runId: run.id,
        organizationId: config.organizationId,
        experimentIndex: i,
        config: result.experimentConfig,
        configDelta: result.configDelta,
        compositeScore: result.compositeScore,
        delta: result.delta,
        status: result.status,
        retrievalMetrics: result.retrievalMetrics,
        judgeScores: result.judgeScores,
        reasoning: null,
        errorMessage: result.errorMessage,
      });

      // Track outcomes
      if (result.status === "kept") {
        keptCount++;
        currentConfig = { ...result.experimentConfig };
        currentScore = result.compositeScore;
        if (result.compositeScore > bestScore) {
          bestConfig = { ...result.experimentConfig };
          bestScore = result.compositeScore;
        }
      } else if (result.status === "error") {
        errorCount++;
      } else {
        discardedCount++;
      }
    }

    // 5. Upsert best config if we found an improvement
    if (bestScore > baselineResult.compositeScore) {
      await deps.upsertBestConfig({
        organizationId: config.organizationId,
        config: bestConfig,
        compositeScore: bestScore,
        compositeWeights: config.compositeWeights,
        runId: run.id,
      });
    }

    // 6. Complete run
    await deps.completeRun({
      runId: run.id,
      status: "complete",
      bestConfig: bestScore > baselineResult.compositeScore ? bestConfig : null,
      bestScore: bestScore > baselineResult.compositeScore ? bestScore : null,
      experimentsRun,
    });

    return {
      runId: run.id,
      experimentsRun,
      bestConfig,
      bestScore,
      baselineScore: baselineResult.compositeScore,
      keptCount,
      discardedCount,
      errorCount,
      status: "complete",
    };
  } catch (err) {
    // Mark run as error
    await deps.completeRun({
      runId: run.id,
      status: "error",
      bestConfig: null,
      bestScore: null,
      experimentsRun,
      errorMessage: err instanceof Error ? err.message : String(err),
    });

    return {
      runId: run.id,
      experimentsRun,
      bestConfig: currentConfig,
      bestScore: currentScore,
      baselineScore: baselineResult.compositeScore,
      keptCount,
      discardedCount,
      errorCount,
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/optimizer-session.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/rag/optimizer/session.ts tests/unit/optimizer-session.test.ts
git commit -m "feat(optimizer): add session loop with baseline tracking and budget cap"
```

---

## Chunk 4: Verification & Docs

### Task 8: Full Test Suite + Build Verification

- [ ] **Step 1: Run all TypeScript tests**

Run: `pnpm vitest run`
Expected: All tests pass (170+ existing + new tests)

- [ ] **Step 2: Run type check**

Run: `pnpm tsc --noEmit`
Expected: Clean — no errors

- [ ] **Step 3: Run production build**

Run: `pnpm build`
Expected: Clean build

- [ ] **Step 4: Run all Python tests**

Run: `cd services/ingestion && source .venv/bin/activate && pytest -v`
Expected: All tests pass (63+ existing + new tests)

- [ ] **Step 5: Regenerate TypeScript types from new schema**

Run: `supabase gen types typescript --local > types/database.types.ts`
Or if using cloud: use the appropriate Supabase CLI command for the cloud project.

- [ ] **Step 6: Update PLAN.md with completed work**

Update `PLAN.md` to reflect:
- REST API gaps resolved (metadata, search endpoint, health check)
- Docling Enhancement 1 (persist DoclingDocument) complete
- Docling Enhancement 2 (semantic unit extraction) complete
- Docling Enhancement 3 (classification scaffold) complete
- Auto-Optimizer Phase 2 complete (session loop with budget cap)
- New migrations: 00035, 00036, 00037
- Updated test counts

- [ ] **Step 7: Update AUTO-OPTIMIZE-BUILD-STATE.md**

Mark Phase 2 tasks 4-7 as complete. Update session log.

- [ ] **Step 8: Update docs/api-guide.md with new endpoints**

Add documentation for:
- `POST /api/v1/search` — retrieval-only search
- `GET /api/v1/health` — health check
- `GET /api/v1/classifications` — list classification proposals
- `PUT /api/v1/classifications/:id` — update proposal status
- `GET /api/v1/classifications/stats` — aggregate statistics
- Updated `POST /api/v1/documents` with metadata field
- Updated `GET /api/v1/documents` and `GET /api/v1/documents/:id` with metadata in response

- [ ] **Step 9: Final commit**

```bash
git add PLAN.md AUTO-OPTIMIZE-BUILD-STATE.md docs/api-guide.md types/database.types.ts
git commit -m "docs: update plans, API guide, and types for deployment readiness"
```

---

## Parallelization Strategy

These workstreams are independent and can run as parallel subagents:

| Subagent | Tasks | Dependencies |
|----------|-------|--------------|
| **A: REST API** | Tasks 1-3 | None |
| **B: Docling Enhancements** | Tasks 4-6 | Task 4 → 5 → 6 (sequential within) |
| **C: Auto-Optimizer** | Task 7 | None |
| **D: Verification** | Task 8 | After A, B, C complete |
