import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExperimentResult } from "@/lib/rag/optimizer/experiment";
import type { ExperimentConfig, CompositeWeights } from "@/lib/rag/optimizer/config";
import { createDefaultConfig } from "@/lib/rag/optimizer/config";
import {
  runSession,
  type SessionConfig,
  type SessionDeps,
  type BaselineResult,
} from "@/lib/rag/optimizer/session";
import type { OptimizationRunRow } from "@/lib/rag/optimizer/results-log";

// --- Helpers ---

const defaultWeights: CompositeWeights = {
  precisionAtK: 0.2,
  recallAtK: 0.2,
  mrr: 0.1,
  faithfulness: 0.2,
  relevance: 0.2,
  completeness: 0.1,
};

const mockRun: OptimizationRunRow = {
  id: "run-abc",
  organization_id: "org-123",
  test_set_id: "ts-456",
  status: "running",
  baseline_config: {},
  baseline_score: 0.5,
  best_config: null,
  best_score: null,
  composite_weights: {},
  experiments_run: 0,
  error_message: null,
  started_at: new Date().toISOString(),
  completed_at: null,
  session_report: null,
};

const testCases = [
  {
    id: "tc-1",
    question: "What is the pet policy?",
    expected_answer: "No pets allowed.",
    expected_source_ids: ["doc-1"],
  },
  {
    id: "tc-2",
    question: "What is the noise curfew?",
    expected_answer: "10 PM on weeknights.",
    expected_source_ids: ["doc-2"],
  },
];

const baselineResult: BaselineResult = {
  compositeScore: 0.5,
  retrievalMetrics: { precisionAtK: 0.8, recallAtK: 0.9, mrr: 1.0 },
  judgeScores: { faithfulness: 4.0, relevance: 4.5, completeness: 4.0 },
};

function makeExperimentResult(overrides: Partial<ExperimentResult> = {}): ExperimentResult {
  return {
    experimentConfig: createDefaultConfig(),
    configDelta: {},
    compositeScore: 0.5,
    delta: 0,
    status: "discarded",
    retrievalMetrics: { precisionAtK: 0.8, recallAtK: 0.9, mrr: 1.0 },
    judgeScores: { faithfulness: 4.0, relevance: 4.5, completeness: 4.0 },
    perCase: null,
    ...overrides,
  };
}

function makeSessionConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    organizationId: "org-123",
    testSetId: "ts-456",
    compositeWeights: defaultWeights,
    maxExperiments: 10,
    maxBudgetUsd: 5.0,
    experiments: [
      { topK: 10 },
      { fullTextWeight: 2.0 },
    ],
    ...overrides,
  };
}

function makeDeps(overrides: Partial<SessionDeps> = {}): SessionDeps {
  return {
    runExperiment: vi.fn().mockResolvedValue(makeExperimentResult()),
    createRun: vi.fn().mockResolvedValue(mockRun),
    completeRun: vi.fn().mockResolvedValue(undefined),
    logExperiment: vi.fn().mockResolvedValue({}),
    upsertBestConfig: vi.fn().mockResolvedValue(undefined),
    getTestCases: vi.fn().mockResolvedValue(testCases),
    runBaseline: vi.fn().mockResolvedValue(baselineResult),
    ...overrides,
  };
}

// --- Tests ---

