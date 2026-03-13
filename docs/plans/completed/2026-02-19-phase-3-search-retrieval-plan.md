# Phase 3: Search & Retrieval Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the hybrid search RPC (vector + BM25 + RRF), TypeScript search orchestration module, and document access logging.

**Architecture:** A Postgres RPC function (`hybrid_search`) handles vector similarity + BM25 full-text search, merged via Reciprocal Rank Fusion. A TypeScript module (`lib/rag/search.ts`) orchestrates: embed query → resolve filters → call RPC → log access → return results. All org-scoping handled by RLS (SECURITY INVOKER).

**Tech Stack:** Supabase Postgres (pgvector HNSW, tsvector BM25), OpenAI text-embedding-3-small, TypeScript, Vitest

**Design Doc:** `docs/plans/2026-02-19-phase-3-search-retrieval-design.md`

---

### Task 1: Database Migrations

**Files:**
- Create: `supabase/migrations/00010_hybrid_search.sql`
- Create: `supabase/migrations/00011_document_access_logs.sql`

**Step 1: Write the hybrid_search RPC migration**

Create `supabase/migrations/00010_hybrid_search.sql`:

```sql
-- Phase 3: Hybrid search RPC function
-- Combines vector similarity (pgvector HNSW) and BM25 full-text search
-- Results merged via Reciprocal Rank Fusion (RRF)
-- SECURITY INVOKER (default): RLS applies automatically

CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_text text,
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  full_text_weight float DEFAULT 1.0,
  semantic_weight float DEFAULT 1.0,
  rrf_k int DEFAULT 60,
  filter_document_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  chunk_id bigint,
  document_id uuid,
  content text,
  metadata jsonb,
  similarity float,
  fts_rank float,
  rrf_score float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH semantic AS (
    SELECT
      dc.id,
      dc.document_id,
      dc.content,
      dc.metadata,
      1 - (dc.embedding <=> query_embedding) AS similarity,
      ROW_NUMBER() OVER (ORDER BY dc.embedding <=> query_embedding) AS rank_ix
    FROM public.document_chunks dc
    WHERE dc.embedding IS NOT NULL
      AND (filter_document_ids IS NULL OR dc.document_id = ANY(filter_document_ids))
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count * 2
  ),
  full_text AS (
    SELECT
      dc.id,
      dc.document_id,
      dc.content,
      dc.metadata,
      ts_rank_cd(dc.fts, websearch_to_tsquery('english', query_text)) AS fts_rank,
      ROW_NUMBER() OVER (ORDER BY ts_rank_cd(dc.fts, websearch_to_tsquery('english', query_text)) DESC) AS rank_ix
    FROM public.document_chunks dc
    WHERE dc.fts @@ websearch_to_tsquery('english', query_text)
      AND (filter_document_ids IS NULL OR dc.document_id = ANY(filter_document_ids))
    ORDER BY fts_rank DESC
    LIMIT match_count * 2
  )
  SELECT
    COALESCE(s.id, f.id) AS chunk_id,
    COALESCE(s.document_id, f.document_id) AS document_id,
    COALESCE(s.content, f.content) AS content,
    COALESCE(s.metadata, f.metadata) AS metadata,
    COALESCE(s.similarity, 0.0)::float AS similarity,
    COALESCE(f.fts_rank, 0.0)::float AS fts_rank,
    (
      COALESCE(semantic_weight / (rrf_k + s.rank_ix), 0.0) +
      COALESCE(full_text_weight / (rrf_k + f.rank_ix), 0.0)
    )::float AS rrf_score
  FROM semantic s
  FULL OUTER JOIN full_text f ON s.id = f.id
  ORDER BY rrf_score DESC
  LIMIT match_count;
END;
$$;
```

**Step 2: Apply the hybrid_search migration to Supabase Cloud**

Use `mcp__supabase-mcp-server__apply_migration` with:
- project_id: `xjzhiprdbzvmijvymkbn`
- name: `hybrid_search`
- SQL content from the file above

**Step 3: Write the document_access_logs migration**

Create `supabase/migrations/00011_document_access_logs.sql`:

```sql
-- Phase 3: Document access logging
-- Audit trail for search queries — one row per document accessed per query

CREATE TABLE public.document_access_logs (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  query_text text,
  chunks_returned integer,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX document_access_logs_org_idx
  ON public.document_access_logs(organization_id);
CREATE INDEX document_access_logs_created_idx
  ON public.document_access_logs(created_at);

ALTER TABLE public.document_access_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org access logs"
  ON public.document_access_logs FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can insert org access logs"
  ON public.document_access_logs FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.get_user_organizations()));
```

