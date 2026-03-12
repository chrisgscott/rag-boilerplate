import { describe, it, expect } from "vitest";
import { assignSplit } from "@/lib/rag/test-set/splitter";

describe("assignSplit", () => {
  it("assigns roughly 70% optimization and 30% validation", () => {
    const splits = Array.from({ length: 100 }, (_, i) => assignSplit(i, 100));
    const optCount = splits.filter((s) => s === "optimization").length;
    const valCount = splits.filter((s) => s === "validation").length;
    expect(optCount).toBe(70);
    expect(valCount).toBe(30);
  });

  it("assigns optimization for single item", () => {
    expect(assignSplit(0, 1)).toBe("optimization");
  });

  it("is deterministic for the same index and total", () => {
    const a = assignSplit(5, 20);
    const b = assignSplit(5, 20);
    expect(a).toBe(b);
  });

  it("handles small batches (3 items → 2 opt, 1 val)", () => {
    const splits = Array.from({ length: 3 }, (_, i) => assignSplit(i, 3));
    const optCount = splits.filter((s) => s === "optimization").length;
    expect(optCount).toBe(2);
  });
});
