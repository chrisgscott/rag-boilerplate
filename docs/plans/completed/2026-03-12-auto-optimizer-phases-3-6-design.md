# RAG Auto-Optimizer Phases 3-6 — Design Spec

> **For agentic workers:** This spec covers Phases 3-6 of the auto-optimizer. Phases 1-2 are complete — see `AUTO-OPTIMIZE-BUILD-STATE.md` for history.

**Goal:** Complete the auto-optimizer by adding an LLM-driven "Decide" step, synthetic test set generation, grounding verification, and a dashboard UI with API endpoint for autonomous runs.

**Existing foundation:** `lib/rag/optimizer/` — `config.ts` (ExperimentConfig, 7 tunable knobs, composite score), `experiment.ts` (single experiment runner), `session.ts` (session loop with baseline tracking), `results-log.ts` (Supabase persistence). Phase 2 added `retrievalOnly` fast mode to `runEvaluation()`.

---

## Phase 3: Agent Decide Step

### Overview

Replace the static experiment list in `session.ts` with an iterative OODA loop where an LLM agent proposes one experiment at a time, sees the result, then decides the next move.

### Module: `lib/rag/optimizer/agent.ts`

**LLM integration:** Vercel AI SDK `generateObject()` with structured output via Zod schema. Model configurable via `OPTIMIZER_MODEL` env var, default to a capable model (e.g., `gpt-4.1`).

**Input to agent (per iteration):**

| Component | Description | ~Tokens |
|-----------|-------------|---------|
| System prompt + knob descriptions | What each knob does, valid ranges, constraints | 800 |
| Current config | All 7 knobs and their values | 200 |
| Test cases | Questions + expected answers (25 cases) | 5,000 |
| Per-case metrics | 6 metrics per case from last eval run | 2,500 |
| Session experiment history | What was tried this session, deltas, reasoning | 3,000 |
| Cumulative insights | Persistent cross-session learnings | 1,000 |
| **Total (worst case, experiment 10)** | | **~12,500** |

**Output schema (Zod-validated):**

```typescript
type ExperimentProposal = {
  knob: string;          // Which knob to change
  value: number | boolean; // New value to test
  reasoning: string;     // Why this change
  hypothesis: string;    // Expected outcome
} | {
  stop: true;            // No further improvements expected
  reasoning: string;     // Why stopping
};
```

### Continuous Improvement Spectrum

The agent prompt must support three reasoning modes, not just "fix failures":

1. **Triage mode** (poor baseline) — "Cases 3, 7, 12 are outright failing. Fix retrieval first."
2. **Optimization mode** (decent baseline) — "No failures, but cases 5 and 9 score 3.8 on completeness while everything else is 4.5+. Can we close that gap?"
3. **Diminishing returns detection** — "Last 3 experiments all produced <0.5% improvement. Further tuning is unlikely to help."

Prompt framing: "Rank all test cases by composite score. Identify the weakest performers. Hypothesize which knob change would most improve the bottom quartile without regressing the top quartile."

### Corpus-Aware Experiment History

Each experiment record includes a `corpus_fingerprint` (jsonb):

```typescript
type CorpusFingerprint = {
  docCount: number;
  chunkCount: number;
  lastIngestedAt: string; // ISO timestamp
};
```

When the agent sees historical experiments, it also sees the corpus state at the time. This lets it reason: "reranking was discarded at 847 chunks, but corpus now has 3,200 chunks — worth retesting."

No automatic invalidation of past results. The agent uses corpus delta as one input to its reasoning.

### Staleness Signaling

At session start, if the corpus has changed significantly since the last optimization session, the agent receives an explicit signal:

> "Corpus has changed substantially since last optimization session (12→42 docs, 847→3,200 chunks). Previous experiment results may not reflect current performance. Consider retesting previously discarded changes."

### Tiered Context Strategy

Cross-session history grows unbounded in the database (for analytics). But the agent only sees:

1. **Current session:** Full detail (deltas, reasoning, per-case metrics) — ~3K tokens max
2. **Last session:** Summary only (kept changes, final config, corpus fingerprint) — ~500 tokens
3. **Cumulative insights:** Persistent structured summary, regenerated each session — ~1K tokens

