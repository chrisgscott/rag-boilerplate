# Phase 3: Search & Retrieval — Design Document

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement the plan generated from this design.

**Goal:** Build the backend retrieval layer — hybrid search (vector + BM25 + RRF), metadata filtering, and document access logging.

**Architecture:** Single TypeScript function orchestrates: embed query → resolve filters → call Postgres RPC → log access → return results. All search logic lives in one RPC function with RLS enforcement via SECURITY INVOKER.

**Tech Stack:** Supabase Postgres (pgvector HNSW, tsvector BM25), OpenAI text-embedding-3-small, TypeScript/Vitest

---

## Key Decisions

1. **Hosting:** Next.js moves from Vercel to Render (alongside Python ingestion). Simplifies deployment — one platform for both services.
2. **Filter strategy:** `filter_document_ids uuid[]` param in the RPC. Higher-level filters (mime type, date range) resolved to document IDs in TypeScript before calling the RPC.
3. **Similarity threshold:** NOT enforced in the search layer. That belongs in Phase 4 (chat — "refuse to answer below 0.7") and Phase 5 (eval — needs all results for metrics).
4. **Access logging:** Fire-and-forget from TypeScript. One row per document per query. Failures swallowed (don't fail search over logging).
5. **Single function approach:** `hybridSearch(supabase, params)` composes existing pieces (embedQuery from embedder.ts, hybrid_search RPC, access log insert). Thin glue, not a framework.

---

## Database Layer

### Migration `00010_hybrid_search.sql`

Core retrieval RPC function:

```sql
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
-- No SECURITY DEFINER → defaults to INVOKER → RLS applies
```

**Implementation details:**
- Two CTEs: `semantic` (cosine distance via HNSW) and `full_text` (BM25 via tsvector/tsquery)
- Each CTE fetches `match_count * 2` candidates
- FULL OUTER JOIN + Reciprocal Rank Fusion merges results
- `websearch_to_tsquery('english', query_text)` for natural language query parsing
- `filter_document_ids`: `WHERE (filter_document_ids IS NULL OR dc.document_id = ANY(filter_document_ids))` applied in both CTEs
- RLS scopes to user's org automatically (SECURITY INVOKER)

### Migration `00011_document_access_logs.sql`

Audit trail table:

```sql
CREATE TABLE public.document_access_logs (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  query_text text,
  chunks_returned integer,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX document_access_logs_org_idx ON public.document_access_logs(organization_id);
CREATE INDEX document_access_logs_created_idx ON public.document_access_logs(created_at);

ALTER TABLE public.document_access_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org access logs"
  ON public.document_access_logs FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can insert org access logs"
  ON public.document_access_logs FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.get_user_organizations()));
```

- One row per document per query (search hitting 3 docs = 3 rows)
- RLS: org members can SELECT and INSERT

---

## TypeScript Layer

### `lib/rag/search.ts`

```typescript
// --- Types ---

export type SearchParams = {
  query: string;
  matchCount?: number;          // default 5
  fullTextWeight?: number;      // default 1.0
  semanticWeight?: number;      // default 1.0
  filters?: {
    documentIds?: string[];     // scope to specific docs
    mimeTypes?: string[];       // e.g., ["application/pdf"]
    dateFrom?: string;          // ISO date string
    dateTo?: string;            // ISO date string
  };
};

export type SearchResult = {
  chunkId: number;
  documentId: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;           // cosine similarity (0-1)
  ftsRank: number;              // BM25 rank
  rrfScore: number;             // fused score
};

export type SearchResponse = {
  results: SearchResult[];
  queryTokenCount: number;      // for cost tracking (Phase 5)
};

// --- Main function ---

export async function hybridSearch(
  supabase: SupabaseClient,
  params: SearchParams
): Promise<SearchResponse>
```

**Internal flow:**

1. `embedQuery(params.query)` — reuses existing embedder.ts
2. If `filters.mimeTypes` or `filters.dateFrom/dateTo` set → query `documents` table for matching IDs, merge with `filters.documentIds`
3. `supabase.rpc('hybrid_search', { query_text, query_embedding, match_count, full_text_weight, semantic_weight, filter_document_ids })`
4. Fire-and-forget: insert into `document_access_logs` (one row per unique document_id in results)
5. Return `{ results, queryTokenCount }` with camelCase-mapped fields

---

## Testing Strategy

**File:** `tests/unit/search.test.ts`

**DI approach:** Mock the Supabase client (`.rpc()` and `.from().select()/.insert()`) and the embedding client (same `setEmbeddingClient()` pattern from embedder.ts).

**Test cases (~8-10):**
1. Basic search — query embeds, RPC called with correct params, results returned and mapped
2. Empty results — RPC returns empty array, response has empty results
3. Filter by document IDs — passed directly to RPC
4. Filter by mime type — resolves to document IDs, then passed to RPC
5. Filter by date range — resolves to document IDs, then passed to RPC
6. Combined filters — mime + date + explicit IDs merged correctly
7. Access logging — correct rows inserted (one per unique document)
8. Access log failure — swallowed, search still returns results
9. Embedding failure — throws, does not call RPC
10. Token count passthrough — embedding token count included in response

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| OpenAI embedding fails | Throw — caller handles |
| RPC call fails | Throw — caller handles |
| Access log insert fails | Swallow — don't fail search over logging |
| No results | Return empty array (not an error) |
| Empty query string | Let OpenAI/Postgres handle (they'll error appropriately) |

---

## Files Touched

| Action | File |
|--------|------|
| Create | `supabase/migrations/00010_hybrid_search.sql` |
| Create | `supabase/migrations/00011_document_access_logs.sql` |
| Create | `lib/rag/search.ts` |
| Create | `tests/unit/search.test.ts` |
| Update | `specs/ARCHITECTURE.md` (hosting: Vercel → Render) |
| Update | `planning/PROJECT_PLAN.md` (Phase 3 task statuses) |
| Update | `PLAN.md` (current status) |

---

*Approved: 2026-02-19*
