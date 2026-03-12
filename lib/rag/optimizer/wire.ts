/**
 * Wiring module — builds SessionConfig and SessionDeps from real implementations.
 * Used by server actions and API routes to run optimization sessions.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionConfig, SessionDeps, BaselineResult } from "./session";
import type { ExperimentConfig, CompositeWeights } from "./config";
import type { ExperimentInput, ExperimentTestCase } from "./experiment";
import type { CumulativeInsights } from "./agent";
import { runSession } from "./session";
import { runExperiment } from "./experiment";
import { createDefaultConfig } from "./config";
import { computeCompositeScore } from "./config";
import { runEvaluation } from "../eval-runner";
import { getModelId } from "../provider";
import {
  createOptimizationRun,
  activateOptimizationRun,
  completeOptimizationRun,
  logExperiment,
  upsertBestConfig,
  getInsights,
  upsertInsights,
} from "./results-log";
import { getCorpusFingerprint } from "./corpus";
import { proposeExperiment } from "./agent";
import { generateSessionReport, buildInsightsFromHistory } from "./report";

/** Default composite weights — equal weight to all metrics */
const DEFAULT_WEIGHTS: CompositeWeights = {
  precisionAtK: 0.15,
  recallAtK: 0.15,
  mrr: 0.10,
  faithfulness: 0.20,
  relevance: 0.20,
  completeness: 0.20,
};

/**
 * Find the org's test set. Returns the first (most recent) test set ID, or null.
 */
async function findTestSetId(
  supabase: SupabaseClient,
  organizationId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("eval_test_sets")
    .select("id")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Build SessionDeps from a Supabase admin client.
 */
function buildSessionDeps(supabase: SupabaseClient): SessionDeps {
  // Bind evalRunner: adapt runEvaluation to the ExperimentDeps.evalRunner signature
  const evalRunner = async (
    testCases: ExperimentTestCase[],
    organizationId: string,
    config: ExperimentConfig
  ) => {
    return runEvaluation(supabase, testCases, organizationId, config);
  };

  return {
    runExperiment: (input: ExperimentInput) =>
      runExperiment(input, { evalRunner }),

    createRun: (input) => createOptimizationRun(supabase, input),

    activateRun: (runId, input) =>
      activateOptimizationRun(supabase, runId, input),

    completeRun: (input) => completeOptimizationRun(supabase, input),

    logExperiment: (input) => logExperiment(supabase, input),

    upsertBestConfig: (input) => upsertBestConfig(supabase, input),

    getTestCases: async (testSetId: string) => {
      const { data, error } = await supabase
        .from("eval_test_cases")
        .select("id, question, expected_answer, expected_source_ids")
        .eq("test_set_id", testSetId)
        .eq("status", "validated");
      if (error) throw new Error(error.message);
      return (data ?? []) as ExperimentTestCase[];
    },

    runBaseline: async (
      config: ExperimentConfig,
      testCases: ExperimentTestCase[],
      organizationId: string,
      weights: CompositeWeights
    ): Promise<BaselineResult> => {
      const evalResult = await runEvaluation(
        supabase,
        testCases,
        organizationId,
        config
      );

      const retrievalMetrics = {
        precisionAtK: evalResult.aggregate.precisionAtK,
        recallAtK: evalResult.aggregate.recallAtK,
        mrr: evalResult.aggregate.mrr,
      };

      const judgeScores =
        evalResult.avgFaithfulness != null
          ? {
              faithfulness: evalResult.avgFaithfulness!,
              relevance: evalResult.avgRelevance!,
              completeness: evalResult.avgCompleteness!,
            }
          : null;

      const compositeScore = computeCompositeScore(
        {
          ...retrievalMetrics,
          faithfulness: judgeScores?.faithfulness ?? 0,
          relevance: judgeScores?.relevance ?? 0,
          completeness: judgeScores?.completeness ?? 0,
        },
        weights
      );

      return { compositeScore, retrievalMetrics, judgeScores };
    },

    // Agent-driven mode deps
    proposeExperiment: (context) => proposeExperiment(context),

    getCorpusFingerprint: (organizationId) =>
      getCorpusFingerprint(supabase, organizationId),

    getInsights: async (organizationId) => {
      const row = await getInsights(supabase, organizationId);
      return row ? (row.insights as CumulativeInsights) : null;
    },

    upsertInsights: async (organizationId, insights) => {
      await upsertInsights(supabase, organizationId, insights);
    },

    generateReport: (params) => generateSessionReport(params),
  };
}

/**
 * Start an optimization session as fire-and-forget.
 * Returns immediately after validation; the session runs in the background.
 *
 * Throws if no test set exists for the organization.
 */
export async function startOptimizationSession(
  supabase: SupabaseClient,
  organizationId: string,
  options?: {
    maxExperiments?: number;
    maxBudgetUsd?: number;
  }
): Promise<{ status: "started" }> {
  // Find test set
  const testSetId = await findTestSetId(supabase, organizationId);
  if (!testSetId) {
    throw new Error(
      "No test set found. Generate test cases before running optimization."
    );
  }

  // Build baseline config with the correct model for the configured provider
  const baselineConfig = createDefaultConfig();
  baselineConfig.model = getModelId();

  const deps = buildSessionDeps(supabase);

  // Create a "pending" run record NOW so the UI can see it immediately.
  // runSession will activate it to "running" after baseline eval completes.
  const { data: pendingRun, error: insertError } = await supabase
    .from("optimization_runs")
    .insert({
      organization_id: organizationId,
      test_set_id: testSetId,
      status: "pending",
      baseline_config: baselineConfig,
      baseline_score: null,
      composite_weights: DEFAULT_WEIGHTS,
    })
    .select()
    .single();

  if (insertError) throw new Error(insertError.message);

  const config: SessionConfig = {
    organizationId,
    testSetId,
    compositeWeights: DEFAULT_WEIGHTS,
    maxExperiments: options?.maxExperiments ?? 10,
    maxBudgetUsd: options?.maxBudgetUsd ?? 20,
    baselineConfig,
    existingRunId: pendingRun.id,
  };

  // Fire-and-forget — session runs in background, will activate the pending record
  void runSession(config, deps).catch((err) => {
    console.error("[optimizer] Session failed:", err);
  });

  return { status: "started" };
}
