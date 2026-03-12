import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external dependencies before importing
vi.mock("@/lib/rag/search", () => ({
  hybridSearch: vi.fn(),
}));

vi.mock("@/lib/rag/judge", () => ({
  buildJudgePrompt: vi.fn().mockReturnValue("judge prompt"),
  parseJudgeResponse: vi.fn().mockReturnValue({
    faithfulness: 4,
    relevance: 5,
    completeness: 4,
  }),
}));

vi.mock("@/lib/rag/prompt", () => ({
  buildSystemPrompt: vi.fn().mockReturnValue("system prompt"),
}));

vi.mock("@/lib/rag/provider", () => ({
  getLLMProvider: vi.fn().mockReturnValue(() => "mock-model"),
  getModelId: vi.fn().mockReturnValue("claude-sonnet-4-5-20250514"),
}));

vi.mock("ai", () => ({
  generateText: vi.fn().mockResolvedValue({ text: "generated answer" }),
}));

import { runEvaluation } from "@/lib/rag/eval-runner";
import { hybridSearch } from "@/lib/rag/search";
import { generateText } from "ai";

const mockHybridSearch = vi.mocked(hybridSearch);
const mockGenerateText = vi.mocked(generateText);

// --- Helpers ---

function makeSearchResponse(docIds: string[] = ["doc-1"]) {
  return {
    results: docIds.map((id) => ({
      documentId: id,
      chunkId: `chunk-${id}`,
      content: `Content for ${id}`,
      similarity: 0.85,
    })),
  };
}

const testCases = [
  {
    id: "tc-1",
    question: "What is the pet policy?",
    expected_answer: "No pets allowed.",
    expected_source_ids: ["doc-1"],
  },
  {
    id: "tc-2",
    question: "What is the rent?",
    expected_answer: "Rent is $2000/mo.",
    expected_source_ids: ["doc-2"],
  },
];

const mockSupabase = {} as Parameters<typeof runEvaluation>[0];
const orgId = "org-123";
const config = { model: "claude-sonnet-4-5-20250514", topK: 5, similarityThreshold: 0.3 };

// --- Tests ---

describe("runEvaluation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHybridSearch.mockResolvedValue(makeSearchResponse(["doc-1"]) as never);
  });

  describe("retrievalOnly mode", () => {
    it("skips LLM generation and judging when retrievalOnly is true", async () => {
      const result = await runEvaluation(
        mockSupabase,
        testCases,
        orgId,
        config,
        { retrievalOnly: true }
      );

      // Should NOT call generateText at all
      expect(mockGenerateText).not.toHaveBeenCalled();

      // Should still have retrieval metrics
      expect(result.aggregate.precisionAtK).toBeDefined();
      expect(result.aggregate.recallAtK).toBeDefined();
      expect(result.aggregate.mrr).toBeDefined();
    });

    it("returns null for all judge score averages in retrievalOnly mode", async () => {
      const result = await runEvaluation(
        mockSupabase,
        testCases,
        orgId,
        config,
        { retrievalOnly: true }
      );

      expect(result.avgFaithfulness).toBeNull();
      expect(result.avgRelevance).toBeNull();
      expect(result.avgCompleteness).toBeNull();
    });

    it("returns perCase results without generatedAnswer or judgeScores in retrievalOnly mode", async () => {
      const result = await runEvaluation(
        mockSupabase,
        testCases,
        orgId,
        config,
        { retrievalOnly: true }
      );

      for (const c of result.perCase) {
        expect(c.generatedAnswer).toBeUndefined();
        expect(c.judgeScores).toBeUndefined();
      }
    });

    it("still runs retrieval for all test cases in retrievalOnly mode", async () => {
      await runEvaluation(
        mockSupabase,
        testCases,
        orgId,
        config,
        { retrievalOnly: true }
      );

      // hybridSearch should be called once per test case
      expect(mockHybridSearch).toHaveBeenCalledTimes(testCases.length);
    });
  });

  describe("default mode (retrievalOnly: false)", () => {
    it("runs LLM generation and judging when retrievalOnly is not set", async () => {
      const result = await runEvaluation(
        mockSupabase,
        testCases,
        orgId,
        config
      );

      // generateText called for generation + judging per test case with expected_answer
      expect(mockGenerateText).toHaveBeenCalled();

      // Should have judge scores
      expect(result.avgFaithfulness).not.toBeNull();
    });

    it("runs LLM generation when retrievalOnly is explicitly false", async () => {
      const result = await runEvaluation(
        mockSupabase,
        testCases,
        orgId,
        config,
        { retrievalOnly: false }
      );

      expect(mockGenerateText).toHaveBeenCalled();
      expect(result.avgFaithfulness).not.toBeNull();
    });
  });
});
