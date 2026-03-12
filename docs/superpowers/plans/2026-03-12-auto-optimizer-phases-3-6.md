# Auto-Optimizer Phases 3-6 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the RAG auto-optimizer with an LLM-driven decide step, synthetic test set generation, grounding verification, and a dashboard UI with API endpoint.

**Architecture:** Iterative OODA loop where an LLM agent proposes one experiment at a time based on failure patterns and cumulative insights. Test cases generated from corpus chunks (bootstrap) or query logs, validated through a 3-layer grounding pipeline, surfaced via a `/optimize` dashboard page and REST API endpoint.

**Tech Stack:** Next.js 15 (App Router), Supabase, Vercel AI SDK (`generateObject`), OpenAI `gpt-4.1` (configurable), Zod, ShadCN/UI, TailwindCSS

**Spec:** `docs/superpowers/specs/2026-03-12-auto-optimizer-phases-3-6-design.md`

**Existing code:**
- `lib/rag/optimizer/config.ts` — ExperimentConfig, CompositeWeights, computeCompositeScore
- `lib/rag/optimizer/experiment.ts` — runExperiment (pure, no DB writes)
- `lib/rag/optimizer/session.ts` — runSession (static experiment list iteration)
- `lib/rag/optimizer/results-log.ts` — Supabase CRUD for optimization tables
- `lib/rag/eval-runner.ts` — runEvaluation with retrievalOnly mode
- `supabase/migrations/00034_optimization_tables.sql` — optimization_runs, optimization_experiments, optimization_configs

**Backpressure commands (run after each task):**
```bash
pnpm vitest run        # All tests must pass
pnpm tsc --noEmit      # No type errors
pnpm build             # Clean build
```

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `supabase/migrations/00038_optimizer_phase3.sql` | Phase 3 schema: corpus_fingerprint, hypothesis columns, optimization_insights table |
| `supabase/migrations/00039_test_case_generation.sql` | Phase 4 schema: extend eval_test_cases with split, generation_mode, grounding_score, source_chunk_id, status |
| `lib/rag/optimizer/corpus.ts` | getCorpusFingerprint() — queries doc/chunk counts |
| `lib/rag/optimizer/agent.ts` | proposeExperiment() — LLM decide step via generateObject |
| `lib/rag/optimizer/report.ts` | generateSessionReport(), updateInsights() |
| `lib/rag/test-set/generator.ts` | generateTestCases() — bootstrap + query log modes |
| `lib/rag/test-set/splitter.ts` | assignSplit() — 70/30 optimization/validation |
| `lib/rag/test-set/validator.ts` | validateTestCases() — 3-layer grounding pipeline |
| `app/api/v1/optimize/route.ts` | POST (trigger session), GET (latest status/results) |
| `app/api/v1/optimize/[id]/route.ts` | GET specific session details |
| `tests/unit/optimize-api.test.ts` | API endpoint tests |
| `app/(dashboard)/optimize/page.tsx` | Dashboard page — 4 panels |
| `app/(dashboard)/optimize/actions.ts` | Server actions for optimize page |
| `app/(dashboard)/optimize/components/` | UI components for each panel |
| `tests/unit/optimizer-corpus.test.ts` | Corpus fingerprint tests |
| `tests/unit/optimizer-agent.test.ts` | Agent decide step tests |
| `tests/unit/optimizer-report.test.ts` | Report generator tests |
| `tests/unit/test-set-generator.test.ts` | Test set generator tests |
| `tests/unit/test-set-splitter.test.ts` | Splitter tests |
| `tests/unit/test-set-validator.test.ts` | Validator tests |

### Modified Files
| File | Changes |
|------|---------|
| `lib/rag/optimizer/session.ts` | Add agent-driven OODA loop alongside static iteration |
| `lib/rag/optimizer/results-log.ts` | Add hypothesis/corpus_fingerprint to ExperimentInsert, insights CRUD |
| `tests/unit/optimizer-session.test.ts` | Add tests for agent-driven mode |
| `.env.example` | Add OPTIMIZER_MODEL, AUTO_OPTIMIZE_ENABLED, ENTAILMENT_AUTO_APPROVE, ENTAILMENT_AUTO_REJECT, BOOTSTRAP_SAMPLE_SIZE |

---

## Chunk 1: Phase 3 — Agent Decide Step

### Task 1: Phase 3 Migration

**Files:**
- Create: `supabase/migrations/00038_optimizer_phase3.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase 3: Agent decide step schema changes

-- Add corpus fingerprint and hypothesis to experiments
ALTER TABLE public.optimization_experiments
  ADD COLUMN IF NOT EXISTS corpus_fingerprint jsonb,
  ADD COLUMN IF NOT EXISTS hypothesis text;

-- Add session report to runs
ALTER TABLE public.optimization_runs
  ADD COLUMN IF NOT EXISTS session_report text;

-- Cumulative insights table (one row per org)
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

- [ ] **Step 2: Apply migration to Supabase Cloud**

Use MCP tool: `mcp__supabase-mcp-server__apply_migration` with project_id `xjzhiprdbzvmijvymkbn` and the SQL above.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00038_optimizer_phase3.sql
git commit -m "feat(optimizer): add phase 3 migration — corpus fingerprint, insights table"
```

---

### Task 2: Corpus Fingerprint Utility

**Files:**
- Create: `lib/rag/optimizer/corpus.ts`
- Create: `tests/unit/optimizer-corpus.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/optimizer-corpus.test.ts
import { describe, it, expect, vi } from "vitest";
import { getCorpusFingerprint } from "@/lib/rag/optimizer/corpus";
import type { CorpusFingerprint } from "@/lib/rag/optimizer/corpus";

describe("getCorpusFingerprint", () => {
  function makeMockSupabase(docCount: number, chunkCount: number, lastIngestedAt: string | null) {
    return {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "documents") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { count: docCount, max_created_at: lastIngestedAt },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "document_chunks") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { count: chunkCount },
                  error: null,
                }),
              }),
            }),
          };
        }
      }),
      rpc: vi.fn(),
    } as any;
  }

  it("returns doc count, chunk count, and last ingested timestamp", async () => {
    const supabase = makeMockSupabase(10, 500, "2026-03-01T00:00:00Z");
    const result = await getCorpusFingerprint(supabase, "org-123");
    expect(result).toEqual({
      docCount: 10,
      chunkCount: 500,
      lastIngestedAt: "2026-03-01T00:00:00Z",
    });
  });

  it("returns null lastIngestedAt when no documents exist", async () => {
    const supabase = makeMockSupabase(0, 0, null);
    const result = await getCorpusFingerprint(supabase, "org-123");
    expect(result.docCount).toBe(0);
    expect(result.lastIngestedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run tests/unit/optimizer-corpus.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// lib/rag/optimizer/corpus.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type CorpusFingerprint = {
  docCount: number;
  chunkCount: number;
  lastIngestedAt: string | null;
};

/**
 * Get a snapshot of the current corpus state for an organization.
 * Used to track what the corpus looked like when an experiment was run.
 */
export async function getCorpusFingerprint(
  supabase: SupabaseClient,
  organizationId: string
): Promise<CorpusFingerprint> {
  const [docsResult, chunksResult] = await Promise.all([
    supabase
      .from("documents")
      .select("count:id.count(), max_created_at:created_at.max()")
      .eq("organization_id", organizationId)
      .single(),
    supabase
      .from("document_chunks")
      .select("count:id.count()")
      .eq("organization_id", organizationId)
      .single(),
  ]);

  if (docsResult.error) throw new Error(docsResult.error.message);
  if (chunksResult.error) throw new Error(chunksResult.error.message);

  return {
    docCount: (docsResult.data as any)?.count ?? 0,
    chunkCount: (chunksResult.data as any)?.count ?? 0,
    lastIngestedAt: (docsResult.data as any)?.max_created_at ?? null,
  };
}
```

