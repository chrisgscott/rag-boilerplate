import type { ExperimentConfig, CompositeWeights } from "./config";
import { createDefaultConfig, computeCompositeScore } from "./config";
import type { ExperimentInput, ExperimentResult, ExperimentTestCase, RetrievalMetricsResult, JudgeScoresResult } from "./experiment";
import type { OptimizationRunInsert, OptimizationRunComplete, ExperimentInsert, BestConfigUpsert, OptimizationRunRow } from "./results-log";
import type { AgentContext, ExperimentProposal, CumulativeInsights, PerCaseMetric, SessionHistoryEntry } from "./agent";
import type { CorpusFingerprint } from "./corpus";

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
  /** Ordered list of config overrides to try. When empty/absent, agent-driven mode is used. */
  experiments?: Partial<ExperimentConfig>[];
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
  /** Agent-driven mode: propose next experiment based on context */
  proposeExperiment?: (context: AgentContext) => Promise<ExperimentProposal>;
  /** Agent-driven mode: get corpus fingerprint for the organization */
  getCorpusFingerprint?: (organizationId: string) => Promise<CorpusFingerprint>;
  /** Agent-driven mode: get cumulative insights from previous sessions */
  getInsights?: (organizationId: string) => Promise<CumulativeInsights | null>;
  /** Agent-driven mode: persist updated cumulative insights */
  upsertInsights?: (organizationId: string, insights: CumulativeInsights) => Promise<void>;
  /** Agent-driven mode: generate a session report */
  generateReport?: (params: any) => string;
};

/**
 * Build per-case metrics from experiment result for agent context.
 */
function buildPerCaseMetrics(
  perCase: NonNullable<ExperimentResult["perCase"]>,
  weights: CompositeWeights
): PerCaseMetric[] {
  return perCase.map((pc) => ({
    testCaseId: pc.testCaseId,
    question: pc.question,
    compositeScore: computeCompositeScore(
      {
        precisionAtK: pc.precisionAtK,
        recallAtK: pc.recallAtK,
        mrr: pc.mrr,
        faithfulness: pc.faithfulness ?? 0,
        relevance: pc.relevance ?? 0,
        completeness: pc.completeness ?? 0,
      },
      weights
    ),
    precisionAtK: pc.precisionAtK,
    recallAtK: pc.recallAtK,
    mrr: pc.mrr,
    faithfulness: pc.faithfulness,
    relevance: pc.relevance,
    completeness: pc.completeness,
  }));
}

/**
 * Run an optimization session: establish baseline, iterate experiments,
 * track best config, log everything.
 *
 * Two modes:
 * - Static mode: config.experiments has items — iterate them in order.
 * - Agent-driven mode: config.experiments is empty/absent — use LLM agent OODA loop.
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
  let sessionReport: string | undefined;

  const useAgentMode = !config.experiments || config.experiments.length === 0;

  try {
    if (useAgentMode && deps.proposeExperiment) {
      // --- Agent-driven OODA loop ---
      const fingerprint = await deps.getCorpusFingerprint!(config.organizationId);
      const existingInsights =
        (await deps.getInsights?.(config.organizationId)) ?? null;
      let insights = existingInsights;
      const history: SessionHistoryEntry[] = [];
      let lastPerCaseMetrics: PerCaseMetric[] = [];

      let experimentIndex = 0;
      while (experimentIndex < config.maxExperiments) {
        const agentContext: AgentContext = {
          currentConfig,
          perCaseMetrics: [...lastPerCaseMetrics],
          sessionHistory: [...history],
          cumulativeInsights: insights,
          corpusFingerprint: fingerprint,
        };

        const proposal = await deps.proposeExperiment(agentContext);

        if (proposal.stop) break;

        const overrides = {
          [proposal.knob!]: proposal.value!,
        } as Partial<ExperimentConfig>;

        const experimentInput: ExperimentInput = {
          baselineConfig: currentConfig,
          baselineScore: currentScore,
          configOverrides: overrides,
          compositeWeights: config.compositeWeights,
          organizationId: config.organizationId,
          runId: run.id,
          experimentIndex,
          testCases,
        };

        const result = await deps.runExperiment(experimentInput);
        experimentsRun++;

        // Log experiment with agent reasoning
        await deps.logExperiment({
          runId: run.id,
          organizationId: config.organizationId,
          experimentIndex,
          config: result.experimentConfig,
          configDelta: result.configDelta,
          compositeScore: result.compositeScore,
          delta: result.delta,
          status: result.status,
          retrievalMetrics: result.retrievalMetrics,
          judgeScores: result.judgeScores,
          reasoning: proposal.reasoning,
          hypothesis: proposal.hypothesis,
          corpusFingerprint: fingerprint,
          errorMessage: result.errorMessage,
        });

        // Build history entry for agent
        history.push({
          experimentIndex,
          knob: proposal.knob!,
          valueTested: proposal.value! as number | boolean,
          delta: result.delta,
          status: result.status,
          reasoning: proposal.reasoning,
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
          // Update per-case metrics from kept experiment
          if (result.perCase) {
            lastPerCaseMetrics = buildPerCaseMetrics(
              result.perCase,
              config.compositeWeights
            );
          }
        } else if (result.status === "error") {
          errorCount++;
        } else {
          discardedCount++;
          // Keep previous per-case metrics (config reverted)
        }

        experimentIndex++;
      }

      // Generate report
      if (deps.generateReport) {
        sessionReport = deps.generateReport({
          baselineConfig: baseline,
          finalConfig: bestConfig,
          baselineScore: baselineResult.compositeScore,
          bestScore,
          experiments: history.map((h) => ({
            index: h.experimentIndex,
            knob: h.knob,
            valueTested: h.valueTested,
            delta: h.delta,
            status: h.status,
            reasoning: h.reasoning,
          })),
          corpusFingerprint: fingerprint,
        });
      }

      // Update insights
      if (deps.upsertInsights && history.length > 0) {
        const { buildInsightsFromHistory } = await import("./report");
        const updatedInsights = buildInsightsFromHistory(
          history.map((h) => ({
            knob: h.knob,
            delta: h.delta,
            status: h.status,
            corpusFingerprint: fingerprint,
          })),
          insights
        );
        await deps.upsertInsights(config.organizationId, updatedInsights);
      }
    } else {
      // --- Static iteration mode ---
      const experiments = config.experiments ?? [];
      const maxToRun = Math.min(experiments.length, config.maxExperiments);

      for (let i = 0; i < maxToRun; i++) {
        const overrides = experiments[i];

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
          hypothesis: null,
          corpusFingerprint: null,
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
      sessionReport,
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
