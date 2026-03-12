import { describe, it, expect } from "vitest";
import { generateSessionReport, buildInsightsFromHistory } from "@/lib/rag/optimizer/report";
import type { ExperimentConfig } from "@/lib/rag/optimizer/config";
import type { CorpusFingerprint } from "@/lib/rag/optimizer/corpus";
import type { CumulativeInsights } from "@/lib/rag/optimizer/agent";

// --- Shared fixtures ---

const baseConfig: ExperimentConfig = {
  model: "claude-sonnet-4-5-20250514",
  topK: 5,
  similarityThreshold: 0.3,
  fullTextWeight: 1.0,
  semanticWeight: 1.0,
  rerankEnabled: false,
  rerankCandidateMultiplier: 4,
};

const fingerprint: CorpusFingerprint = {
  docCount: 10,
  chunkCount: 500,
  lastIngestedAt: "2026-03-01T00:00:00Z",
};

// --- generateSessionReport ---

describe("generateSessionReport", () => {
  it("includes all three experiments in the table", () => {
    const report = generateSessionReport({
      baselineConfig: baseConfig,
      finalConfig: baseConfig,
      baselineScore: 0.7,
      bestScore: 0.75,
      experiments: [
        { index: 1, knob: "topK", valueTested: 8, delta: 0.05, status: "kept", reasoning: "More results helped" },
        { index: 2, knob: "rerankEnabled", valueTested: true, delta: -0.01, status: "discarded", reasoning: "No benefit" },
        { index: 3, knob: "similarityThreshold", valueTested: 0.2, delta: 0.0, status: "error", reasoning: null },
      ],
      corpusFingerprint: fingerprint,
    });

    expect(report).toContain("| 1 | topK | 8 |");
    expect(report).toContain("| 2 | rerankEnabled | true |");
    expect(report).toContain("| 3 | similarityThreshold | 0.2 |");
    expect(report).toContain("kept");
    expect(report).toContain("discarded");
    expect(report).toContain("error");
  });

  it("includes corpus fingerprint in the report", () => {
    const report = generateSessionReport({
      baselineConfig: baseConfig,
      finalConfig: baseConfig,
      baselineScore: 0.7,
      bestScore: 0.7,
      experiments: [],
      corpusFingerprint: fingerprint,
    });

    expect(report).toContain("10 docs, 500 chunks");
  });

  it("includes baseline and best scores", () => {
    const report = generateSessionReport({
      baselineConfig: baseConfig,
      finalConfig: baseConfig,
      baselineScore: 0.7123,
      bestScore: 0.8456,
      experiments: [],
      corpusFingerprint: fingerprint,
    });

    expect(report).toContain("0.7123");
    expect(report).toContain("0.8456");
  });

  it("shows config diff when finalConfig differs from baselineConfig", () => {
    const finalConfig: ExperimentConfig = {
      ...baseConfig,
      topK: 10,
      rerankEnabled: true,
    };

    const report = generateSessionReport({
      baselineConfig: baseConfig,
      finalConfig,
      baselineScore: 0.7,
      bestScore: 0.8,
      experiments: [],
      corpusFingerprint: fingerprint,
    });

    expect(report).toContain("## Config Changes");
    expect(report).toContain("**topK:** 5 → 10");
    expect(report).toContain("**rerankEnabled:** false → true");
  });

  it("omits config changes section when configs are identical", () => {
    const report = generateSessionReport({
      baselineConfig: baseConfig,
      finalConfig: { ...baseConfig },
      baselineScore: 0.7,
      bestScore: 0.7,
      experiments: [],
      corpusFingerprint: fingerprint,
    });

    expect(report).not.toContain("## Config Changes");
  });

  it("correctly counts kept and discarded experiments", () => {
    const report = generateSessionReport({
      baselineConfig: baseConfig,
      finalConfig: baseConfig,
      baselineScore: 0.7,
      bestScore: 0.75,
      experiments: [
        { index: 1, knob: "topK", valueTested: 8, delta: 0.05, status: "kept", reasoning: null },
        { index: 2, knob: "rerankEnabled", valueTested: true, delta: -0.01, status: "discarded", reasoning: null },
        { index: 3, knob: "similarityThreshold", valueTested: 0.2, delta: 0.0, status: "error", reasoning: null },
      ],
      corpusFingerprint: fingerprint,
    });

    expect(report).toContain("3 total (1 kept, 1 discarded)");
  });

  it("formats positive delta with a + sign", () => {
    const report = generateSessionReport({
      baselineConfig: baseConfig,
      finalConfig: baseConfig,
      baselineScore: 0.7,
      bestScore: 0.75,
      experiments: [
        { index: 1, knob: "topK", valueTested: 8, delta: 0.05, status: "kept", reasoning: null },
      ],
      corpusFingerprint: fingerprint,
    });

    expect(report).toContain("+0.0500");
  });

  it("uses '-' for null reasoning in table", () => {
    const report = generateSessionReport({
      baselineConfig: baseConfig,
      finalConfig: baseConfig,
      baselineScore: 0.7,
      bestScore: 0.7,
      experiments: [
        { index: 1, knob: "topK", valueTested: 8, delta: 0.0, status: "discarded", reasoning: null },
      ],
      corpusFingerprint: fingerprint,
    });

    expect(report).toContain("| - |");
  });
});

// --- buildInsightsFromHistory ---

