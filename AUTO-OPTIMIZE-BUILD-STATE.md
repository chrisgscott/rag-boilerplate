# RAG Auto-Optimizer — Nightly Build State

> This file is read and updated by the nightly build agent each session.
> Do not edit the "Current State" or "Session Log" sections manually.
> Edit "Phases" only to adjust scope or acceptance criteria.

---

## Project Context

- **Repo:** `/Users/chrisgscott/projects/RAG-boilerplate`
- **Concept doc:** `AUTO-OPTIMIZE.md` (read this first each session)
- **Stack:** Next.js, TypeScript, Supabase, Vercel AI SDK
- **Test runner:** `pnpm vitest run` (130 tests must pass before any commit)
- **Type check:** `pnpm tsc --noEmit` (must be clean before any commit)
- **Build check:** `pnpm build` (must be clean before any commit)

---

## Current State

**Active phase:** 1
**Last session:** 2026-03-11
**Overall status:** in progress

---

## Phases

### Phase 1 — Config Mutation Layer + Results Log
**Goal:** Make RAG pipeline parameters programmatically swappable and log experiment results to Supabase.

Tasks:
- [x] Create `lib/rag/optimizer/config.ts` — `ExperimentConfig` type extending `EvalConfig` with all tunable knobs (topK, fullTextWeight, semanticWeight, similarityThreshold, rerankEnabled, rerankCandidateMultiplier)
- [x] Create Supabase migration for `optimization_runs` and `optimization_experiments` tables
- [x] Create `lib/rag/optimizer/results-log.ts` — write/read experiment results to Supabase
- [ ] Update `hybridSearch` in `search.ts` to accept runtime config overrides (fullTextWeight, semanticWeight, matchCount) instead of only env vars
- [x] Add unit tests for config serialization and results log read/write
- [ ] Confirm: `pnpm vitest run` passes, `pnpm tsc --noEmit` clean, `pnpm build` clean

**Acceptance criteria:** Can programmatically run two different configs through `runEvaluation()` and see both results logged to Supabase with correct deltas.

---

### Phase 2 — Two-Tier Eval Loop
**Goal:** Wrap the existing eval runner in an experiment loop that runs retrieval-only metrics cheaply, escalates to full judge scoring only on promising candidates.

Tasks:
- [ ] Create `lib/rag/optimizer/experiment.ts` — single experiment runner: apply config delta, run eval, compute composite score, log result, revert config
- [ ] Implement composite score function with configurable weights (see AUTO-OPTIMIZE.md)
- [ ] Add "fast mode" to `runEvaluation` — retrieval metrics only, skip LLM judge
- [ ] Create `lib/rag/optimizer/session.ts` — session loop: establish baseline, iterate experiments, track best config
- [ ] Add session loop unit tests with mocked eval runner
- [ ] Confirm: `pnpm vitest run` passes, `pnpm tsc --noEmit` clean, `pnpm build` clean

**Acceptance criteria:** Can run a 5-experiment session against a fixed test set, see keep/discard decisions logged correctly, composite score tracked across experiments.

---

### Phase 3 — Agent "Decide" Step
**Goal:** Replace dumb iteration order with an LLM agent that reads failure patterns and proposes the highest-leverage next experiment.

Tasks:
- [ ] Create `lib/rag/optimizer/agent.ts` — takes current baseline config, per-case failure breakdown, experiment history; returns next experiment + reasoning
- [ ] Design agent prompt: failure pattern analysis, variable space description, experiment history, output format
- [ ] Integrate agent into session loop (replace sequential knob iteration)
- [ ] Add session report generator to `lib/rag/optimizer/report.ts` — structured markdown summary of kept/discarded experiments + final config
- [ ] Write agent prompt unit tests (mock LLM responses, test parsing)
- [ ] Confirm: `pnpm vitest run` passes, `pnpm tsc --noEmit` clean, `pnpm build` clean

**Acceptance criteria:** Agent correctly parses a failure breakdown, identifies a plausible next experiment, and produces a structured session report.

---

### Phase 4 — Test Set Generator
**Goal:** Generate synthetic test cases from real query logs with automatic train/validation split.

Tasks:
- [ ] Create `lib/rag/test-set/generator.ts` — pulls high-confidence pairs from `document_access_logs`, generates Q&A pairs via LLM
- [ ] Create Supabase migration for `test_cases` table with `split` column (optimization/validation)
- [ ] Create `lib/rag/test-set/splitter.ts` — enforces 70/30 split at generation time, optimizer never touches validation set
- [ ] Wire generator into dashboard (new UI trigger or API endpoint)
- [ ] Add unit tests for split logic and generator output parsing
- [ ] Confirm: `pnpm vitest run` passes, `pnpm tsc --noEmit` clean, `pnpm build` clean

