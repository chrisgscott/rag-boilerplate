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