The cumulative insights doc is maintained by the report generator (see below). It captures durable learnings like:

```
- Reranking: not beneficial below ~1,000 chunks (tested 3x, last at 847 chunks)
- topK: sweet spot 5-8 for this corpus, >8 adds noise
- fullTextWeight: 1.2 outperforms 1.0, tested twice
```

This keeps agent context under ~15K tokens regardless of how many sessions have run.

### Session Loop Changes (`session.ts`)

Current flow (Phase 2):
```
establish baseline → iterate static experiments[] → track best → log to DB
```

New flow (Phase 3):
```
establish baseline → call agent → run experiment → log result → call agent again → repeat until:
  - agent says "stop" (no further improvements expected)
  - maxExperiments reached (default 10)
  - maxBudgetUsd reached (default $5)
```

Budget enforcement: cost tracked per experiment (embedding calls + optional judge calls + agent decide calls). Session stops when either cap is hit.

### Report Generator: `lib/rag/optimizer/report.ts`

After session completes, generates:

1. **Session report** — structured markdown: baseline vs final config, kept/discarded experiments with reasoning, per-metric deltas, total cost.
2. **Updated cumulative insights** — overwrites the previous insights doc with current learnings. Keeps only what's still relevant (not append-only).

### Schema Changes

Add columns to `optimization_experiments` table (migration 00034 already has `reasoning`):
- `corpus_fingerprint` (jsonb, nullable) — `{ docCount, chunkCount, lastIngestedAt }`
- `hypothesis` (text, nullable) — agent's expected outcome

**Corpus fingerprint population:** Query at experiment time:
```sql
SELECT count(*) FROM documents WHERE organization_id = $1;
SELECT count(*) FROM document_chunks WHERE organization_id = $1;
SELECT max(created_at) FROM documents WHERE organization_id = $1;
```

Add `session_report` (text, nullable) column to `optimization_runs` — stores the markdown session report for dashboard display.

New table for cumulative insights:

```sql
CREATE TABLE public.optimization_insights (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  insights jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.optimization_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org insights"
  ON public.optimization_insights FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can upsert org insights"
  ON public.optimization_insights FOR ALL
  USING (organization_id IN (SELECT public.get_user_organizations()));
```

### SessionConfig Type Changes

The existing `SessionConfig.experiments: Partial<ExperimentConfig>[]` field becomes optional. When omitted, the session uses agent-driven iteration (Phase 3 default). When provided, it falls back to the Phase 2 static iteration — useful for testing and manual overrides.

### Single-Knob Constraint

The agent proposes one knob change per experiment. This is intentional — single-variable experiments produce clean signal about which changes help. Multi-knob proposals would make it impossible to attribute improvements. If a future use case needs coordinated changes (e.g., "enable reranking AND increase topK"), the agent can propose them as sequential experiments.

---

## Phase 4: Test Set Generator

### Overview

Generate synthetic test cases from real corpus content so the optimizer has data to work with. Two modes: bootstrap (fresh deployments) and query log (mature deployments).

### Module: `lib/rag/test-set/generator.ts`

**Bootstrap mode** (no usage data required):
1. Sample document chunks from the corpus — one chunk per document (deduped), up to `BOOTSTRAP_SAMPLE_SIZE` (default 20). Prefer longer chunks (more content to generate questions from). Random selection within that filter.
2. For each chunk, send to LLM: "Given this source content, write a realistic question a user would ask and the expected answer based only on this text."
3. Populate `expected_source_ids` from the chunk's document ID
4. Pass to grounding verification pipeline (Phase 5)

**Query log mode** (requires `document_access_logs` data):
1. Harvest queries from `document_access_logs` that returned results (`chunks_returned > 0`)
2. Re-run each query through `hybridSearch` to get the actual chunks with similarity scores (the access log table stores `query_text` and `document_id` but not chunk-level scores — we re-retrieve to get fresh, scored results)
3. Filter to high-confidence pairs (top similarity scores)
4. For each pair, LLM generates the expected answer from the chunk content
5. Populate `expected_source_ids` from retrieved doc IDs
6. Pass to grounding verification pipeline (Phase 5)

