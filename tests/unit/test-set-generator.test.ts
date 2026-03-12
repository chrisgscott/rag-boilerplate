import { describe, it, expect, vi } from "vitest";
import { generateTestCases } from "@/lib/rag/test-set/generator";
import type { GeneratorDeps } from "@/lib/rag/test-set/generator";

function makeDeps(overrides: Partial<GeneratorDeps> = {}): GeneratorDeps {
  return {
    generateQA: vi.fn().mockResolvedValue({
      question: "What is the late fee?",
      expectedAnswer: "$50 per day",
    }),
    getChunks: vi.fn().mockResolvedValue([
      { id: "chunk-1", documentId: "doc-1", content: "Late fee is $50/day", tokenCount: 100 },
      { id: "chunk-2", documentId: "doc-2", content: "Pet policy details", tokenCount: 80 },
    ]),
    getAccessLogs: vi.fn().mockResolvedValue([
      { queryText: "late fee amount", documentId: "doc-1", chunksReturned: 3 },
    ]),
    searchForChunks: vi.fn().mockResolvedValue([
      { id: "chunk-1", content: "Late fee is $50/day", similarity: 0.9 },
    ]),
    ...overrides,
  };
}

describe("generateTestCases", () => {
  describe("bootstrap mode", () => {
    it("generates test cases from chunks", async () => {
      const deps = makeDeps();
      const result = await generateTestCases("bootstrap", "org-1", "ts-1", deps);

      expect(result).toHaveLength(2);
      expect(result[0].generationMode).toBe("bootstrap");
      expect(result[0].status).toBe("pending");
      expect(result[0].sourceChunkId).toBe("chunk-1");
      expect(deps.getChunks).toHaveBeenCalledWith("org-1", 20); // default sample size
    });

    it("assigns splits via splitter", async () => {
      const result = await generateTestCases("bootstrap", "org-1", "ts-1", makeDeps());
      // With 2 items: first should be optimization (index 0 < round(2*0.7)=1), second validation
      expect(result[0].split).toBe("optimization");
      expect(result[1].split).toBe("validation");
    });

    it("respects custom sample size", async () => {
      const deps = makeDeps();
      await generateTestCases("bootstrap", "org-1", "ts-1", deps, { sampleSize: 5 });
      expect(deps.getChunks).toHaveBeenCalledWith("org-1", 5);
    });

    it("passes chunk content to generateQA", async () => {
      const deps = makeDeps();
      await generateTestCases("bootstrap", "org-1", "ts-1", deps);
      expect(deps.generateQA).toHaveBeenCalledWith("Late fee is $50/day");
    });
  });

  describe("query_log mode", () => {
    it("generates test cases from access logs", async () => {
      const deps = makeDeps();
      const result = await generateTestCases("query_log", "org-1", "ts-1", deps);

      expect(result).toHaveLength(1);
      expect(result[0].generationMode).toBe("query_log");
      expect(result[0].status).toBe("pending");
    });

    it("re-runs search for each log entry", async () => {
      const deps = makeDeps();
      await generateTestCases("query_log", "org-1", "ts-1", deps);
      expect(deps.searchForChunks).toHaveBeenCalledWith("late fee amount", "org-1");
    });

    it("passes query text to generateQA", async () => {
      const deps = makeDeps();
      await generateTestCases("query_log", "org-1", "ts-1", deps);
      expect(deps.generateQA).toHaveBeenCalledWith("Late fee is $50/day", "late fee amount");
    });

    it("skips log entries with no search results", async () => {
      const deps = makeDeps({
        searchForChunks: vi.fn().mockResolvedValue([]),
      });
      const result = await generateTestCases("query_log", "org-1", "ts-1", deps);
      expect(result).toHaveLength(0);
    });
  });
});
