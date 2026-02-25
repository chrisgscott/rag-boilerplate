# Semantic Caching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cache LLM responses for semantically similar queries using pgvector, reducing API costs by 60-90% on repeated/similar questions.

**Architecture:** A `response_cache` table stores query embeddings alongside their LLM responses. Before calling the LLM, we embed the query, check pgvector for a semantically similar cached response (cosine similarity >= 0.95), and return it via simulated streaming if found. An org-wide `cache_version` counter invalidates all cached entries when documents change.

**Tech Stack:** pgvector (HNSW index), Supabase RPC, TypeScript (lib/rag/cache.ts), Python (worker invalidation)

---

### Task 1: Database Migration — response_cache Table + cache_version Column

**Files:**
- Create: `supabase/migrations/00032_response_cache.sql`

**Context:** This is migration #32. Previous migration was 00031. The project uses `get_user_organizations()` for RLS (a SECURITY DEFINER function returning org UUIDs for the current user). The `organizations` table already exists and needs a new `cache_version` column. pgvector is already enabled (used by `document_chunks`).

**Step 1: Write the migration**

```sql
-- Add cache_version to organizations for org-wide cache invalidation
ALTER TABLE organizations ADD COLUMN cache_version INTEGER NOT NULL DEFAULT 1;

-- Response cache table
CREATE TABLE response_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cache_version INTEGER NOT NULL,
  query_text TEXT NOT NULL,
  query_embedding vector(1536) NOT NULL,
  response_text TEXT NOT NULL,
  sources JSONB NOT NULL DEFAULT '[]',
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW index for fast cosine similarity lookup
CREATE INDEX idx_response_cache_embedding
  ON response_cache USING hnsw (query_embedding vector_cosine_ops);

-- Composite index for org + version filtering (used by cache_lookup WHERE clause)
CREATE INDEX idx_response_cache_org_version
  ON response_cache (organization_id, cache_version);

-- RLS
ALTER TABLE response_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org isolation" ON response_cache
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));

-- Cache lookup RPC — finds the nearest cached response above similarity threshold
-- SECURITY INVOKER so RLS applies when called by dashboard (session auth)
-- Service role client (API routes) bypasses RLS automatically
CREATE FUNCTION cache_lookup(
  query_embedding vector(1536),
  org_id UUID,
  org_cache_version INTEGER,
  similarity_threshold FLOAT DEFAULT 0.95
)
RETURNS TABLE (
  id UUID,
  response_text TEXT,
  sources JSONB,
  model TEXT,
  similarity FLOAT
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    rc.id,
    rc.response_text,
    rc.sources,
    rc.model,
    1 - (rc.query_embedding <=> cache_lookup.query_embedding) AS similarity
  FROM public.response_cache rc
  WHERE rc.organization_id = org_id
    AND rc.cache_version = org_cache_version
    AND 1 - (rc.query_embedding <=> cache_lookup.query_embedding) >= similarity_threshold
  ORDER BY rc.query_embedding <=> cache_lookup.query_embedding
  LIMIT 1;
$$;
```

**Step 2: Apply migration to Supabase Cloud**

Use the `mcp__supabase-mcp-server__apply_migration` tool with:
- `project_id`: `xjzhiprdbzvmijvymkbn`
- `name`: `response_cache`
- `query`: (the SQL above)

**Step 3: Regenerate TypeScript types**

Run: `pnpm db:types`

This updates `types/database.types.ts` with the new `response_cache` table and `cache_lookup` RPC.

**Step 4: Commit**

```bash
git add supabase/migrations/00032_response_cache.sql types/database.types.ts
git commit -m "feat: add response_cache table + cache_lookup RPC for semantic caching"
```

---

### Task 2: Cache Module — lib/rag/cache.ts (TDD)

**Files:**
- Create: `lib/rag/cache.ts`
- Create: `tests/unit/cache.test.ts`

**Context:** This module provides `isCacheEnabled()`, `lookupCache()`, and `writeCache()`. It calls the `cache_lookup` RPC for reads and inserts into `response_cache` for writes. Follow the same Supabase mock pattern used in `tests/unit/search.test.ts` (vi.mock before imports, chainable mock helpers).

**Step 1: Write the failing tests**

