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
});
