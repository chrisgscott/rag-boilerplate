import OpenAI from "openai";

const MODEL = "text-embedding-3-small";
const BATCH_SIZE = 100; // OpenAI max per request

export type EmbeddingResult = {
  embeddings: number[][];
  tokenCount: number;
};

export type QueryEmbeddingResult = {
  embedding: number[];
  tokenCount: number;
};

/** Minimal interface for the OpenAI embeddings client (for DI/testing). */
export type EmbeddingClient = {
  embeddings: {
    create: (params: {
      model: string;
      input: string[];
    }) => Promise<{
      data: { embedding: number[]; index: number }[];
      usage: { prompt_tokens: number; total_tokens: number };
    }>;
  };
};

let defaultClient: EmbeddingClient | null = null;

/**
 * Get or create the default OpenAI client.
 * Override with setEmbeddingClient() for testing.
 */
export function getEmbeddingClient(): EmbeddingClient {
  if (!defaultClient) {
    defaultClient = new OpenAI() as unknown as EmbeddingClient;
  }
  return defaultClient;
}

/** Override the embedding client (useful for testing). */
export function setEmbeddingClient(client: EmbeddingClient | null): void {
  defaultClient = client;
}

/**
 * Generate embeddings for a batch of texts.
 * Automatically splits into sub-batches of 100 (OpenAI limit).
 * Returns embeddings in the same order as input texts.
 */
export async function embedTexts(texts: string[]): Promise<EmbeddingResult> {
  if (texts.length === 0) {
    return { embeddings: [], tokenCount: 0 };
  }

  const client = getEmbeddingClient();
  const allEmbeddings: number[][] = [];
  let totalTokens = 0;

  // Process in batches
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await client.embeddings.create({
      model: MODEL,
      input: batch,
    });

    // Sort by index to preserve order
    const sorted = [...response.data].sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      allEmbeddings.push(item.embedding);
    }

    totalTokens += response.usage.prompt_tokens;
  }

  return {
    embeddings: allEmbeddings,
    tokenCount: totalTokens,
  };
}

/**
 * Generate a single embedding for a search query.
 */
export async function embedQuery(
  query: string
): Promise<QueryEmbeddingResult> {
  const result = await embedTexts([query]);
  return {
    embedding: result.embeddings[0],
    tokenCount: result.tokenCount,
  };
}