**Important: Supabase aggregate syntax.** PostgREST does NOT support `id.count()` in `.select()`. Use the known-working pattern instead. Replace the Promise.all in the implementation above with:

```typescript
const [docsResult, chunksResult, latestDocResult] = await Promise.all([
  supabase.from("documents").select("*", { count: "exact", head: true }).eq("organization_id", organizationId),
  supabase.from("document_chunks").select("*", { count: "exact", head: true }).eq("organization_id", organizationId),
  supabase.from("documents").select("created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
]);

if (docsResult.error) throw new Error(docsResult.error.message);
if (chunksResult.error) throw new Error(chunksResult.error.message);

return {
  docCount: docsResult.count ?? 0,
  chunkCount: chunksResult.count ?? 0,
  lastIngestedAt: latestDocResult.data?.created_at ?? null,
};
```

Update the test mocks to match this API shape (`.select("*", { count: "exact", head: true })` returns `{ count, data: null }`).

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run tests/unit/optimizer-corpus.test.ts
```

- [ ] **Step 5: Run backpressure**

```bash
pnpm vitest run && pnpm tsc --noEmit && pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add lib/rag/optimizer/corpus.ts tests/unit/optimizer-corpus.test.ts
git commit -m "feat(optimizer): add corpus fingerprint utility"
```

---

### Task 3: Agent Decide Module

**Files:**
- Create: `lib/rag/optimizer/agent.ts`
- Create: `tests/unit/optimizer-agent.test.ts`

**Context:** This is the core intelligence of the optimizer. It takes current state (config, per-case metrics, experiment history, insights) and proposes the next experiment. Uses Vercel AI SDK `generateObject()` with Zod schema for structured output.

**Key design decisions:**
- `OPTIMIZER_MODEL` env var, default `gpt-4.1` (must be an OpenAI model name — uses `@ai-sdk/openai` provider directly since the project only has `OPENAI_API_KEY` configured)
- Single-knob proposals only (clean attribution)
- Continuous improvement spectrum: triage → optimization → diminishing returns
- Can return `{ stop: true }` when no further improvements expected

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/optimizer-agent.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExperimentProposal, AgentContext } from "@/lib/rag/optimizer/agent";

// Mock the ai module before import
vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));
vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn().mockReturnValue("mock-model"),
}));

import { proposeExperiment } from "@/lib/rag/optimizer/agent";
import { generateObject } from "ai";

const mockGenerateObject = vi.mocked(generateObject);

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    currentConfig: {
      model: "claude-sonnet-4-5-20250514",
      topK: 5,
      similarityThreshold: 0.3,
      fullTextWeight: 1.0,
      semanticWeight: 1.0,
      rerankEnabled: false,
      rerankCandidateMultiplier: 4,
    },
    perCaseMetrics: [
      {
        testCaseId: "tc-1",
        question: "What is the late fee?",
        compositeScore: 0.9,
        precisionAtK: 1.0,
        recallAtK: 1.0,
        mrr: 1.0,
        faithfulness: 4.5,
        relevance: 4.5,
        completeness: 4.0,
      },
      {
        testCaseId: "tc-2",
        question: "Compare pet policies across buildings",
        compositeScore: 0.4,
        precisionAtK: 0.4,
        recallAtK: 0.6,
        mrr: 0.5,
        faithfulness: 2.0,
        relevance: 3.0,
        completeness: 2.0,
      },
    ],
    sessionHistory: [],
    cumulativeInsights: null,
    corpusFingerprint: { docCount: 10, chunkCount: 500, lastIngestedAt: "2026-03-01T00:00:00Z" },
    ...overrides,
  };
}

describe("proposeExperiment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a proposal with knob, value, reasoning, and hypothesis", async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        stop: false,
        knob: "topK",
        value: 8,
        reasoning: "Low recall on multi-hop questions suggests we need more candidates",
        hypothesis: "Increasing topK from 5 to 8 should improve recall on cases tc-2",
      },
    } as any);

    const result = await proposeExperiment(makeContext());
    expect(result).toEqual({
      stop: false,
      knob: "topK",
      value: 8,
      reasoning: expect.any(String),
      hypothesis: expect.any(String),
    });
  });

  it("returns stop=true when agent decides no improvements possible", async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        stop: true,
        knob: null,
        value: null,
        reasoning: "Last 3 experiments showed <0.5% improvement",
        hypothesis: null,
      },
    } as any);

    const result = await proposeExperiment(makeContext());
    expect(result.stop).toBe(true);
    expect(result.reasoning).toBeTruthy();
  });

  it("passes session history to the agent for context", async () => {
    const context = makeContext({
      sessionHistory: [
        {
          experimentIndex: 0,
          knob: "topK",
          valueTested: 8,
          delta: 0.05,
          status: "kept",
          reasoning: "More candidates helped recall",
        },
      ],
    });

    mockGenerateObject.mockResolvedValue({
      object: {
        stop: false,
        knob: "fullTextWeight",
        value: 1.3,
        reasoning: "topK helped, now try BM25 weight",
        hypothesis: "Increasing BM25 weight may help keyword-heavy queries",
      },
    } as any);

    await proposeExperiment(context);

    // Verify generateObject was called (prompt contains session history)
    expect(mockGenerateObject).toHaveBeenCalledOnce();
    const callArgs = mockGenerateObject.mock.calls[0][0];
    expect(callArgs.prompt).toContain("topK");
    expect(callArgs.prompt).toContain("kept");
  });

  it("includes corpus fingerprint in the prompt", async () => {
    mockGenerateObject.mockResolvedValue({
      object: { stop: false, knob: "topK", value: 8, reasoning: "test", hypothesis: "test" },
    } as any);

    await proposeExperiment(makeContext());

    const callArgs = mockGenerateObject.mock.calls[0][0];
    expect(callArgs.prompt).toContain("10 documents");
    expect(callArgs.prompt).toContain("500 chunks");
  });

  it("includes cumulative insights when available", async () => {
    const context = makeContext({
      cumulativeInsights: {
        knobFindings: [
          { knob: "rerankEnabled", finding: "Not beneficial below 1000 chunks", testedCount: 3 },
        ],
      },
    });

    mockGenerateObject.mockResolvedValue({
      object: { stop: false, knob: "topK", value: 8, reasoning: "test", hypothesis: "test" },
    } as any);

    await proposeExperiment(context);

    const callArgs = mockGenerateObject.mock.calls[0][0];
    expect(callArgs.prompt).toContain("rerankEnabled");
    expect(callArgs.prompt).toContain("Not beneficial below 1000 chunks");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run tests/unit/optimizer-agent.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `lib/rag/optimizer/agent.ts`:

```typescript
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import type { ExperimentConfig } from "./config";
import type { CorpusFingerprint } from "./corpus";