describe("runSession", () => {
  it("is importable", () => {
    expect(typeof runSession).toBe("function");
  });

  it("runs baseline then iterates experiments", async () => {
    const deps = makeDeps();
    const config = makeSessionConfig({ experiments: [{ topK: 10 }, { fullTextWeight: 2.0 }] });

    const result = await runSession(config, deps);

    // createRun called once
    expect(deps.createRun).toHaveBeenCalledTimes(1);
    expect(deps.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-123",
        testSetId: "ts-456",
        baselineScore: 0.5,
      })
    );

    // runBaseline called once
    expect(deps.runBaseline).toHaveBeenCalledTimes(1);

    // runExperiment called twice (one per experiment)
    expect(deps.runExperiment).toHaveBeenCalledTimes(2);

    // logExperiment called twice
    expect(deps.logExperiment).toHaveBeenCalledTimes(2);

    // completeRun called once with status "complete"
    expect(deps.completeRun).toHaveBeenCalledTimes(1);
    expect(deps.completeRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "complete" })
    );

    expect(result.status).toBe("complete");
    expect(result.experimentsRun).toBe(2);
    expect(result.runId).toBe("run-abc");
  });

  it("stops at maxExperiments", async () => {
    const deps = makeDeps();
    const config = makeSessionConfig({
      experiments: [{ topK: 10 }, { topK: 15 }, { topK: 20 }, { topK: 25 }],
      maxExperiments: 3,
    });

    const result = await runSession(config, deps);

    // Only 3 of the 4 experiments should run
    expect(deps.runExperiment).toHaveBeenCalledTimes(3);
    expect(result.experimentsRun).toBe(3);
  });

  it("updates baseline when experiment is kept", async () => {
    const keptConfig: ExperimentConfig = { ...createDefaultConfig(), topK: 10 };
    const keptResult = makeExperimentResult({
      experimentConfig: keptConfig,
      compositeScore: 0.75,
      delta: 0.25,
      status: "kept",
    });

    // First experiment is kept, second returns discarded
    const runExperiment = vi
      .fn()
      .mockResolvedValueOnce(keptResult)
      .mockResolvedValueOnce(makeExperimentResult({ status: "discarded" }));

    const deps = makeDeps({ runExperiment });
    const config = makeSessionConfig({
      experiments: [{ topK: 10 }, { fullTextWeight: 2.0 }],
    });

    const result = await runSession(config, deps);

    // Second experiment should receive the kept config and kept score as baseline
    const secondCallInput = (runExperiment.mock.calls[1] as any[])[0];
    expect(secondCallInput.baselineConfig).toEqual(keptConfig);
    expect(secondCallInput.baselineScore).toBe(0.75);

    // upsertBestConfig should be called since we found an improvement
    expect(deps.upsertBestConfig).toHaveBeenCalledTimes(1);
    expect(deps.upsertBestConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-123",
        config: keptConfig,
        compositeScore: 0.75,
      })
    );

    expect(result.keptCount).toBe(1);
    expect(result.discardedCount).toBe(1);
    expect(result.bestScore).toBe(0.75);
  });

  it("marks run as error on exception", async () => {
    const runExperiment = vi.fn().mockRejectedValue(new Error("OpenAI rate limit"));
    const deps = makeDeps({ runExperiment });
    const config = makeSessionConfig({ experiments: [{ topK: 10 }] });

    const result = await runSession(config, deps);

    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("OpenAI rate limit");

    // completeRun should be called with error status
    expect(deps.completeRun).toHaveBeenCalledTimes(1);
    expect(deps.completeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        errorMessage: "OpenAI rate limit",
      })
    );
  });

  it("handles empty experiments array", async () => {
    const deps = makeDeps();
    const config = makeSessionConfig({ experiments: [] });

    const result = await runSession(config, deps);

    // Baseline and run creation still happen
    expect(deps.runBaseline).toHaveBeenCalledTimes(1);
    expect(deps.createRun).toHaveBeenCalledTimes(1);

    // No experiments run
    expect(deps.runExperiment).not.toHaveBeenCalled();
    expect(deps.logExperiment).not.toHaveBeenCalled();

    // completeRun with 0 experiments
    expect(deps.completeRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: "complete", experimentsRun: 0 })
    );

    expect(result.experimentsRun).toBe(0);
    expect(result.keptCount).toBe(0);
    expect(result.discardedCount).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(result.status).toBe("complete");
  });

  it("does not call upsertBestConfig when no improvement found", async () => {
    // All experiments are discarded (score same as baseline)
    const deps = makeDeps({
      runExperiment: vi.fn().mockResolvedValue(
        makeExperimentResult({ compositeScore: 0.5, delta: 0, status: "discarded" })
      ),
    });
    const config = makeSessionConfig({ experiments: [{ topK: 10 }] });

    await runSession(config, deps);

    expect(deps.upsertBestConfig).not.toHaveBeenCalled();
  });

  it("passes correct test cases and organizationId to runExperiment", async () => {
    const runExperiment = vi.fn().mockResolvedValue(makeExperimentResult());
    const deps = makeDeps({ runExperiment });
    const config = makeSessionConfig({ experiments: [{ topK: 10 }] });

    await runSession(config, deps);

    const callInput = (runExperiment.mock.calls[0] as any[])[0];
    expect(callInput.testCases).toBe(testCases);
    expect(callInput.organizationId).toBe("org-123");
    expect(callInput.runId).toBe("run-abc");
    expect(callInput.experimentIndex).toBe(0);
  });

  it("uses baselineConfig from SessionConfig when provided", async () => {
    const customBaseline: ExperimentConfig = { ...createDefaultConfig(), topK: 20 };
    const deps = makeDeps();
    const config = makeSessionConfig({
      baselineConfig: customBaseline,
      experiments: [{ topK: 25 }],
    });

    await runSession(config, deps);

    // createRun should receive the custom baseline
    expect(deps.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ baselineConfig: customBaseline })
    );

    // runBaseline should receive the custom baseline
    expect(deps.runBaseline).toHaveBeenCalledWith(
      customBaseline,
      testCases,
      "org-123",
      defaultWeights
    );
  });

  it("counts error experiments correctly", async () => {
    const runExperiment = vi
      .fn()
      .mockResolvedValueOnce(makeExperimentResult({ status: "error", compositeScore: 0 }))
      .mockResolvedValueOnce(makeExperimentResult({ status: "kept", compositeScore: 0.75, delta: 0.25 }))
      .mockResolvedValueOnce(makeExperimentResult({ status: "discarded", compositeScore: 0.4, delta: -0.1 }));

    const deps = makeDeps({ runExperiment });
    const config = makeSessionConfig({
      experiments: [{ topK: 10 }, { topK: 15 }, { topK: 3 }],
    });

    const result = await runSession(config, deps);

    expect(result.errorCount).toBe(1);
    expect(result.keptCount).toBe(1);
    expect(result.discardedCount).toBe(1);
    expect(result.experimentsRun).toBe(3);
  });
});