Create `tests/unit/cache.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// --- Types ---

type CacheHit = {
  responseText: string;
  sources: unknown[];
  model: string;
  similarity: number;
};

// --- Test constants ---

const FAKE_EMBEDDING = Array(1536).fill(0.1);
const ORG_ID = "org-test-123";
const CACHE_VERSION = 3;

const CACHED_ROW = {
  id: "cache-entry-1",
  response_text: "The pet policy allows cats and dogs under 25 lbs.",
  sources: [{ documentId: "doc-1", documentName: "lease.md", chunkId: 1, chunkIndex: 0 }],
  model: "claude-sonnet-4-20250514",
  similarity: 0.97,
};

// --- Mock Supabase ---

function createMockSupabase(rpcData: any = null, rpcError: any = null) {
  const insertMock = vi.fn().mockResolvedValue({ error: null });
  const mock = {
    rpc: vi.fn().mockResolvedValue({ data: rpcData ? [rpcData] : [], error: rpcError }),
    from: vi.fn().mockReturnValue({
      insert: insertMock,
    }),
    _insertMock: insertMock,
  } as unknown as SupabaseClient & { _insertMock: ReturnType<typeof vi.fn> };
  return mock;
}

// --- Tests ---

describe("isCacheEnabled", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns false by default", async () => {
    delete process.env.SEMANTIC_CACHE_ENABLED;
    const { isCacheEnabled } = await import("@/lib/rag/cache");
    expect(isCacheEnabled()).toBe(false);
  });

  it("returns true when SEMANTIC_CACHE_ENABLED=true", async () => {
    process.env.SEMANTIC_CACHE_ENABLED = "true";
    const { isCacheEnabled } = await import("@/lib/rag/cache");
    expect(isCacheEnabled()).toBe(true);
  });
});

describe("getCacheSimilarityThreshold", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns 0.95 by default", async () => {
    delete process.env.CACHE_SIMILARITY_THRESHOLD;
    const { getCacheSimilarityThreshold } = await import("@/lib/rag/cache");
    expect(getCacheSimilarityThreshold()).toBe(0.95);
  });

  it("reads from env var", async () => {
    process.env.CACHE_SIMILARITY_THRESHOLD = "0.90";
    const { getCacheSimilarityThreshold } = await import("@/lib/rag/cache");
    expect(getCacheSimilarityThreshold()).toBe(0.9);
  });
});

describe("lookupCache", () => {
  it("returns null on cache miss (no rows)", async () => {
    const supabase = createMockSupabase(null);
    const { lookupCache } = await import("@/lib/rag/cache");

    const result = await lookupCache(supabase, FAKE_EMBEDDING, ORG_ID, CACHE_VERSION);
    expect(result).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledWith("cache_lookup", {
      query_embedding: FAKE_EMBEDDING,
      org_id: ORG_ID,
      org_cache_version: CACHE_VERSION,
      similarity_threshold: 0.95,
    });
  });

  it("returns cached response on hit", async () => {
    const supabase = createMockSupabase(CACHED_ROW);
    const { lookupCache } = await import("@/lib/rag/cache");

    const result = await lookupCache(supabase, FAKE_EMBEDDING, ORG_ID, CACHE_VERSION);
    expect(result).not.toBeNull();
    expect(result!.responseText).toBe(CACHED_ROW.response_text);
    expect(result!.sources).toEqual(CACHED_ROW.sources);
    expect(result!.model).toBe(CACHED_ROW.model);
    expect(result!.similarity).toBe(0.97);
  });

  it("returns null on RPC error (graceful degradation)", async () => {
    const supabase = createMockSupabase(null, { message: "DB error" });
    const { lookupCache } = await import("@/lib/rag/cache");

    const result = await lookupCache(supabase, FAKE_EMBEDDING, ORG_ID, CACHE_VERSION);
    expect(result).toBeNull();
  });
});

describe("writeCache", () => {
  it("inserts a row into response_cache", async () => {
    const supabase = createMockSupabase();
    const { writeCache } = await import("@/lib/rag/cache");

    await writeCache(supabase, FAKE_EMBEDDING, "What is the pet policy?", ORG_ID, CACHE_VERSION, "Cats and dogs allowed.", [{ docId: "1" }], "claude-sonnet-4-20250514");

    expect(supabase.from).toHaveBeenCalledWith("response_cache");
    expect(supabase._insertMock).toHaveBeenCalledWith({
      organization_id: ORG_ID,
      cache_version: CACHE_VERSION,
      query_text: "What is the pet policy?",
      query_embedding: FAKE_EMBEDDING,
      response_text: "Cats and dogs allowed.",
      sources: [{ docId: "1" }],
      model: "claude-sonnet-4-20250514",
    });
  });

  it("does not throw on insert error (fire-and-forget)", async () => {
    const supabase = createMockSupabase();
    supabase._insertMock.mockRejectedValue(new Error("insert failed"));
    const { writeCache } = await import("@/lib/rag/cache");

    // Should not throw
    await writeCache(supabase, FAKE_EMBEDDING, "q", ORG_ID, CACHE_VERSION, "a", [], "model");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/cache.test.ts`