// --- Types ---

export type PerCaseMetric = {
  testCaseId: string;
  question: string;
  compositeScore: number;
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
  faithfulness: number | null;
  relevance: number | null;
  completeness: number | null;
};

export type SessionHistoryEntry = {
  experimentIndex: number;
  knob: string;
  valueTested: number | boolean;
  delta: number;
  status: "kept" | "discarded" | "error";
  reasoning: string | null;
};

export type CumulativeInsights = {
  knobFindings: Array<{
    knob: string;
    finding: string;
    testedCount: number;
  }>;
};

export type AgentContext = {
  currentConfig: ExperimentConfig;
  perCaseMetrics: PerCaseMetric[];
  sessionHistory: SessionHistoryEntry[];
  cumulativeInsights: CumulativeInsights | null;
  corpusFingerprint: CorpusFingerprint;
};

export type ExperimentProposal = {
  stop: boolean;
  knob: string | null;
  value: number | boolean | null;
  reasoning: string;
  hypothesis: string | null;
};

// --- Zod schema for structured output ---

const proposalSchema = z.object({
  stop: z.boolean().describe("Set to true if no further improvements are expected"),
  knob: z.string().nullable().describe("The config knob to change (null if stopping)"),
  value: z.union([z.number(), z.boolean()]).nullable().describe("The new value to test (null if stopping)"),
  reasoning: z.string().describe("Why this experiment or why stopping"),
  hypothesis: z.string().nullable().describe("Expected outcome (null if stopping)"),
});

// --- Knob descriptions for the agent ---

const KNOB_DESCRIPTIONS = `
Available tunable knobs:
- topK (number, 1-20): Number of chunks retrieved. Default 5. Higher = more candidates but more noise.
- similarityThreshold (number, 0.0-1.0): Minimum similarity to include a result. Default 0.3. Lower = more results but less relevant.
- fullTextWeight (number, 0.0-3.0): Weight for BM25 keyword search in RRF fusion. Default 1.0. Higher = favor keyword matches.
- semanticWeight (number, 0.0-3.0): Weight for vector/semantic search in RRF fusion. Default 1.0. Higher = favor meaning matches.
- rerankEnabled (boolean): Whether to use Cohere cross-encoder reranking. Default false. Reranking re-scores candidates for precision.
- rerankCandidateMultiplier (number, 2-10): Over-fetch multiplier when reranking. Default 4. Higher = more candidates to rerank from.
`.trim();

// --- Prompt builder ---

function buildAgentPrompt(context: AgentContext): string {
  const { currentConfig, perCaseMetrics, sessionHistory, cumulativeInsights, corpusFingerprint } = context;

  // Sort cases by composite score (weakest first)
  const sortedCases = [...perCaseMetrics].sort((a, b) => a.compositeScore - b.compositeScore);

  let prompt = `You are a RAG pipeline optimizer. Your job is to propose ONE single-variable experiment that will most improve retrieval and answer quality.

## Current Corpus
${corpusFingerprint.docCount} documents, ${corpusFingerprint.chunkCount} chunks. Last ingested: ${corpusFingerprint.lastIngestedAt ?? "never"}.

## Current Configuration
${JSON.stringify(currentConfig, null, 2)}

## ${KNOB_DESCRIPTIONS}

## Per-Case Metrics (sorted by composite score, weakest first)
${sortedCases.map((c, i) => `${i + 1}. [${c.testCaseId}] "${c.question}" — composite: ${c.compositeScore.toFixed(3)}, P@k: ${c.precisionAtK.toFixed(2)}, R@k: ${c.recallAtK.toFixed(2)}, MRR: ${c.mrr.toFixed(2)}${c.faithfulness != null ? `, F: ${c.faithfulness.toFixed(1)}, R: ${c.relevance?.toFixed(1)}, C: ${c.completeness?.toFixed(1)}` : ""}`).join("\n")}
`;

  if (sessionHistory.length > 0) {
    prompt += `\n## Session History (experiments tried this session)\n`;
    prompt += sessionHistory.map((h) =>
      `- Exp ${h.experimentIndex}: ${h.knob}=${JSON.stringify(h.valueTested)} → delta: ${h.delta >= 0 ? "+" : ""}${h.delta.toFixed(4)}, ${h.status}${h.reasoning ? ` — ${h.reasoning}` : ""}`
    ).join("\n");
    prompt += "\n";
  }

  if (cumulativeInsights?.knobFindings?.length) {
    prompt += `\n## Cumulative Insights (from previous sessions)\n`;
    prompt += cumulativeInsights.knobFindings.map((f) =>
      `- ${f.knob}: ${f.finding} (tested ${f.testedCount}x)`
    ).join("\n");
    prompt += "\n";
  }

  prompt += `
## Your Task
Analyze the per-case metrics. Identify the weakest performers. Propose ONE knob change that would most improve the bottom quartile without regressing the top performers.

Rules:
- Change exactly ONE knob per experiment (single-variable for clean attribution).
- Do NOT re-try an experiment that was already tried this session with the same knob+value.
- If the last 3+ experiments all produced <0.5% improvement, consider stopping.
- Consider corpus size when reasoning about knobs (e.g., reranking may help more on larger corpora).
- Focus on continuous improvement, not just fixing failures. Even if scores are good, look for the weakest relative performers.

If you believe no further improvements are achievable with the available knobs, set stop=true and explain why.`;

  return prompt;
}

// --- Main function ---

