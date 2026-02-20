import { describe, it, expect } from "vitest";

/**
 * Test the score mapping logic extracted from getEvalResults.
 * Scores of 0 should be preserved as 0, not mapped to null.
 */
function mapScore(value: string | number | null): number | null {
  return value !== null && value !== undefined ? Number(value) : null;
}

describe("mapScore", () => {
  it("preserves 0 as a valid score", () => {
    expect(mapScore(0)).toBe(0);
    expect(mapScore("0")).toBe(0);
    expect(mapScore("0.0000")).toBe(0);
  });

  it("maps null to null", () => {
    expect(mapScore(null)).toBeNull();
  });

  it("maps valid numeric strings to numbers", () => {
    expect(mapScore("0.7500")).toBe(0.75);
    expect(mapScore("1.0000")).toBe(1);
  });
});
