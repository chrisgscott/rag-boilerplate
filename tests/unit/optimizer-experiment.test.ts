import { describe, it, expect, vi } from "vitest";
import type { EvalRunResult } from "@/lib/rag/eval-runner";
import type { ExperimentConfig, CompositeWeights } from "@/lib/rag/optimizer/config";
import { createDefaultConfig } from "@/lib/rag/optimizer/config";
import {
  runExperiment,
  type ExperimentInput,
  type ExperimentResult,
} from "@/lib/rag/optimizer/experiment";

// --- Helpers ---

const defaultWeights: CompositeWeights = {
  precisionAtK: 0.2,
  recallAtK: 0.2,
  mrr: 0.1,
  faithfulness: 0.2,
  relevance: 0.2,
  completeness: 0.1,
};

function makeEvalResult(overrides: Partial<EvalRunResult> = {}): EvalRunResult {
  return {
    perCase: [],
    aggregate: { precisionAtK: 0.8, recallAtK: 0.9, mrr: 1.0 },
    avgFaithfulness: 4.0,
    avgRelevance: 4.5,
    avgCompleteness: 4.0,
    ...overrides,
  };
}

function makeInput(overrides: Partial<ExperimentInput> = {}): ExperimentInput {
  return {
    baselineConfig: createDefaultConfig(),
    baselineScore: 0.5,
    configOverrides: { topK: 10 },
    compositeWeights: defaultWeights,
    organizationId: "org-123",
    runId: "run-456",
    experimentIndex: 0,
    testCases: [
      {
        id: "tc-1",
        question: "What is the pet policy?",
        expected_answer: "No pets allowed.",
        expected_source_ids: ["doc-1"],
      },
    ],
    ...overrides,
  };
}

// --- Tests ---