export async function proposeExperiment(
  context: AgentContext,
  modelId?: string
): Promise<ExperimentProposal> {
  const model = modelId ?? process.env.OPTIMIZER_MODEL ?? "gpt-4.1";

  const { object } = await generateObject({
    model: openai(model),
    schema: proposalSchema,
    prompt: buildAgentPrompt(context),
  });

  return object;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run tests/unit/optimizer-agent.test.ts
```

- [ ] **Step 5: Run backpressure**

```bash
pnpm vitest run && pnpm tsc --noEmit && pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add lib/rag/optimizer/agent.ts tests/unit/optimizer-agent.test.ts
git commit -m "feat(optimizer): add agent decide module — LLM proposes experiments via generateObject"
```

---

### Task 4: Report Generator

**Files:**
- Create: `lib/rag/optimizer/report.ts`
- Create: `tests/unit/optimizer-report.test.ts`

**Context:** Generates a markdown session report and updates the cumulative insights doc. The insights doc is the cross-session memory — regenerated each session, not appended.

- [ ] **Step 1: Write the failing tests**

Test `generateSessionReport()` produces markdown with baseline vs final config, experiment results table, and total cost. Test `buildInsightsFromHistory()` produces a CumulativeInsights object from experiment history.

Key test cases:
- Session with 3 experiments (1 kept, 1 discarded, 1 error) → report has all three
- Empty experiment history → insights has no findings
- Multiple experiments on same knob → insights summarizes the most recent finding
- Report includes corpus fingerprint

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run tests/unit/optimizer-report.test.ts
```

- [ ] **Step 3: Write the implementation**

`lib/rag/optimizer/report.ts`:

```typescript
import type { ExperimentConfig, ConfigDiff } from "./config";
import { configDiff } from "./config";
import type { CorpusFingerprint } from "./corpus";
import type { CumulativeInsights } from "./agent";

type ExperimentSummary = {
  index: number;
  knob: string;
  valueTested: string | number | boolean;
  delta: number;
  status: "kept" | "discarded" | "error";
  reasoning: string | null;
};

type ReportParams = {
  baselineConfig: ExperimentConfig;
  finalConfig: ExperimentConfig;
  baselineScore: number;
  bestScore: number;
  experiments: ExperimentSummary[];
  corpusFingerprint: CorpusFingerprint;
};

export function generateSessionReport(params: ReportParams): string {
  const { baselineConfig, finalConfig, baselineScore, bestScore, experiments, corpusFingerprint } = params;
  const diff = configDiff(baselineConfig, finalConfig);
  const keptCount = experiments.filter((e) => e.status === "kept").length;
  const discardedCount = experiments.filter((e) => e.status === "discarded").length;

  let md = `# Optimization Session Report\n\n`;
  md += `**Corpus:** ${corpusFingerprint.docCount} docs, ${corpusFingerprint.chunkCount} chunks\n`;
  md += `**Baseline score:** ${baselineScore.toFixed(4)}\n`;
  md += `**Best score:** ${bestScore.toFixed(4)} (${bestScore > baselineScore ? "+" : ""}${(bestScore - baselineScore).toFixed(4)})\n`;
  md += `**Experiments:** ${experiments.length} total (${keptCount} kept, ${discardedCount} discarded)\n\n`;

  if (Object.keys(diff).length > 0) {
    md += `## Config Changes\n`;
    for (const [key, entry] of Object.entries(diff)) {
      md += `- **${key}:** ${entry!.before} → ${entry!.after}\n`;
    }
    md += "\n";
  }

  md += `## Experiment Log\n\n`;
  md += `| # | Knob | Value | Delta | Status | Reasoning |\n`;
  md += `|---|------|-------|-------|--------|----------|\n`;
  for (const exp of experiments) {
    md += `| ${exp.index} | ${exp.knob} | ${exp.valueTested} | ${exp.delta >= 0 ? "+" : ""}${exp.delta.toFixed(4)} | ${exp.status} | ${exp.reasoning ?? "-"} |\n`;
  }

  return md;
}

type HistoryEntry = {
  knob: string;
  delta: number;
  status: "kept" | "discarded" | "error";
  corpusFingerprint: CorpusFingerprint | null;
};

export function buildInsightsFromHistory(
  experiments: HistoryEntry[],
  existingInsights: CumulativeInsights | null
): CumulativeInsights {
  // Group experiments by knob
  const byKnob = new Map<string, HistoryEntry[]>();
  for (const exp of experiments) {
    const list = byKnob.get(exp.knob) ?? [];
    list.push(exp);
    byKnob.set(exp.knob, list);
  }

  // Merge with existing insights
  const existingMap = new Map(
    (existingInsights?.knobFindings ?? []).map((f) => [f.knob, f])
  );

  for (const [knob, exps] of byKnob) {
    const kept = exps.filter((e) => e.status === "kept");
    const discarded = exps.filter((e) => e.status === "discarded");
    const existing = existingMap.get(knob);
    const totalTested = (existing?.testedCount ?? 0) + exps.length;
    const lastCorpus = exps[exps.length - 1]?.corpusFingerprint;

    let finding: string;
    if (kept.length > 0) {
      const avgDelta = kept.reduce((sum, e) => sum + e.delta, 0) / kept.length;
      finding = `Beneficial (avg delta +${avgDelta.toFixed(4)})${lastCorpus ? ` at ${lastCorpus.chunkCount} chunks` : ""}`;
    } else if (discarded.length === exps.length) {
      finding = `Not beneficial${lastCorpus ? ` at ${lastCorpus.chunkCount} chunks` : ""}`;
    } else {
      finding = existing?.finding ?? "Inconclusive";
    }

    existingMap.set(knob, { knob, finding, testedCount: totalTested });
  }

  return { knobFindings: Array.from(existingMap.values()) };
}
```

Tests should verify:
- `generateSessionReport` produces markdown with config diff, experiment table, and scores
- `buildInsightsFromHistory` merges new experiments with existing insights, keeps latest finding per knob, increments testedCount
- Empty experiments → existing insights preserved unchanged
- All-discarded knob → "Not beneficial" finding
- Mixed kept/discarded → "Beneficial" finding with avg delta

- [ ] **Step 4: Run tests, backpressure, commit**

```bash
pnpm vitest run tests/unit/optimizer-report.test.ts
pnpm vitest run && pnpm tsc --noEmit && pnpm build
git add lib/rag/optimizer/report.ts tests/unit/optimizer-report.test.ts
git commit -m "feat(optimizer): add session report generator and insights builder"
```

---

### Task 5: Extend Results Log

**Files:**
- Modify: `lib/rag/optimizer/results-log.ts`

**Context:** Add `hypothesis` and `corpus_fingerprint` to `ExperimentInsert` and row types. Add CRUD for `optimization_insights` table.

**IMPORTANT: Steps 1-4 must be completed together before running backpressure. Adding fields to `ExperimentInsert` will cause tsc errors in `session.ts` until Step 4 updates the callsite.**

- [ ] **Step 1: Update types in results-log.ts**

Add to `ExperimentInsert`:
```typescript
hypothesis: string | null;
corpusFingerprint: Record<string, unknown> | null;
```

Add to `OptimizationExperimentRow`:
```typescript
hypothesis: string | null;
corpus_fingerprint: Record<string, unknown> | null;
```

Add to `OptimizationRunRow`:
```typescript
session_report: string | null;
```

Add to `OptimizationRunComplete`:
```typescript
sessionReport?: string;
```

- [ ] **Step 2: Update logExperiment to include new fields**

In `logExperiment()`, add to `insertPayload`:
```typescript
hypothesis: input.hypothesis ?? null,
corpus_fingerprint: input.corpusFingerprint ?? null,
```

In `completeOptimizationRun()`, add to `updatePayload`:
```typescript
session_report: input.sessionReport ?? null,
```

- [ ] **Step 3: Add insights CRUD functions**

```typescript
export type InsightsRow = {
  organization_id: string;
  insights: Record<string, unknown>;
  updated_at: string;
};