**Acceptance criteria:** Can generate 10+ test cases from access logs, all cases correctly assigned to split, optimizer only sees optimization-set cases.

---

### Phase 5 — Grounding Verification Pipeline
**Goal:** Filter hallucinated test cases before they enter the optimization set.

Tasks:
- [ ] Create `lib/rag/test-set/validator.ts` — three-layer pipeline: round-trip retrieval check, entailment scoring, human review queue flagging
- [ ] Round-trip check: re-run retrieval for each generated question, verify source chunk appears in top results
- [ ] Entailment scoring: second LLM pass scoring answer groundedness 1-5, configurable threshold (default 4)
- [ ] Human review queue: flag below-threshold cases in Supabase, surface in dashboard eval UI
- [ ] Integrate validator into generator pipeline (generate -> validate -> promote or flag)
- [ ] Add unit tests for each validation layer
- [ ] Confirm: `pnpm vitest run` passes, `pnpm tsc --noEmit` clean, `pnpm build` clean

**Acceptance criteria:** Hallucinated test cases are reliably caught by at least one layer; grounding scores stored per test case; flagged cases visible in dashboard.

---

### Phase 6 — Dashboard UI + Scheduling
**Goal:** Surface the optimizer in the dashboard and make it runnable on a schedule or on-demand.

Tasks:
- [ ] Add optimizer dashboard page at `app/(dashboard)/optimize/page.tsx`
- [ ] Show current best config, last session summary, experiment history table
- [ ] Add "Run Optimization Session" button (triggers background job)
- [ ] Add "Generate Test Cases" button (triggers generator + validator pipeline)
- [ ] Human review queue UI for flagged test cases
- [ ] Optional: trigger re-optimization on document ingestion
- [ ] Confirm: `pnpm vitest run` passes, `pnpm tsc --noEmit` clean, `pnpm build` clean, E2E tests pass

**Acceptance criteria:** Can run a full optimization session from the dashboard, see results, and review flagged test cases without touching code.

---

## Session Log

*(Agent appends after each session)*

### 2026-03-10
- **Phase:** 1
- **Task completed:** Create `lib/rag/optimizer/config.ts` — ExperimentConfig type + helpers
- **TDD:** red -> green -> refactor
- **Commits:** pending (Cowork VM cannot commit — needs manual commit on host)
- **New tests:** 14 (optimizer-config.test.ts)
- **Duration:** ~30 min
- **Stopped because:** natural boundary (task complete) + environment limitations (Cowork VM)
- **Blocker:** Cowork VM cannot run vitest/build (macOS node_modules on Linux VM) or git commit (filesystem permissions). Code is written and tsc-verified. Also fixed 2 pre-existing tsc errors in chat.test.ts and search.test.ts.

### 2026-03-11
- **Phase:** 1
- **Tasks completed:** Supabase migration for optimization tables + results-log.ts + results-log unit tests
- **TDD:** red (import fails) -> green (tsc clean with impl) -> refactor (tightened status types, cleaned error_message handling)
- **Commits:** pending (Cowork VM cannot commit — needs manual commit on host)
- **New tests:** 10 (optimizer-results-log.test.ts)
- **Duration:** ~35 min
- **Stopped because:** natural boundary (3 tasks complete in single session)
- **Blocker:** Same Cowork VM limitation — cannot run vitest/build (macOS node_modules on Linux ARM64 VM) or git commit. Code is written and tsc-verified clean. Chris needs to run `pnpm vitest run` and `pnpm build` on host, then commit.

---

## Notes for the Agent

- Read `AUTO-OPTIMIZE.md` first. It has the full concept, architecture decisions, and open questions.
- Work on one phase at a time. Do not start Phase 2 until Phase 1 acceptance criteria are met.
- Each session must complete at least one full task and leave the codebase in a passing state.
- Stop for the night when: (a) a natural task boundary is reached, (b) you have been running ~90 minutes, or (c) you hit a blocker that needs Chris's input.
- Never leave tests failing, TypeScript erroring, or build broken at end of session.
- Write the morning briefing to `AUTO-OPTIMIZE-BRIEFING.md` before stopping.
- Do NOT git push — local commits only.
