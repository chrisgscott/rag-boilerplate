import { describe, it, expect } from "vitest";
import {
  precisionAtK,
  recallAtK,
  meanReciprocalRank,
  aggregateMetrics,
} from "@/lib/rag/eval-metrics";

describe("precisionAtK", () => {
  it("returns 1.0 when all retrieved docs are relevant", () => {
    const retrieved = ["doc-1", "doc-2", "doc-3"];
    const expected = ["doc-1", "doc-2", "doc-3"];
    expect(precisionAtK(retrieved, expected)).toBe(1.0);
  });

  it("returns 0.0 when no retrieved docs are relevant", () => {
    const retrieved = ["doc-4", "doc-5"];
    const expected = ["doc-1", "doc-2"];
    expect(precisionAtK(retrieved, expected)).toBe(0.0);
  });

  it("returns correct fraction for partial overlap", () => {
    const retrieved = ["doc-1", "doc-4", "doc-2", "doc-5"];
    const expected = ["doc-1", "doc-2", "doc-3"];
    expect(precisionAtK(retrieved, expected)).toBe(0.5);
  });

  it("returns 0 when retrieved is empty", () => {
    expect(precisionAtK([], ["doc-1"])).toBe(0);
  });
});

describe("recallAtK", () => {
  it("returns 1.0 when all expected docs are retrieved", () => {
    const retrieved = ["doc-1", "doc-2", "doc-3", "doc-4"];
    const expected = ["doc-1", "doc-2"];
    expect(recallAtK(retrieved, expected)).toBe(1.0);
  });

  it("returns 0.0 when none of the expected docs are retrieved", () => {
    const retrieved = ["doc-4", "doc-5"];
    const expected = ["doc-1", "doc-2"];
    expect(recallAtK(retrieved, expected)).toBe(0.0);
  });

  it("returns correct fraction for partial recall", () => {
    const retrieved = ["doc-1", "doc-4"];
    const expected = ["doc-1", "doc-2", "doc-3"];
    expect(recallAtK(retrieved, expected)).toBeCloseTo(0.333, 2);
  });

  it("returns 0 when expected is empty", () => {
    expect(recallAtK(["doc-1"], [])).toBe(0);
  });
});

describe("meanReciprocalRank", () => {
  it("returns 1.0 when first result is relevant", () => {
    const retrieved = ["doc-1", "doc-2"];
    const expected = ["doc-1"];
    expect(meanReciprocalRank(retrieved, expected)).toBe(1.0);
  });

  it("returns 0.5 when first relevant is at position 2", () => {
    const retrieved = ["doc-3", "doc-1", "doc-2"];
    const expected = ["doc-1", "doc-2"];
    expect(meanReciprocalRank(retrieved, expected)).toBe(0.5);
  });

  it("returns 0 when no relevant docs found", () => {
    const retrieved = ["doc-3", "doc-4"];
    const expected = ["doc-1"];
    expect(meanReciprocalRank(retrieved, expected)).toBe(0);
  });

  it("returns 0 when retrieved is empty", () => {
    expect(meanReciprocalRank([], ["doc-1"])).toBe(0);
  });
});

describe("aggregateMetrics", () => {
  it("averages metrics across multiple cases", () => {
    const perCase = [
      { precisionAtK: 1.0, recallAtK: 0.5, mrr: 1.0 },
      { precisionAtK: 0.5, recallAtK: 1.0, mrr: 0.5 },
    ];
    const result = aggregateMetrics(perCase);
    expect(result.precisionAtK).toBe(0.75);
    expect(result.recallAtK).toBe(0.75);
    expect(result.mrr).toBe(0.75);
  });

  it("returns zeros for empty input", () => {
    const result = aggregateMetrics([]);
    expect(result.precisionAtK).toBe(0);
    expect(result.recallAtK).toBe(0);
    expect(result.mrr).toBe(0);
  });
});