**Step 4: Apply the document_access_logs migration to Supabase Cloud**

Use `mcp__supabase-mcp-server__apply_migration` with:
- project_id: `xjzhiprdbzvmijvymkbn`
- name: `document_access_logs`
- SQL content from the file above

**Step 5: Commit**

```bash
git add supabase/migrations/00010_hybrid_search.sql supabase/migrations/00011_document_access_logs.sql
git commit -m "feat: add hybrid_search RPC + document_access_logs table (migrations 00010-00011)"
```

---

### Task 2: Search Module Scaffold + First Failing Test

**Files:**
- Create: `lib/rag/search.ts`
- Create: `tests/unit/search.test.ts`

**Reference:** Check `lib/rag/embedder.ts` for the `embedQuery` signature and `tests/unit/embedder.test.ts` for testing patterns.

**Step 1: Create the search module with types and a stub**

Create `lib/rag/search.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import { embedQuery } from "./embedder";

// --- Types ---

export type SearchParams = {
  query: string;
  organizationId: string;
  matchCount?: number;
  fullTextWeight?: number;
  semanticWeight?: number;
  filters?: {
    documentIds?: string[];
    mimeTypes?: string[];
    dateFrom?: string;
    dateTo?: string;
  };
};

export type SearchResult = {
  chunkId: number;
  documentId: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
  ftsRank: number;
  rrfScore: number;
};

export type SearchResponse = {
  results: SearchResult[];
  queryTokenCount: number;
};

// --- Implementation ---

export async function hybridSearch(
  supabase: SupabaseClient,
  params: SearchParams
): Promise<SearchResponse> {
  throw new Error("Not implemented");
}
```

**Step 2: Create the test file with helpers and first test**

Create `tests/unit/search.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Mock the embedder module (must be before importing search)
vi.mock("@/lib/rag/embedder", () => ({
  embedQuery: vi.fn(),
}));

import { embedQuery } from "@/lib/rag/embedder";
import { hybridSearch } from "@/lib/rag/search";

const mockEmbedQuery = embedQuery as Mock;

// --- Test constants ---

const FAKE_EMBEDDING = Array(1536).fill(0.1);
const ORG_ID = "org-test-123";

// Sample RPC response row (snake_case, matching Postgres RETURNS TABLE)
const SAMPLE_RPC_ROW = {
  chunk_id: 1,
  document_id: "doc-1",
  content: "Test chunk content about lease terms",
  metadata: { section: "introduction" },
  similarity: 0.95,
  fts_rank: 0.8,
  rrf_score: 0.032,
};

// --- Test helpers ---

/**
 * Create a chainable query builder mock.
 * Supports .select().in().gte().lte() chains.
 * Resolves with { data, error } when awaited.
 */
function chainMock(data: any[] = [], error: any = null) {
  const chain: any = {};
  ["select", "in", "gte", "lte", "eq"].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  // Make it thenable so `await` works
  chain.then = (resolve: Function) => resolve({ data, error });
  return chain;
}

/**
 * Create a mock Supabase client with configurable behavior.
 *
 * @param opts.rpcData - Data returned by .rpc('hybrid_search')
 * @param opts.rpcError - Error returned by .rpc('hybrid_search')
 * @param opts.documentsData - Data returned by .from('documents').select()...
 * @param opts.insertError - Whether .from('document_access_logs').insert() throws
 */
function mockSupabase(
  opts: {
    rpcData?: any[];
    rpcError?: any;
    documentsData?: any[];
    insertError?: boolean;
  } = {}
) {
  const insertMock = opts.insertError
    ? vi.fn().mockImplementation(() => {
        throw new Error("insert failed");
      })
    : vi.fn().mockImplementation(() => ({
        then: (resolve: Function) => resolve({ error: null }),
      }));

  const documentsChain = chainMock(opts.documentsData ?? []);

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === "document_access_logs") return { insert: insertMock };
    if (table === "documents") return documentsChain;
    return chainMock();
  });

  const rpcMock = vi.fn().mockResolvedValue({
    data: opts.rpcData ?? [],
    error: opts.rpcError ?? null,
  });

  return {
    client: { rpc: rpcMock, from: fromMock } as unknown as SupabaseClient,
    rpcMock,
    fromMock,
    insertMock,
    documentsChain,
  };
}

// --- Tests ---

describe("hybridSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbedQuery.mockResolvedValue({
      embedding: FAKE_EMBEDDING,
      tokenCount: 5,
    });
  });

  it("embeds query, calls RPC, and returns mapped results", async () => {
    const { client, rpcMock } = mockSupabase({ rpcData: [SAMPLE_RPC_ROW] });

    const response = await hybridSearch(client, {
      query: "What are the lease terms?",
      organizationId: ORG_ID,
    });

    // Verify embedQuery called with the query text
    expect(mockEmbedQuery).toHaveBeenCalledWith("What are the lease terms?");

    // Verify RPC called with correct params
    expect(rpcMock).toHaveBeenCalledWith("hybrid_search", {
      query_text: "What are the lease terms?",
      query_embedding: FAKE_EMBEDDING,
      match_count: 5,
      full_text_weight: 1.0,
      semantic_weight: 1.0,
      filter_document_ids: null,
    });

    // Verify results mapped from snake_case to camelCase
    expect(response.results).toEqual([
      {
        chunkId: 1,
        documentId: "doc-1",
        content: "Test chunk content about lease terms",
        metadata: { section: "introduction" },
        similarity: 0.95,
        ftsRank: 0.8,
        rrfScore: 0.032,
      },
    ]);

    // Verify token count passed through from embedQuery
    expect(response.queryTokenCount).toBe(5);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/search.test.ts`
