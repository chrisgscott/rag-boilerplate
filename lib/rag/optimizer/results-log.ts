import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExperimentConfig, CompositeWeights, ConfigDiff } from "./config";

// --- Input types (camelCase for TypeScript callers) ---

export type OptimizationRunInsert = {
  organizationId: string;
  testSetId: string;
  baselineConfig: ExperimentConfig;
  baselineScore: number;
  compositeWeights: CompositeWeights;
};

export type OptimizationRunComplete = {
  runId: string;
  status: "complete" | "error";
  bestConfig: ExperimentConfig | null;
  bestScore: number | null;
  experimentsRun: number;
  errorMessage?: string;
  sessionReport?: string;
};

export type ExperimentInsert = {
  runId: string;
  organizationId: string;
  experimentIndex: number;
  config: ExperimentConfig;
  configDelta: ConfigDiff;
  compositeScore: number;
  delta: number;
  status: ExperimentStatus;
  retrievalMetrics: Record<string, number> | null;
  judgeScores: Record<string, number> | null;
  reasoning: string | null;
  hypothesis: string | null;
  corpusFingerprint: Record<string, unknown> | null;
  errorMessage?: string;
};

export type BestConfigUpsert = {
  organizationId: string;
  config: ExperimentConfig;
  compositeScore: number;
  compositeWeights: CompositeWeights;
  runId: string;
};

// --- Shared status unions matching DB CHECK constraints ---

export type RunStatus = "pending" | "running" | "complete" | "error";
export type ExperimentStatus = "kept" | "discarded" | "error";

// --- Row types (snake_case matching Supabase) ---

export type OptimizationRunRow = {
  id: string;
  organization_id: string;
  test_set_id: string | null;
  status: RunStatus;
  baseline_config: Record<string, unknown>;
  baseline_score: number | null;
  best_config: Record<string, unknown> | null;
  best_score: number | null;
  composite_weights: Record<string, unknown>;
  experiments_run: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  session_report: string | null;
};

export type OptimizationExperimentRow = {
  id: string;
  run_id: string;
  organization_id: string;
  experiment_index: number;
  config: Record<string, unknown>;
  config_delta: Record<string, unknown>;
  composite_score: number;
  delta: number;
  status: ExperimentStatus;
  retrieval_metrics: Record<string, number> | null;
  judge_scores: Record<string, number> | null;
  reasoning: string | null;
  hypothesis: string | null;
  corpus_fingerprint: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
};

export type OptimizationConfigRow = {
  organization_id: string;
  config: Record<string, unknown>;
  composite_score: number | null;
  composite_weights: Record<string, unknown>;
  run_id: string | null;
  updated_at: string;
};

// --- Functions ---

/**
 * Create a new optimization run (session). Returns the inserted row.
 */
export async function createOptimizationRun(
  supabase: SupabaseClient,
  input: OptimizationRunInsert
): Promise<OptimizationRunRow> {
  const { data, error } = await supabase
    .from("optimization_runs")
    .insert({
      organization_id: input.organizationId,
      test_set_id: input.testSetId,
      status: "running",
      baseline_config: input.baselineConfig,
      baseline_score: input.baselineScore,
      composite_weights: input.compositeWeights,
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as OptimizationRunRow;
}

/**
 * Activate a pending run — update with baseline data and set status to "running".
 */
export async function activateOptimizationRun(
  supabase: SupabaseClient,
  runId: string,
  input: OptimizationRunInsert
): Promise<void> {
  const { error } = await supabase
    .from("optimization_runs")
    .update({
      status: "running",
      baseline_config: input.baselineConfig,
      baseline_score: input.baselineScore,
      composite_weights: input.compositeWeights,
    })
    .eq("id", runId);

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Complete an optimization run — update status, best config/score, experiment count.
 */
export async function completeOptimizationRun(
  supabase: SupabaseClient,
  input: OptimizationRunComplete
): Promise<void> {
  const updatePayload: Record<string, unknown> = {
    status: input.status,
    best_config: input.bestConfig,
    best_score: input.bestScore,
    experiments_run: input.experimentsRun,
    completed_at: new Date().toISOString(),
    error_message: input.errorMessage ?? null,
    session_report: input.sessionReport ?? null,
  };

  const { error } = await supabase
    .from("optimization_runs")
    .update(updatePayload)
    .eq("id", input.runId);

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Log a single experiment result. Returns the inserted row.
 */
export async function logExperiment(
  supabase: SupabaseClient,
  input: ExperimentInsert
): Promise<OptimizationExperimentRow> {
  const insertPayload: Record<string, unknown> = {
    run_id: input.runId,
    organization_id: input.organizationId,
    experiment_index: input.experimentIndex,
    config: input.config,
    config_delta: input.configDelta,
    composite_score: input.compositeScore,
    delta: input.delta,
    status: input.status,
    retrieval_metrics: input.retrievalMetrics,
    judge_scores: input.judgeScores,
    reasoning: input.reasoning,
    hypothesis: input.hypothesis ?? null,
    corpus_fingerprint: input.corpusFingerprint ?? null,
    error_message: input.errorMessage ?? null,
  };

  const { data, error } = await supabase
    .from("optimization_experiments")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as OptimizationExperimentRow;
}

/**
 * Get all experiments for a run, ordered by experiment_index ascending.
 */
export async function getRunExperiments(
  supabase: SupabaseClient,
  runId: string
): Promise<OptimizationExperimentRow[]> {
  const { data, error } = await supabase
    .from("optimization_experiments")
    .select()
    .eq("run_id", runId)
    .order("experiment_index", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as OptimizationExperimentRow[];
}

/**
 * Upsert the best known config for an organization.
 * Uses organization_id as the conflict key.
 */
export async function upsertBestConfig(
  supabase: SupabaseClient,
  input: BestConfigUpsert
): Promise<void> {
  const { error } = await supabase
    .from("optimization_configs")
    .upsert(
      {
        organization_id: input.organizationId,
        config: input.config,
        composite_score: input.compositeScore,
        composite_weights: input.compositeWeights,
        run_id: input.runId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" }
    )
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Get the best known config for an organization. Returns null if none exists.
 */
export async function getBestConfig(
  supabase: SupabaseClient,
  organizationId: string
): Promise<OptimizationConfigRow | null> {
  const { data, error } = await supabase
    .from("optimization_configs")
    .select()
    .eq("organization_id", organizationId)
    .single();

  if (error) {
    // "PGRST116" = no rows found — not an error for us
    if (error.code === "PGRST116") {
      return null;
    }
    throw new Error(error.message);
  }

  return data as OptimizationConfigRow | null;
}

// --- Insights CRUD ---

export type InsightsRow = {
  organization_id: string;
  insights: Record<string, unknown>;
  updated_at: string;
};

/**
 * Get cumulative optimization insights for an organization. Returns null if none exist.
 */
export async function getInsights(
  supabase: SupabaseClient,
  organizationId: string
): Promise<InsightsRow | null> {
  const { data, error } = await supabase
    .from("optimization_insights")
    .select()
    .eq("organization_id", organizationId)
    .single();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(error.message);
  }
  return data as InsightsRow;
}

/**
 * Upsert cumulative optimization insights for an organization.
 */
export async function upsertInsights(
  supabase: SupabaseClient,
  organizationId: string,
  insights: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from("optimization_insights")
    .upsert(
      {
        organization_id: organizationId,
        insights,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" }
    )
    .select()
    .single();
  if (error) throw new Error(error.message);
}