export async function getInsights(
  supabase: SupabaseClient,
  organizationId: string
): Promise<InsightsRow | null> {
  const { data, error } = await supabase
    .from("optimization_insights")
    .select()
    .eq("organization_id", organizationId)
    .single();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(error.message);
  }
  return data as InsightsRow;
}

export async function upsertInsights(
  supabase: SupabaseClient,
  organizationId: string,
  insights: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from("optimization_insights")
    .upsert(
      {
        organization_id: organizationId,
        insights,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" }
    )
    .select()
    .single();
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Update existing session.ts logExperiment calls**

In `session.ts` line 139, the existing `reasoning: null` stays. Add:
```typescript
hypothesis: null,
corpusFingerprint: null,
```

- [ ] **Step 5: Run backpressure**

```bash
pnpm vitest run && pnpm tsc --noEmit && pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add lib/rag/optimizer/results-log.ts lib/rag/optimizer/session.ts
git commit -m "feat(optimizer): extend results-log with hypothesis, corpus fingerprint, insights CRUD"
```

---

### Task 6: Refactor Session Loop for OODA

**Files:**
- Modify: `lib/rag/optimizer/session.ts`
- Modify: `tests/unit/optimizer-session.test.ts`

**Context:** When `SessionConfig.experiments` is empty or absent, the session uses the agent to propose experiments iteratively. When `experiments` is provided, it uses the existing Phase 2 static iteration. This preserves backward compatibility.

- [ ] **Step 1: Update SessionConfig type**

Make `experiments` optional:
```typescript
experiments?: Partial<ExperimentConfig>[];
```

Add agent-related deps to `SessionDeps`:
```typescript
proposeExperiment?: (context: AgentContext) => Promise<ExperimentProposal>;
getCorpusFingerprint?: (organizationId: string) => Promise<CorpusFingerprint>;
getInsights?: (organizationId: string) => Promise<CumulativeInsights | null>;
upsertInsights?: (organizationId: string, insights: CumulativeInsights) => Promise<void>;
generateReport?: (params: any) => string;
```

- [ ] **Step 2: Add agent-driven loop to runSession**

After the baseline eval, check if `config.experiments` is provided:
- If yes: use existing static iteration (unchanged)
- If no (agent mode): loop calling `deps.proposeExperiment()`, convert proposal to `configOverrides`, run experiment, build per-case metrics for next iteration, repeat until stop/budget

Key logic for agent mode:
```typescript
// Agent-driven OODA loop
let experimentIndex = 0;
while (experimentIndex < config.maxExperiments) {
  const context: AgentContext = {
    currentConfig,
    perCaseMetrics: buildPerCaseMetrics(lastEvalResult, config.compositeWeights),
    sessionHistory: history,
    cumulativeInsights: insights,
    corpusFingerprint: fingerprint,
  };

  const proposal = await deps.proposeExperiment!(context);

  if (proposal.stop) break;

  const overrides = { [proposal.knob!]: proposal.value! } as Partial<ExperimentConfig>;
  // ... run experiment, log with reasoning + hypothesis + fingerprint, update state
  experimentIndex++;
}
```

After the loop: generate report, update insights, complete run.

- [ ] **Step 3: Add helper to build per-case metrics from EvalRunResult**

```typescript
function buildPerCaseMetrics(evalResult: EvalRunResult, weights: CompositeWeights): PerCaseMetric[]
```

This maps `evalResult.perCase` to the `PerCaseMetric` type needed by the agent.

**Per-case metrics data flow:** The agent needs updated per-case metrics after each "kept" experiment to see whether its changes improved the weak cases. To enable this:

1. Add `perCase` to `ExperimentResult`:
```typescript
// In experiment.ts ExperimentResult type, add:
perCase: Array<{
  testCaseId: string;
  question: string;
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
  faithfulness: number | null;
  relevance: number | null;
  completeness: number | null;
}> | null;
```

2. In `runExperiment()`, populate it from `evalResult.perCase`:
```typescript
perCase: evalResult.perCase.map((pc) => ({
  testCaseId: pc.testCaseId,
  question: pc.question,
  precisionAtK: pc.precisionAtK,
  recallAtK: pc.recallAtK,
  mrr: pc.mrr,
  faithfulness: pc.judgeScores?.faithfulness ?? null,
  relevance: pc.judgeScores?.relevance ?? null,
  completeness: pc.judgeScores?.completeness ?? null,
})),
```

3. In the OODA loop, after a "kept" experiment, update `lastPerCaseMetrics` from the experiment's `perCase`. After a "discarded" experiment, keep the previous per-case metrics (config reverted, so old metrics still apply).

4. `buildPerCaseMetrics` helper computes compositeScore per case:
```typescript
function buildPerCaseMetrics(
  perCase: ExperimentResult["perCase"],
  weights: CompositeWeights
): PerCaseMetric[] {
  if (!perCase) return [];
  return perCase.map((pc) => ({
    testCaseId: pc.testCaseId,
    question: pc.question,
    compositeScore: computeCompositeScore({
      precisionAtK: pc.precisionAtK,
      recallAtK: pc.recallAtK,
      mrr: pc.mrr,
      faithfulness: pc.faithfulness ?? 0,
      relevance: pc.relevance ?? 0,
      completeness: pc.completeness ?? 0,
    }, weights),
    ...pc,
  }));
}
```

**Existing tests:** Add `perCase: null` to the `ExperimentResult` return in existing test mocks to maintain backward compatibility. The existing session tests mock `runExperiment` and don't inspect `perCase`, so they won't break.

- [ ] **Step 4: Write new tests for agent-driven mode**

Add to `tests/unit/optimizer-session.test.ts`:

```typescript
describe("agent-driven mode (no static experiments)", () => {
  it("calls proposeExperiment when experiments array is empty", async () => {
    // ...setup with proposeExperiment mock that returns stop after 1 experiment
  });

  it("stops when agent returns stop=true", async () => {
    // proposeExperiment returns { stop: true } immediately
    // verify 0 experiments run
  });

  it("stops when maxExperiments reached", async () => {
    // proposeExperiment always proposes, maxExperiments=3
    // verify exactly 3 experiments run
  });

  it("passes updated session history to each agent call", async () => {
    // verify second proposeExperiment call includes first experiment result
  });

  it("logs reasoning and hypothesis from agent proposal", async () => {
    // verify logExperiment called with reasoning and hypothesis from proposal
  });

  it("generates report and updates insights after session", async () => {
    // verify generateReport and upsertInsights called
  });

  it("falls back to static iteration when experiments provided", async () => {
    // config.experiments = [{topK: 8}], proposeExperiment should NOT be called
  });
});
```

- [ ] **Step 5: Run tests, backpressure, commit**

```bash
pnpm vitest run tests/unit/optimizer-session.test.ts
pnpm vitest run && pnpm tsc --noEmit && pnpm build
git add lib/rag/optimizer/session.ts tests/unit/optimizer-session.test.ts
git commit -m "feat(optimizer): add agent-driven OODA loop to session runner"
```

---

## Chunk 2: Phases 4+5 — Test Set Generator + Grounding Verification

### Task 7: Phase 4 Migration

**Files:**
- Create: `supabase/migrations/00039_test_case_generation.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase 4: Test case generation — extend eval_test_cases with generation metadata

ALTER TABLE public.eval_test_cases
  ADD COLUMN IF NOT EXISTS split text NOT NULL DEFAULT 'optimization'
    CHECK (split IN ('optimization', 'validation')),
  ADD COLUMN IF NOT EXISTS generation_mode text NOT NULL DEFAULT 'manual'
    CHECK (generation_mode IN ('bootstrap', 'query_log', 'manual')),
  ADD COLUMN IF NOT EXISTS grounding_score numeric(3,1)
    CHECK (grounding_score >= 1.0 AND grounding_score <= 5.0),
  ADD COLUMN IF NOT EXISTS source_chunk_id uuid REFERENCES public.document_chunks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'validated'
    CHECK (status IN ('pending', 'validated', 'flagged', 'rejected'));

-- Index for optimizer queries (only validated optimization cases)
CREATE INDEX IF NOT EXISTS eval_test_cases_optimizer_idx
  ON public.eval_test_cases(test_set_id, status, split)
  WHERE status = 'validated' AND split = 'optimization';
```

- [ ] **Step 2: Apply migration**

Use MCP tool: `mcp__supabase-mcp-server__apply_migration`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00039_test_case_generation.sql
git commit -m "feat(test-set): add generation metadata columns to eval_test_cases"
```

---

### Task 8: Test Set Splitter

**Files:**
- Create: `lib/rag/test-set/splitter.ts`
- Create: `tests/unit/test-set-splitter.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/test-set-splitter.test.ts
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
    expect(optCount).toBe(2); // Math.round(3 * 0.7) = Math.round(2.1) = 2
  });
});
```

- [ ] **Step 2: Run tests to verify they fail, write implementation, verify pass**

```typescript
// lib/rag/test-set/splitter.ts

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
```

- [ ] **Step 3: Run backpressure, commit**

```bash
pnpm vitest run && pnpm tsc --noEmit && pnpm build
git add lib/rag/test-set/splitter.ts tests/unit/test-set-splitter.test.ts
git commit -m "feat(test-set): add deterministic 70/30 split assignment"
```

---

### Task 9: Test Set Generator

**Files:**
- Create: `lib/rag/test-set/generator.ts`
- Create: `tests/unit/test-set-generator.test.ts`

**Context:** Two modes — bootstrap (from chunks) and query log (from document_access_logs). Both use `generateObject` to produce Q&A pairs from source content.

- [ ] **Step 1: Write the failing tests**

Key test cases:
- Bootstrap mode: given mock chunks, generates Q&A pairs with correct source_chunk_id and expected_source_ids
- Query log mode: given mock access logs, re-runs search, generates Q&A pairs
- Both modes assign splits via splitter
- All generated cases have `status: 'pending'` (awaiting validation)
- `generation_mode` correctly set
- Mock the LLM — don't call real API

Use dependency injection pattern matching existing optimizer code:
```typescript
type GeneratorDeps = {
  generateQA: (chunkContent: string, question?: string) => Promise<{ question: string; expectedAnswer: string }>;
  getChunks: (organizationId: string, limit: number) => Promise<ChunkForGeneration[]>;
  getAccessLogs: (organizationId: string, limit: number) => Promise<AccessLogEntry[]>;
  searchForChunks: (query: string, organizationId: string) => Promise<SearchResult[]>;
};
```

- [ ] **Step 2: Write implementation**

**Shared types (export from generator.ts, consumed by validator.ts):**

```typescript
export type GeneratedTestCase = {
  question: string;
  expectedAnswer: string;
  expectedSourceIds: string[];
  sourceChunkId: string;
  split: "optimization" | "validation";
  generationMode: "bootstrap" | "query_log";
  status: "pending";
};

