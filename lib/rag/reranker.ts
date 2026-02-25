import { CohereClient } from "cohere-ai";
import type { SearchResult } from "./search";

const RERANK_MODEL = "rerank-v3.5";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 7_000; // 7s base — trial key is 10 req/min

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
  const docs = results.map((r) => r.content);

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.v2.rerank({
        model: RERANK_MODEL,
        query,
        documents: docs,
        topN,
      });
      return response.results.map((r) => results[r.index]);
    } catch (err: unknown) {
      lastError = err;
      const is429 =
        err instanceof Error && err.message.includes("429");
      if (!is429 || attempt === MAX_RETRIES - 1) break;
      const delay = BASE_DELAY_MS * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