describe("runExperiment", () => {
  it("merges config overrides with baseline config", async () => {
    const evalRunner = vi.fn().mockResolvedValue(makeEvalResult());

    const input = makeInput({ configOverrides: { topK: 10, fullTextWeight: 2.0 } });
    await runExperiment(input, { evalRunner });

    // The eval runner should receive the merged config
    const calledConfig = evalRunner.mock.calls[0][2] as ExperimentConfig;
    expect(calledConfig.topK).toBe(10);
    expect(calledConfig.fullTextWeight).toBe(2.0);
    // Unchanged fields should retain baseline values
    expect(calledConfig.semanticWeight).toBe(1.0);
    expect(calledConfig.rerankEnabled).toBe(false);
  });

  it("computes composite score from eval results", async () => {
    const evalResult = makeEvalResult({
      aggregate: { precisionAtK: 1.0, recallAtK: 1.0, mrr: 1.0 },
      avgFaithfulness: 5.0,
      avgRelevance: 5.0,
      avgCompleteness: 5.0,
    });
    const evalRunner = vi.fn().mockResolvedValue(evalResult);

    const result = await runExperiment(makeInput(), { evalRunner });

    // With default weights summing to 1.0, perfect scores = 1.0
    expect(result.compositeScore).toBeCloseTo(1.0, 5);
  });

  it("computes positive delta when experiment beats baseline", async () => {
    const evalRunner = vi.fn().mockResolvedValue(
      makeEvalResult({
        aggregate: { precisionAtK: 1.0, recallAtK: 1.0, mrr: 1.0 },
        avgFaithfulness: 5.0,
        avgRelevance: 5.0,
        avgCompleteness: 5.0,
      })
    );

    const result = await runExperiment(
      makeInput({ baselineScore: 0.5 }),
      { evalRunner }
    );

    expect(result.delta).toBeCloseTo(0.5, 5);
    expect(result.status).toBe("kept");
  });

  it("computes negative delta and discards when experiment is worse", async () => {
    const evalRunner = vi.fn().mockResolvedValue(
      makeEvalResult({
        aggregate: { precisionAtK: 0.2, recallAtK: 0.2, mrr: 0.5 },
        avgFaithfulness: 2.0,
        avgRelevance: 2.0,
        avgCompleteness: 2.0,
      })
    );

    const result = await runExperiment(
      makeInput({ baselineScore: 0.8 }),
      { evalRunner }
    );

    expect(result.delta).toBeLessThan(0);
    expect(result.status).toBe("discarded");
  });

  it("discards when delta is exactly zero", async () => {
    // Score must exactly match baseline to be discarded (no improvement = no keep)
    const evalRunner = vi.fn().mockResolvedValue(
      makeEvalResult({
        aggregate: { precisionAtK: 0.5, recallAtK: 0.5, mrr: 0.5 },
        avgFaithfulness: 2.5,
        avgRelevance: 2.5,
        avgCompleteness: 2.5,
      })
    );

    // Compute the expected score: 0.2*0.5 + 0.2*0.5 + 0.1*0.5 + 0.2*(2.5/5) + 0.2*(2.5/5) + 0.1*(2.5/5)
    // = 0.1 + 0.1 + 0.05 + 0.1 + 0.1 + 0.05 = 0.5
    const result = await runExperiment(
      makeInput({ baselineScore: 0.5 }),
      { evalRunner }
    );

    expect(result.delta).toBeCloseTo(0, 5);
    expect(result.status).toBe("discarded");
  });

  it("returns config diff between baseline and experiment", async () => {
    const evalRunner = vi.fn().mockResolvedValue(makeEvalResult());

    const result = await runExperiment(
      makeInput({ configOverrides: { topK: 10, fullTextWeight: 2.0 } }),
      { evalRunner }
    );

    expect(result.configDelta).toEqual({
      topK: { before: 5, after: 10 },
      fullTextWeight: { before: 1.0, after: 2.0 },
    });
  });

  it("returns retrieval metrics and judge scores separately", async () => {
    const evalResult = makeEvalResult({
      aggregate: { precisionAtK: 0.8, recallAtK: 0.9, mrr: 1.0 },
      avgFaithfulness: 4.0,
      avgRelevance: 4.5,
      avgCompleteness: 4.0,
    });
    const evalRunner = vi.fn().mockResolvedValue(evalResult);

    const result = await runExperiment(makeInput(), { evalRunner });

    expect(result.retrievalMetrics).toEqual({
      precisionAtK: 0.8,
      recallAtK: 0.9,
      mrr: 1.0,
    });
    expect(result.judgeScores).toEqual({
      faithfulness: 4.0,
      relevance: 4.5,
      completeness: 4.0,
    });
  });

  it("handles null judge scores (retrieval-only mode)", async () => {
    const evalResult = makeEvalResult({
      avgFaithfulness: null,
      avgRelevance: null,
      avgCompleteness: null,
    });
    const evalRunner = vi.fn().mockResolvedValue(evalResult);

    const result = await runExperiment(makeInput(), { evalRunner });

    expect(result.judgeScores).toBeNull();
  });

  it("returns error status when eval runner throws", async () => {
    const evalRunner = vi.fn().mockRejectedValue(new Error("OpenAI rate limit"));

    const result = await runExperiment(makeInput(), { evalRunner });

    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("OpenAI rate limit");
    expect(result.compositeScore).toBe(0);
    expect(result.delta).toBe(0);
  });

  it("passes correct arguments to eval runner", async () => {
    const evalRunner = vi.fn().mockResolvedValue(makeEvalResult());
    const testCases = [
      {
        id: "tc-1",
        question: "Q1?",
        expected_answer: "A1",
        expected_source_ids: ["d1"],
      },
      {
        id: "tc-2",
        question: "Q2?",
        expected_answer: "A2",
        expected_source_ids: ["d2"],
      },
    ];

    await runExperiment(
      makeInput({ testCases, organizationId: "org-abc" }),
      { evalRunner }
    );

    expect(evalRunner).toHaveBeenCalledTimes(1);
    // Args: testCases, organizationId, config
    expect(evalRunner.mock.calls[0][0]).toBe(testCases);
    expect(evalRunner.mock.calls[0][1]).toBe("org-abc");
    // Config should be the merged experiment config
    expect(evalRunner.mock.calls[0][2]).toMatchObject({ topK: 10 });
  });

  it("returns the full experiment config used", async () => {
    const evalRunner = vi.fn().mockResolvedValue(makeEvalResult());

    const result = await runExperiment(
      makeInput({ configOverrides: { topK: 10 } }),
      { evalRunner }
    );

    expect(result.experimentConfig.topK).toBe(10);
    // Rest should be defaults
    expect(result.experimentConfig.fullTextWeight).toBe(1.0);
    expect(result.experimentConfig.model).toBe("claude-sonnet-4-5-20250514");
  });
});