export type ChunkForGeneration = {
  id: string;
  documentId: string;
  content: string;
  tokenCount: number;
};

export type AccessLogEntry = {
  queryText: string;
  documentId: string;
  chunksReturned: number;
};
```

**Zod schema for LLM Q&A generation:**

```typescript
import { z } from "zod";

const qaSchema = z.object({
  question: z.string().describe("A realistic question a user would ask about this content"),
  expectedAnswer: z.string().describe("The answer based ONLY on the provided source text — do not add information not present in the source"),
});
```

**Prompt for bootstrap mode:**
```
Given this document excerpt, write a realistic question that a user might ask and provide the expected answer. The answer MUST be fully supported by the text below — do not add any information that is not explicitly stated.

Source text:
{chunkContent}
```

**Prompt for query log mode:**
```
A user asked this question: "{queryText}"

Based ONLY on the document excerpt below, write the expected answer. The answer MUST be fully supported by the text — do not add any information that is not explicitly stated.

Source text:
{chunkContent}
```

Core function:
```typescript
export async function generateTestCases(
  mode: "bootstrap" | "query_log",
  organizationId: string,
  testSetId: string,
  deps: GeneratorDeps,
  options?: { sampleSize?: number }
): Promise<GeneratedTestCase[]>
```

Bootstrap mode:
1. `deps.getChunks(organizationId, sampleSize)` — one per document, prefer longer chunks
2. For each chunk: `deps.generateQA(chunk.content)` → get question + expected answer
3. Assign split via `assignSplit(index, total)`
4. Return array of `GeneratedTestCase` with all metadata

Query log mode:
1. `deps.getAccessLogs(organizationId, sampleSize)` — queries with `chunks_returned > 0`
2. For each log: `deps.searchForChunks(log.queryText, organizationId)` → get top chunk
3. `deps.generateQA(chunk.content, log.queryText)` → generate expected answer for that question
4. Assign split, return array

- [ ] **Step 3: Run tests, backpressure, commit**

```bash
pnpm vitest run tests/unit/test-set-generator.test.ts
pnpm vitest run && pnpm tsc --noEmit && pnpm build
git add lib/rag/test-set/generator.ts tests/unit/test-set-generator.test.ts
git commit -m "feat(test-set): add test case generator — bootstrap and query log modes"
```

---

### Task 10: Grounding Validator

**Files:**
- Create: `lib/rag/test-set/validator.ts`
- Create: `tests/unit/test-set-validator.test.ts`

**Context:** Three-layer grounding pipeline. Layer 1 (round-trip retrieval) and Layer 2 (entailment scoring) are automated. Layer 3 (human review) just means flagged cases surface in the dashboard — no code needed here beyond setting the status.

- [ ] **Step 1: Write the failing tests**

Key test cases:
- Round-trip check: source chunk in top results → passes layer 1
- Round-trip check: source chunk NOT in top results → `rejected`
- Entailment score >= 4 → `validated`
- Entailment score == 1 → `rejected`
- Entailment score 2-3 → `flagged`
- Already rejected by layer 1 → layer 2 is skipped (cost optimization)
- Custom thresholds respected (ENTAILMENT_AUTO_APPROVE, ENTAILMENT_AUTO_REJECT)

Dependency injection:
```typescript
type ValidatorDeps = {
  search: (query: string, organizationId: string) => Promise<SearchResult[]>;
  scoreEntailment: (chunkContent: string, answer: string) => Promise<number>;
};
```

- [ ] **Step 2: Write implementation**

**ValidatedTestCase type:**
```typescript
import type { GeneratedTestCase } from "./generator";

