import { CohereClient } from "cohere-ai";
import type { SearchResult } from "./search";

const RERANK_MODEL = "rerank-v3.5";

let cohereClient: CohereClient | null = null;

function getClient(): CohereClient {
  if (!cohereClient) {
    cohereClient = new CohereClient({
      token: process.env.COHERE_API_KEY,
    });
  }
  return cohereClient;
}

export function isRerankEnabled(): boolean {
  return !!process.env.COHERE_API_KEY;
}

/**
 * Rerank search results using Cohere's cross-encoder model.
 * Returns the top `topN` results sorted by relevance score.
 */
export async function rerankResults(
  query: string,
  results: SearchResult[],
  topN: number
): Promise<SearchResult[]> {
  if (results.length === 0) return [];
  if (results.length <= topN) return results;

  const client = getClient();

  const response = await client.v2.rerank({
    model: RERANK_MODEL,
    query,
    documents: results.map((r) => r.content),
    topN,
  });

  // Map reranked indices back to SearchResult objects
  return response.results.map((r) => results[r.index]);
}