Expected: FAIL — `@/lib/rag/cache` does not exist

**Step 3: Write minimal implementation**

Create `lib/rag/cache.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

// --- Types ---

export type CacheHit = {
  responseText: string;
  sources: unknown[];
  model: string;
  similarity: number;
};

// --- Config ---

export function isCacheEnabled(): boolean {
  return process.env.SEMANTIC_CACHE_ENABLED === "true";
}

export function getCacheSimilarityThreshold(): number {
  return parseFloat(process.env.CACHE_SIMILARITY_THRESHOLD ?? "0.95");
}

// --- Lookup ---

export async function lookupCache(
  supabase: SupabaseClient,
  embedding: number[],
  organizationId: string,
  cacheVersion: number
): Promise<CacheHit | null> {
  try {
    const { data, error } = await supabase.rpc("cache_lookup", {
      query_embedding: embedding,
      org_id: organizationId,
      org_cache_version: cacheVersion,
      similarity_threshold: getCacheSimilarityThreshold(),
    });

    if (error || !data?.length) return null;

    const row = data[0];
    return {
      responseText: row.response_text,
      sources: row.sources,
      model: row.model,
      similarity: row.similarity,
    };
  } catch {
    // Graceful degradation — cache failure should never break chat
    return null;
  }
}

// --- Write ---

export async function writeCache(
  supabase: SupabaseClient,
  embedding: number[],
  queryText: string,
  organizationId: string,
  cacheVersion: number,
  responseText: string,
  sources: unknown[],
  model: string
): Promise<void> {
  try {
    await supabase.from("response_cache").insert({
      organization_id: organizationId,
      cache_version: cacheVersion,
      query_text: queryText,
      query_embedding: embedding,
      response_text: responseText,
      sources,
      model,
    });
  } catch {
    // Fire-and-forget — cache write failure is not critical
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/cache.test.ts`
Expected: ALL PASS (8 tests)

**Step 5: Commit**

```bash
git add lib/rag/cache.ts tests/unit/cache.test.ts
git commit -m "feat: add semantic cache module with lookup, write, and config"
```

---

### Task 3: Pre-computed Embedding Support in hybridSearch

**Files:**
- Modify: `lib/rag/search.ts`
- Modify: `tests/unit/search.test.ts`

**Context:** Currently `hybridSearch()` always calls `embedQuery()` internally. When semantic caching is enabled, the chat route embeds the query upfront for the cache lookup. If the cache misses, we pass that same embedding to `hybridSearch()` to avoid a redundant OpenAI API call. Add an optional `precomputedEmbedding` field to `SearchParams`.

**Step 1: Add a test for pre-computed embedding**

Add to `tests/unit/search.test.ts`, inside the existing `describe("hybridSearch")` block:

```typescript
it("uses precomputedEmbedding when provided (skips embedQuery)", async () => {
  const precomputed = Array(1536).fill(0.5);
  const supabase = createMockSupabase([SAMPLE_RPC_ROW]);

  const response = await hybridSearch(supabase, {
    query: "test query",
    organizationId: ORG_ID,
    precomputedEmbedding: { embedding: precomputed, tokenCount: 7 },
  });

  // embedQuery should NOT be called when precomputedEmbedding is provided
  expect(mockEmbedQuery).not.toHaveBeenCalled();
  // The RPC should receive the pre-computed embedding
  expect(supabase.rpc).toHaveBeenCalledWith(
    "hybrid_search",
    expect.objectContaining({ query_embedding: precomputed })
  );
  expect(response.queryTokenCount).toBe(7);
  expect(response.results).toHaveLength(1);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/search.test.ts`
