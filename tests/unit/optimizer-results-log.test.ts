import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createOptimizationRun,
  completeOptimizationRun,
  logExperiment,
  getRunExperiments,
  upsertBestConfig,
  getBestConfig,
  type OptimizationRunInsert,
  type ExperimentInsert,
} from "@/lib/rag/optimizer/results-log";
import { createDefaultConfig } from "@/lib/rag/optimizer/config";
import type { CompositeWeights } from "@/lib/rag/optimizer/config";

// --- Mock Supabase client factory ---

function createMockSupabase(overrides?: {
  insertReturn?: { data: unknown; error: unknown };
  selectReturn?: { data: unknown; error: unknown };
  updateReturn?: { data: unknown; error: unknown };
  upsertReturn?: { data: unknown; error: unknown };
}) {
  const defaults = {
    insertReturn: { data: [{ id: "run-1" }], error: null },
    selectReturn: { data: [], error: null },
    updateReturn: { data: [{ id: "run-1" }], error: null },
    upsertReturn: { data: [{}], error: null },
  };
  const resolved = { ...defaults, ...overrides };

  const chainable = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockImplementation(() => {
      return resolved.selectReturn.data
        ? { data: Array.isArray(resolved.selectReturn.data) ? resolved.selectReturn.data[0] : resolved.selectReturn.data, error: resolved.selectReturn.error }
        : { data: null, error: resolved.selectReturn.error };
    }),
    // Terminal methods that resolve the chain
    then: undefined as unknown,
  };

  // Make select/insert/update/upsert return different resolved values
  const selectChain = {
    ...chainable,
    eq: vi.fn().mockReturnValue({
      ...chainable,
      order: vi.fn().mockReturnValue(resolved.selectReturn),
      single: vi.fn().mockReturnValue({
        data: Array.isArray(resolved.selectReturn.data) ? resolved.selectReturn.data[0] : resolved.selectReturn.data,
        error: resolved.selectReturn.error,
      }),
    }),
    order: vi.fn().mockReturnValue(resolved.selectReturn),
  };

  const insertChain = {
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockReturnValue(resolved.insertReturn),
    }),
  };

  const updateChain = {
    eq: vi.fn().mockReturnValue(resolved.updateReturn),
  };

  const upsertChain = {
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockReturnValue(resolved.upsertReturn),
    }),
  };

  const from = vi.fn().mockImplementation(() => ({
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue(insertChain),
    update: vi.fn().mockReturnValue(updateChain),
    upsert: vi.fn().mockReturnValue(upsertChain),
  }));

  return { from } as unknown as SupabaseClient;
}

// --- Tests ---

