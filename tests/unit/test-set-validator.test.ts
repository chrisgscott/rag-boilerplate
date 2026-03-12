import { describe, it, expect, vi } from "vitest";
import { validateTestCases } from "@/lib/rag/test-set/validator";
import type { GeneratedTestCase, ValidatorDeps } from "@/lib/rag/test-set/validator";

function makeTestCase(overrides: Partial<GeneratedTestCase> = {}): GeneratedTestCase {
  return {
    question: "What is the late fee?",
    expectedAnswer: "$50 per day",
    expectedSourceIds: ["chunk-1"],
    sourceChunkId: "chunk-1",
    split: "optimization",
    generationMode: "bootstrap",
    status: "pending",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ValidatorDeps> = {}): ValidatorDeps {
  return {
    search: vi.fn().mockResolvedValue([
      { id: "chunk-1", content: "The late fee is $50 per day.", similarity: 0.9 },
    ]),
    scoreEntailment: vi.fn().mockResolvedValue(5),
    ...overrides,
  };
}

describe("validateTestCases", () => {
  it("validates when source found and entailment >= 4", async () => {
    const result = await validateTestCases([makeTestCase()], "org-1", makeDeps());
    expect(result[0].status).toBe("validated");
    expect(result[0].groundingScore).toBe(5);
  });

  it("rejects when source chunk not in search results (layer 1)", async () => {
    const deps = makeDeps({
      search: vi.fn().mockResolvedValue([
        { id: "chunk-other", content: "Unrelated", similarity: 0.5 },
      ]),
    });
    const result = await validateTestCases([makeTestCase()], "org-1", deps);
    expect(result[0].status).toBe("rejected");
    expect(result[0].groundingScore).toBeNull();
  });

  it("rejects when entailment score <= autoReject threshold", async () => {
    const deps = makeDeps({ scoreEntailment: vi.fn().mockResolvedValue(1) });
    const result = await validateTestCases([makeTestCase()], "org-1", deps);
    expect(result[0].status).toBe("rejected");
    expect(result[0].groundingScore).toBe(1);
  });

  it("flags when entailment score is between thresholds", async () => {
    const deps = makeDeps({ scoreEntailment: vi.fn().mockResolvedValue(3) });
    const result = await validateTestCases([makeTestCase()], "org-1", deps);
    expect(result[0].status).toBe("flagged");
    expect(result[0].groundingScore).toBe(3);
  });

  it("skips entailment check when layer 1 rejects", async () => {
    const scoreEntailment = vi.fn().mockResolvedValue(5);
    const deps = makeDeps({
      search: vi.fn().mockResolvedValue([]),
      scoreEntailment,
    });
    await validateTestCases([makeTestCase()], "org-1", deps);
    expect(scoreEntailment).not.toHaveBeenCalled();
  });

  it("respects custom thresholds", async () => {
    const deps = makeDeps({ scoreEntailment: vi.fn().mockResolvedValue(3) });
    const result = await validateTestCases([makeTestCase()], "org-1", deps, {
      autoApproveThreshold: 3,
      autoRejectThreshold: 1,
    });
    expect(result[0].status).toBe("validated");
  });

  it("handles multiple test cases", async () => {
    const deps = makeDeps({
      search: vi
        .fn()
        .mockResolvedValueOnce([{ id: "chunk-1", content: "Fee is $50", similarity: 0.9 }])
        .mockResolvedValueOnce([]),
      scoreEntailment: vi.fn().mockResolvedValue(5),
    });
    const result = await validateTestCases(
      [makeTestCase(), makeTestCase({ sourceChunkId: "chunk-2" })],
      "org-1",
      deps
    );
    expect(result[0].status).toBe("validated");
    expect(result[1].status).toBe("rejected");
  });
});