Expected: FAIL — `precomputedEmbedding` is not a valid property on `SearchParams`

**Step 3: Modify search.ts**

In `lib/rag/search.ts`, add `precomputedEmbedding` to `SearchParams`:

```typescript
export type SearchParams = {
  query: string;
  organizationId: string;
  matchCount?: number;
  fullTextWeight?: number;
  semanticWeight?: number;
  precomputedEmbedding?: { embedding: number[]; tokenCount: number };
  filters?: {
    documentIds?: string[];
    mimeTypes?: string[];
    dateFrom?: string;
    dateTo?: string;
  };
};
```

Then modify the embedding step in `hybridSearch()`. Replace:

```typescript
  // 1. Embed the query
  const { embedding, tokenCount } = await embedQuery(params.query);
```

With:

```typescript
  // 1. Embed the query (skip if pre-computed embedding provided)
  const { embedding, tokenCount } = params.precomputedEmbedding
    ? { embedding: params.precomputedEmbedding.embedding, tokenCount: params.precomputedEmbedding.tokenCount }
    : await embedQuery(params.query);
```

**Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/search.test.ts`
Expected: ALL PASS (existing tests + new test)

**Step 5: Commit**

```bash
git add lib/rag/search.ts tests/unit/search.test.ts
git commit -m "feat: support pre-computed embedding in hybridSearch to avoid double-embed"
```

---

### Task 4: Dashboard Chat Route — Cache Integration

**Files:**
- Modify: `app/api/chat/route.ts`

**Context:** This is the dashboard chat endpoint (session auth via `createClient()`). Currently it goes: parse → auth → org → conversation → save user msg → hybridSearch → threshold → build prompt → streamText. We insert a cache check after embedding but before hybridSearch. On cache hit, we return a simulated streaming response. On cache miss, we pass the pre-computed embedding to hybridSearch and write the result to cache in `onFinish`.

The org's `cache_version` is fetched alongside the existing `system_prompt` query (same table, one extra column). The query embedding is computed upfront using `embedQuery()` from `lib/rag/embedder`.

**Step 1: Modify the route**

In `app/api/chat/route.ts`, add these imports at the top:

```typescript
import { embedQuery } from "@/lib/rag/embedder";
import { isCacheEnabled, lookupCache, writeCache, getCacheSimilarityThreshold } from "@/lib/rag/cache";
```

Modify the org query (around line 53) to also fetch `cache_version`:

Change:
```typescript
  const { data: org } = await supabase
    .from("organizations")
    .select("system_prompt")
    .eq("id", organizationId)
    .single();

  const orgSystemPrompt = org?.system_prompt ?? null;
```

To:
```typescript
  const { data: org } = await supabase
    .from("organizations")
    .select("system_prompt, cache_version")
    .eq("id", organizationId)
    .single();

  const orgSystemPrompt = org?.system_prompt ?? null;
  const cacheVersion = org?.cache_version ?? 1;
```

After saving the user message (after line 114, `const userMessageId = userMsg?.id ?? null;`), add the cache check block:

```typescript
  // 6b. Semantic cache check (before search + LLM)
  const cacheEnabled = isCacheEnabled();
  let queryEmbedding: { embedding: number[]; tokenCount: number } | null = null;

  if (cacheEnabled) {
    queryEmbedding = await embedQuery(latestMessage.content);

    const cached = await lookupCache(supabase, queryEmbedding.embedding, organizationId, cacheVersion);

    if (cached) {
      // Save cached response as assistant message
      await supabase.from("messages").insert({
        conversation_id: conversationId,
        parent_message_id: userMessageId,
        role: "assistant",
        content: cached.responseText,
        parts: [{ type: "text", text: cached.responseText }],
        sources: cached.sources,
        model: cached.model,
      });

      // Track usage with zero LLM cost
      void Promise.resolve(
        trackUsage(supabase, {
          organizationId,
          userId: user.id,
          queryText: latestMessage.content,
          embeddingTokens: queryEmbedding.tokenCount,
          llmInputTokens: 0,
          llmOutputTokens: 0,
          model: cached.model,
          chunksRetrieved: 0,
        })
      ).catch(() => {});

      // Return cached response via simulated streaming
      const refusalStream = createUIMessageStream({
        execute: ({ writer }) => {
          writer.write({ type: "text-start", id: "cached" });
          writer.write({
            type: "text-delta",
            id: "cached",
            delta: cached.responseText,
          });
          writer.write({ type: "finish-step" });
          writer.write({ type: "finish", finishReason: "stop" });
        },
      });

      const sourcesHeader = JSON.stringify(
        (cached.sources as any[]).map((s: any) => ({
          documentId: s.documentId,
          documentName: s.documentName,
          chunkId: s.chunkId,
          chunkIndex: s.chunkIndex,
          ...(s.pageImagePaths ? { pageImagePaths: s.pageImagePaths } : {}),
        }))
      );

      return createUIMessageStreamResponse({
        stream: refusalStream,
        headers: {
          "x-conversation-id": conversationId,
          "x-sources": sourcesHeader,
          "x-cache-status": "hit",
        },
      });
    }
  }
