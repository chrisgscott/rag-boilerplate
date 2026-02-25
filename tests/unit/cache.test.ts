import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  beforeEach(() => {
    vi.resetModules();
  });

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
  beforeEach(() => {
    vi.resetModules();
  });

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
