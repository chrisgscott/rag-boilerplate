import { describe, it, expect } from "vitest";
import { getCorpusFingerprint } from "@/lib/rag/optimizer/corpus";

// Build a mock Supabase client that handles chained calls.
// .from("documents").select("*", { count: "exact", head: true }).eq(...)
//   → returns { count: N, data: null, error: null }
// .from("documents").select("created_at").eq(...).order(...).limit(...).maybeSingle()
//   → returns { data: { created_at: "..." } | null, error: null }
// .from("document_chunks").select("*", { count: "exact", head: true }).eq(...)
//   → returns { count: N, data: null, error: null }

function makeSupabaseMock({
  docCount,
  chunkCount,
  latestCreatedAt,
}: {
  docCount: number;
  chunkCount: number;
  latestCreatedAt: string | null;
}) {
  const makeChainable = (resolveWith: object) => {
    const chain: Record<string, unknown> = {};
    const methods = ["eq", "order", "limit"];
    for (const m of methods) {
      chain[m] = () => chain;
    }
    chain["maybeSingle"] = () =>
      Promise.resolve(
        latestCreatedAt !== null
          ? { data: { created_at: latestCreatedAt }, error: null }
          : { data: null, error: null }
      );
    // Make the chain itself thenable so `.eq()` can be awaited directly
    chain["then"] = (resolve: (v: object) => void) =>
      Promise.resolve(resolveWith).then(resolve);
    return chain;
  };

  return {
    from: (table: string) => ({
      select: (cols: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.head) {
          // Head count query — chaining ends at .eq()
          const count = table === "documents" ? docCount : chunkCount;
          return makeChainable({ count, data: null, error: null });
        }
        // Regular select (for the latest doc query)
        return makeChainable({ data: null, error: null });
      },
    }),
  };
}

describe("getCorpusFingerprint", () => {
  it("returns doc count, chunk count, and last ingested timestamp", async () => {
    const supabase = makeSupabaseMock({
      docCount: 5,
      chunkCount: 120,
      latestCreatedAt: "2026-03-10T12:00:00Z",
    });

    const result = await getCorpusFingerprint(
      supabase as any,
      "org-123"
    );

    expect(result.docCount).toBe(5);
    expect(result.chunkCount).toBe(120);
    expect(result.lastIngestedAt).toBe("2026-03-10T12:00:00Z");
  });

  it("returns null lastIngestedAt when no documents exist", async () => {
    const supabase = makeSupabaseMock({
      docCount: 0,
      chunkCount: 0,
      latestCreatedAt: null,
    });

    const result = await getCorpusFingerprint(
      supabase as any,
      "org-456"
    );

    expect(result.docCount).toBe(0);
    expect(result.chunkCount).toBe(0);
    expect(result.lastIngestedAt).toBeNull();
  });
});