```

Modify the hybridSearch call (around line 117) to pass the pre-computed embedding:

Change:
```typescript
  const searchResponse = await hybridSearch(supabase, {
    query: latestMessage.content,
    organizationId,
  });
```

To:
```typescript
  const searchResponse = await hybridSearch(supabase, {
    query: latestMessage.content,
    organizationId,
    ...(queryEmbedding ? { precomputedEmbedding: queryEmbedding } : {}),
  });
```

Inside the `onFinish` callback of `streamText` (around line 180), after the existing usage tracking, add the cache write:

```typescript
        // Write to cache (fire-and-forget)
        if (cacheEnabled && queryEmbedding) {
          void Promise.resolve(
            writeCache(
              supabase,
              queryEmbedding.embedding,
              latestMessage.content,
              organizationId,
              cacheVersion,
              text,
              relevantResults.map((r) => {
                const meta = r.metadata as Record<string, unknown> | null;
                const pip = meta?.page_image_paths as Record<string, string> | undefined;
                return {
                  documentId: r.documentId,
                  documentName: r.documentName,
                  chunkId: r.chunkId,
                  chunkIndex: r.chunkIndex,
                  content: r.content,
                  similarity: r.similarity,
                  rrfScore: r.rrfScore,
                  ...(pip ? { pageImagePaths: pip } : {}),
                };
              }),
              modelId
            )
          ).catch(() => {});
        }
```

Add cache status headers to the response. In the `return result.toUIMessageStreamResponse({...})` call at the end, add the header:

```typescript
  return result.toUIMessageStreamResponse({
    headers: {
      "x-conversation-id": conversationId,
      "x-sources": sourcesHeader,
      ...(cacheEnabled ? { "x-cache-status": "miss" } : {}),
    },
  });
```

**Step 2: Run the build to verify no type errors**

Run: `pnpm tsc --noEmit`
Expected: No errors

**Step 3: Run all tests to verify nothing broke**

Run: `pnpm vitest run`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat: integrate semantic cache into dashboard chat route"
```

---

### Task 5: API Chat Route — Cache Integration

**Files:**
- Modify: `app/api/v1/chat/route.ts`

**Context:** Same cache pattern as the dashboard route but this file handles three response formats: non-streaming JSON, AI SDK stream, and SSE stream. The API uses `createAdminClient()` (service role — bypasses RLS). Cache hit must return the right format based on `shouldStream` and `useAiSdkFormat`.

**Step 1: Modify the route**

In `app/api/v1/chat/route.ts`, add imports:

```typescript
import { embedQuery } from "@/lib/rag/embedder";
import { isCacheEnabled, lookupCache, writeCache } from "@/lib/rag/cache";
```

Modify the org query (around line 53) to also fetch `cache_version`:

Change:
```typescript
  const { data: org } = await admin
    .from("organizations")
    .select("system_prompt")
    .eq("id", organizationId)
    .single();

  const orgSystemPrompt = org?.system_prompt ?? null;
```

To:
```typescript
  const { data: org } = await admin
    .from("organizations")
    .select("system_prompt, cache_version")
    .eq("id", organizationId)
    .single();

  const orgSystemPrompt = org?.system_prompt ?? null;
  const cacheVersion = org?.cache_version ?? 1;
```

After saving the user message (after line 120, `const userMessageId = userMsg?.id ?? null;`), add the cache check:

