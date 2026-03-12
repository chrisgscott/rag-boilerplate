import type { ExperimentConfig, CompositeWeights } from "./config";
import { createDefaultConfig } from "./config";
import type { ExperimentInput, ExperimentResult, ExperimentTestCase, RetrievalMetricsResult, JudgeScoresResult } from "./experiment";
import type { OptimizationRunInsert, OptimizationRunComplete, ExperimentInsert, BestConfigUpsert, OptimizationRunRow } from "./results-log";

/**
 * Configuration for an optimization session.
 */
export type SessionConfig = {
  organizationId: string;
  testSetId: string;
  compositeWeights: CompositeWeights;
  /** Maximum number of experiments to run (budget cap) */
  maxExperiments: number;
  /** Maximum API spend in USD. NOTE: Cost tracking deferred to Phase 3 (agent decide step).
   *  maxExperiments is the primary budget cap for now. This field is declared for
   *  forward compatibility so callers set it from day one. */
  maxBudgetUsd: number;
  /** Ordered list of config overrides to try */
  experiments: Partial<ExperimentConfig>[];
  /** Optional starting config (defaults to createDefaultConfig()) */
  baselineConfig?: ExperimentConfig;
};

/**
 * Baseline eval result — score + metrics from running the current config.
 */
export type BaselineResult = {
  compositeScore: number;
  retrievalMetrics: RetrievalMetricsResult;
  judgeScores: JudgeScoresResult | null;
};

/**
 * Session result returned after all experiments complete.
 */
export type SessionResult = {
  runId: string;
  experimentsRun: number;
  bestConfig: ExperimentConfig;
  bestScore: number;
  baselineScore: number;
  keptCount: number;
  discardedCount: number;
  errorCount: number;
  status: "complete" | "error";
  errorMessage?: string;
};

/**
 * Dependency injection for the session loop.
 * All external side effects are injected so the loop is pure + testable.
 */
export type SessionDeps = {
  /** Run a single experiment. The caller is responsible for binding the eval runner. */
  runExperiment: (input: ExperimentInput) => Promise<ExperimentResult>;
  createRun: (input: OptimizationRunInsert) => Promise<OptimizationRunRow>;
  completeRun: (input: OptimizationRunComplete) => Promise<void>;
  logExperiment: (input: ExperimentInsert) => Promise<any>;
  upsertBestConfig: (input: BestConfigUpsert) => Promise<void>;
  getTestCases: (testSetId: string) => Promise<ExperimentTestCase[]>;
  runBaseline: (config: ExperimentConfig, testCases: ExperimentTestCase[], organizationId: string, weights: CompositeWeights) => Promise<BaselineResult>;
};

/**
 * Run an optimization session: establish baseline, iterate experiments,
 * track best config, log everything.
 */
export async function runSession(
  config: SessionConfig,
  deps: SessionDeps
): Promise<SessionResult> {
  const baseline = config.baselineConfig ?? createDefaultConfig();

  // 1. Fetch test cases
  const testCases = await deps.getTestCases(config.testSetId);

  // 2. Run baseline eval
  const baselineResult = await deps.runBaseline(
    baseline,
    testCases,
    config.organizationId,
    config.compositeWeights
  );

  // 3. Create optimization run
  const run = await deps.createRun({
    organizationId: config.organizationId,
    testSetId: config.testSetId,
    baselineConfig: baseline,
    baselineScore: baselineResult.compositeScore,
    compositeWeights: config.compositeWeights,
  });

  let currentConfig = { ...baseline };
  let currentScore = baselineResult.compositeScore;
  let bestConfig = { ...baseline };
  let bestScore = baselineResult.compositeScore;
  let experimentsRun = 0;
  let keptCount = 0;
  let discardedCount = 0;
  let errorCount = 0;

  try {
    // 4. Iterate experiments up to maxExperiments
    const maxToRun = Math.min(config.experiments.length, config.maxExperiments);

    for (let i = 0; i < maxToRun; i++) {
      const overrides = config.experiments[i];

      const experimentInput: ExperimentInput = {
        baselineConfig: currentConfig,
        baselineScore: currentScore,
        configOverrides: overrides,
        compositeWeights: config.compositeWeights,
        organizationId: config.organizationId,
        runId: run.id,
        experimentIndex: i,
        testCases,
      };

      // Run experiment — deps.runExperiment is pre-bound with its own evalRunner
      const result = await deps.runExperiment(experimentInput);

      experimentsRun++;

      // Log experiment
      await deps.logExperiment({
        runId: run.id,
        organizationId: config.organizationId,
        experimentIndex: i,
        config: result.experimentConfig,
        configDelta: result.configDelta,
        compositeScore: result.compositeScore,
        delta: result.delta,
        status: result.status,
        retrievalMetrics: result.retrievalMetrics,
        judgeScores: result.judgeScores,
        reasoning: null,
        errorMessage: result.errorMessage,
      });

      // Track outcomes
      if (result.status === "kept") {
        keptCount++;
        currentConfig = { ...result.experimentConfig };
        currentScore = result.compositeScore;
        if (result.compositeScore > bestScore) {
          bestConfig = { ...result.experimentConfig };
          bestScore = result.compositeScore;
        }
      } else if (result.status === "error") {
        errorCount++;
      } else {
        discardedCount++;
      }
    }

    // 5. Upsert best config if we found an improvement
    if (bestScore > baselineResult.compositeScore) {
      await deps.upsertBestConfig({
        organizationId: config.organizationId,
        config: bestConfig,
        compositeScore: bestScore,
        compositeWeights: config.compositeWeights,
        runId: run.id,
      });
    }

    // 6. Complete run
    await deps.completeRun({
      runId: run.id,
      status: "complete",
      bestConfig: bestScore > baselineResult.compositeScore ? bestConfig : null,
      bestScore: bestScore > baselineResult.compositeScore ? bestScore : null,
      experimentsRun,
    });

    return {
      runId: run.id,
      experimentsRun,
      bestConfig,
      bestScore,
      baselineScore: baselineResult.compositeScore,
      keptCount,
      discardedCount,
      errorCount,
      status: "complete",
    };
  } catch (err) {
    // Mark run as error
    await deps.completeRun({
      runId: run.id,
      status: "error",
      bestConfig: null,
      bestScore: null,
      experimentsRun,
      errorMessage: err instanceof Error ? err.message : String(err),
    });

    return {
      runId: run.id,
      experimentsRun,
      bestConfig: currentConfig,
      bestScore: currentScore,
      baselineScore: baselineResult.compositeScore,
      keptCount,
      discardedCount,
      errorCount,
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
