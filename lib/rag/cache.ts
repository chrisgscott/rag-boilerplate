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