describe("results-log", () => {
  const orgId = "org-123";
  const testSetId = "test-set-456";
  const defaultWeights: CompositeWeights = {
    precisionAtK: 0.2,
    recallAtK: 0.2,
    mrr: 0.1,
    faithfulness: 0.2,
    relevance: 0.2,
    completeness: 0.1,
  };

  describe("createOptimizationRun", () => {
    it("inserts a new run and returns the created row", async () => {
      const runRow = {
        id: "run-1",
        organization_id: orgId,
        test_set_id: testSetId,
        status: "running",
        baseline_config: createDefaultConfig(),
        baseline_score: 0.65,
        composite_weights: defaultWeights,
      };

      const supabase = createMockSupabase({
        insertReturn: { data: runRow, error: null },
      });

      const input: OptimizationRunInsert = {
        organizationId: orgId,
        testSetId: testSetId,
        baselineConfig: createDefaultConfig(),
        baselineScore: 0.65,
        compositeWeights: defaultWeights,
      };

      const result = await createOptimizationRun(supabase, input);

      expect(result.id).toBe("run-1");
      expect(supabase.from).toHaveBeenCalledWith("optimization_runs");
    });

    it("throws on Supabase error", async () => {
      const supabase = createMockSupabase({
        insertReturn: { data: null, error: { message: "insert failed" } },
      });

      const input: OptimizationRunInsert = {
        organizationId: orgId,
        testSetId: testSetId,
        baselineConfig: createDefaultConfig(),
        baselineScore: 0.65,
        compositeWeights: defaultWeights,
      };

      await expect(createOptimizationRun(supabase, input)).rejects.toThrow(
        "insert failed"
      );
    });
  });

  describe("completeOptimizationRun", () => {
    it("updates run status and best config", async () => {
      const supabase = createMockSupabase({
        updateReturn: { data: { id: "run-1" }, error: null },
      });

      await expect(
        completeOptimizationRun(supabase, {
          runId: "run-1",
          status: "complete",
          bestConfig: createDefaultConfig(),
          bestScore: 0.78,
          experimentsRun: 5,
        })
      ).resolves.not.toThrow();

      expect(supabase.from).toHaveBeenCalledWith("optimization_runs");
    });

    it("throws on Supabase error", async () => {
      const supabase = createMockSupabase({
        updateReturn: { data: null, error: { message: "update failed" } },
      });

      await expect(
        completeOptimizationRun(supabase, {
          runId: "run-1",
          status: "error",
          bestConfig: null,
          bestScore: null,
          experimentsRun: 0,
          errorMessage: "something broke",
        })
      ).rejects.toThrow("update failed");
    });
  });

  describe("logExperiment", () => {
    it("inserts an experiment row and returns it", async () => {
      const experimentRow = {
        id: "exp-1",
        run_id: "run-1",
        organization_id: orgId,
        experiment_index: 0,
        config: createDefaultConfig(),
        config_delta: { topK: { before: 5, after: 10 } },
        composite_score: 0.72,
        delta: 0.07,
        status: "kept",
        retrieval_metrics: { precisionAtK: 0.8, recallAtK: 0.7, mrr: 0.9 },
        judge_scores: null,
        reasoning: "Increasing topK improved recall",
      };

      const supabase = createMockSupabase({
        insertReturn: { data: experimentRow, error: null },
      });

      const input: ExperimentInsert = {
        runId: "run-1",
        organizationId: orgId,
        experimentIndex: 0,
        config: createDefaultConfig(),
        configDelta: { topK: { before: 5, after: 10 } },
        compositeScore: 0.72,
        delta: 0.07,
        status: "kept",
        retrievalMetrics: { precisionAtK: 0.8, recallAtK: 0.7, mrr: 0.9 },
        judgeScores: null,
        reasoning: "Increasing topK improved recall",
      };

      const result = await logExperiment(supabase, input);

      expect(result.id).toBe("exp-1");
      expect(supabase.from).toHaveBeenCalledWith("optimization_experiments");
    });
  });

  describe("getRunExperiments", () => {
    it("returns experiments for a run ordered by index", async () => {
      const experiments = [
        { id: "exp-1", experiment_index: 0, status: "kept" },
        { id: "exp-2", experiment_index: 1, status: "discarded" },
      ];

      const supabase = createMockSupabase({
        selectReturn: { data: experiments, error: null },
      });

      const result = await getRunExperiments(supabase, "run-1");

      expect(result).toHaveLength(2);
      expect(supabase.from).toHaveBeenCalledWith("optimization_experiments");
    });

    it("returns empty array when no experiments exist", async () => {
      const supabase = createMockSupabase({
        selectReturn: { data: [], error: null },
      });

      const result = await getRunExperiments(supabase, "run-1");
      expect(result).toHaveLength(0);
    });
  });

  describe("upsertBestConfig", () => {
    it("upserts the best config for an organization", async () => {
      const config = createDefaultConfig();
      const supabase = createMockSupabase({
        upsertReturn: { data: { organization_id: orgId }, error: null },
      });

      await expect(
        upsertBestConfig(supabase, {
          organizationId: orgId,
          config,
          compositeScore: 0.85,
          compositeWeights: defaultWeights,
          runId: "run-1",
        })
      ).resolves.not.toThrow();

      expect(supabase.from).toHaveBeenCalledWith("optimization_configs");
    });
  });

  describe("getBestConfig", () => {
    it("returns the current best config for an org", async () => {
      const configRow = {
        organization_id: orgId,
        config: createDefaultConfig(),
        composite_score: 0.85,
        composite_weights: defaultWeights,
        run_id: "run-1",
      };

      const supabase = createMockSupabase({
        selectReturn: { data: configRow, error: null },
      });

      const result = await getBestConfig(supabase, orgId);

      expect(result).not.toBeNull();
      expect(result?.config).toEqual(createDefaultConfig());
    });

    it("returns null when no best config exists", async () => {
      const supabase = createMockSupabase({
        selectReturn: { data: null, error: null },
      });

      const result = await getBestConfig(supabase, orgId);
      expect(result).toBeNull();
    });
  });
});