export type ValidatedTestCase = Omit<GeneratedTestCase, "status"> & {
  status: "validated" | "flagged" | "rejected";
  groundingScore: number | null;
};
```

**Entailment scoring Zod schema:**
```typescript
const entailmentSchema = z.object({
  score: z.number().min(1).max(5).describe("How well the answer is supported by the source. 1=not at all, 5=fully supported"),
  reasoning: z.string().describe("Brief explanation of the score"),
});
```

**Entailment prompt:**
```
Given ONLY the source text below, evaluate whether the proposed answer is fully supported.

Source text:
{chunkContent}

Proposed answer:
{expectedAnswer}

Score 1-5:
1 = Answer contains claims not in the source
2 = Answer mostly unsupported
3 = Answer partially supported
4 = Answer well supported with minor gaps
5 = Answer fully supported by the source
```

```typescript
export async function validateTestCases(
  testCases: GeneratedTestCase[],
  organizationId: string,
  deps: ValidatorDeps,
  options?: { autoApproveThreshold?: number; autoRejectThreshold?: number }
): Promise<ValidatedTestCase[]>
```

For each test case:
1. Layer 1: `deps.search(testCase.question, organizationId)` → check if `testCase.sourceChunkId` is in results
2. If not found → `{ ...testCase, status: 'rejected', groundingScore: null }`
3. Layer 2: `deps.scoreEntailment(chunkContent, testCase.expectedAnswer)` → score 1-5
4. Score >= autoApprove → `validated`, score <= autoReject → `rejected`, else → `flagged`
5. Set `groundingScore` on the result

- [ ] **Step 3: Run tests, backpressure, commit**

```bash
pnpm vitest run tests/unit/test-set-validator.test.ts
pnpm vitest run && pnpm tsc --noEmit && pnpm build
git add lib/rag/test-set/validator.ts tests/unit/test-set-validator.test.ts
git commit -m "feat(test-set): add grounding verification pipeline — round-trip + entailment"
```

---

## Chunk 3: Phase 6 — Dashboard UI + API

### Task 11: Optimize API Route

**Files:**
- Create: `app/api/v1/optimize/route.ts`

**Context:** Follow the pattern from `app/api/v1/search/route.ts` — auth via `authenticateApiKey`, service role client, `apiSuccess`/`apiError` responses.

- [ ] **Step 1: Write POST handler**

```typescript
// POST /api/v1/optimize — trigger optimization session
// Returns { data: { sessionId: string, status: "running" } }
// 409 if session already running for this org
// Requires AUTO_OPTIMIZE_ENABLED=true for API-triggered runs
```

- POST validates `AUTO_OPTIMIZE_ENABLED` env var
- Checks for active session: query `optimization_runs` where `status = 'running'` for org → 409 if found
- Creates session record with status "running"
- Fires off `runSession()` as detached promise (fire-and-forget)
- Returns session ID immediately

- [ ] **Step 2: Write GET handler**

```typescript
// GET /api/v1/optimize — latest session status + best config
// Returns { data: { latestSession: {...}, bestConfig: {...} } }
```

- Queries latest `optimization_runs` for org
- Queries `optimization_configs` for org
- Returns both

- [ ] **Step 3: Create session detail route**

Create `app/api/v1/optimize/[id]/route.ts`:
```typescript
// GET /api/v1/optimize/:id — specific session details with experiments
// Auth via authenticateApiKey
// Query optimization_runs by id + org, then optimization_experiments for that run
// Return { data: { session, experiments } }
// 404 if not found or wrong org
```

- [ ] **Step 4: Write API tests**

Create `tests/unit/optimize-api.test.ts` with tests for:
- Missing auth → 401
- `AUTO_OPTIMIZE_ENABLED=false` on POST → 403
- Active session running → POST returns 409
- Successful POST → returns session ID
- GET returns latest session and best config
- GET /[id] for wrong org → 404

Mock `authenticateApiKey`, Supabase queries, and `runSession`.

- [ ] **Step 5: Run backpressure, commit**

```bash
pnpm vitest run && pnpm tsc --noEmit && pnpm build
git add app/api/v1/optimize/ tests/unit/optimize-api.test.ts
git commit -m "feat(optimizer): add /api/v1/optimize endpoint — trigger, status, and detail"
```

---

### Task 12: Optimize Server Actions

**Files:**
- Create: `app/(dashboard)/optimize/actions.ts`

**Context:** Follow the pattern from `app/(dashboard)/eval/actions.ts` — `getCurrentOrg()` helper, server actions with `"use server"`, `revalidatePath("/optimize")`.

- [ ] **Step 1: Write server actions**

```typescript
"use server";

// runOptimizationSession() — kicks off background session
// - Gets current org
// - Checks for active session (409 pattern)
// - Creates run, fires off runSession detached
// - Returns { sessionId }

// generateTestCases(mode) — triggers generator + validator pipeline
// - Gets current org
// - Finds or creates test set for org
// - Calls generateTestCases() then validateTestCases()
// - Inserts validated cases into eval_test_cases
// - Returns { generated: number, validated: number, flagged: number, rejected: number }

// reviewTestCase(id, decision) — approve/reject flagged case
// - Updates eval_test_cases status
// - revalidatePath("/optimize")

// getOptimizePageData() — loads all data for the dashboard page
// Returns OptimizePageData:
export type OptimizePageData = {
  bestConfig: OptimizationConfigRow | null;
  latestSessions: OptimizationRunRow[];
  experiments: OptimizationExperimentRow[];
  insights: CumulativeInsights | null;
  flaggedTestCases: Array<{ id: string; question: string; expected_answer: string; grounding_score: number | null }>;
  flaggedCount: number;
};
```

**Wiring real dependencies for generateTestCases action:**

```typescript
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { hybridSearch } from "@/lib/rag/search";
import { createAdminClient } from "@/lib/supabase/admin";