Expected: FAIL with "Not implemented"

**Step 4: Commit scaffold**

```bash
git add lib/rag/search.ts tests/unit/search.test.ts
git commit -m "feat: search module types + test scaffold (RED)"
```

---

### Task 3: Basic Search Implementation

**Files:**
- Modify: `lib/rag/search.ts`

**Step 1: Replace the stub with the full implementation**

Replace the entire contents of `lib/rag/search.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import { embedQuery } from "./embedder";

// --- Types ---

export type SearchParams = {
  query: string;
  organizationId: string;
  matchCount?: number;
  fullTextWeight?: number;
  semanticWeight?: number;
  filters?: {
    documentIds?: string[];
    mimeTypes?: string[];
    dateFrom?: string;
    dateTo?: string;
  };
};

export type SearchResult = {
  chunkId: number;
  documentId: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
  ftsRank: number;
  rrfScore: number;
};

export type SearchResponse = {
  results: SearchResult[];
  queryTokenCount: number;
};

// --- Implementation ---

export async function hybridSearch(
  supabase: SupabaseClient,
  params: SearchParams
): Promise<SearchResponse> {
  // 1. Embed the query
  const { embedding, tokenCount } = await embedQuery(params.query);

  // 2. Resolve filters to document IDs
  const filterDocumentIds = params.filters
    ? await resolveFilterDocumentIds(supabase, params.filters)
    : null;

  // 3. Call the hybrid search RPC
  const { data, error } = await supabase.rpc("hybrid_search", {
    query_text: params.query,
    query_embedding: embedding,
    match_count: params.matchCount ?? 5,
    full_text_weight: params.fullTextWeight ?? 1.0,
    semantic_weight: params.semanticWeight ?? 1.0,
    filter_document_ids: filterDocumentIds,
  });

  if (error) throw error;

  // 4. Map results from snake_case to camelCase
  const results: SearchResult[] = (data ?? []).map((row: any) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    content: row.content,
    metadata: row.metadata,
    similarity: row.similarity,
    ftsRank: row.fts_rank,
    rrfScore: row.rrf_score,
  }));

  // 5. Log document access (fire-and-forget)
  logDocumentAccess(
    supabase,
    results,
    params.query,
    params.organizationId
  ).catch(() => {});

  return { results, queryTokenCount: tokenCount };
}

/** Resolve high-level filters (mimeTypes, dates) to document IDs. */
async function resolveFilterDocumentIds(
  supabase: SupabaseClient,
  filters: NonNullable<SearchParams["filters"]>
): Promise<string[] | null> {
  const hasHighLevelFilters =
    filters.mimeTypes?.length || filters.dateFrom || filters.dateTo;

  if (!hasHighLevelFilters && !filters.documentIds?.length) {
    return null;
  }

  let resolvedIds: string[] | null = null;

  if (hasHighLevelFilters) {
    let query = supabase.from("documents").select("id");
    if (filters.mimeTypes?.length) {
      query = query.in("mime_type", filters.mimeTypes);
    }
    if (filters.dateFrom) {
      query = query.gte("created_at", filters.dateFrom);
    }
    if (filters.dateTo) {
      query = query.lte("created_at", filters.dateTo);
    }
    const { data, error } = await query;
    if (error) throw error;
    resolvedIds = (data ?? []).map((d: { id: string }) => d.id);
  }

  if (filters.documentIds?.length) {
    if (resolvedIds) {
      // Intersect explicit IDs with resolved IDs
      const resolvedSet = new Set(resolvedIds);
      resolvedIds = filters.documentIds.filter((id) => resolvedSet.has(id));
    } else {
      resolvedIds = [...filters.documentIds];
    }
  }

  return resolvedIds;
}

/** Log which documents were accessed by a search query. Fire-and-forget. */
async function logDocumentAccess(
  supabase: SupabaseClient,
  results: SearchResult[],
  queryText: string,
  organizationId: string
): Promise<void> {
  if (results.length === 0) return;

  // Group chunks by document
  const docChunks = new Map<string, number>();
  for (const result of results) {
    docChunks.set(
      result.documentId,
      (docChunks.get(result.documentId) ?? 0) + 1
    );
  }

  const rows = Array.from(docChunks.entries()).map(
    ([documentId, chunksReturned]) => ({
      organization_id: organizationId,
      document_id: documentId,
      query_text: queryText,
      chunks_returned: chunksReturned,
    })
  );

  await supabase.from("document_access_logs").insert(rows);
}
```

