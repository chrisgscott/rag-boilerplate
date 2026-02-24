import type { SupabaseClient } from "@supabase/supabase-js";
import { embedQuery } from "./embedder";
import { isRerankEnabled, rerankResults } from "./reranker";

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
  chunkIndex: number;
  documentId: string;
  documentName: string;
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
  const finalCount = params.matchCount ?? 5;
  const useRerank = isRerankEnabled();
  // Over-fetch candidates when reranking (4x) so the cross-encoder has more to work with
  const candidateCount = useRerank ? finalCount * 4 : finalCount;

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
    match_count: candidateCount,
    full_text_weight: params.fullTextWeight ?? 1.0,
    semantic_weight: params.semanticWeight ?? 1.0,
    filter_document_ids: filterDocumentIds,
  });

  if (error) throw error;

  // 4. Resolve document names
  const docIds = [...new Set((data ?? []).map((row: any) => row.document_id))];
  const docNameMap = new Map<string, string>();
  if (docIds.length > 0) {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, name")
      .in("id", docIds);
    for (const doc of docs ?? []) {
      docNameMap.set(doc.id, doc.name);
    }
  }

  // 5. Map results from snake_case to camelCase
  let results: SearchResult[] = (data ?? []).map((row: any) => ({
    chunkId: row.chunk_id,
    chunkIndex: row.chunk_index,
    documentId: row.document_id,
    documentName: docNameMap.get(row.document_id) ?? "Unknown document",
    content: row.content,
    metadata: row.metadata,
    similarity: row.similarity,
    ftsRank: row.fts_rank,
    rrfScore: row.rrf_score,
  }));

  // 6. Rerank with Cohere cross-encoder (if enabled)
  if (useRerank && results.length > 0) {
    results = await rerankResults(params.query, results, finalCount);
  }

  // 7. Log document access (fire-and-forget)
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