describe("buildInsightsFromHistory", () => {
  it("returns empty knobFindings when experiments is empty and no existing insights", () => {
    const result = buildInsightsFromHistory([], null);
    expect(result.knobFindings).toEqual([]);
  });

  it("returns empty knobFindings when experiments is empty and existing insights is empty", () => {
    const result = buildInsightsFromHistory([], { knobFindings: [] });
    expect(result.knobFindings).toEqual([]);
  });

  it("marks all-discarded knob as 'Not beneficial'", () => {
    const result = buildInsightsFromHistory(
      [
        { knob: "rerankEnabled", delta: -0.01, status: "discarded", corpusFingerprint: null },
        { knob: "rerankEnabled", delta: -0.02, status: "discarded", corpusFingerprint: null },
      ],
      null
    );

    expect(result.knobFindings).toHaveLength(1);
    expect(result.knobFindings[0].finding).toContain("Not beneficial");
  });

  it("marks knob with kept experiments as 'Beneficial' with avg delta", () => {
    const result = buildInsightsFromHistory(
      [
        { knob: "topK", delta: 0.04, status: "kept", corpusFingerprint: fingerprint },
        { knob: "topK", delta: 0.06, status: "kept", corpusFingerprint: fingerprint },
      ],
      null
    );

    expect(result.knobFindings).toHaveLength(1);
    expect(result.knobFindings[0].finding).toContain("Beneficial");
    expect(result.knobFindings[0].finding).toContain("+0.0500");
  });

  it("includes chunk count in finding when corpusFingerprint is present", () => {
    const result = buildInsightsFromHistory(
      [{ knob: "topK", delta: 0.05, status: "kept", corpusFingerprint: fingerprint }],
      null
    );

    expect(result.knobFindings[0].finding).toContain("500 chunks");
  });

  it("omits chunk count when corpusFingerprint is null", () => {
    const result = buildInsightsFromHistory(
      [{ knob: "topK", delta: 0.05, status: "kept", corpusFingerprint: null }],
      null
    );

    expect(result.knobFindings[0].finding).not.toContain("chunks");
  });

  it("merges with existing insights, incrementing testedCount", () => {
    const existing: CumulativeInsights = {
      knobFindings: [
        { knob: "topK", finding: "Beneficial (avg delta +0.0300) at 300 chunks", testedCount: 3 },
      ],
    };

    const result = buildInsightsFromHistory(
      [{ knob: "topK", delta: 0.05, status: "kept", corpusFingerprint: fingerprint }],
      existing
    );

    const topKFinding = result.knobFindings.find((f) => f.knob === "topK");
    expect(topKFinding?.testedCount).toBe(4); // 3 existing + 1 new
  });

  it("produces one finding entry for multiple experiments on the same knob", () => {
    const result = buildInsightsFromHistory(
      [
        { knob: "topK", delta: 0.02, status: "kept", corpusFingerprint: null },
        { knob: "topK", delta: 0.04, status: "kept", corpusFingerprint: null },
        { knob: "topK", delta: -0.01, status: "discarded", corpusFingerprint: null },
      ],
      null
    );

    const topKFindings = result.knobFindings.filter((f) => f.knob === "topK");
    expect(topKFindings).toHaveLength(1);
    expect(topKFindings[0].testedCount).toBe(3);
  });

  it("preserves existing insights for knobs not in new experiments", () => {
    const existing: CumulativeInsights = {
      knobFindings: [
        { knob: "rerankEnabled", finding: "Not beneficial at 200 chunks", testedCount: 2 },
      ],
    };

    const result = buildInsightsFromHistory(
      [{ knob: "topK", delta: 0.05, status: "kept", corpusFingerprint: fingerprint }],
      existing
    );

    const rerankFinding = result.knobFindings.find((f) => f.knob === "rerankEnabled");
    expect(rerankFinding).toBeDefined();
    expect(rerankFinding?.finding).toBe("Not beneficial at 200 chunks");
    expect(rerankFinding?.testedCount).toBe(2);
  });

  it("handles mixed kept/discarded/error as 'Beneficial' when at least one kept", () => {
    const result = buildInsightsFromHistory(
      [
        { knob: "topK", delta: 0.05, status: "kept", corpusFingerprint: null },
        { knob: "topK", delta: -0.02, status: "discarded", corpusFingerprint: null },
        { knob: "topK", delta: 0.0, status: "error", corpusFingerprint: null },
      ],
      null
    );

    expect(result.knobFindings[0].finding).toContain("Beneficial");
    // avg delta is only from kept experiments: 0.05 / 1 = 0.05
    expect(result.knobFindings[0].finding).toContain("+0.0500");
  });

  it("returns 'Inconclusive' for all-error experiments with no existing insight", () => {
    const result = buildInsightsFromHistory(
      [{ knob: "topK", delta: 0.0, status: "error", corpusFingerprint: null }],
      null
    );

    expect(result.knobFindings[0].finding).toBe("Inconclusive");
  });

  it("uses existing finding for all-error experiments when existing insight present", () => {
    const existing: CumulativeInsights = {
      knobFindings: [
        { knob: "topK", finding: "Beneficial (avg delta +0.0300) at 300 chunks", testedCount: 2 },
      ],
    };

    const result = buildInsightsFromHistory(
      [{ knob: "topK", delta: 0.0, status: "error", corpusFingerprint: null }],
      existing
    );

    expect(result.knobFindings[0].finding).toBe("Beneficial (avg delta +0.0300) at 300 chunks");
    expect(result.knobFindings[0].testedCount).toBe(3); // 2 existing + 1 new
  });
});
