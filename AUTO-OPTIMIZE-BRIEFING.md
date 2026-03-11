# RAG Auto-Optimizer — Morning Briefing
**Date:** 2026-03-11 (night shift)
**Session duration:** ~45 min
**Phase:** 1 — Config Mutation Layer + Results Log ✅ COMPLETE

---

## What Got Built Tonight

Added `rerankEnabled?: boolean` and `rerankCandidateMultiplier?: number` to `SearchParams` in `lib/rag/search.ts`. When provided, these override the env-var-based `isRerankEnabled()` check and the hardcoded `4x` over-fetch multiplier respectively. This was the last unchecked task in Phase 1 — all six tasks are now done and Phase 1 acceptance criteria are met.

The optimizer can now programmatically toggle reranking on/off and control the candidate pool size without touching env vars or config files. Both parameters are optional and backward-compatible — all existing call sites work unchanged.

## TDD Summary

- **Tests written:** 5 new tests in `tests/unit/search.test.ts`
- **Red → Green:** Wrote tests that asserted `rerankEnabled: true` causes over-fetching even with `mockIsRerankEnabled.mockReturnValue(false)` — both failed correctly before implementation (the param was silently ignored). Confirmed 3 failing, 0 false negatives.
- **Refactor notes:** Added 1 edge case test confirming `rerankCandidateMultiplier` is ignored when reranking is disabled. Code was already clean; the multiplier logic needed a clear comment but no structural changes.

## Commits

- `271a2e5` — feat(optimizer): add rerankEnabled and rerankCandidateMultiplier runtime overrides to hybridSearch

## Backpressure Status

- **Vitest:** 159 passing, 0 failing (154 baseline + 5 new)
- **TypeScript:** clean — `pnpm tsc --noEmit` exits 0
- **Build:** ⚠️ NOT VERIFIABLE FROM VM — `pnpm build` fails due to macOS FUSE `.next` directory having open file handles that the Linux VM cannot unlink. This is an infrastructure issue, not a code regression. **Day shift: please run `pnpm build` from your Mac to verify before starting Phase 2.**

## What's Next

**Phase 2 begins.** First task: Create `lib/rag/optimizer/experiment.ts` — the single experiment runner.

This function takes an `ExperimentConfig`, applies it to a search run, calls `runEvaluation()`, computes a composite score, logs the result to `optimization_experiments`, and returns the delta vs baseline.

**Important note for Phase 2:** `eval-runner.ts` currently only reads `topK` from `EvalConfig` and passes it to `hybridSearch` as `matchCount`. It does NOT yet pass `fullTextWeight`, `semanticWeight`, `rerankEnabled`, or `rerankCandidateMultiplier`. The experiment runner will need to call `hybridSearch` directly or extend `runEvaluation` to accept an `ExperimentConfig` to pass the full config through.

## Blockers / Decisions Needed

1. **Build verification:** Run `pnpm build` from your Mac and confirm clean before Phase 2.
2. **Phase 2 design decision:** Should `experiment.ts` extend `runEvaluation` to accept `ExperimentConfig` (cleaner, single eval entry point), or call `hybridSearch` directly with config fields (more surgical)? Lean toward extending `runEvaluation`.
3. **Composite score precision:** Gotcha #2 still unresolved — `numeric(7,6)` maxes at 9.999999. Low risk until weights sum > 1.0. Consider a small migration to `numeric(10,6)` before Phase 2.

## Notes

Had to bootstrap the Linux VM environment before any work could happen — the project's `node_modules` were installed on macOS (darwin-arm64) and the VM runs linux-arm64. Fixed by copying the linux-arm64 native binaries for `@rollup/rollup-linux-arm64-gnu`, `@esbuild/linux-arm64`, and `@next/swc-linux-arm64-gnu` into the appropriate pnpm virtual store locations. These are in-memory VM fixes only — the project's node_modules on the Mac are unaffected. This bootstrapping needs to happen each fresh VM session.

**Phase 1 acceptance criteria status:** Config mutation layer (`SearchParams` overrides for all knobs including reranking) and results log (from prior session) are both in place. Phase 2 wires them together into an actual experiment loop. 🎉
