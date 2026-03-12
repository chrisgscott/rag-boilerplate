import { assignSplit } from "./splitter";
import type { GeneratedTestCase } from "./validator";

// Re-export for consumers of this module
export type { GeneratedTestCase };

export type ChunkForGeneration = {
  id: string;
  documentId: string;
  content: string;
  tokenCount: number;
};

export type AccessLogEntry = {
  queryText: string;
  documentId: string;
  chunksReturned: number;
};

export type SearchResult = {
  id: string;
  content: string;
  similarity: number;
};

export type GeneratorDeps = {
  generateQA: (chunkContent: string, question?: string) => Promise<{ question: string; expectedAnswer: string }>;
  getChunks: (organizationId: string, limit: number) => Promise<ChunkForGeneration[]>;
  getAccessLogs: (organizationId: string, limit: number) => Promise<AccessLogEntry[]>;
  searchForChunks: (query: string, organizationId: string) => Promise<SearchResult[]>;
};

export async function generateTestCases(
  mode: "bootstrap" | "query_log",
  organizationId: string,
  testSetId: string,
  deps: GeneratorDeps,
  options?: { sampleSize?: number }
): Promise<GeneratedTestCase[]> {
  const sampleSize = options?.sampleSize ?? 20;
  const results: GeneratedTestCase[] = [];

  if (mode === "bootstrap") {
    // Get chunks (prefer longer ones)
    const chunks = await deps.getChunks(organizationId, sampleSize);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const qa = await deps.generateQA(chunk.content);

      results.push({
        question: qa.question,
        expectedAnswer: qa.expectedAnswer,
        expectedSourceIds: [chunk.id],
        sourceChunkId: chunk.id,
        split: assignSplit(i, chunks.length),
        generationMode: "bootstrap",
        status: "pending",
      });
    }
  } else {
    // Query log mode
    const logs = await deps.getAccessLogs(organizationId, sampleSize);

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      // Re-run search to get scored results
      const searchResults = await deps.searchForChunks(log.queryText, organizationId);

      if (searchResults.length === 0) continue;

      const topChunk = searchResults[0];
      const qa = await deps.generateQA(topChunk.content, log.queryText);

      results.push({
        question: qa.question,
        expectedAnswer: qa.expectedAnswer,
        expectedSourceIds: [topChunk.id],
        sourceChunkId: topChunk.id,
        split: assignSplit(i, logs.length),
        generationMode: "query_log",
        status: "pending",
      });
    }
  }

  return results;
}