```typescript
  // 6b. Semantic cache check
  const cacheEnabled = isCacheEnabled();
  let queryEmbedding: { embedding: number[]; tokenCount: number } | null = null;

  if (cacheEnabled) {
    queryEmbedding = await embedQuery(latestMessage.content);

    const cached = await lookupCache(admin, queryEmbedding.embedding, organizationId, cacheVersion);

    if (cached) {
      // Save cached response as assistant message
      await admin.from("messages").insert({
        conversation_id: conversationId,
        parent_message_id: userMessageId,
        role: "assistant",
        content: cached.responseText,
        sources: cached.sources,
        model: cached.model,
      });

      // Track usage with zero LLM cost
      trackUsage(admin, {
        organizationId,
        userId: null,
        queryText: latestMessage.content,
        embeddingTokens: queryEmbedding.tokenCount,
        llmInputTokens: 0,
        llmOutputTokens: 0,
        model: cached.model,
        chunksRetrieved: 0,
      }).catch(() => {});

      const cachedSources = (cached.sources as any[]).map((s: any) => ({
        documentId: s.documentId,
        documentName: s.documentName,
        chunkId: s.chunkId,
        chunkIndex: s.chunkIndex,
        content: s.content,
        similarity: s.similarity,
      }));

      // Non-streaming JSON response
      if (!shouldStream) {
        return apiSuccess({
          conversationId,
          message: cached.responseText,
          sources: cachedSources,
          cached: true,
        });
      }

      // AI SDK format
      if (useAiSdkFormat) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`0:${JSON.stringify(cached.responseText)}\n`));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/x-vercel-ai-data-stream",
            "x-conversation-id": conversationId!,
            "x-sources": JSON.stringify(cachedSources.map(({ content: _c, ...rest }) => rest)),
            "x-cache-status": "hit",
          },
        });
      }

      // SSE format (default)
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `event: text-delta\ndata: ${JSON.stringify({ content: cached.responseText })}\n\n`
            )
          );
          controller.enqueue(
            encoder.encode(`event: sources\ndata: ${JSON.stringify(cachedSources)}\n\n`)
          );
          controller.enqueue(
            encoder.encode(
              `event: done\ndata: ${JSON.stringify({ conversationId, cached: true })}\n\n`
            )
          );
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "x-cache-status": "hit",
        },
      });
    }
  }
```

Modify the hybridSearch call (around line 123) to pass pre-computed embedding:

Change:
```typescript
  const searchResponse = await hybridSearch(admin, {
    query: latestMessage.content,
    organizationId,
  });
```

To:
```typescript
  const searchResponse = await hybridSearch(admin, {
    query: latestMessage.content,
    organizationId,
    ...(queryEmbedding ? { precomputedEmbedding: queryEmbedding } : {}),
  });
```

In each of the three `onFinish` callbacks (non-streaming at ~line 260, AI SDK at ~line 300, SSE at ~line 340), add the cache write after usage tracking:

```typescript
        if (cacheEnabled && queryEmbedding) {
          void Promise.resolve(
            writeCache(admin, queryEmbedding.embedding, latestMessage.content, organizationId, cacheVersion, text, sources, modelId)
          ).catch(() => {});
        }
```

Add `x-cache-status: miss` header to all three response paths when caching is enabled.

**Step 2: Run the build**

Run: `pnpm tsc --noEmit`
Expected: No errors

**Step 3: Run all tests**

Run: `pnpm vitest run`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add app/api/v1/chat/route.ts
git commit -m "feat: integrate semantic cache into API chat route (SSE + AI SDK + JSON)"
```

---

### Task 6: Cache Invalidation — Python Worker

**Files:**
- Modify: `services/ingestion/src/worker.py`

**Context:** After successful ingestion (when `update_document_status(document_id, "complete", ...)` is called), bump the org's `cache_version`. The worker already has a `_get_supabase()` helper that creates a Supabase client with the service role key. Use it to update the organizations table.

**Step 1: Add a test**

Create or add to `services/ingestion/tests/test_worker.py`. If there's an existing test file, add to it. Otherwise create a focused test:

```python
# In tests/test_cache_invalidation.py
from unittest.mock import MagicMock, patch