**Note:** Query log mode requires real usage in `document_access_logs`. The access log table does not store per-chunk similarity scores, so we re-run retrieval at generation time. This also ensures test cases reflect the current embedding state.

### Split Enforcement: `lib/rag/test-set/splitter.ts`

70% optimization set, 30% held-out validation. Enforced at generation time in code. The optimizer only ever queries optimization-split cases. Validation set is for human review and drift detection.

### Schema: Extend Existing `eval_test_cases` Table

Rather than creating a separate `test_cases` table, add new columns to the existing `eval_test_cases` table (migration 00015). This keeps a single test case store — the optimizer, eval runner, and generator all work with the same data.

```sql
ALTER TABLE public.eval_test_cases
  ADD COLUMN split text NOT NULL DEFAULT 'optimization'
    CHECK (split IN ('optimization', 'validation')),
  ADD COLUMN generation_mode text NOT NULL DEFAULT 'manual'
    CHECK (generation_mode IN ('bootstrap', 'query_log', 'manual')),
  ADD COLUMN grounding_score numeric(3,1)
    CHECK (grounding_score >= 1.0 AND grounding_score <= 5.0),
  ADD COLUMN source_chunk_id uuid REFERENCES public.document_chunks(id) ON DELETE SET NULL,
  ADD COLUMN status text NOT NULL DEFAULT 'validated'
    CHECK (status IN ('pending', 'validated', 'flagged', 'rejected'));
```

**Backward compatibility:** Existing manually-created test cases get `split='optimization'`, `generation_mode='manual'`, `status='validated'` — they continue working unchanged. The optimizer queries only `status='validated' AND split='optimization'`.

**ID consistency:** `eval_test_cases` uses `uuid` primary keys, matching the existing `ExperimentTestCase.id: string` type in the optimizer code.

RLS: already in place via `test_set_id → eval_test_sets.organization_id`.

---

## Phase 5: Grounding Verification Pipeline

### Overview

Filter hallucinated test cases before they corrupt the optimization signal. Three layers applied in order of cost.

### Module: `lib/rag/test-set/validator.ts`

**Layer 1 — Round-trip retrieval check (free):**
Run the generated question through `hybridSearch`. If the source chunk doesn't appear in the top results, the question is too vague or malformed. Mark as `rejected`.

**Layer 2 — Entailment scoring (cheap):**
Second LLM pass using `OPTIMIZER_MODEL`: "Given only this source chunk, is this answer fully supported? Score 1-5." Structured output via Zod.

- Score >= `ENTAILMENT_AUTO_APPROVE` (default 4) → `validated`
- Score <= `ENTAILMENT_AUTO_REJECT` (default 1) → `rejected`
- Between → `flagged` for human review

**Layer 3 — Human review queue:**
Flagged cases surface in the dashboard (Phase 6). Human can approve → `validated` or reject → `rejected`. Keeps human effort focused on the ambiguous middle.

### Pipeline Flow

```
Generate → Round-trip check → Entailment score → Auto-validate/reject/flag → Human reviews flagged
```

Both generation modes (bootstrap and query log) go through the same pipeline. Cases only enter the optimization set after reaching `validated` status.

### Configurable Thresholds

- `ENTAILMENT_AUTO_APPROVE` (default 4) — env var
- `ENTAILMENT_AUTO_REJECT` (default 1) — env var

---

## Phase 6: Dashboard UI + API

### Overview

Surface the optimizer in the dashboard for visibility and manual control. Provide an API endpoint for autonomous/scheduled runs.

### Route: `app/(dashboard)/optimize/page.tsx`

**Four panels:**

**1. Current Best Config**
- Active optimized config vs. defaults (diff view)
- Last optimization date, composite score, corpus fingerprint
- "Run Optimization Session" button (triggers background session via server action)

**2. Experiment History**
- Table of past sessions, expandable to individual experiments
- Each row: timestamp, knob changed, delta, kept/discarded, reasoning snippet
- Sortable by session, knob, or outcome

**3. Cumulative Insights**
- The persistent insights doc rendered as a read-only card
- What the optimizer has learned about this corpus
- Auto-generated each session by the report generator

