import type { EvalRunResult } from "../eval-runner";
import type {
  ExperimentConfig,
  CompositeWeights,
  ConfigDiff,
} from "./config";
import { createDefaultConfig, configDiff, computeCompositeScore } from "./config";

/**
 * A test case passed to the experiment runner.
 */
export type ExperimentTestCase = {
  id: string;
  question: string;
  expected_answer: string | null;
  expected_source_ids: string[] | null;
};

/**
 * Input to runExperiment — everything needed to execute a single experiment.
 */
export type ExperimentInput = {
  /** The baseline config to merge overrides into */
  baselineConfig: ExperimentConfig;
  /** The baseline composite score to compare against */
  baselineScore: number;
  /** Config fields to override for this experiment */
  configOverrides: Partial<ExperimentConfig>;
  /** Weights for computing the composite score */
  compositeWeights: CompositeWeights;
  /** Organization ID for scoping the eval run */
  organizationId: string;
  /** The optimization run ID this experiment belongs to */
  runId: string;
  /** Sequential index of this experiment within the run */
  experimentIndex: number;
  /** Test cases to evaluate */
  testCases: ExperimentTestCase[];
};

/**
 * Retrieval metrics extracted from an eval run result.
 */
export type RetrievalMetricsResult = {
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
};

/**
 * Judge scores extracted from an eval run result.
 */
export type JudgeScoresResult = {
  faithfulness: number;
  relevance: number;
  completeness: number;
};

/**
 * The result of a single experiment run.
 */
export type ExperimentResult = {
  /** The full merged config used for this experiment */
  experimentConfig: ExperimentConfig;
  /** Diff between baseline and experiment config (only changed fields) */
  configDelta: ConfigDiff;
  /** The computed composite score */
  compositeScore: number;
  /** Delta from baseline (positive = improvement) */
  delta: number;
  /** Whether to keep or discard the experiment */
  status: "kept" | "discarded" | "error";
  /** Retrieval metrics from the eval run */
  retrievalMetrics: RetrievalMetricsResult;
  /** Judge scores (null if retrieval-only mode) */
  judgeScores: JudgeScoresResult | null;
  /** Per-case breakdown for agent-driven optimization */
  perCase: Array<{
    testCaseId: string;
    question: string;
    precisionAtK: number;
    recallAtK: number;
    mrr: number;
    faithfulness: number | null;
    relevance: number | null;
    completeness: number | null;
  }> | null;
  /** Error message if status is "error" */
  errorMessage?: string;
};

/**
 * Dependency injection for the eval runner, allowing tests to mock it.
 */
export type ExperimentDeps = {
  evalRunner: (
    testCases: ExperimentTestCase[],
    organizationId: string,
    config: ExperimentConfig
  ) => Promise<EvalRunResult>;
};

/**
 * Run a single experiment: merge config overrides with baseline, run eval,
 * compute composite score, determine keep/discard.
 *
 * This is a pure orchestration function — it does not write to Supabase.
 * The caller (session loop) is responsible for logging results.
 */
export async function runExperiment(
  input: ExperimentInput,
  deps: ExperimentDeps
): Promise<ExperimentResult> {
  // Merge overrides with baseline
  const experimentConfig: ExperimentConfig = {
    ...input.baselineConfig,
    ...input.configOverrides,
  };

  // Compute config diff
  const delta = configDiff(input.baselineConfig, experimentConfig);

  try {
    // Run eval with merged config
    const evalResult = await deps.evalRunner(
      input.testCases,
      input.organizationId,
      experimentConfig
    );

    // Extract retrieval metrics
    const retrievalMetrics: RetrievalMetricsResult = {
      precisionAtK: evalResult.aggregate.precisionAtK,
      recallAtK: evalResult.aggregate.recallAtK,
      mrr: evalResult.aggregate.mrr,
    };

    // Extract judge scores (null if not available)
    const judgeScores: JudgeScoresResult | null =
      evalResult.avgFaithfulness != null &&
      evalResult.avgRelevance != null &&
      evalResult.avgCompleteness != null
        ? {
            faithfulness: evalResult.avgFaithfulness,
            relevance: evalResult.avgRelevance,
            completeness: evalResult.avgCompleteness,
          }
        : null;

    // Compute composite score
    const compositeScore = computeCompositeScore(
      {
        precisionAtK: retrievalMetrics.precisionAtK,
        recallAtK: retrievalMetrics.recallAtK,
        mrr: retrievalMetrics.mrr,
        faithfulness: judgeScores?.faithfulness ?? 0,
        relevance: judgeScores?.relevance ?? 0,
        completeness: judgeScores?.completeness ?? 0,
      },
      input.compositeWeights
    );

    // Compute delta from baseline
    const scoreDelta = compositeScore - input.baselineScore;

    // Keep only if strictly better
    const status = scoreDelta > 0 ? "kept" : "discarded";

    return {
      experimentConfig,
      configDelta: delta,
      compositeScore,
      delta: scoreDelta,
      status,
      retrievalMetrics,
      judgeScores,
      perCase: evalResult.perCase?.map((pc) => ({
        testCaseId: pc.testCaseId,
        question: pc.question,
        precisionAtK: pc.precisionAtK,
        recallAtK: pc.recallAtK,
        mrr: pc.mrr,
        faithfulness: pc.judgeScores?.faithfulness ?? null,
        relevance: pc.judgeScores?.relevance ?? null,
        completeness: pc.judgeScores?.completeness ?? null,
      })) ?? null,
    };
  } catch (err) {
    return {
      experimentConfig,
      configDelta: delta,
      compositeScore: 0,
      delta: 0,
      status: "error",
      retrievalMetrics: { precisionAtK: 0, recallAtK: 0, mrr: 0 },
      judgeScores: null,
      perCase: null,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
