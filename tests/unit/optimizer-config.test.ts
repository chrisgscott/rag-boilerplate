import { describe, it, expect } from "vitest";
import {
  createDefaultConfig,
  configDiff,
  serializeConfig,
  type ExperimentConfig,
  type CompositeWeights,
  computeCompositeScore,
} from "@/lib/rag/optimizer/config";

describe("ExperimentConfig", () => {
  describe("createDefaultConfig", () => {
    it("returns a config with all required knobs", () => {
      const config = createDefaultConfig();

      // EvalConfig fields
      expect(config.model).toBe("claude-sonnet-4-5-20250514");
      expect(config.topK).toBe(5);
      expect(config.similarityThreshold).toBe(0.3);

      // Optimizer-specific fields
      expect(config.fullTextWeight).toBe(1.0);
      expect(config.semanticWeight).toBe(1.0);
      expect(config.rerankEnabled).toBe(false);
      expect(config.rerankCandidateMultiplier).toBe(4);
    });

    it("all fields are defined (no undefined values)", () => {
      const config = createDefaultConfig();
      for (const [key, value] of Object.entries(config)) {
        expect(value, `${key} should not be undefined`).toBeDefined();
      }
    });
  });

  describe("configDiff", () => {
    it("returns empty object when configs are identical", () => {
      const a = createDefaultConfig();
      const b = createDefaultConfig();
      const diff = configDiff(a, b);
      expect(Object.keys(diff)).toHaveLength(0);
    });

    it("returns changed fields with before/after values", () => {
      const a = createDefaultConfig();
      const b: ExperimentConfig = { ...a, topK: 10, fullTextWeight: 2.0 };
      const diff = configDiff(a, b);

      expect(diff).toEqual({
        topK: { before: 5, after: 10 },
        fullTextWeight: { before: 1.0, after: 2.0 },
      });
    });

    it("detects boolean changes", () => {
      const a = createDefaultConfig();
      const b: ExperimentConfig = { ...a, rerankEnabled: true };
      const diff = configDiff(a, b);

      expect(diff).toEqual({
        rerankEnabled: { before: false, after: true },
      });
    });

    it("detects string changes", () => {
      const a = createDefaultConfig();
      const b: ExperimentConfig = { ...a, model: "gpt-4o" };
      const diff = configDiff(a, b);

      expect(diff).toEqual({
        model: { before: "claude-sonnet-4-5-20250514", after: "gpt-4o" },
      });
    });
  });

  describe("serializeConfig", () => {
    it("produces deterministic JSON string", () => {
      const config = createDefaultConfig();
      const a = serializeConfig(config);
      const b = serializeConfig(config);
      expect(a).toBe(b);
    });

    it("keys are sorted alphabetically", () => {
      const config = createDefaultConfig();
      const serialized = serializeConfig(config);
      const parsed = JSON.parse(serialized);
      const keys = Object.keys(parsed);
      const sortedKeys = [...keys].sort();
      expect(keys).toEqual(sortedKeys);
    });

    it("round-trips through parse correctly", () => {
      const config = createDefaultConfig();
      const serialized = serializeConfig(config);
      const parsed = JSON.parse(serialized) as ExperimentConfig;
      expect(parsed).toEqual(config);
    });
  });
});

describe("computeCompositeScore", () => {
  const defaultWeights: CompositeWeights = {
    precisionAtK: 0.2,
    recallAtK: 0.2,
    mrr: 0.1,
    faithfulness: 0.2,
    relevance: 0.2,
    completeness: 0.1,
  };

  it("returns weighted sum of all metrics", () => {
    const metrics = {
      precisionAtK: 1.0,
      recallAtK: 1.0,
      mrr: 1.0,
      faithfulness: 5.0,
      relevance: 5.0,
      completeness: 5.0,
    };

    const score = computeCompositeScore(metrics, defaultWeights);
    // retrieval: 0.2*1 + 0.2*1 + 0.1*1 = 0.5
    // judge (normalized to 0-1): 0.2*(5/5) + 0.2*(5/5) + 0.1*(5/5) = 0.5
    // total: 1.0
    expect(score).toBeCloseTo(1.0, 5);
  });

  it("normalizes judge scores from 1-5 to 0-1 scale", () => {
    const metrics = {
      precisionAtK: 0.0,
      recallAtK: 0.0,
      mrr: 0.0,
      faithfulness: 3.0,
      relevance: 3.0,
      completeness: 3.0,
    };

    const weights: CompositeWeights = {
      precisionAtK: 0,
      recallAtK: 0,
      mrr: 0,
      faithfulness: 1.0,
      relevance: 0,
      completeness: 0,
    };

    const score = computeCompositeScore(metrics, weights);
    // faithfulness 3/5 = 0.6, weight 1.0 -> 0.6
    expect(score).toBeCloseTo(0.6, 5);
  });

  it("returns 0 when all metrics are zero", () => {
    const metrics = {
      precisionAtK: 0,
      recallAtK: 0,
      mrr: 0,
      faithfulness: 0,
      relevance: 0,
      completeness: 0,
    };

    const score = computeCompositeScore(metrics, defaultWeights);
    expect(score).toBe(0);
  });

  it("handles null judge scores by treating them as 0", () => {
    const metrics = {
      precisionAtK: 1.0,
      recallAtK: 1.0,
      mrr: 1.0,
      faithfulness: null as unknown as number,
      relevance: null as unknown as number,
      completeness: null as unknown as number,
    };

    const score = computeCompositeScore(metrics, defaultWeights);
    // Only retrieval contributes: 0.2 + 0.2 + 0.1 = 0.5
    expect(score).toBeCloseTo(0.5, 5);
  });

  it("correctly applies legal/precision-focused weights", () => {
    const legalWeights: CompositeWeights = {
      precisionAtK: 0.3,
      recallAtK: 0.1,
      mrr: 0.2,
      faithfulness: 0.25,
      relevance: 0.1,
      completeness: 0.05,
    };

    const metrics = {
      precisionAtK: 0.8,
      recallAtK: 0.6,
      mrr: 0.9,
      faithfulness: 4.0,
      relevance: 3.5,
      completeness: 3.0,
    };

    const score = computeCompositeScore(metrics, legalWeights);
    // 0.3*0.8 + 0.1*0.6 + 0.2*0.9 + 0.25*(4/5) + 0.1*(3.5/5) + 0.05*(3/5)
    // = 0.24 + 0.06 + 0.18 + 0.2 + 0.07 + 0.03 = 0.78
    expect(score).toBeCloseTo(0.78, 2);
  });
});