const model = process.env.OPTIMIZER_MODEL ?? "gpt-4.1";
const supabase = createAdminClient();

const generatorDeps: GeneratorDeps = {
  generateQA: async (content, question) => {
    const { object } = await generateObject({
      model: openai(model),
      schema: qaSchema,
      prompt: question
        ? `A user asked: "${question}"\n\nBased ONLY on this text, write the expected answer:\n\n${content}`
        : `Given this document excerpt, write a realistic question and expected answer based ONLY on the text:\n\n${content}`,
    });
    return object;
  },
  getChunks: async (orgId, limit) => {
    const { data, error } = await supabase
      .from("document_chunks")
      .select("id, document_id, content, token_count")
      .eq("organization_id", orgId)
      .order("token_count", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map((d: any) => ({
      id: d.id, documentId: d.document_id,
      content: d.content, tokenCount: d.token_count,
    }));
  },
  getAccessLogs: async (orgId, limit) => {
    const { data, error } = await supabase
      .from("document_access_logs")
      .select("query_text, document_id, chunks_returned")
      .eq("organization_id", orgId)
      .gt("chunks_returned", 0)
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map((d: any) => ({
      queryText: d.query_text, documentId: d.document_id,
      chunksReturned: d.chunks_returned,
    }));
  },
  searchForChunks: async (query, orgId) => {
    return hybridSearch(supabase, query, orgId);
  },
};

const validatorDeps: ValidatorDeps = {
  search: async (query, orgId) => hybridSearch(supabase, query, orgId),
  scoreEntailment: async (chunkContent, answer) => {
    const { object } = await generateObject({
      model: openai(model),
      schema: entailmentSchema,
      prompt: `Evaluate if this answer is supported by the source:\n\nSource: ${chunkContent}\n\nAnswer: ${answer}`,
    });
    return object.score;
  },
};
```

- [ ] **Step 2: Run backpressure, commit**

```bash
pnpm vitest run && pnpm tsc --noEmit && pnpm build
git add app/\(dashboard\)/optimize/actions.ts
git commit -m "feat(optimizer): add optimize page server actions"
```

---

### Task 13: Optimize Dashboard Page

**Files:**
- Create: `app/(dashboard)/optimize/page.tsx`
- Create: `app/(dashboard)/optimize/components/best-config-panel.tsx`
- Create: `app/(dashboard)/optimize/components/experiment-history-panel.tsx`
- Create: `app/(dashboard)/optimize/components/insights-panel.tsx`
- Create: `app/(dashboard)/optimize/components/test-case-panel.tsx`

**Context:** Follow the pattern from `app/(dashboard)/eval/page.tsx` — async Server Component, load data via server actions, pass to child components. Use ShadCN components: `Card`, `Table`, `Tabs`, `Button`, `Badge`, `Select`.

- [ ] **Step 1: Create the page component**

Async server component that:
1. Calls `getOptimizePageData()` from actions
2. Renders four panels in a grid layout
3. Each panel is a separate client component (for interactive elements like buttons)

- [ ] **Step 2: Create BestConfigPanel**

Shows current optimized config vs defaults, last optimization date, composite score.
"Run Optimization Session" button calls `runOptimizationSession()` server action.

- [ ] **Step 3: Create ExperimentHistoryPanel**

Table of past sessions with expandable rows showing individual experiments.
Uses `Table`, `Badge` (kept=green, discarded=red, error=yellow).

- [ ] **Step 4: Create InsightsPanel**

Read-only card showing cumulative insights.
Simple markdown-like rendering of knob findings.

- [ ] **Step 5: Create TestCasePanel**

Two tabs (Tabs component):
- Generator tab: mode selector (Select) + "Generate" button
- Review Queue tab: cards for flagged cases with approve/reject buttons

- [ ] **Step 6: Add /optimize to sidebar navigation**

Find the sidebar component (likely `components/sidebar.tsx` or similar) and add a navigation link for `/optimize`. Use the same pattern as `/eval` link.

- [ ] **Step 7: Update eval runner to filter by status**

In `app/(dashboard)/eval/actions.ts`, update `runEval()` to add `.eq("status", "validated")` when querying `eval_test_cases`. This prevents rejected generated test cases from appearing in manual eval runs.

- [ ] **Step 8: Run backpressure, commit**

```bash
pnpm vitest run && pnpm tsc --noEmit && pnpm build
git add app/\(dashboard\)/optimize/ components/
git commit -m "feat(optimizer): add /optimize dashboard page with 4 panels"
```

---

### Task 14: Update .env.example and Final Cleanup

**Files:**
- Modify: `.env.example`
- Modify: `AUTO-OPTIMIZE-BUILD-STATE.md`

- [ ] **Step 1: Update .env.example**

Add after the `SEMANTIC_CACHE` section:

```env
# AUTO-OPTIMIZER (optional — runs iterative experiments to tune RAG config)
OPTIMIZER_MODEL=gpt-4.1              # Model for optimizer decide step (default gpt-4.1)
AUTO_OPTIMIZE_ENABLED=false           # Set to "true" to allow API-triggered optimization
ENTAILMENT_AUTO_APPROVE=4             # Min entailment score for auto-validation (default 4)
ENTAILMENT_AUTO_REJECT=1              # Max entailment score for auto-rejection (default 1)
BOOTSTRAP_SAMPLE_SIZE=20              # Chunks to sample in bootstrap test generation
```

- [ ] **Step 2: Update AUTO-OPTIMIZE-BUILD-STATE.md**

Mark Phases 3-6 as complete. Update session log with today's date and work summary.

- [ ] **Step 3: Run full backpressure**

```bash
pnpm vitest run && pnpm tsc --noEmit && pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add .env.example AUTO-OPTIMIZE-BUILD-STATE.md
git commit -m "chore(optimizer): update env.example and build state — phases 3-6 complete"
```

---

## Summary

| Task | Phase | Description | New Tests |
|------|-------|-------------|-----------|
| 1 | 3 | Migration — corpus fingerprint, insights table | — |
| 2 | 3 | Corpus fingerprint utility | ~4 |
| 3 | 3 | Agent decide module | ~5 |
| 4 | 3 | Report generator | ~5 |
| 5 | 3 | Extend results-log types + insights CRUD | — |
| 6 | 3 | Refactor session loop for OODA | ~7 |
| 7 | 4 | Migration — extend eval_test_cases | — |
| 8 | 4 | Test set splitter | ~4 |
| 9 | 4 | Test set generator | ~6 |
| 10 | 5 | Grounding validator | ~7 |
| 11 | 6 | Optimize API route + tests | ~6 |
| 12 | 6 | Optimize server actions | — |
| 13 | 6 | Optimize dashboard page + sidebar | — |
| 14 | 6 | Env vars + build state cleanup | — |

**Estimated new tests:** ~44
**Total tasks:** 14
