// Defined locally until generator.ts is created (Task 9).
// When generator.ts lands, replace this with:
// import type { GeneratedTestCase } from "./generator";
export type GeneratedTestCase = {
  question: string;
  expectedAnswer: string;
  expectedSourceIds: string[];
  sourceChunkId: string;
  split: "optimization" | "validation";
  generationMode: "bootstrap" | "query_log";
  status: "pending";
};

export type ValidatedTestCase = Omit<GeneratedTestCase, "status"> & {
  status: "validated" | "flagged" | "rejected";
  groundingScore: number | null;
};

export type SearchResult = {
  id: string;
  content: string;
  similarity: number;
};

export type ValidatorDeps = {
  search: (query: string, organizationId: string) => Promise<SearchResult[]>;
  scoreEntailment: (chunkContent: string, answer: string) => Promise<number>;
};

export async function validateTestCases(
  testCases: GeneratedTestCase[],
  organizationId: string,
  deps: ValidatorDeps,
  options?: { autoApproveThreshold?: number; autoRejectThreshold?: number }
): Promise<ValidatedTestCase[]> {
  const autoApprove = options?.autoApproveThreshold ?? 4;
  const autoReject = options?.autoRejectThreshold ?? 1;
  const results: ValidatedTestCase[] = [];

  for (const tc of testCases) {
    // Layer 1: Round-trip retrieval check
    const searchResults = await deps.search(tc.question, organizationId);
    const sourceFound = searchResults.some((r) => r.id === tc.sourceChunkId);

    if (!sourceFound) {
      results.push({ ...tc, status: "rejected", groundingScore: null });
      continue;
    }

    // Layer 2: Entailment scoring
    const sourceChunk = searchResults.find((r) => r.id === tc.sourceChunkId);
    const score = await deps.scoreEntailment(sourceChunk!.content, tc.expectedAnswer);

    let status: "validated" | "flagged" | "rejected";
    if (score >= autoApprove) {
      status = "validated";
    } else if (score <= autoReject) {
      status = "rejected";
    } else {
      status = "flagged";
    }

    results.push({ ...tc, status, groundingScore: score });
  }

  return results;
}
