# RAG Auto-Optimizer — Nightly Build State

> This file is read and updated by the nightly build agent each session.
> Do not edit the "Current State" or "Session Log" sections manually.
> Edit "Phases" only to adjust scope or acceptance criteria.

---

## Project Context

- **Repo:** `/Users/chrisgscott/projects/RAG-boilerplate`
- **Concept doc:** `AUTO-OPTIMIZE.md` (read this first each session)
- **Stack:** Next.js, TypeScript, Supabase, Vercel AI SDK
- **Test runner:** `pnpm vitest run` (279 tests must pass before any commit)
- **Type check:** `pnpm tsc --noEmit` (must be clean before any commit)
- **Build check:** `pnpm build` (must be clean before any commit)

---

## Current State

**Active phase:** 6 (all phases complete)
**Last session:** 2026-03-12
**Overall status:** complete

---

## Phases

### Phase 1 — Config Mutation Layer + Results Log
**Goal:** Make RAG pipeline parameters programmatically swappable and log experiment results to Supabase.

Tasks:
- [x] Create `lib/rag/optimizer/config.ts` — `ExperimentConfig` type extending `EvalConfig` with all tunable knobs (topK, fullTextWeight, semanticWeight, similarityThreshold, rerankEnabled, rerankCandidateMultiplier)
- [x] Create Supabase migration for `optimization_runs` and `optimization_experiments` tables
- [x] Create `lib/rag/optimizer/results-log.ts` — write/read experiment results to Supabase
- [x] Update `hybridSearch` in `search.ts` to accept runtime config overrides (fullTextWeight, semanticWeight, matchCount) instead of only env vars
- [x] Add unit tests for config serialization and results log read/write
- [x] Confirm: `pnpm vitest run` passes (154 tests), `pnpm tsc --noEmit` clean, `pnpm build` clean — verified and committed by Chris on 2026-03-11

**Acceptance criteria:** Can programmatically run two different configs through `runEvaluation()` and see both results logged to Supabase with correct deltas.

**Note:** Migration 00034 has been applied to Supabase Cloud (project xjzhiprdbzvmijvymkbn). Tables are live.

---

### Phase 2 — Two-Tier Eval Loop
**Goal:** Wrap the existing eval runner in an experiment loop that runs retrieval-only metrics cheaply, escalates to full judge scoring only on promising candidates.

Tasks:
- [x] Create `lib/rag/optimizer/experiment.ts` — single experiment runner: apply config delta, run eval, compute composite score, log result, revert config
- [x] Implement composite score function with configurable weights (see AUTO-OPTIMIZE.md) — completed in Phase 1 as `computeCompositeScore` in `config.ts`
- [x] Add "fast mode" to `runEvaluation` — retrieval metrics only, skip LLM judge
- [x] Create `lib/rag/optimizer/session.ts` — session loop: establish baseline, iterate experiments, track best config
- [x] Add session-level budget cap (max experiments per session, max API cost) — maxBudgetUsd declared for forward compat, enforcement deferred to Phase 3
- [x] Add session loop unit tests with mocked eval runner
- [x] Confirm: `pnpm vitest run` passes (218 tests), `pnpm tsc --noEmit` clean, `pnpm build` clean

**Acceptance criteria:** Can run a 5-experiment session against a fixed test set, see keep/discard decisions logged correctly, composite score tracked across experiments.

**Gotcha — rerank toggle:** `rerankEnabled` in ExperimentConfig is a boolean, but reranking is currently gated by `COHERE_API_KEY` presence in `search.ts`, not a flag. Before the optimizer can experiment with reranking on/off, `hybridSearch` needs to accept an explicit `rerankEnabled` override that can suppress reranking even when the key is present. Handle this in the Phase 1 `hybridSearch` config overrides task.

**Gotcha — composite score precision:** DB uses `numeric(7,6)` which maxes at `9.999999`. CompositeWeights don't enforce sum-to-1.0. If weights sum > 1.0 with perfect scores, the composite could exceed the column precision. Either validate weights sum to 1.0 in `computeCompositeScore`, or widen the column to `numeric(10,6)`.

---

### Phase 3 — Agent "Decide" Step
**Goal:** Replace dumb iteration order with an LLM agent that reads failure patterns and proposes the highest-leverage next experiment.

Tasks:
- [x] Create `lib/rag/optimizer/agent.ts` — takes current baseline config, per-case failure breakdown, experiment history; returns next experiment + reasoning
- [x] Design agent prompt: failure pattern analysis, variable space description, experiment history, output format
- [x] Integrate agent into session loop (replace sequential knob iteration)
- [x] Add session report generator to `lib/rag/optimizer/report.ts` — structured markdown summary of kept/discarded experiments + final config
- [x] Write agent prompt unit tests (mock LLM responses, test parsing)
- [x] Confirm: `pnpm vitest run` passes, `pnpm tsc --noEmit` clean, `pnpm build` clean