def test_bump_cache_version_called_on_success():
    """After successful ingestion, cache_version should be bumped."""
    from src.worker import bump_cache_version

    mock_supabase = MagicMock()
    mock_table = MagicMock()
    mock_update = MagicMock()
    mock_eq = MagicMock()

    mock_supabase.table.return_value = mock_table
    mock_table.update.return_value = mock_update
    mock_update.eq.return_value = mock_eq
    mock_eq.execute.return_value = None

    bump_cache_version("org-123", mock_supabase)

    mock_supabase.table.assert_called_once_with("organizations")
    # The update call should use raw SQL-style increment
    # Since Supabase Python client doesn't support atomic increment,
    # we use the direct DB connection for this
```

Actually, the Supabase Python SDK doesn't support `SET col = col + 1` atomically. The worker already has `_get_db_connection()` (psycopg2 direct connection). Use that instead:

```python
def test_bump_cache_version():
    """bump_cache_version increments the org's cache_version by 1."""
    from src.worker import bump_cache_version
    from unittest.mock import MagicMock, patch

    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value.__enter__ = lambda s: mock_cursor
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

    with patch("src.worker._get_db_connection", return_value=mock_conn):
        bump_cache_version("org-123")

    mock_cursor.execute.assert_called_once_with(
        "UPDATE organizations SET cache_version = cache_version + 1 WHERE id = %s",
        ("org-123",),
    )
    mock_conn.commit.assert_called_once()
    mock_conn.close.assert_called_once()
```

**Step 2: Run test to verify it fails**

Run: `cd services/ingestion && source .venv/bin/activate && pytest tests/test_cache_invalidation.py -v`
Expected: FAIL — `bump_cache_version` not found

**Step 3: Add bump_cache_version to worker.py**

Add this function to `services/ingestion/src/worker.py`:

```python
def bump_cache_version(organization_id: str, conn=None):
    """Increment the org's cache_version to invalidate semantic cache."""
    should_close = conn is None
    if conn is None:
        conn = _get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE organizations SET cache_version = cache_version + 1 WHERE id = %s",
                (organization_id,),
            )
        conn.commit()
    finally:
        if should_close:
            conn.close()
```

Then call it in `process_message()`, right after the successful `update_document_status(..., "complete", ...)` call (around line 158):

```python
            update_document_status(
                document_id,
                "complete",
                error_message=None,
                chunk_count=len(chunks),
                parsed_content=parse_result.text,
            )

            # Invalidate semantic cache for this org
            bump_cache_version(organization_id)

            logger.info(...)
```

**Step 4: Run test to verify it passes**

Run: `cd services/ingestion && source .venv/bin/activate && pytest tests/test_cache_invalidation.py -v`
Expected: PASS

**Step 5: Run all Python tests**

Run: `cd services/ingestion && pytest -v`
Expected: ALL PASS (46 + 1 new = 47)

**Step 6: Commit**

```bash
git add services/ingestion/src/worker.py services/ingestion/tests/test_cache_invalidation.py
git commit -m "feat: bump cache_version on successful ingestion (cache invalidation)"
```

---

### Task 7: Cache Invalidation — Document Deletion

**Files:**
- Modify: `app/(dashboard)/documents/actions.ts`
- Modify: `app/api/v1/documents/[id]/route.ts`

**Context:** When a document is deleted via the dashboard or API, we bump `cache_version` the same way we do after ingestion. The dashboard uses the user's RLS-scoped client; the API uses the admin client. Both can do the update since the org's `UPDATE` RLS policy allows org members to modify their org.

**Step 1: Modify dashboard deletion**

In `app/(dashboard)/documents/actions.ts`, in the `deleteDocument` function, after the successful DB delete and before `revalidatePath`, add:

```typescript
  // Invalidate semantic cache for this org
  await supabase
    .from("organizations")
    .update({ cache_version: org.cache_version + 1 })
    .eq("id", organizationId);
```

Wait — the dashboard deletion function doesn't currently have access to `organizationId` or `cache_version`. Look at the function: it uses `getCurrentOrg()` which gives us `supabase`. We need to also get the org ID. Check what `getCurrentOrg()` returns.

Actually, looking at the existing code pattern: `const { supabase } = await getCurrentOrg();`. We need to fetch the org's cache_version first. The simplest approach: use a raw RPC or do a select + update.

Simpler: just use atomic SQL via RPC. But we don't have an RPC for this. Even simpler: since the dashboard has the user's supabase client, we can increment with a two-step read-then-write. But that's not atomic.

**Best approach:** Add a small SQL function `bump_cache_version(org_id UUID)` to the migration, then call it from both TypeScript and Python. Actually, let's keep it simple — the race condition window is tiny and the worst case is just incrementing by 2 instead of 1 (still correct). Use a select-then-update pattern.

In the `deleteDocument` function, we need the org ID. We can get it from the document itself:

After the document fetch (which gets `storage_path, status`), also fetch `organization_id`:

Change:
```typescript
  const { data: doc } = await supabase
    .from("documents")
    .select("storage_path, status")
    .eq("id", documentId)
    .single();
