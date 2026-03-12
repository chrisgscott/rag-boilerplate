/**
 * Deterministically assign a test case to optimization or validation split.
 * First 70% (by index) go to optimization, rest to validation.
 */
export function assignSplit(
  index: number,
  total: number
): "optimization" | "validation" {
  const optimizationCount = Math.round(total * 0.7);
  return index < optimizationCount ? "optimization" : "validation";
}