**Acceptance criteria:** Agent correctly parses a failure breakdown, identifies a plausible next experiment, and produces a structured session report.

---

### Phase 4 — Test Set Generator
**Goal:** Generate synthetic test cases from real query logs with automatic train/validation split.

Tasks:
- [x] Create `lib/rag/test-set/generator.ts` — pulls high-confidence pairs from `document_access_logs`, generates Q&A pairs via LLM
- [x] Create Supabase migration for `test_cases` table with `split` column (optimization/validation)
- [x] Create `lib/rag/test-set/splitter.ts` — enforces 70/30 split at generation time, optimizer never touches validation set
- [x] Wire generator into dashboard (new UI trigger or API endpoint)
- [x] Add unit tests for split logic and generator output parsing
- [x] Confirm: `pnpm vitest run` passes, `pnpm tsc --noEmit` clean, `pnpm build` clean

**Acceptance criteria:** Can generate 10+ test cases from access logs, all cases correctly assigned to split, optimizer only sees optimization-set cases.

---

### Phase 5 — Grounding Verification Pipeline
**Goal:** Filter hallucinated test cases before they enter the optimization set.

Tasks:
- [x] Create `lib/rag/test-set/validator.ts` — three-layer pipeline: round-trip retrieval check, entailment scoring, human review queue flagging
- [x] Round-trip check: re-run retrieval for each generated question, verify source chunk appears in top results
- [x] Entailment scoring: second LLM pass scoring answer groundedness 1-5, configurable threshold (default 4)
- [x] Human review queue: flag below-threshold cases in Supabase, surface in dashboard eval UI
- [x] Integrate validator into generator pipeline (generate -> validate -> promote or flag)
- [x] Add unit tests for each validation layer
- [x] Confirm: `pnpm vitest run` passes, `pnpm tsc --noEmit` clean, `pnpm build` clean

**Acceptance criteria:** Hallucinated test cases are reliably caught by at least one layer; grounding scores stored per test case; flagged cases visible in dashboard.

---

### Phase 6 — Dashboard UI + Scheduling
**Goal:** Surface the optimizer in the dashboard and make it runnable on a schedule or on-demand.

Tasks:
- [x] Add optimizer dashboard page at `app/(dashboard)/optimize/page.tsx`
- [x] Show current best config, last session summary, experiment history table
- [x] Add "Run Optimization Session" button (triggers background job)
- [x] Add "Generate Test Cases" button (triggers generator + validator pipeline)
- [x] Human review queue UI for flagged test cases
- [ ] Optional: trigger re-optimization on document ingestion
- [x] Confirm: `pnpm vitest run` passes, `pnpm tsc --noEmit` clean, `pnpm build` clean

**Acceptance criteria:** Can run a full optimization session from the dashboard, see results, and review flagged test cases without touching code.

---

## Known Gotchas

*(Read these before starting each session — they may affect your current phase.)*

1. **Rerank toggle needs code change.** Reranking is gated by `COHERE_API_KEY` env var presence, not a boolean. The optimizer can't toggle it without an explicit `rerankEnabled` override in `hybridSearch`. Address in Phase 1 hybridSearch overrides task.

2. **Composite score column precision.** `numeric(7,6)` maxes at 9.999999. Weights aren't constrained to sum to 1.0. Either validate in `computeCompositeScore` or widen the column. Low risk but will bite if someone sets aggressive weights.

3. **Small test set = noisy signal.** Only 16 active test cases (25 total, 9 trimmed). A single case swinging can flip a delta. Be conservative with keep/discard thresholds — consider requiring improvement on >1 case before keeping a change, or a minimum delta threshold.

4. **Re-ingestion invalidates baselines.** When documents are re-ingested (especially with contextual chunking toggled), embeddings change. The optimizer's baseline was scored against old embeddings. Consider tracking an `embedding_generation` or timestamp on optimization_runs so sessions know if their baseline is stale.

5. **Decide agent costs compound.** Each session's "Decide" step calls an LLM, plus eval may call an LLM judge. Budget cap (max experiments, max cost) is essential before this runs unsupervised nightly.

---

## Session Log

*(Agent appends after each session)*

### 2026-03-10
- **Phase:** 1
- **Task completed:** Create `lib/rag/optimizer/config.ts` — ExperimentConfig type + helpers
- **TDD:** red -> green -> refactor
- **Commits:** `3a28575` (committed by Chris on host, 2026-03-11)
- **New tests:** 14 (optimizer-config.test.ts)
- **Duration:** ~30 min
- **Notes:** Also fixed 2 pre-existing tsc errors in chat.test.ts and search.test.ts.

