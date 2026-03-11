import type { EvalConfig } from "../eval-runner";

/**
 * ExperimentConfig extends EvalConfig with all tunable knobs available
 * for optimization. Each field represents a parameter that the optimizer
 * can vary between experiments.
 */
export type ExperimentConfig = EvalConfig & {
  /** Weight for BM25 full-text search in RRF fusion (default: 1.0) */
  fullTextWeight: number;
  /** Weight for semantic/vector search in RRF fusion (default: 1.0) */
  semanticWeight: number;
  /** Whether to enable Cohere cross-encoder reranking */
  rerankEnabled: boolean;
  /** Over-fetch multiplier when reranking (e.g., 4 means fetch 4x topK candidates) */
  rerankCandidateMultiplier: number;
};

/**
 * Weights for computing a single composite score from individual metrics.
 * Retrieval metrics (precisionAtK, recallAtK, mrr) are already on 0-1 scale.
 * Judge scores (faithfulness, relevance, completeness) are on 1-5 scale
 * and will be normalized to 0-1 before weighting.
 */
export type CompositeWeights = {
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
  faithfulness: number;
  relevance: number;
  completeness: number;
};

/**
 * Raw metrics from an eval run, used as input to composite score calculation.
 * Retrieval metrics are 0-1. Judge scores are 0-5 (or null if not available).
 */
export type EvalMetrics = {
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
  faithfulness: number;
  relevance: number;
  completeness: number;
};

/**
 * A single field-level diff entry showing the before and after value.
 */
export type ConfigDiffEntry = {
  before: string | number | boolean;
  after: string | number | boolean;
};

/**
 * A diff between two ExperimentConfig objects, keyed by the field name.
 * Only includes fields that changed.
 */
export type ConfigDiff = Partial<Record<keyof ExperimentConfig, ConfigDiffEntry>>;

/**
 * Create a default ExperimentConfig with sensible starting values.
 * These match the current codebase defaults.
 */
export function createDefaultConfig(): ExperimentConfig {
  return {
    model: "claude-sonnet-4-5-20250514",
    topK: 5,
    similarityThreshold: 0.3,
    fullTextWeight: 1.0,
    semanticWeight: 1.0,
    rerankEnabled: false,
    rerankCandidateMultiplier: 4,
  };
}

/**
 * Compute a diff between two configs, returning only the fields that changed.
 * Useful for logging what was varied in an experiment.
 */
export function configDiff(
  a: ExperimentConfig,
  b: ExperimentConfig
): ConfigDiff {
  const diff: ConfigDiff = {};
  const keys = Object.keys(a) as Array<keyof ExperimentConfig>;

  for (const key of keys) {
    if (a[key] !== b[key]) {
      diff[key] = {
        before: a[key],
        after: b[key],
      };
    }
  }

  return diff;
}

/**
 * Serialize a config to a deterministic JSON string with sorted keys.
 * Used for storing configs in the database and comparing across sessions.
 */
export function serializeConfig(config: ExperimentConfig): string {
  const sortedKeys = (Object.keys(config) as Array<keyof ExperimentConfig>).sort();
  const sorted: Record<string, string | number | boolean> = {};
  for (const key of sortedKeys) {
    sorted[key] = config[key];
  }
  return JSON.stringify(sorted);
}

const JUDGE_SCORE_MAX = 5;

/**
 * Compute a single composite score from eval metrics and user-defined weights.
 *
 * Retrieval metrics (precisionAtK, recallAtK, mrr) are already on 0-1 scale.
 * Judge scores (faithfulness, relevance, completeness) are on 1-5 scale and
 * are normalized to 0-1 before weighting by dividing by JUDGE_SCORE_MAX.
 *
 * Null/undefined judge scores are treated as 0.
 */
export function computeCompositeScore(
  metrics: EvalMetrics,
  weights: CompositeWeights
): number {
  const safeValue = (v: number | null | undefined): number =>
    v != null && !Number.isNaN(v) ? v : 0;

  const retrieval =
    weights.precisionAtK * safeValue(metrics.precisionAtK) +
    weights.recallAtK * safeValue(metrics.recallAtK) +
    weights.mrr * safeValue(metrics.mrr);

  const judge =
    weights.faithfulness * (safeValue(metrics.faithfulness) / JUDGE_SCORE_MAX) +
    weights.relevance * (safeValue(metrics.relevance) / JUDGE_SCORE_MAX) +
    weights.completeness * (safeValue(metrics.completeness) / JUDGE_SCORE_MAX);

  return retrieval + judge;
}