**4. Test Case Management**
- **Generator tab:** "Generate Test Cases" button with mode selector (bootstrap/query log). Progress indicator and results summary.
- **Review Queue tab:** Flagged test cases awaiting human review. Each card: question, expected answer, source chunk excerpt, entailment score. Approve/reject buttons. Count badge for pending reviews.

### API Endpoint: `app/api/v1/optimize/route.ts`

- `POST /api/v1/optimize` — triggers an optimization session. Returns session ID immediately (fire-and-forget).
- `GET /api/v1/optimize` — returns latest session status/results. Caller polls this for progress.
- `GET /api/v1/optimize/:id` — returns specific session details.

Uses existing API key auth from `lib/api/auth.ts`.

**Execution model:** The POST handler starts the session and returns immediately. The session runs as a background async task within the same process. This works for self-hosted / long-running server environments (Render, Railway, VPS). On Vercel (serverless, 60-300s timeout), optimization sessions will hit the function timeout for large experiment counts — users on Vercel should trigger sessions via the nightly agent pattern (external scheduler calling the API) or reduce `maxExperiments`. The dashboard button uses server actions which have the same timeout constraints.

**Concurrency guard:** Only one active session per org at a time. If a session is already running, POST returns 409 Conflict. Checked via `optimization_runs` where `status = 'running'` for the org.

### Autonomous Runs

The app does NOT ship a built-in scheduler. Instead:

- **Manual:** Dashboard button
- **Autonomous:** API endpoint + user's own scheduler (launchd, cron, Vercel cron)
- **Opt-in gate:** `AUTO_OPTIMIZE_ENABLED=false` env var — must be explicitly enabled before autonomous runs will execute
- **Cost protection:** Per-session budget caps (`maxExperiments`, `maxBudgetUsd`) enforced regardless of trigger source
- **Visibility:** Dashboard shows cumulative cost across sessions

### Server Actions

```typescript
// app/(dashboard)/optimize/actions.ts
runOptimizationSession(): Promise<{ sessionId: string }>
generateTestCases(mode: 'bootstrap' | 'query_log'): Promise<{ generated: number }>
reviewTestCase(id: string, decision: 'validated' | 'rejected'): Promise<void>
```

---

## Environment Variables (New)

| Variable | Default | Description |
|----------|---------|-------------|
| `OPTIMIZER_MODEL` | `gpt-4.1` | Model for decide step + entailment scoring (distinct from `EvalConfig.model` which controls the chat/generation model being evaluated) |
| `AUTO_OPTIMIZE_ENABLED` | `false` | Gate for autonomous/scheduled runs |
| `ENTAILMENT_AUTO_APPROVE` | `4` | Min score for auto-validation |
| `ENTAILMENT_AUTO_REJECT` | `1` | Max score for auto-rejection |
| `BOOTSTRAP_SAMPLE_SIZE` | `20` | Number of chunks to sample in bootstrap mode |

---

## Dependencies

- **Vercel AI SDK** (`ai` package) — already installed, used for `generateObject()`
- **OpenAI provider** (`@ai-sdk/openai`) — already installed
- **Zod** — already installed, used for structured output schemas

No new dependencies required.

---

## Relationship to Existing Code

| Existing Module | How Phases 3-6 Interact |
|-----------------|------------------------|
| `lib/rag/optimizer/config.ts` | Agent proposes changes to ExperimentConfig knobs |
| `lib/rag/optimizer/experiment.ts` | Session loop calls `runExperiment()` unchanged |
| `lib/rag/optimizer/session.ts` | **Modified:** static experiment list → agent-driven OODA loop |
| `lib/rag/optimizer/results-log.ts` | **Extended:** new columns on experiments table, new insights table |
| `lib/rag/eval-runner.ts` | Called by experiment runner, fast mode for retrieval-only |
| `lib/rag/search.ts` | Called by round-trip retrieval check in validator |
| `supabase/migrations/00011_document_access_logs.sql` | Source data for query log test set generation |
| `app/api/v1/` | New `/optimize` endpoint follows existing API patterns |

---

*Spec written: 2026-03-12. Covers Phases 3-6 of the RAG Auto-Optimizer.*