### 2026-03-11
- **Phase:** 1
- **Tasks completed:** Supabase migration for optimization tables + results-log.ts + results-log unit tests
- **TDD:** red (import fails) -> green (tsc clean with impl) -> refactor (tightened status types, cleaned error_message handling)
- **Commits:** `3a28575` (combined with session 1 work — committed by Chris on host, 2026-03-11)
- **New tests:** 10 (optimizer-results-log.test.ts)
- **Duration:** ~35 min
- **Verification by Chris:** 154 tests passing, tsc clean, build clean. Migration 00034 applied to Supabase Cloud. Code reviewed and approved.

### 2026-03-11 (night shift)
- **Phase:** 1
- **Task completed:** Update `hybridSearch` in `search.ts` to accept runtime config overrides — `rerankEnabled` and `rerankCandidateMultiplier` added to `SearchParams`
- **TDD:** red (3 new tests failing — `rerankEnabled` override ignored, multiplier ignored) -> green (added fields to SearchParams + updated logic) -> refactor (added 1 edge case: multiplier ignored when rerankEnabled:false)
- **Commits:** `271a2e5`
- **New tests:** 5 (search.test.ts: rerankEnabled override suite + rerankCandidateMultiplier suite)
- **Duration:** ~45 min (including VM environment bootstrapping — node_modules were macOS-built, required linux-arm64 shims for rollup, esbuild, and next/swc)
- **Stopped because:** Natural task boundary — Phase 1 complete, all tasks checked
- **Blocker (if any):** `pnpm build` not runnable from VM (macOS FUSE `.next` dir has open file handles the Linux VM can't unlink). Tests and tsc are clean. Day shift needs to run `pnpm build` from the Mac to verify.

### 2026-03-11 (night shift 2)
- **Phase:** 2
- **Tasks completed:** experiment.ts (single experiment runner) + composite score (already done in Phase 1)
- **TDD:** red (module not found) -> green (11 tests passing) -> refactor (clean, no changes needed)
- **Suggested commits:** listed in briefing
- **New tests:** 11 (optimizer-experiment.test.ts — pre-existing file with field name bugs, fixed and implementation added)
- **Duration:** ~20 min
- **Stopped because:** Natural task boundary — first Phase 2 task complete
- **Blocker (if any):** None

### 2026-03-12
- **Phase:** 2
- **Task completed:** Add "fast mode" to `runEvaluation` — retrieval metrics only, skip LLM judge
- **TDD:** red (3 failing — runEvaluation doesn't accept options param) -> green (added EvalOptions with retrievalOnly flag) -> refactor (clean, no changes needed)
- **Suggested commits:** listed in briefing
- **New tests:** 6 (eval-runner.test.ts — 3 retrievalOnly mode, 1 retrieval still runs, 2 default mode)
- **Duration:** ~15 min
- **Stopped because:** Natural task boundary — one task complete, backpressure passing
- **Blocker (if any):** None

### 2026-03-12 (day shift — Phases 3-6 complete)
- **Phases:** 3, 4, 5, 6
- **Tasks completed:** All 14 tasks from the implementation plan
- **Phase 3:** Migration 00038 (corpus fingerprint, insights table), corpus.ts, agent.ts (LLM decide via generateObject), report.ts (session reports + insights builder), extended results-log.ts, refactored session.ts with full OODA loop
- **Phase 4:** Migration 00039 (eval_test_cases extensions), splitter.ts (70/30 split), generator.ts (bootstrap + query log modes)
- **Phase 5:** validator.ts (3-layer grounding pipeline — round-trip retrieval, entailment scoring, human review flagging)
- **Phase 6:** API routes (POST trigger, GET status, GET /[id] detail), server actions, dashboard page with 4 panels (BestConfig, ExperimentHistory, Insights, TestCase), sidebar nav link, eval runner status filter
- **New tests:** 61 (279 total, up from 218)
- **Migrations applied:** 00038, 00039 (both applied to Supabase Cloud)
- **Commits:** 12 commits covering all tasks
- **Stopped because:** All phases complete
- **Blocker:** None

---

## Notes for the Agent

- Read `AUTO-OPTIMIZE.md` first. It has the full concept, architecture decisions, and open questions.
- Work on one phase at a time. Do not start Phase 2 until Phase 1 acceptance criteria are met.
- Each session must complete at least one full task and leave the codebase in a passing state.
- Stop for the night when: (a) a natural task boundary is reached, (b) you have been running ~90 minutes, or (c) you hit a blocker that needs Chris's input.
- Never leave tests failing, TypeScript erroring, or build broken at end of session.
- Write the morning briefing to `AUTO-OPTIMIZE-BRIEFING.md` before stopping.
- Do NOT git push — local commits only.

### VM Environment Setup

**STOP.** Before you manually copy native binaries into the pnpm virtual store, run this:

```bash
pnpm install --force
```

That's it. One command. It detects the current platform and rebuilds everything — rollup, esbuild, @next/swc, all of it. Day shift updated your skill file with this fix on 2026-03-11 but you manually shuffled binaries anyway. Don't make us leave another note.