**Step 2: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/search.test.ts`
Expected: PASS (1 test)

**Step 3: Commit**

```bash
git add lib/rag/search.ts
git commit -m "feat: implement hybridSearch with filter resolution + access logging (GREEN)"
```

---

### Task 4: Empty Results + Custom Params + RPC Error Tests

**Files:**
- Modify: `tests/unit/search.test.ts`

**Step 1: Add three tests after the first `it()` block**

```typescript
  it("returns empty results when RPC finds no matches", async () => {
    const { client } = mockSupabase({ rpcData: [] });

    const response = await hybridSearch(client, {
      query: "obscure query with no matches",
      organizationId: ORG_ID,
    });

    expect(response.results).toEqual([]);
    expect(response.queryTokenCount).toBe(5);
  });

  it("passes custom matchCount and weights to RPC", async () => {
    const { client, rpcMock } = mockSupabase({ rpcData: [] });

    await hybridSearch(client, {
      query: "test",
      organizationId: ORG_ID,
      matchCount: 10,
      fullTextWeight: 0.5,
      semanticWeight: 2.0,
    });

    expect(rpcMock).toHaveBeenCalledWith("hybrid_search", {
      query_text: "test",
      query_embedding: FAKE_EMBEDDING,
      match_count: 10,
      full_text_weight: 0.5,
      semantic_weight: 2.0,
      filter_document_ids: null,
    });
  });

  it("throws when RPC returns an error", async () => {
    const rpcError = { message: "function not found", code: "42883" };
    const { client } = mockSupabase({ rpcError });

    await expect(
      hybridSearch(client, { query: "test", organizationId: ORG_ID })
    ).rejects.toEqual(rpcError);
  });
```

**Step 2: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/search.test.ts`
Expected: PASS (4 tests) — all three should pass with the existing implementation.

**Step 3: Commit**

```bash
git add tests/unit/search.test.ts
git commit -m "test: add empty results, custom params, and RPC error tests"
```

---

### Task 5: Document ID Filter Test

**Files:**
- Modify: `tests/unit/search.test.ts`

**Step 1: Add a test for direct document ID filtering**

```typescript
  it("passes document IDs filter directly to RPC", async () => {
    const docIds = ["doc-1", "doc-2"];
    const { client, rpcMock } = mockSupabase({ rpcData: [] });

    await hybridSearch(client, {
      query: "test",
      organizationId: ORG_ID,
      filters: { documentIds: docIds },
    });

    expect(rpcMock).toHaveBeenCalledWith(
      "hybrid_search",
      expect.objectContaining({
        filter_document_ids: docIds,
      })
    );
  });
```

**Step 2: Run tests to verify it passes**

Run: `pnpm vitest run tests/unit/search.test.ts`
Expected: PASS (5 tests)

**Step 3: Commit**

```bash
git add tests/unit/search.test.ts
git commit -m "test: add document ID filter passthrough test"
```

---

### Task 6: Mime Type Filter Test