```

To:
```typescript
  const { data: doc } = await supabase
    .from("documents")
    .select("storage_path, status, organization_id")
    .eq("id", documentId)
    .single();
```

After the successful delete, before `revalidatePath`:

```typescript
  // Invalidate semantic cache — increment cache_version atomically via RPC
  // Using raw SQL increment is safest, but Supabase JS client doesn't support it.
  // A simple update is sufficient — race conditions just double-bump (still correct).
  const { data: currentOrg } = await supabase
    .from("organizations")
    .select("cache_version")
    .eq("id", doc.organization_id)
    .single();

  if (currentOrg) {
    await supabase
      .from("organizations")
      .update({ cache_version: (currentOrg.cache_version ?? 1) + 1 })
      .eq("id", doc.organization_id);
  }
```

**Step 2: Modify API deletion**

In `app/api/v1/documents/[id]/route.ts`, in the `DELETE` handler, after the successful delete (after `const { error } = await admin.from("documents").delete().eq("id", id);`) and before the success return:

```typescript
  // Invalidate semantic cache
  const { data: currentOrg } = await admin
    .from("organizations")
    .select("cache_version")
    .eq("id", organizationId)
    .single();

  if (currentOrg) {
    await admin
      .from("organizations")
      .update({ cache_version: (currentOrg.cache_version ?? 1) + 1 })
      .eq("id", organizationId);
  }
```

**Step 3: Run build**

Run: `pnpm tsc --noEmit`
Expected: No errors

**Step 4: Run all tests**

Run: `pnpm vitest run`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add app/(dashboard)/documents/actions.ts app/api/v1/documents/[id]/route.ts
git commit -m "feat: invalidate semantic cache on document deletion"
```

---

### Task 8: Update .env.example + Docs

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `services/ingestion/.env.example`

**Step 1: Add env vars to .env.example**

Add to `.env.example` after the `SIMILARITY_THRESHOLD` line:

```bash
# SEMANTIC CACHE (optional — reduces LLM costs 60-90% on repeated queries)
SEMANTIC_CACHE_ENABLED=false         # Set to "true" to enable
CACHE_SIMILARITY_THRESHOLD=0.95      # Min similarity for cache hit (default 0.95)
```

**Step 2: Update README.md env vars table**

In the Next.js env vars table in README.md, add two rows after `VLM_ENABLED`:

```markdown
| `SEMANTIC_CACHE_ENABLED` | No | Set `true` to cache LLM responses for similar queries (60-90% cost reduction) |
| `CACHE_SIMILARITY_THRESHOLD` | No | Minimum similarity for cache hit (default `0.95`) |
```

In the "Configuration (no code changes)" section of "Building On Top of This", add a bullet:

```markdown
- **Semantic caching** — Set `SEMANTIC_CACHE_ENABLED=true` to cache LLM responses. Repeated or similar questions return cached answers instantly, reducing API costs by 60-90%. Cache auto-invalidates when documents change. Tune sensitivity with `CACHE_SIMILARITY_THRESHOLD` (default 0.95).
```

**Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: add semantic caching env vars and README documentation"
```

---

### Task 9: Build Verification + Full Test Run

**Files:** None (verification only)

**Step 1: Run all TypeScript tests**

Run: `pnpm vitest run`
Expected: ALL PASS (120 existing + 8 new cache tests = ~128)

**Step 2: Run Python tests**

Run: `cd services/ingestion && source .venv/bin/activate && pytest -v`
Expected: ALL PASS (46 existing + 1 new = 47)

**Step 3: Run full build**

Run: `pnpm build`
Expected: Clean build, no errors

**Step 4: Run type check**

Run: `pnpm tsc --noEmit`
Expected: No errors

**Step 5: Commit any fixes if needed, then final commit message**

If all passes with no fixes needed, no commit required. If fixes were needed, commit them:

```bash
git commit -m "fix: address build/test issues from semantic caching integration"
```