// --- Agent-driven mode tests ---

const mockFingerprint = {
  docCount: 10,
  chunkCount: 500,
  lastIngestedAt: "2026-03-01T00:00:00Z",
};

function makeAgentDeps(overrides: Partial<SessionDeps> = {}): SessionDeps {
  return {
    ...makeDeps(),
    proposeExperiment: vi.fn(),
    getCorpusFingerprint: vi.fn().mockResolvedValue(mockFingerprint),
    getInsights: vi.fn().mockResolvedValue(null),
    upsertInsights: vi.fn().mockResolvedValue(undefined),
    generateReport: vi.fn().mockReturnValue("# Report"),
    ...overrides,
  };
}

function makeAgentConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    organizationId: "org-123",
    testSetId: "ts-456",
    compositeWeights: defaultWeights,
    maxExperiments: 10,
    maxBudgetUsd: 5.0,
    experiments: [],
    ...overrides,
  };
}

describe("agent-driven mode (no static experiments)", () => {
  it("calls proposeExperiment when experiments array is empty", async () => {
    const proposeExperiment = vi
      .fn()
      .mockResolvedValueOnce({
        stop: false,
        knob: "topK",
        value: 10,
        reasoning: "Try more chunks",
        hypothesis: "More chunks = better recall",
      })
      .mockResolvedValueOnce({
        stop: true,
        knob: null,
        value: null,
        reasoning: "No more ideas",
        hypothesis: null,
      });

    const deps = makeAgentDeps({ proposeExperiment });
    const config = makeAgentConfig();

    const result = await runSession(config, deps);

    expect(proposeExperiment).toHaveBeenCalled();
    expect(deps.runExperiment).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("complete");
    expect(result.experimentsRun).toBe(1);
  });

  it("stops when agent returns stop=true immediately", async () => {
    const proposeExperiment = vi.fn().mockResolvedValue({
      stop: true,
      knob: null,
      value: null,
      reasoning: "Already optimal",
      hypothesis: null,
    });

    const deps = makeAgentDeps({ proposeExperiment });
    const config = makeAgentConfig();

    const result = await runSession(config, deps);

    expect(proposeExperiment).toHaveBeenCalledTimes(1);
    expect(deps.runExperiment).not.toHaveBeenCalled();
    expect(result.experimentsRun).toBe(0);
    expect(result.status).toBe("complete");
  });

  it("stops when maxExperiments reached", async () => {
    const proposeExperiment = vi.fn().mockResolvedValue({
      stop: false,
      knob: "topK",
      value: 10,
      reasoning: "Try more",
      hypothesis: "Better recall",
    });

    const deps = makeAgentDeps({ proposeExperiment });
    const config = makeAgentConfig({ maxExperiments: 2 });

    const result = await runSession(config, deps);

    expect(deps.runExperiment).toHaveBeenCalledTimes(2);
    expect(result.experimentsRun).toBe(2);
  });

  it("passes updated session history to each agent call", async () => {
    const proposeExperiment = vi
      .fn()
      .mockResolvedValueOnce({
        stop: false,
        knob: "topK",
        value: 10,
        reasoning: "Try more chunks",
        hypothesis: "Better recall",
      })
      .mockResolvedValueOnce({
        stop: false,
        knob: "fullTextWeight",
        value: 2.0,
        reasoning: "Boost keywords",
        hypothesis: "Better precision",
      })
      .mockResolvedValueOnce({
        stop: true,
        knob: null,
        value: null,
        reasoning: "Done",
        hypothesis: null,
      });

    const deps = makeAgentDeps({ proposeExperiment });
    const config = makeAgentConfig();

    await runSession(config, deps);

    // First call: empty history
    const firstContext = proposeExperiment.mock.calls[0][0] as any;
    expect(firstContext.sessionHistory).toHaveLength(0);

    // Second call: one entry in history
    const secondContext = proposeExperiment.mock.calls[1][0] as any;
    expect(secondContext.sessionHistory).toHaveLength(1);
    expect(secondContext.sessionHistory[0].knob).toBe("topK");

    // Third call: two entries in history
    const thirdContext = proposeExperiment.mock.calls[2][0] as any;
    expect(thirdContext.sessionHistory).toHaveLength(2);
  });

  it("logs reasoning and hypothesis from agent proposal", async () => {
    const proposeExperiment = vi
      .fn()
      .mockResolvedValueOnce({
        stop: false,
        knob: "topK",
        value: 10,
        reasoning: "More chunks needed",
        hypothesis: "Recall will improve by 5%",
      })
      .mockResolvedValueOnce({
        stop: true,
        knob: null,
        value: null,
        reasoning: "Done",
        hypothesis: null,
      });

    const logExperiment = vi.fn().mockResolvedValue({});
    const deps = makeAgentDeps({ proposeExperiment, logExperiment });
    const config = makeAgentConfig();

    await runSession(config, deps);

    expect(logExperiment).toHaveBeenCalledTimes(1);
    expect(logExperiment).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning: "More chunks needed",
        hypothesis: "Recall will improve by 5%",
        corpusFingerprint: mockFingerprint,
      })
    );
  });

  it("generates report and updates insights after session", async () => {
    const proposeExperiment = vi
      .fn()
      .mockResolvedValueOnce({
        stop: false,
        knob: "topK",
        value: 10,
        reasoning: "Try more",
        hypothesis: "Better",
      })
      .mockResolvedValueOnce({
        stop: true,
        knob: null,
        value: null,
        reasoning: "Done",
        hypothesis: null,
      });

    const generateReport = vi.fn().mockReturnValue("# Session Report");
    const upsertInsights = vi.fn().mockResolvedValue(undefined);
    const deps = makeAgentDeps({
      proposeExperiment,
      generateReport,
      upsertInsights,
    });
    const config = makeAgentConfig();

    await runSession(config, deps);

    expect(generateReport).toHaveBeenCalledTimes(1);
    expect(generateReport).toHaveBeenCalledWith(
      expect.objectContaining({
        baselineScore: 0.5,
        corpusFingerprint: mockFingerprint,
      })
    );

    expect(upsertInsights).toHaveBeenCalledTimes(1);
    expect(upsertInsights).toHaveBeenCalledWith(
      "org-123",
      expect.objectContaining({ knobFindings: expect.any(Array) })
    );

    // Session report should be passed to completeRun
    expect(deps.completeRun).toHaveBeenCalledWith(
      expect.objectContaining({ sessionReport: "# Session Report" })
    );
  });

  it("falls back to static iteration when experiments provided", async () => {
    const proposeExperiment = vi.fn();
    const deps = makeAgentDeps({ proposeExperiment });
    const config = makeAgentConfig({
      experiments: [{ topK: 8 }],
    });

    const result = await runSession(config, deps);

    expect(proposeExperiment).not.toHaveBeenCalled();
    expect(deps.runExperiment).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("complete");
  });
});