**Files:**
- Modify: `tests/unit/search.test.ts`

**Step 1: Add a test for mime type filter resolution**

```typescript
  it("resolves mime type filter to document IDs before calling RPC", async () => {
    const { client, rpcMock, fromMock } = mockSupabase({
      rpcData: [],
      documentsData: [{ id: "doc-pdf-1" }, { id: "doc-pdf-2" }],
    });

    await hybridSearch(client, {
      query: "test",
      organizationId: ORG_ID,
      filters: { mimeTypes: ["application/pdf"] },
    });

    // Verify documents table was queried
    expect(fromMock).toHaveBeenCalledWith("documents");

    // Verify resolved IDs passed to RPC
    expect(rpcMock).toHaveBeenCalledWith(
      "hybrid_search",
      expect.objectContaining({
        filter_document_ids: ["doc-pdf-1", "doc-pdf-2"],
      })
    );
  });
```

**Step 2: Run tests to verify it passes**

Run: `pnpm vitest run tests/unit/search.test.ts`
Expected: PASS (6 tests)

**Step 3: Commit**

```bash
git add tests/unit/search.test.ts
git commit -m "test: add mime type filter resolution test"
```

---

### Task 7: Date Range + Combined Filter Tests

**Files:**
- Modify: `tests/unit/search.test.ts`

**Step 1: Add date range and combined filter tests**

```typescript
  it("resolves date range filter to document IDs", async () => {
    const { client, rpcMock, documentsChain } = mockSupabase({
      rpcData: [],
      documentsData: [{ id: "doc-recent" }],
    });

    await hybridSearch(client, {
      query: "test",
      organizationId: ORG_ID,
      filters: { dateFrom: "2026-01-01", dateTo: "2026-02-01" },
    });

    // Verify date filters were applied to the documents query
    expect(documentsChain.gte).toHaveBeenCalledWith(
      "created_at",
      "2026-01-01"
    );
    expect(documentsChain.lte).toHaveBeenCalledWith(
      "created_at",
      "2026-02-01"
    );

    // Verify resolved IDs passed to RPC
    expect(rpcMock).toHaveBeenCalledWith(
      "hybrid_search",
      expect.objectContaining({
        filter_document_ids: ["doc-recent"],
      })
    );
  });

  it("intersects mime type results with explicit document IDs", async () => {
    const { client, rpcMock } = mockSupabase({
      rpcData: [],
      // Mime type query returns doc-1, doc-2, doc-3
      documentsData: [{ id: "doc-1" }, { id: "doc-2" }, { id: "doc-3" }],
    });

    await hybridSearch(client, {
      query: "test",
      organizationId: ORG_ID,
      filters: {
        mimeTypes: ["application/pdf"],
        documentIds: ["doc-1", "doc-4"], // doc-4 not in mime type results
      },
    });

    // Only doc-1 is in both sets (intersection)
    expect(rpcMock).toHaveBeenCalledWith(
      "hybrid_search",
      expect.objectContaining({
        filter_document_ids: ["doc-1"],
      })
    );
  });
```

**Step 2: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/search.test.ts`
Expected: PASS (8 tests)

**Step 3: Commit**

```bash
git add tests/unit/search.test.ts
git commit -m "test: add date range and combined filter tests"
```

---

### Task 8: Access Logging Tests

**Files:**
- Modify: `tests/unit/search.test.ts`

**Step 1: Add access logging tests**

```typescript
  it("logs document access with one row per unique document", async () => {
    const multiDocData = [
      { ...SAMPLE_RPC_ROW, chunk_id: 1, document_id: "doc-1" },
      { ...SAMPLE_RPC_ROW, chunk_id: 2, document_id: "doc-1" },
      { ...SAMPLE_RPC_ROW, chunk_id: 3, document_id: "doc-2" },
    ];
    const { client, insertMock } = mockSupabase({ rpcData: multiDocData });

    await hybridSearch(client, {
      query: "lease terms",
      organizationId: ORG_ID,
    });

    // Wait for fire-and-forget to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(insertMock).toHaveBeenCalledWith([
      {
        organization_id: ORG_ID,
        document_id: "doc-1",
        query_text: "lease terms",
        chunks_returned: 2,
      },
      {
        organization_id: ORG_ID,
        document_id: "doc-2",
        query_text: "lease terms",
        chunks_returned: 1,
      },
    ]);
  });

  it("does not log access when there are no results", async () => {
    const { client, insertMock } = mockSupabase({ rpcData: [] });

    await hybridSearch(client, {
      query: "test",
      organizationId: ORG_ID,
    });

    // Wait for any async operations
    await new Promise((r) => setTimeout(r, 10));

    expect(insertMock).not.toHaveBeenCalled();
  });
