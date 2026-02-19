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