```

**Step 2: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/search.test.ts`
Expected: PASS (10 tests)

**Step 3: Commit**

```bash
git add tests/unit/search.test.ts
git commit -m "test: add access logging tests"
```

---

### Task 9: Error Handling Tests

**Files:**
- Modify: `tests/unit/search.test.ts`

**Step 1: Add error handling tests**

```typescript
  it("does not fail search when access logging throws", async () => {
    const { client } = mockSupabase({
      rpcData: [SAMPLE_RPC_ROW],
      insertError: true,
    });

    // Should NOT throw despite insert error
    const response = await hybridSearch(client, {
      query: "test",
      organizationId: ORG_ID,
    });

    expect(response.results).toHaveLength(1);
  });

  it("throws when embedding fails", async () => {
    mockEmbedQuery.mockRejectedValue(new Error("OpenAI rate limited"));
    const { client, rpcMock } = mockSupabase();

    await expect(
      hybridSearch(client, { query: "test", organizationId: ORG_ID })
    ).rejects.toThrow("OpenAI rate limited");

    // RPC should NOT have been called
    expect(rpcMock).not.toHaveBeenCalled();
  });
```

**Step 2: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/search.test.ts`
Expected: PASS (12 tests)

**Step 3: Commit**

```bash
git add tests/unit/search.test.ts
git commit -m "test: add error handling tests (logging failure, embedding failure)"
```

---

### Task 10: Update Documentation

**Files:**
- Modify: `specs/ARCHITECTURE.md`
- Modify: `planning/PROJECT_PLAN.md`
- Modify: `PLAN.md`

**Step 1: Update ARCHITECTURE.md hosting references**

In `specs/ARCHITECTURE.md`, change all references from "Vercel" to "Render" for the Next.js frontend:
- System overview diagram: `Frontend (Vercel)` → `Frontend (Render)`
- 3-Service Architecture table: Hosting column `Vercel` → `Render`
- Technology Stack table: Frontend Hosting row `Vercel` → `Render`
- Remove/update any Vercel-specific notes (serverless timeouts, Edge functions, etc.)

**Step 2: Update PROJECT_PLAN.md Phase 3 task statuses**

Change Phase 3 tasks from `blocked` to `done`:
- 3.1: `hybrid_search` RPC → `done`
- 3.2: Search orchestration layer → `done`
- 3.3: Metadata filtering → `done`
- 3.4: Configurable top-k and similarity threshold → `done`
- 3.5: Document access logging → `done`
- 3.6: `document_access_logs` table + RLS → `done`

**Step 3: Update PLAN.md with current session state**

Update `PLAN.md` at project root:
- Phase 3 COMPLETE
- List new files created
- Update next steps to Phase 4

**Step 4: Regenerate database types**

Run: `pnpm db:types`
Verify: `types/database.types.ts` updated with `hybrid_search` function and `document_access_logs` table.

**Step 5: Run full test suite + build**

```bash
pnpm vitest run
cd services/ingestion && source .venv/bin/activate && pytest -v && cd ../..
pnpm build
```

Expected:
- TypeScript tests: 19 passing (7 embedder + 12 search)
- Python tests: 27 passing
- Build: clean

**Step 6: Commit**

```bash
git add specs/ARCHITECTURE.md planning/PROJECT_PLAN.md PLAN.md types/database.types.ts
git commit -m "docs: update architecture (Render hosting) + mark Phase 3 complete"
```

---

## Summary

| Task | What | Tests |
|------|------|-------|
| 1 | Migrations (hybrid_search RPC + document_access_logs) | — |
| 2 | Search module scaffold + first failing test | 1 (RED) |
| 3 | Full implementation (search + filters + logging) | 1 (GREEN) |
| 4 | Empty results + custom params + RPC error | +3 |
| 5 | Document ID filter passthrough | +1 |
| 6 | Mime type filter resolution | +1 |
| 7 | Date range + combined filter intersection | +2 |
| 8 | Access logging (per-document, skip empty) | +2 |
| 9 | Error handling (log failure, embedding failure) | +2 |
| 10 | Docs update + full verification | — |

**Total: 10 tasks, 12 new tests, 2 migrations, 1 new TypeScript module**
