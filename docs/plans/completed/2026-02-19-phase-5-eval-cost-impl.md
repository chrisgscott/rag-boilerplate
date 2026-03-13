# Phase 5: Evaluation & Cost Tracking — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add built-in evaluation tooling (retrieval + answer quality metrics), per-query cost tracking, user feedback loop, and admin UI for model rates.

**Architecture:** Server Actions for all mutations. All data in Supabase with RLS. Cost tracking hooks into the existing chat route's `onFinish` callback. Eval runner calls `hybridSearch()` directly for retrieval metrics, full LLM pipeline for answer quality. LLM-as-judge scores faithfulness, relevance, and completeness on a 1-5 scale.

**Tech Stack:** Next.js 16 (App Router), Supabase Postgres, Vercel AI SDK, Vitest, ShadCN/UI, TailwindCSS v4

**Design Doc:** `docs/plans/2026-02-19-phase-5-eval-cost-design.md`

---

## Important Context

Before starting, read these files to understand existing patterns:

- `app/api/chat/route.ts` — The chat route handler. The `onFinish` callback (line 170) already receives `{ text, usage }` with `usage.inputTokens` and `usage.outputTokens`. This is where cost tracking plugs in.
- `lib/rag/search.ts` — `hybridSearch()` already returns `queryTokenCount` (embedding tokens) in its response. No embedder modification needed.
- `lib/rag/embedder.ts` — The embedding client with DI pattern (`setEmbeddingClient()` for testing).
- `lib/rag/provider.ts` — `getLLMProvider()` and `getModelId()` for LLM access.
- `app/(dashboard)/chat/actions.ts` — The `getCurrentOrg()` helper pattern used by all Server Actions.
- `app/(dashboard)/documents/actions.ts` — Another example of the Server Action + `getCurrentOrg()` pattern.
- `tests/unit/search.test.ts` — Test patterns: mock Supabase client, `vi.mock()`, async assertions.
- `tests/unit/embedder.test.ts` — Test patterns: DI-based testing, mock client injection.

Key facts:
- `messages.id` is `bigint` (auto-increment), NOT `uuid` — any FK referencing it must be `bigint`
- Messages have no `organization_id` column — RLS is via conversation join
- Next migration number: `00014`
- Supabase project ID: `xjzhiprdbzvmijvymkbn`
- All RLS uses the `get_user_organizations()` helper function
- Use `mcp__supabase-mcp-server__apply_migration` tool for migrations
- Test command: `pnpm vitest run` from project root
- Build command: `pnpm build`

---

## Task 1: Database Migration — usage_logs + model_rates

**Files:**
- Create: `supabase/migrations/00014_usage_logs.sql`

**Step 1: Write the migration**

```sql
-- Phase 5: Usage logs and model rates for cost tracking

-- Model rates: per-org token pricing
CREATE TABLE public.model_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  model_id text NOT NULL,
  input_rate numeric(12,10) NOT NULL DEFAULT 0,
  output_rate numeric(12,10) NOT NULL DEFAULT 0,
  embedding_rate numeric(12,10),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (organization_id, model_id)
);

CREATE INDEX model_rates_org_idx ON public.model_rates(organization_id);

CREATE TRIGGER model_rates_updated_at
  BEFORE UPDATE ON public.model_rates
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

ALTER TABLE public.model_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage org model rates"
  ON public.model_rates FOR ALL
  USING (organization_id IN (SELECT public.get_user_organizations()));

-- Usage logs: per-query cost tracking
CREATE TABLE public.usage_logs (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  query_text text,
  embedding_tokens integer DEFAULT 0,
  llm_input_tokens integer DEFAULT 0,
  llm_output_tokens integer DEFAULT 0,
  embedding_cost numeric(10,6) DEFAULT 0,
  llm_cost numeric(10,6) DEFAULT 0,
  total_cost numeric(10,6) GENERATED ALWAYS AS (embedding_cost + llm_cost) STORED,
  model text,
  chunks_retrieved integer,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX usage_logs_org_idx ON public.usage_logs(organization_id);
CREATE INDEX usage_logs_created_at_idx ON public.usage_logs(created_at);

ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org usage"
  ON public.usage_logs FOR SELECT
  USING (organization_id IN (SELECT public.get_user_organizations()));

CREATE POLICY "Users can insert org usage"
  ON public.usage_logs FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.get_user_organizations()));
```

**Step 2: Apply the migration**

Run: `mcp__supabase-mcp-server__apply_migration` with name `usage_logs` and the SQL above.
Expected: Migration applied successfully.

**Step 3: Commit**

```bash
git add supabase/migrations/00014_usage_logs.sql
git commit -m "feat: add usage_logs and model_rates tables (Phase 5)"
```

---

## Task 2: Database Migration — eval tables

**Files:**
- Create: `supabase/migrations/00015_eval_tables.sql`

**Step 1: Write the migration**

```sql
-- Phase 5: Evaluation tables

-- Test sets: named groups of test cases
CREATE TABLE public.eval_test_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX eval_test_sets_org_idx ON public.eval_test_sets(organization_id);

ALTER TABLE public.eval_test_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage org test sets"
  ON public.eval_test_sets FOR ALL
  USING (organization_id IN (SELECT public.get_user_organizations()));

-- Test cases: individual questions with expected answers/sources
CREATE TABLE public.eval_test_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_set_id uuid REFERENCES public.eval_test_sets(id) ON DELETE CASCADE NOT NULL,
  question text NOT NULL,
  expected_answer text,
  expected_source_ids uuid[],
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX eval_test_cases_set_idx ON public.eval_test_cases(test_set_id);

ALTER TABLE public.eval_test_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage test cases in org test sets"
  ON public.eval_test_cases FOR ALL
  USING (test_set_id IN (
    SELECT id FROM public.eval_test_sets
    WHERE organization_id IN (SELECT public.get_user_organizations())
  ));

-- Eval results: run outcomes with retrieval + answer quality scores
CREATE TABLE public.eval_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_set_id uuid REFERENCES public.eval_test_sets(id) ON DELETE CASCADE NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  precision_at_k numeric(5,4),
  recall_at_k numeric(5,4),
  mrr numeric(5,4),
  avg_faithfulness numeric(3,2),
  avg_relevance numeric(3,2),
  avg_completeness numeric(3,2),
  per_case_results jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'complete', 'error')),
  error_message text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX eval_results_set_idx ON public.eval_results(test_set_id);
CREATE INDEX eval_results_org_idx ON public.eval_results(organization_id);

ALTER TABLE public.eval_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage org eval results"
  ON public.eval_results FOR ALL
  USING (organization_id IN (SELECT public.get_user_organizations()));
```

**Step 2: Apply the migration**

Run: `mcp__supabase-mcp-server__apply_migration` with name `eval_tables` and the SQL above.
Expected: Migration applied successfully.

**Step 3: Commit**

```bash
git add supabase/migrations/00015_eval_tables.sql
git commit -m "feat: add eval_test_sets, eval_test_cases, eval_results tables (Phase 5)"
```

---

## Task 3: Database Migration — message_feedback

**Files:**
- Create: `supabase/migrations/00016_message_feedback.sql`

**Step 1: Write the migration**

Note: `messages.id` is `bigint`, so `message_id` FK must be `bigint`.

```sql
-- Phase 5: User feedback on chat messages

CREATE TABLE public.message_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id bigint REFERENCES public.messages(id) ON DELETE CASCADE NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL NOT NULL,
  rating integer NOT NULL CHECK (rating IN (1, 5)),
  comment text,
  converted_to_test_case_id uuid REFERENCES public.eval_test_cases(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (message_id, user_id)
);

CREATE INDEX message_feedback_org_idx ON public.message_feedback(organization_id);
CREATE INDEX message_feedback_message_idx ON public.message_feedback(message_id);

ALTER TABLE public.message_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage org message feedback"
  ON public.message_feedback FOR ALL
  USING (organization_id IN (SELECT public.get_user_organizations()));
```

**Step 2: Apply the migration**

Run: `mcp__supabase-mcp-server__apply_migration` with name `message_feedback` and the SQL above.
Expected: Migration applied successfully.

**Step 3: Commit**

```bash
git add supabase/migrations/00016_message_feedback.sql
git commit -m "feat: add message_feedback table (Phase 5)"
```

---

## Task 4: Regenerate TypeScript Types

**Step 1: Regenerate types from Supabase**

Run: `pnpm db:types` (or `npx supabase gen types typescript --project-id xjzhiprdbzvmijvymkbn > types/database.types.ts`)

**Step 2: Verify types include new tables**

Open `types/database.types.ts` and confirm it contains:
- `model_rates` table type
- `usage_logs` table type
- `eval_test_sets` table type
- `eval_test_cases` table type
- `eval_results` table type
- `message_feedback` table type

**IMPORTANT:** Check that the file doesn't have Supabase CLI stdout contamination at the top (known gotcha — if it does, remove the non-TypeScript lines).

**Step 3: Verify build still passes**

Run: `pnpm build`
Expected: Clean build with no type errors.

**Step 4: Commit**

```bash
git add types/database.types.ts
git commit -m "chore: regenerate types after Phase 5 migrations"
```

---

## Task 5: Cost Calculation Utility (TDD)

**Files:**
- Create: `lib/rag/cost.ts`
- Create: `tests/unit/cost.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/cost.test.ts
import { describe, it, expect } from "vitest";
import {
  calculateCost,
  DEFAULT_MODEL_RATES,
  type ModelRates,
} from "@/lib/rag/cost";

describe("calculateCost", () => {
  const customRates: ModelRates = {
    input_rate: 0.000003, // $3/M input tokens
    output_rate: 0.000015, // $15/M output tokens
    embedding_rate: 0.00000002, // $0.02/M embedding tokens
  };

  it("calculates cost with custom rates", () => {
    const result = calculateCost({
      embeddingTokens: 10,
      llmInputTokens: 1000,
      llmOutputTokens: 500,
      rates: customRates,
    });

    expect(result.embeddingCost).toBeCloseTo(0.0000002, 10);
    expect(result.llmCost).toBeCloseTo(0.0105, 6);
    expect(result.totalCost).toBeCloseTo(0.0105002, 6);
  });

  it("returns zero cost when all tokens are zero", () => {
    const result = calculateCost({
      embeddingTokens: 0,
      llmInputTokens: 0,
      llmOutputTokens: 0,
      rates: customRates,
    });

    expect(result.embeddingCost).toBe(0);
    expect(result.llmCost).toBe(0);
    expect(result.totalCost).toBe(0);
  });

  it("handles null embedding_rate by treating embedding cost as zero", () => {
    const ratesNoEmbed: ModelRates = {
      input_rate: 0.000003,
      output_rate: 0.000015,
      embedding_rate: null,
    };

    const result = calculateCost({
      embeddingTokens: 100,
      llmInputTokens: 1000,
      llmOutputTokens: 500,
      rates: ratesNoEmbed,
    });

    expect(result.embeddingCost).toBe(0);
    expect(result.llmCost).toBeCloseTo(0.0105, 6);
  });

  it("exports DEFAULT_MODEL_RATES with expected models", () => {
    expect(DEFAULT_MODEL_RATES).toHaveProperty("text-embedding-3-small");
    expect(DEFAULT_MODEL_RATES).toHaveProperty("gpt-4o");
    expect(DEFAULT_MODEL_RATES).toHaveProperty("claude-sonnet-4-20250514");
    expect(DEFAULT_MODEL_RATES["text-embedding-3-small"].embedding_rate).not.toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/cost.test.ts`
Expected: FAIL — module `@/lib/rag/cost` not found.

**Step 3: Write the implementation**

```typescript
// lib/rag/cost.ts

export type ModelRates = {
  input_rate: number;
  output_rate: number;
  embedding_rate: number | null;
};

export type CostInput = {
  embeddingTokens: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  rates: ModelRates;
};

export type CostResult = {
  embeddingCost: number;
  llmCost: number;
  totalCost: number;
};

/**
 * Calculate cost for a single query given token counts and rates.
 */
export function calculateCost(input: CostInput): CostResult {
  const embeddingCost = input.rates.embedding_rate
    ? input.embeddingTokens * input.rates.embedding_rate
    : 0;

  const llmCost =
    input.llmInputTokens * input.rates.input_rate +
    input.llmOutputTokens * input.rates.output_rate;

  return {
    embeddingCost,
    llmCost,
    totalCost: embeddingCost + llmCost,
  };
}

/**
 * Default rates (as of Feb 2026) used when no org-specific rates exist.
 * Rates are per-token (not per-million).
 */
export const DEFAULT_MODEL_RATES: Record<string, ModelRates> = {
  "text-embedding-3-small": {
    input_rate: 0,
    output_rate: 0,
    embedding_rate: 0.00000002, // $0.02/M tokens
  },
  "gpt-4o": {
    input_rate: 0.0000025, // $2.50/M input
    output_rate: 0.00001, // $10/M output
    embedding_rate: null,
  },
  "gpt-4o-mini": {
    input_rate: 0.00000015, // $0.15/M input
    output_rate: 0.0000006, // $0.60/M output
    embedding_rate: null,
  },
  "claude-sonnet-4-20250514": {
    input_rate: 0.000003, // $3/M input
    output_rate: 0.000015, // $15/M output
    embedding_rate: null,
  },
  "claude-haiku-3-5-20241022": {
    input_rate: 0.0000008, // $0.80/M input
    output_rate: 0.000004, // $4/M output
    embedding_rate: null,
  },
};
```

**Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/cost.test.ts`
Expected: All 4 tests PASS.

**Step 5: Commit**

```bash
git add lib/rag/cost.ts tests/unit/cost.test.ts
git commit -m "feat: add cost calculation utility with tests (Phase 5)"
```

---

## Task 6: Eval Metrics Utility (TDD)

**Files:**
- Create: `lib/rag/eval-metrics.ts`
- Create: `tests/unit/eval-metrics.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/eval-metrics.test.ts
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
    // 2 relevant out of 4 retrieved
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
    // 1 out of 3 expected
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
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/eval-metrics.test.ts`
Expected: FAIL — module `@/lib/rag/eval-metrics` not found.

**Step 3: Write the implementation**

```typescript
// lib/rag/eval-metrics.ts

/**
 * Precision@k: What fraction of retrieved documents are relevant?
 * retrieved and expected are arrays of document IDs.
 */
export function precisionAtK(
  retrievedDocIds: string[],
  expectedDocIds: string[]
): number {
  if (retrievedDocIds.length === 0) return 0;
  const expectedSet = new Set(expectedDocIds);
  const relevant = retrievedDocIds.filter((id) => expectedSet.has(id)).length;
  return relevant / retrievedDocIds.length;
}

/**
 * Recall@k: What fraction of expected documents were retrieved?
 */
export function recallAtK(
  retrievedDocIds: string[],
  expectedDocIds: string[]
): number {
  if (expectedDocIds.length === 0) return 0;
  const retrievedSet = new Set(retrievedDocIds);
  const found = expectedDocIds.filter((id) => retrievedSet.has(id)).length;
  return found / expectedDocIds.length;
}

/**
 * Mean Reciprocal Rank: 1/rank of first relevant result.
 */
export function meanReciprocalRank(
  retrievedDocIds: string[],
  expectedDocIds: string[]
): number {
  const expectedSet = new Set(expectedDocIds);
  for (let i = 0; i < retrievedDocIds.length; i++) {
    if (expectedSet.has(retrievedDocIds[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

export type RetrievalMetrics = {
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
};

/**
 * Aggregate metrics across multiple test cases by averaging.
 */
export function aggregateMetrics(perCase: RetrievalMetrics[]): RetrievalMetrics {
  if (perCase.length === 0) {
    return { precisionAtK: 0, recallAtK: 0, mrr: 0 };
  }

  const sum = perCase.reduce(
    (acc, m) => ({
      precisionAtK: acc.precisionAtK + m.precisionAtK,
      recallAtK: acc.recallAtK + m.recallAtK,
      mrr: acc.mrr + m.mrr,
    }),
    { precisionAtK: 0, recallAtK: 0, mrr: 0 }
  );

  return {
    precisionAtK: sum.precisionAtK / perCase.length,
    recallAtK: sum.recallAtK / perCase.length,
    mrr: sum.mrr / perCase.length,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/eval-metrics.test.ts`
Expected: All 12 tests PASS.

**Step 5: Commit**

```bash
git add lib/rag/eval-metrics.ts tests/unit/eval-metrics.test.ts
git commit -m "feat: add eval metrics utility (P@k, R@k, MRR) with tests (Phase 5)"
```

---

## Task 7: LLM Judge Utility (TDD)

**Files:**
- Create: `lib/rag/judge.ts`
- Create: `tests/unit/judge.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/judge.test.ts
import { describe, it, expect } from "vitest";
import { buildJudgePrompt, parseJudgeResponse, type JudgeScores } from "@/lib/rag/judge";

describe("buildJudgePrompt", () => {
  it("includes question, expected answer, generated answer, and sources", () => {
    const prompt = buildJudgePrompt({
      question: "What is the pet policy?",
      expectedAnswer: "No pets allowed except service animals.",
      generatedAnswer: "The lease prohibits pets.",
      retrievedSources: ["Source 1: No pets...", "Source 2: Service animals..."],
    });

    expect(prompt).toContain("What is the pet policy?");
    expect(prompt).toContain("No pets allowed except service animals.");
    expect(prompt).toContain("The lease prohibits pets.");
    expect(prompt).toContain("Source 1: No pets...");
    expect(prompt).toContain("faithfulness");
    expect(prompt).toContain("relevance");
    expect(prompt).toContain("completeness");
    expect(prompt).toContain("JSON");
  });
});

describe("parseJudgeResponse", () => {
  it("parses valid JSON response with scores", () => {
    const response = `{"faithfulness": 4, "relevance": 5, "completeness": 3}`;
    const scores = parseJudgeResponse(response);
    expect(scores).toEqual({ faithfulness: 4, relevance: 5, completeness: 3 });
  });

  it("extracts JSON from markdown code blocks", () => {
    const response = `Here is my evaluation:\n\`\`\`json\n{"faithfulness": 3, "relevance": 4, "completeness": 2}\n\`\`\``;
    const scores = parseJudgeResponse(response);
    expect(scores).toEqual({ faithfulness: 3, relevance: 4, completeness: 2 });
  });

  it("returns null for unparseable response", () => {
    expect(parseJudgeResponse("I cannot evaluate this.")).toBeNull();
  });

  it("returns null when scores are out of range", () => {
    expect(parseJudgeResponse(`{"faithfulness": 6, "relevance": 5, "completeness": 3}`)).toBeNull();
    expect(parseJudgeResponse(`{"faithfulness": 0, "relevance": 5, "completeness": 3}`)).toBeNull();
  });

  it("returns null when keys are missing", () => {
    expect(parseJudgeResponse(`{"faithfulness": 4, "relevance": 5}`)).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/judge.test.ts`
Expected: FAIL — module `@/lib/rag/judge` not found.

**Step 3: Write the implementation**

```typescript
// lib/rag/judge.ts

export type JudgeInput = {
  question: string;
  expectedAnswer: string;
  generatedAnswer: string;
  retrievedSources: string[];
};

export type JudgeScores = {
  faithfulness: number;
  relevance: number;
  completeness: number;
};

/**
 * Build the LLM judge prompt for answer quality evaluation.
 */
export function buildJudgePrompt(input: JudgeInput): string {
  const sourcesBlock = input.retrievedSources
    .map((s, i) => `[Source ${i + 1}]: ${s}`)
    .join("\n\n");

  return `You are an evaluation judge. Score the following generated answer on three dimensions.

## Rubric

- **faithfulness** (1-5): Is the generated answer grounded in the retrieved sources? 5 = fully grounded, 1 = hallucinated.
- **relevance** (1-5): Does the generated answer address the question? 5 = directly answers, 1 = off-topic.
- **completeness** (1-5): Does the generated answer cover all key points from the expected answer? 5 = complete, 1 = missing most points.

## Question
${input.question}

## Expected Answer
${input.expectedAnswer}

## Generated Answer
${input.generatedAnswer}

## Retrieved Sources
${sourcesBlock}

## Instructions
Respond with ONLY a JSON object (no other text):
{"faithfulness": <1-5>, "relevance": <1-5>, "completeness": <1-5>}`;
}

/**
 * Parse the LLM judge response to extract scores.
 * Returns null if the response cannot be parsed or scores are invalid.
 */
export function parseJudgeResponse(response: string): JudgeScores | null {
  // Try to extract JSON from code blocks first
  const codeBlockMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : response.trim();

  try {
    const parsed = JSON.parse(jsonStr);

    const { faithfulness, relevance, completeness } = parsed;

    // Validate all three keys exist and are integers 1-5
    if (
      typeof faithfulness !== "number" ||
      typeof relevance !== "number" ||
      typeof completeness !== "number"
    ) {
      return null;
    }

    if (
      faithfulness < 1 || faithfulness > 5 ||
      relevance < 1 || relevance > 5 ||
      completeness < 1 || completeness > 5
    ) {
      return null;
    }

    return { faithfulness, relevance, completeness };
  } catch {
    return null;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/judge.test.ts`
Expected: All 6 tests PASS.

**Step 5: Commit**

```bash
git add lib/rag/judge.ts tests/unit/judge.test.ts
git commit -m "feat: add LLM judge utility with tests (Phase 5)"
```

---

## Task 8: Cost Tracking Integration in Chat Route

**Files:**
- Modify: `app/api/chat/route.ts:170-192` (onFinish callback)
- Create: `lib/rag/cost-tracker.ts` (DB lookup + cost insert helper)

**Step 1: Create cost-tracker helper**

This module wraps the DB operations: look up model rates, calculate cost, insert usage log.

```typescript
// lib/rag/cost-tracker.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateCost, DEFAULT_MODEL_RATES, type ModelRates } from "./cost";

type TrackUsageInput = {
  organizationId: string;
  userId: string;
  queryText: string;
  embeddingTokens: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  model: string;
  chunksRetrieved: number;
};

/**
 * Look up model rates from DB, falling back to DEFAULT_MODEL_RATES.
 */
async function getModelRates(
  supabase: SupabaseClient,
  organizationId: string,
  modelId: string,
  rateType: "llm" | "embedding"
): Promise<ModelRates> {
  const { data } = await supabase
    .from("model_rates")
    .select("input_rate, output_rate, embedding_rate")
    .eq("organization_id", organizationId)
    .eq("model_id", modelId)
    .single();

  if (data) {
    return {
      input_rate: Number(data.input_rate),
      output_rate: Number(data.output_rate),
      embedding_rate: data.embedding_rate ? Number(data.embedding_rate) : null,
    };
  }

  // Fall back to hardcoded defaults
  return DEFAULT_MODEL_RATES[modelId] ?? {
    input_rate: 0,
    output_rate: 0,
    embedding_rate: null,
  };
}

/**
 * Track usage and cost for a chat query. Fire-and-forget.
 */
export async function trackUsage(
  supabase: SupabaseClient,
  input: TrackUsageInput
): Promise<void> {
  // Look up LLM rates
  const llmRates = await getModelRates(
    supabase,
    input.organizationId,
    input.model,
    "llm"
  );

  // Look up embedding rates (always text-embedding-3-small for now)
  const embeddingRates = await getModelRates(
    supabase,
    input.organizationId,
    "text-embedding-3-small",
    "embedding"
  );

  const costs = calculateCost({
    embeddingTokens: input.embeddingTokens,
    llmInputTokens: input.llmInputTokens,
    llmOutputTokens: input.llmOutputTokens,
    rates: {
      input_rate: llmRates.input_rate,
      output_rate: llmRates.output_rate,
      embedding_rate: embeddingRates.embedding_rate,
    },
  });

  await supabase.from("usage_logs").insert({
    organization_id: input.organizationId,
    user_id: input.userId,
    query_text: input.queryText,
    embedding_tokens: input.embeddingTokens,
    llm_input_tokens: input.llmInputTokens,
    llm_output_tokens: input.llmOutputTokens,
    embedding_cost: costs.embeddingCost,
    llm_cost: costs.llmCost,
    model: input.model,
    chunks_retrieved: input.chunksRetrieved,
  });
}
```

**Step 2: Modify the chat route's onFinish callback**

In `app/api/chat/route.ts`, add the usage tracking call inside `onFinish`. The `searchResponse.queryTokenCount` is already available in the route's closure scope.

Add import at the top of the file:
```typescript
import { trackUsage } from "@/lib/rag/cost-tracker";
```

Replace the existing `onFinish` callback (lines 170-192) with:

```typescript
    onFinish: async ({ text, usage }) => {
      try {
        // Save assistant message
        await supabase.from("messages").insert({
          conversation_id: conversationId,
          parent_message_id: userMessageId,
          role: "assistant",
          content: text,
          parts: [{ type: "text", text }],
          sources: relevantResults.map((r) => ({
            documentId: r.documentId,
            chunkId: r.chunkId,
            content: r.content,
            similarity: r.similarity,
            rrfScore: r.rrfScore,
          })),
          token_count:
            (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
          model: modelId,
        });

        // Track usage and cost (fire-and-forget)
        trackUsage(supabase, {
          organizationId,
          userId: user.id,
          queryText: latestMessage.content,
          embeddingTokens: searchResponse.queryTokenCount,
          llmInputTokens: usage?.inputTokens ?? 0,
          llmOutputTokens: usage?.outputTokens ?? 0,
          model: modelId,
          chunksRetrieved: relevantResults.length,
        }).catch((e) => {
          console.error("Failed to track usage:", e);
        });
      } catch (e) {
        console.error("Failed to save assistant message:", e);
      }
    },
```

**Step 3: Verify build passes**

Run: `pnpm build`
Expected: Clean build.

**Step 4: Run existing tests to verify no regressions**

Run: `pnpm vitest run`
Expected: All existing tests pass (40+).

**Step 5: Commit**

```bash
git add lib/rag/cost-tracker.ts app/api/chat/route.ts
git commit -m "feat: integrate cost tracking into chat route (Phase 5)"
```

---

## Task 9: Model Rates CRUD — Server Actions

**Files:**
- Create: `app/(dashboard)/settings/actions.ts`

**Step 1: Write the Server Actions**

```typescript
// app/(dashboard)/settings/actions.ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DEFAULT_MODEL_RATES } from "@/lib/rag/cost";

async function getCurrentOrg() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .single();

  if (!profile?.current_organization_id) {
    throw new Error("No active organization");
  }

  return { supabase, user, organizationId: profile.current_organization_id };
}

export type ModelRate = {
  id: string;
  model_id: string;
  input_rate: number;
  output_rate: number;
  embedding_rate: number | null;
  updated_at: string;
};

export async function getModelRates(): Promise<ModelRate[]> {
  const { supabase } = await getCurrentOrg();

  const { data, error } = await supabase
    .from("model_rates")
    .select("id, model_id, input_rate, output_rate, embedding_rate, updated_at")
    .order("model_id");

  if (error) throw new Error("Failed to load model rates");

  return (data ?? []).map((r) => ({
    id: r.id,
    model_id: r.model_id,
    input_rate: Number(r.input_rate),
    output_rate: Number(r.output_rate),
    embedding_rate: r.embedding_rate ? Number(r.embedding_rate) : null,
    updated_at: r.updated_at,
  }));
}

export async function upsertModelRate(formData: FormData) {
  const { supabase, organizationId } = await getCurrentOrg();

  const modelId = formData.get("model_id") as string;
  const inputRate = parseFloat(formData.get("input_rate") as string);
  const outputRate = parseFloat(formData.get("output_rate") as string);
  const embeddingRateStr = formData.get("embedding_rate") as string;
  const embeddingRate = embeddingRateStr ? parseFloat(embeddingRateStr) : null;

  if (!modelId || isNaN(inputRate) || isNaN(outputRate)) {
    return { error: "Invalid input" };
  }

  const { error } = await supabase.from("model_rates").upsert(
    {
      organization_id: organizationId,
      model_id: modelId,
      input_rate: inputRate,
      output_rate: outputRate,
      embedding_rate: embeddingRate,
    },
    { onConflict: "organization_id,model_id" }
  );

  if (error) {
    console.error("Upsert model rate failed:", error);
    return { error: "Failed to save model rate" };
  }

  revalidatePath("/settings");
  return { success: true };
}

export async function deleteModelRate(rateId: string) {
  const { supabase } = await getCurrentOrg();

  const { error } = await supabase
    .from("model_rates")
    .delete()
    .eq("id", rateId);

  if (error) {
    return { error: "Failed to delete model rate" };
  }

  revalidatePath("/settings");
  return { success: true };
}

export async function seedDefaultRates() {
  const { supabase, organizationId } = await getCurrentOrg();

  const rows = Object.entries(DEFAULT_MODEL_RATES).map(([modelId, rates]) => ({
    organization_id: organizationId,
    model_id: modelId,
    input_rate: rates.input_rate,
    output_rate: rates.output_rate,
    embedding_rate: rates.embedding_rate,
  }));

  const { error } = await supabase
    .from("model_rates")
    .upsert(rows, { onConflict: "organization_id,model_id" });

  if (error) {
    return { error: "Failed to seed default rates" };
  }

  revalidatePath("/settings");
  return { success: true };
}
```

**Step 2: Verify build passes**

Run: `pnpm build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add "app/(dashboard)/settings/actions.ts"
git commit -m "feat: add model rates CRUD Server Actions (Phase 5)"
```

---

## Task 10: Settings Page — Model Rates UI

**Files:**
- Create: `app/(dashboard)/settings/page.tsx`
- Create: `components/settings/model-rates-table.tsx`

**Step 1: Create the model rates table component**

```typescript
// components/settings/model-rates-table.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  upsertModelRate,
  deleteModelRate,
  seedDefaultRates,
  type ModelRate,
} from "@/app/(dashboard)/settings/actions";

function formatRate(rate: number): string {
  if (rate === 0) return "$0";
  // Show as $/M tokens
  const perMillion = rate * 1_000_000;
  return `$${perMillion.toFixed(2)}/M`;
}

export function ModelRatesTable({ rates }: { rates: ModelRate[] }) {
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSeed() {
    setLoading(true);
    const result = await seedDefaultRates();
    setLoading(false);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Default rates loaded");
    }
  }

  async function handleDelete(id: string) {
    const result = await deleteModelRate(id);
    if (result.error) {
      toast.error(result.error);
    }
  }

  async function handleSubmit(formData: FormData) {
    const result = await upsertModelRate(formData);
    if (result.error) {
      toast.error(result.error);
    } else {
      setAdding(false);
      toast.success("Rate saved");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Model Rates</h2>
        <div className="flex gap-2">
          {rates.length === 0 && (
            <Button variant="outline" onClick={handleSeed} disabled={loading}>
              {loading ? "Loading..." : "Load Defaults"}
            </Button>
          )}
          <Button onClick={() => setAdding(true)} disabled={adding}>
            Add Rate
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead>Input Rate</TableHead>
            <TableHead>Output Rate</TableHead>
            <TableHead>Embedding Rate</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rates.map((rate) => (
            <TableRow key={rate.id}>
              <TableCell className="font-mono text-sm">{rate.model_id}</TableCell>
              <TableCell>{formatRate(rate.input_rate)}</TableCell>
              <TableCell>{formatRate(rate.output_rate)}</TableCell>
              <TableCell>
                {rate.embedding_rate !== null ? formatRate(rate.embedding_rate) : "—"}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(rate.id)}
                >
                  Delete
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {adding && (
            <TableRow>
              <TableCell colSpan={5}>
                <form action={handleSubmit} className="flex items-center gap-2">
                  <Input name="model_id" placeholder="model-id" required className="max-w-48" />
                  <Input
                    name="input_rate"
                    placeholder="Input (per token)"
                    type="number"
                    step="any"
                    required
                    className="max-w-36"
                  />
                  <Input
                    name="output_rate"
                    placeholder="Output (per token)"
                    type="number"
                    step="any"
                    required
                    className="max-w-36"
                  />
                  <Input
                    name="embedding_rate"
                    placeholder="Embed (optional)"
                    type="number"
                    step="any"
                    className="max-w-36"
                  />
                  <Button type="submit" size="sm">Save</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                </form>
              </TableCell>
            </TableRow>
          )}
          {rates.length === 0 && !adding && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                No model rates configured. Click &quot;Load Defaults&quot; to start.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

**Step 2: Create the settings page**

```typescript
// app/(dashboard)/settings/page.tsx
import { getModelRates } from "./actions";
import { ModelRatesTable } from "@/components/settings/model-rates-table";

export default async function SettingsPage() {
  const rates = await getModelRates();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage model rates and configuration.
        </p>
      </div>
      <ModelRatesTable rates={rates} />
    </div>
  );
}
```

**Step 3: Verify build passes**

Run: `pnpm build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add "app/(dashboard)/settings/page.tsx" components/settings/model-rates-table.tsx
git commit -m "feat: add settings page with model rates UI (Phase 5)"
```

---

## Task 11: Usage Dashboard — Server Actions

**Files:**
- Create: `app/(dashboard)/usage/actions.ts`

**Step 1: Write the Server Actions**

```typescript
// app/(dashboard)/usage/actions.ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

async function getCurrentOrg() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .single();

  if (!profile?.current_organization_id) {
    throw new Error("No active organization");
  }

  return { supabase, user, organizationId: profile.current_organization_id };
}

export type UsageSummary = {
  totalQueries: number;
  totalCost: number;
  avgCostPerQuery: number;
};

export type UsageLogEntry = {
  id: number;
  queryText: string | null;
  model: string | null;
  embeddingTokens: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  totalCost: number;
  chunksRetrieved: number | null;
  createdAt: string;
};

export async function getUsageSummary(): Promise<UsageSummary> {
  const { supabase } = await getCurrentOrg();

  const { data, error } = await supabase
    .from("usage_logs")
    .select("total_cost");

  if (error) throw new Error("Failed to load usage summary");

  const rows = data ?? [];
  const totalQueries = rows.length;
  const totalCost = rows.reduce((sum, r) => sum + Number(r.total_cost ?? 0), 0);

  return {
    totalQueries,
    totalCost,
    avgCostPerQuery: totalQueries > 0 ? totalCost / totalQueries : 0,
  };
}

export async function getRecentUsage(limit = 50): Promise<UsageLogEntry[]> {
  const { supabase } = await getCurrentOrg();

  const { data, error } = await supabase
    .from("usage_logs")
    .select(
      "id, query_text, model, embedding_tokens, llm_input_tokens, llm_output_tokens, total_cost, chunks_retrieved, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error("Failed to load usage logs");

  return (data ?? []).map((r) => ({
    id: Number(r.id),
    queryText: r.query_text,
    model: r.model,
    embeddingTokens: r.embedding_tokens ?? 0,
    llmInputTokens: r.llm_input_tokens ?? 0,
    llmOutputTokens: r.llm_output_tokens ?? 0,
    totalCost: Number(r.total_cost ?? 0),
    chunksRetrieved: r.chunks_retrieved,
    createdAt: r.created_at,
  }));
}
```

**Step 2: Verify build passes**

Run: `pnpm build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add "app/(dashboard)/usage/actions.ts"
git commit -m "feat: add usage dashboard Server Actions (Phase 5)"
```

---

## Task 12: Usage Dashboard Page

**Files:**
- Create: `app/(dashboard)/usage/page.tsx`
- Create: `components/usage/usage-dashboard.tsx`
- Create: `components/usage/usage-table.tsx`

**Step 1: Create the usage table component**

```typescript
// components/usage/usage-table.tsx
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { UsageLogEntry } from "@/app/(dashboard)/usage/actions";

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(6)}`;
  return `$${cost.toFixed(4)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function UsageTable({ logs }: { logs: UsageLogEntry[] }) {
  if (logs.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8">
        No usage data yet. Start chatting to see cost tracking here.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Query</TableHead>
          <TableHead>Model</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead>Date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.map((log) => (
          <TableRow key={log.id}>
            <TableCell className="max-w-xs truncate">
              {log.queryText ?? "—"}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {log.model ?? "—"}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {(log.llmInputTokens + log.llmOutputTokens).toLocaleString()}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCost(log.totalCost)}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {formatDate(log.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

**Step 2: Create the usage dashboard component**

```typescript
// components/usage/usage-dashboard.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { UsageSummary } from "@/app/(dashboard)/usage/actions";

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(6)}`;
  return `$${cost.toFixed(2)}`;
}

export function UsageDashboard({ summary }: { summary: UsageSummary }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total Queries
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {summary.totalQueries.toLocaleString()}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total Cost
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatCost(summary.totalCost)}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Avg Cost / Query
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatCost(summary.avgCostPerQuery)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 3: Create the page**

```typescript
// app/(dashboard)/usage/page.tsx
import { getUsageSummary, getRecentUsage } from "./actions";
import { UsageDashboard } from "@/components/usage/usage-dashboard";
import { UsageTable } from "@/components/usage/usage-table";

export default async function UsagePage() {
  const [summary, logs] = await Promise.all([
    getUsageSummary(),
    getRecentUsage(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Usage</h1>
        <p className="text-muted-foreground">
          Track query costs and token usage.
        </p>
      </div>
      <UsageDashboard summary={summary} />
      <div>
        <h2 className="text-lg font-semibold mb-4">Recent Queries</h2>
        <UsageTable logs={logs} />
      </div>
    </div>
  );
}
```

**Step 4: Verify build passes**

Run: `pnpm build`
Expected: Clean build.

**Step 5: Commit**

```bash
git add "app/(dashboard)/usage/page.tsx" components/usage/usage-dashboard.tsx components/usage/usage-table.tsx
git commit -m "feat: add usage dashboard page (Phase 5)"
```

---

## Task 13: Message Feedback — Server Action + UI Component

**Files:**
- Modify: `app/(dashboard)/chat/actions.ts` — add `submitFeedback` action
- Create: `components/chat/message-feedback.tsx`

**Step 1: Add submitFeedback Server Action**

Add this function to `app/(dashboard)/chat/actions.ts`:

```typescript
/**
 * Submit thumbs up/down feedback on an assistant message.
 * Rating: 1 = thumbs down, 5 = thumbs up.
 */
export async function submitFeedback(
  messageId: number,
  rating: 1 | 5,
  comment?: string
) {
  const { supabase, user, organizationId } = await getCurrentOrg();

  const { error } = await supabase.from("message_feedback").upsert(
    {
      message_id: messageId,
      organization_id: organizationId,
      user_id: user.id,
      rating,
      comment: comment ?? null,
    },
    { onConflict: "message_id,user_id" }
  );

  if (error) {
    console.error("Feedback submit failed:", error);
    return { error: "Failed to submit feedback" };
  }

  return { success: true };
}
```

**Step 2: Create the feedback component**

```typescript
// components/chat/message-feedback.tsx
"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { submitFeedback } from "@/app/(dashboard)/chat/actions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Props = {
  messageId: number;
};

export function MessageFeedback({ messageId }: Props) {
  const [rating, setRating] = useState<1 | 5 | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleFeedback(value: 1 | 5) {
    if (submitting) return;
    setSubmitting(true);
    setRating(value);

    const result = await submitFeedback(messageId, value);
    setSubmitting(false);

    if (result.error) {
      toast.error(result.error);
      setRating(null);
    }
  }

  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7", rating === 5 && "text-green-600")}
        onClick={() => handleFeedback(5)}
        disabled={submitting}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7", rating === 1 && "text-red-600")}
        onClick={() => handleFeedback(1)}
        disabled={submitting}
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
```

**Step 3: Verify build passes**

Run: `pnpm build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add "app/(dashboard)/chat/actions.ts" components/chat/message-feedback.tsx
git commit -m "feat: add message feedback Server Action and UI component (Phase 5)"
```

---

## Task 14: Integrate Feedback into Chat Interface

**Files:**
- Modify: `components/chat/chat-interface.tsx` — add feedback buttons to assistant messages

**Step 1: Add feedback to assistant messages**

In `components/chat/chat-interface.tsx`:

1. Add import at top:
```typescript
import { MessageFeedback } from "./message-feedback";
```

2. Wrap assistant messages to include feedback. Replace the message rendering block (the `messages.map(...)` section, around lines 168-179) with:

```typescript
            messages.map((msg) => (
              <Message key={msg.id} from={msg.role}>
                <div className="group relative">
                  <MessageContent>
                    {msg.role === "assistant" ? (
                      <MessageResponse>{getMessageText(msg)}</MessageResponse>
                    ) : (
                      <p className="whitespace-pre-wrap">{getMessageText(msg)}</p>
                    )}
                  </MessageContent>
                  {msg.role === "assistant" && !isStreaming && (
                    <MessageFeedback messageId={Number(msg.id)} />
                  )}
                </div>
              </Message>
            ))
```

Note: `msg.id` comes from the DB as a string (stringified bigint). `Number(msg.id)` converts it to a number for the feedback Server Action. This works for all practical message IDs (JavaScript safely handles integers up to 2^53).

**Step 2: Verify build passes**

Run: `pnpm build`
Expected: Clean build.

**Step 3: Run existing chat tests to verify no regressions**

Run: `pnpm vitest run tests/unit/chat.test.ts`
Expected: All 21 tests pass.

**Step 4: Commit**

```bash
git add components/chat/chat-interface.tsx
git commit -m "feat: integrate thumbs up/down feedback into chat interface (Phase 5)"
```

---

## Task 15: Eval Runner Utility

**Files:**
- Create: `lib/rag/eval-runner.ts`

This module orchestrates running evaluation: for each test case, it calls `hybridSearch()`, calculates retrieval metrics, optionally runs answer quality via LLM judge.

**Step 1: Write the eval runner**

```typescript
// lib/rag/eval-runner.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { hybridSearch } from "./search";
import { precisionAtK, recallAtK, meanReciprocalRank, aggregateMetrics, type RetrievalMetrics } from "./eval-metrics";
import { buildJudgePrompt, parseJudgeResponse, type JudgeScores } from "./judge";
import { buildSystemPrompt } from "./prompt";
import { getLLMProvider, getModelId } from "./provider";
import { generateText } from "ai";

export type EvalConfig = {
  model: string;
  topK: number;
  similarityThreshold: number;
};

export type PerCaseResult = {
  testCaseId: string;
  question: string;
  retrievedDocIds: string[];
  expectedSourceIds: string[];
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
  generatedAnswer?: string;
  judgeScores?: JudgeScores;
};

export type EvalRunResult = {
  perCase: PerCaseResult[];
  aggregate: RetrievalMetrics;
  avgFaithfulness: number | null;
  avgRelevance: number | null;
  avgCompleteness: number | null;
};

type TestCase = {
  id: string;
  question: string;
  expected_answer: string | null;
  expected_source_ids: string[] | null;
};

/**
 * Run evaluation for a set of test cases.
 * Phase 1: Retrieval metrics for all cases.
 * Phase 2: Answer quality (LLM judge) for cases that have expected answers.
 */
export async function runEvaluation(
  supabase: SupabaseClient,
  testCases: TestCase[],
  organizationId: string,
  config: EvalConfig
): Promise<EvalRunResult> {
  const perCase: PerCaseResult[] = [];
  const judgeScoresList: JudgeScores[] = [];

  for (const tc of testCases) {
    // Phase 1: Retrieval
    const searchResponse = await hybridSearch(supabase, {
      query: tc.question,
      organizationId,
      matchCount: config.topK,
    });

    // Deduplicate document IDs from retrieved chunks
    const retrievedDocIds = [
      ...new Set(searchResponse.results.map((r) => r.documentId)),
    ];
    const expectedSourceIds = tc.expected_source_ids ?? [];

    const precision = precisionAtK(retrievedDocIds, expectedSourceIds);
    const recall = recallAtK(retrievedDocIds, expectedSourceIds);
    const mrr = meanReciprocalRank(retrievedDocIds, expectedSourceIds);

    const caseResult: PerCaseResult = {
      testCaseId: tc.id,
      question: tc.question,
      retrievedDocIds,
      expectedSourceIds,
      precisionAtK: precision,
      recallAtK: recall,
      mrr,
    };

    // Phase 2: Answer quality (only if expected answer exists)
    if (tc.expected_answer && searchResponse.results.length > 0) {
      const systemPrompt = buildSystemPrompt(searchResponse.results);
      const provider = getLLMProvider();
      const modelId = config.model || getModelId();

      // Generate answer
      const { text: generatedAnswer } = await generateText({
        model: provider(modelId),
        system: systemPrompt,
        prompt: tc.question,
      });

      caseResult.generatedAnswer = generatedAnswer;

      // Judge the answer
      const judgePrompt = buildJudgePrompt({
        question: tc.question,
        expectedAnswer: tc.expected_answer,
        generatedAnswer,
        retrievedSources: searchResponse.results.map((r) => r.content),
      });

      const { text: judgeResponse } = await generateText({
        model: provider(modelId),
        prompt: judgePrompt,
      });

      const scores = parseJudgeResponse(judgeResponse);
      if (scores) {
        caseResult.judgeScores = scores;
        judgeScoresList.push(scores);
      }
    }

    perCase.push(caseResult);
  }

  // Aggregate retrieval metrics
  const aggregate = aggregateMetrics(
    perCase.map((c) => ({
      precisionAtK: c.precisionAtK,
      recallAtK: c.recallAtK,
      mrr: c.mrr,
    }))
  );

  // Aggregate answer quality
  let avgFaithfulness: number | null = null;
  let avgRelevance: number | null = null;
  let avgCompleteness: number | null = null;

  if (judgeScoresList.length > 0) {
    avgFaithfulness =
      judgeScoresList.reduce((s, j) => s + j.faithfulness, 0) /
      judgeScoresList.length;
    avgRelevance =
      judgeScoresList.reduce((s, j) => s + j.relevance, 0) /
      judgeScoresList.length;
    avgCompleteness =
      judgeScoresList.reduce((s, j) => s + j.completeness, 0) /
      judgeScoresList.length;
  }

  return {
    perCase,
    aggregate,
    avgFaithfulness,
    avgRelevance,
    avgCompleteness,
  };
}
```

**Step 2: Verify build passes**

Run: `pnpm build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add lib/rag/eval-runner.ts
git commit -m "feat: add eval runner utility (Phase 5)"
```

---

## Task 16: Eval Server Actions — CRUD + Run

**Files:**
- Create: `app/(dashboard)/eval/actions.ts`

**Step 1: Write the Server Actions**

```typescript
// app/(dashboard)/eval/actions.ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { runEvaluation, type EvalConfig } from "@/lib/rag/eval-runner";
import { getModelId } from "@/lib/rag/provider";

async function getCurrentOrg() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .single();

  if (!profile?.current_organization_id) {
    throw new Error("No active organization");
  }

  return { supabase, user, organizationId: profile.current_organization_id };
}

// --- Test Set CRUD ---

export type TestSetSummary = {
  id: string;
  name: string;
  description: string | null;
  caseCount: number;
  createdAt: string;
};

export async function getTestSets(): Promise<TestSetSummary[]> {
  const { supabase } = await getCurrentOrg();

  const { data, error } = await supabase
    .from("eval_test_sets")
    .select("id, name, description, created_at, eval_test_cases(count)")
    .order("created_at", { ascending: false });

  if (error) throw new Error("Failed to load test sets");

  return (data ?? []).map((ts: any) => ({
    id: ts.id,
    name: ts.name,
    description: ts.description,
    caseCount: ts.eval_test_cases?.[0]?.count ?? 0,
    createdAt: ts.created_at,
  }));
}

export async function createTestSet(formData: FormData) {
  const { supabase, organizationId } = await getCurrentOrg();

  const name = formData.get("name") as string;
  const description = (formData.get("description") as string) || null;

  if (!name) return { error: "Name is required" };

  const { error } = await supabase.from("eval_test_sets").insert({
    organization_id: organizationId,
    name,
    description,
  });

  if (error) return { error: "Failed to create test set" };

  revalidatePath("/eval");
  return { success: true };
}

export async function deleteTestSet(testSetId: string) {
  const { supabase } = await getCurrentOrg();

  const { error } = await supabase
    .from("eval_test_sets")
    .delete()
    .eq("id", testSetId);

  if (error) return { error: "Failed to delete test set" };

  revalidatePath("/eval");
  return { success: true };
}

// --- Test Case CRUD ---

export type TestCaseData = {
  id: string;
  question: string;
  expectedAnswer: string | null;
  expectedSourceIds: string[] | null;
};

export async function getTestCases(testSetId: string): Promise<TestCaseData[]> {
  const { supabase } = await getCurrentOrg();

  const { data, error } = await supabase
    .from("eval_test_cases")
    .select("id, question, expected_answer, expected_source_ids")
    .eq("test_set_id", testSetId)
    .order("created_at");

  if (error) throw new Error("Failed to load test cases");

  return (data ?? []).map((tc) => ({
    id: tc.id,
    question: tc.question,
    expectedAnswer: tc.expected_answer,
    expectedSourceIds: tc.expected_source_ids,
  }));
}

export async function createTestCase(formData: FormData) {
  const { supabase } = await getCurrentOrg();

  const testSetId = formData.get("test_set_id") as string;
  const question = formData.get("question") as string;
  const expectedAnswer = (formData.get("expected_answer") as string) || null;
  const sourceIdsStr = formData.get("expected_source_ids") as string;
  const expectedSourceIds = sourceIdsStr
    ? sourceIdsStr.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  if (!question) return { error: "Question is required" };

  const { error } = await supabase.from("eval_test_cases").insert({
    test_set_id: testSetId,
    question,
    expected_answer: expectedAnswer,
    expected_source_ids: expectedSourceIds,
  });

  if (error) return { error: "Failed to create test case" };

  revalidatePath("/eval");
  return { success: true };
}

export async function deleteTestCase(testCaseId: string) {
  const { supabase } = await getCurrentOrg();

  const { error } = await supabase
    .from("eval_test_cases")
    .delete()
    .eq("id", testCaseId);

  if (error) return { error: "Failed to delete test case" };

  revalidatePath("/eval");
  return { success: true };
}

// --- Eval Runner ---

export type EvalResultSummary = {
  id: string;
  testSetName: string;
  status: string;
  precisionAtK: number | null;
  recallAtK: number | null;
  mrr: number | null;
  avgFaithfulness: number | null;
  avgRelevance: number | null;
  avgCompleteness: number | null;
  config: any;
  createdAt: string;
};

export async function runEval(testSetId: string) {
  const { supabase, organizationId } = await getCurrentOrg();

  // Load test cases
  const { data: testCases, error: tcError } = await supabase
    .from("eval_test_cases")
    .select("id, question, expected_answer, expected_source_ids")
    .eq("test_set_id", testSetId);

  if (tcError || !testCases?.length) {
    return { error: "No test cases found" };
  }

  const config: EvalConfig = {
    model: getModelId(),
    topK: 5,
    similarityThreshold: 0.7,
  };

  // Create result record (status: running)
  const { data: resultRow, error: insertError } = await supabase
    .from("eval_results")
    .insert({
      test_set_id: testSetId,
      organization_id: organizationId,
      config,
      status: "running",
    })
    .select("id")
    .single();

  if (insertError || !resultRow) {
    return { error: "Failed to create eval result" };
  }

  try {
    const result = await runEvaluation(
      supabase,
      testCases,
      organizationId,
      config
    );

    // Update result with scores
    await supabase
      .from("eval_results")
      .update({
        precision_at_k: result.aggregate.precisionAtK,
        recall_at_k: result.aggregate.recallAtK,
        mrr: result.aggregate.mrr,
        avg_faithfulness: result.avgFaithfulness,
        avg_relevance: result.avgRelevance,
        avg_completeness: result.avgCompleteness,
        per_case_results: result.perCase,
        status: "complete",
      })
      .eq("id", resultRow.id);

    revalidatePath("/eval");
    return { success: true, resultId: resultRow.id };
  } catch (e) {
    // Mark as error
    await supabase
      .from("eval_results")
      .update({
        status: "error",
        error_message: e instanceof Error ? e.message : "Unknown error",
      })
      .eq("id", resultRow.id);

    revalidatePath("/eval");
    return { error: "Evaluation failed" };
  }
}

export async function getEvalResults(): Promise<EvalResultSummary[]> {
  const { supabase } = await getCurrentOrg();

  const { data, error } = await supabase
    .from("eval_results")
    .select("id, test_set_id, status, precision_at_k, recall_at_k, mrr, avg_faithfulness, avg_relevance, avg_completeness, config, created_at, eval_test_sets(name)")
    .order("created_at", { ascending: false });

  if (error) throw new Error("Failed to load eval results");

  return (data ?? []).map((r: any) => ({
    id: r.id,
    testSetName: r.eval_test_sets?.name ?? "Unknown",
    status: r.status,
    precisionAtK: r.precision_at_k ? Number(r.precision_at_k) : null,
    recallAtK: r.recall_at_k ? Number(r.recall_at_k) : null,
    mrr: r.mrr ? Number(r.mrr) : null,
    avgFaithfulness: r.avg_faithfulness ? Number(r.avg_faithfulness) : null,
    avgRelevance: r.avg_relevance ? Number(r.avg_relevance) : null,
    avgCompleteness: r.avg_completeness ? Number(r.avg_completeness) : null,
    config: r.config,
    createdAt: r.created_at,
  }));
}

export async function getEvalResultDetail(resultId: string) {
  const { supabase } = await getCurrentOrg();

  const { data, error } = await supabase
    .from("eval_results")
    .select("*")
    .eq("id", resultId)
    .single();

  if (error) throw new Error("Failed to load eval result");
  return data;
}

// --- Feedback Suggestions ---

export type FeedbackSuggestion = {
  feedbackId: string;
  messageId: number;
  queryText: string;
  assistantAnswer: string;
  comment: string | null;
  createdAt: string;
};

export async function getFeedbackSuggestions(): Promise<FeedbackSuggestion[]> {
  const { supabase } = await getCurrentOrg();

  // Get thumbs-down feedback not yet converted to test cases
  const { data, error } = await supabase
    .from("message_feedback")
    .select("id, message_id, comment, created_at")
    .eq("rating", 1)
    .is("converted_to_test_case_id", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error("Failed to load feedback suggestions");

  // For each feedback, get the original question (user message) and answer (assistant message)
  const suggestions: FeedbackSuggestion[] = [];
  for (const fb of data ?? []) {
    // Get the assistant message
    const { data: assistantMsg } = await supabase
      .from("messages")
      .select("content, conversation_id, parent_message_id")
      .eq("id", fb.message_id)
      .single();

    if (!assistantMsg) continue;

    // Get the user message (the one before the assistant message)
    // parent_message_id points to the user's message
    let queryText = "";
    if (assistantMsg.parent_message_id) {
      const { data: userMsg } = await supabase
        .from("messages")
        .select("content")
        .eq("id", assistantMsg.parent_message_id)
        .single();
      queryText = userMsg?.content ?? "";
    }

    suggestions.push({
      feedbackId: fb.id,
      messageId: fb.message_id,
      queryText,
      assistantAnswer: assistantMsg.content,
      comment: fb.comment,
      createdAt: fb.created_at,
    });
  }

  return suggestions;
}

export async function convertFeedbackToTestCase(
  feedbackId: string,
  testSetId: string,
  question: string,
  expectedAnswer: string,
  expectedSourceIds?: string[]
) {
  const { supabase } = await getCurrentOrg();

  // Create test case
  const { data: testCase, error: tcError } = await supabase
    .from("eval_test_cases")
    .insert({
      test_set_id: testSetId,
      question,
      expected_answer: expectedAnswer,
      expected_source_ids: expectedSourceIds ?? null,
    })
    .select("id")
    .single();

  if (tcError || !testCase) {
    return { error: "Failed to create test case" };
  }

  // Mark feedback as converted
  await supabase
    .from("message_feedback")
    .update({ converted_to_test_case_id: testCase.id })
    .eq("id", feedbackId);

  revalidatePath("/eval");
  return { success: true };
}
```

**Step 2: Verify build passes**

Run: `pnpm build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add "app/(dashboard)/eval/actions.ts"
git commit -m "feat: add eval CRUD, runner, and feedback Server Actions (Phase 5)"
```

---

## Task 17: Eval Page — Test Sets Tab

**Files:**
- Create: `app/(dashboard)/eval/page.tsx`
- Create: `components/eval/test-set-manager.tsx`
- Create: `components/eval/test-case-form.tsx`

**Step 1: Create test case form**

```typescript
// components/eval/test-case-form.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { createTestCase } from "@/app/(dashboard)/eval/actions";
import { toast } from "sonner";

export function TestCaseForm({
  testSetId,
  onDone,
}: {
  testSetId: string;
  onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    formData.set("test_set_id", testSetId);
    const result = await createTestCase(formData);
    setLoading(false);

    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Test case added");
      onDone();
    }
  }

  return (
    <form action={handleSubmit} className="space-y-3 border rounded-lg p-4">
      <div>
        <Label htmlFor="question">Question</Label>
        <Input id="question" name="question" placeholder="What is the pet policy?" required />
      </div>
      <div>
        <Label htmlFor="expected_answer">Expected Answer</Label>
        <Textarea
          id="expected_answer"
          name="expected_answer"
          placeholder="Optional — required for answer quality evaluation"
        />
      </div>
      <div>
        <Label htmlFor="expected_source_ids">Expected Source Document IDs</Label>
        <Input
          id="expected_source_ids"
          name="expected_source_ids"
          placeholder="Comma-separated UUIDs (optional)"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={loading}>
          {loading ? "Adding..." : "Add Test Case"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
```

**Step 2: Create test set manager**

```typescript
// components/eval/test-set-manager.tsx
"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, Plus, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import {
  createTestSet,
  deleteTestSet,
  getTestCases,
  deleteTestCase,
  type TestSetSummary,
  type TestCaseData,
} from "@/app/(dashboard)/eval/actions";
import { TestCaseForm } from "./test-case-form";

export function TestSetManager({ testSets }: { testSets: TestSetSummary[] }) {
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [testCases, setTestCases] = useState<TestCaseData[]>([]);
  const [addingCase, setAddingCase] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (expandedId) {
      getTestCases(expandedId).then(setTestCases).catch(() => setTestCases([]));
    } else {
      setTestCases([]);
    }
  }, [expandedId]);

  async function handleCreate(formData: FormData) {
    setLoading(true);
    const result = await createTestSet(formData);
    setLoading(false);
    if (result.error) {
      toast.error(result.error);
    } else {
      setCreating(false);
    }
  }

  async function handleDeleteSet(id: string) {
    const result = await deleteTestSet(id);
    if (result.error) toast.error(result.error);
    if (expandedId === id) setExpandedId(null);
  }

  async function handleDeleteCase(id: string) {
    const result = await deleteTestCase(id);
    if (result.error) {
      toast.error(result.error);
    } else {
      setTestCases((prev) => prev.filter((tc) => tc.id !== id));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Test Sets</h2>
        <Button onClick={() => setCreating(true)} disabled={creating}>
          <Plus className="h-4 w-4 mr-2" />
          New Test Set
        </Button>
      </div>

      {creating && (
        <form action={handleCreate} className="flex gap-2 items-end">
          <Input name="name" placeholder="Test set name" required />
          <Input name="description" placeholder="Description (optional)" />
          <Button type="submit" disabled={loading}>Create</Button>
          <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
        </form>
      )}

      {testSets.length === 0 && !creating && (
        <p className="text-center text-muted-foreground py-8">
          No test sets yet. Create one to start evaluating.
        </p>
      )}

      {testSets.map((ts) => (
        <Card key={ts.id}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <button
                className="flex items-center gap-2 text-left"
                onClick={() => setExpandedId(expandedId === ts.id ? null : ts.id)}
              >
                {expandedId === ts.id ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <CardTitle className="text-base">{ts.name}</CardTitle>
                <span className="text-sm text-muted-foreground">
                  ({ts.caseCount} cases)
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDeleteSet(ts.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {ts.description && (
              <p className="text-sm text-muted-foreground ml-6">{ts.description}</p>
            )}
          </CardHeader>
          {expandedId === ts.id && (
            <CardContent className="space-y-3">
              {testCases.map((tc) => (
                <div
                  key={tc.id}
                  className="flex items-start justify-between border rounded p-3 text-sm"
                >
                  <div className="space-y-1 flex-1 min-w-0">
                    <p className="font-medium">{tc.question}</p>
                    {tc.expectedAnswer && (
                      <p className="text-muted-foreground truncate">
                        Expected: {tc.expectedAnswer}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteCase(tc.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {addingCase ? (
                <TestCaseForm
                  testSetId={ts.id}
                  onDone={() => {
                    setAddingCase(false);
                    getTestCases(ts.id).then(setTestCases);
                  }}
                />
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAddingCase(true)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Test Case
                </Button>
              )}
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}
```

**Step 3: Create the eval page with tabs**

```typescript
// app/(dashboard)/eval/page.tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getTestSets, getEvalResults, getFeedbackSuggestions } from "./actions";
import { TestSetManager } from "@/components/eval/test-set-manager";
import { EvalRunner } from "@/components/eval/eval-runner";
import { EvalResults } from "@/components/eval/eval-results";

export default async function EvalPage() {
  const [testSets, results, suggestions] = await Promise.all([
    getTestSets(),
    getEvalResults(),
    getFeedbackSuggestions(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Evaluation</h1>
        <p className="text-muted-foreground">
          Measure retrieval quality and answer accuracy.
        </p>
      </div>

      <Tabs defaultValue="test-sets">
        <TabsList>
          <TabsTrigger value="test-sets">Test Sets</TabsTrigger>
          <TabsTrigger value="run">Run Evaluation</TabsTrigger>
          <TabsTrigger value="results">Results History</TabsTrigger>
        </TabsList>

        <TabsContent value="test-sets" className="mt-4">
          <TestSetManager testSets={testSets} />
        </TabsContent>

        <TabsContent value="run" className="mt-4">
          <EvalRunner testSets={testSets} />
        </TabsContent>

        <TabsContent value="results" className="mt-4">
          <EvalResults results={results} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

Note: `EvalRunner` and `EvalResults` components are created in the next two tasks.

**Step 4: Commit (partial — page will error until runner/results components exist)**

Wait for Tasks 18 and 19 to create remaining components before committing. If you want to commit incrementally, create placeholder components first:

```typescript
// components/eval/eval-runner.tsx (placeholder)
"use client";
export function EvalRunner({ testSets }: { testSets: any[] }) {
  return <p className="text-muted-foreground">Coming soon...</p>;
}

// components/eval/eval-results.tsx (placeholder)
"use client";
export function EvalResults({ results }: { results: any[] }) {
  return <p className="text-muted-foreground">Coming soon...</p>;
}
```

**Step 5: Verify build**

Run: `pnpm build`
Expected: Clean build.

**Step 6: Commit**

```bash
git add "app/(dashboard)/eval/page.tsx" components/eval/test-set-manager.tsx components/eval/test-case-form.tsx components/eval/eval-runner.tsx components/eval/eval-results.tsx
git commit -m "feat: add eval page with test set management (Phase 5)"
```

---

## Task 18: Eval Page — Run Evaluation Tab

**Files:**
- Modify: `components/eval/eval-runner.tsx` — replace placeholder

**Step 1: Write the eval runner component**

```typescript
// components/eval/eval-runner.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { runEval, type TestSetSummary } from "@/app/(dashboard)/eval/actions";

export function EvalRunner({ testSets }: { testSets: TestSetSummary[] }) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [running, setRunning] = useState(false);

  async function handleRun() {
    if (!selectedId) {
      toast.error("Select a test set first");
      return;
    }

    setRunning(true);
    const result = await runEval(selectedId);
    setRunning(false);

    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Evaluation complete! Check the Results tab.");
    }
  }

  if (testSets.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8">
        Create a test set first, then come back to run an evaluation.
      </p>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run Evaluation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-4">
          <div className="flex-1 max-w-sm">
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a test set" />
              </SelectTrigger>
              <SelectContent>
                {testSets.map((ts) => (
                  <SelectItem key={ts.id} value={ts.id}>
                    {ts.name} ({ts.caseCount} cases)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleRun} disabled={running || !selectedId}>
            {running && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {running ? "Running..." : "Run Evaluation"}
          </Button>
        </div>
        {running && (
          <p className="text-sm text-muted-foreground">
            Running retrieval + answer quality evaluation. This may take a minute...
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

**Step 2: Verify build passes**

Run: `pnpm build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add components/eval/eval-runner.tsx
git commit -m "feat: add eval runner UI component (Phase 5)"
```

---

## Task 19: Eval Page — Results History Tab

**Files:**
- Modify: `components/eval/eval-results.tsx` — replace placeholder

**Step 1: Write the results component**

```typescript
// components/eval/eval-results.tsx
"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EvalResultSummary } from "@/app/(dashboard)/eval/actions";

function ScoreBadge({
  score,
  target,
  label,
}: {
  score: number | null;
  target: number;
  label: string;
}) {
  if (score === null) return <span className="text-muted-foreground">—</span>;
  const pass = score >= target;
  return (
    <Badge variant={pass ? "default" : "destructive"} className="font-mono">
      {label}: {score.toFixed(2)}
    </Badge>
  );
}

function QualityScore({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted-foreground">—</span>;
  return <span className="font-mono">{score.toFixed(1)}/5</span>;
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "complete"
      ? "default"
      : status === "running"
        ? "secondary"
        : status === "error"
          ? "destructive"
          : "outline";
  return <Badge variant={variant}>{status}</Badge>;
}

export function EvalResults({ results }: { results: EvalResultSummary[] }) {
  if (results.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8">
        No evaluation results yet. Run an evaluation to see results here.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Test Set</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Retrieval</TableHead>
          <TableHead>Answer Quality</TableHead>
          <TableHead>Date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {results.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-medium">{r.testSetName}</TableCell>
            <TableCell>
              <StatusBadge status={r.status} />
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                <ScoreBadge score={r.precisionAtK} target={0.8} label="P@k" />
                <ScoreBadge score={r.recallAtK} target={0.75} label="R@k" />
                <ScoreBadge score={r.mrr} target={0.7} label="MRR" />
              </div>
            </TableCell>
            <TableCell>
              <div className="flex gap-3 text-sm">
                <span>F: <QualityScore score={r.avgFaithfulness} /></span>
                <span>R: <QualityScore score={r.avgRelevance} /></span>
                <span>C: <QualityScore score={r.avgCompleteness} /></span>
              </div>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {new Date(r.createdAt).toLocaleDateString()}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

**Step 2: Verify build passes**

Run: `pnpm build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add components/eval/eval-results.tsx
git commit -m "feat: add eval results history UI (Phase 5)"
```

---

## Task 20: Feedback → Test Case Conversion UI

**Files:**
- Create: `components/eval/feedback-suggestions.tsx`
- Modify: `app/(dashboard)/eval/page.tsx` — add feedback suggestions section to Test Sets tab

**Step 1: Create the feedback suggestions component**

```typescript
// components/eval/feedback-suggestions.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  convertFeedbackToTestCase,
  type FeedbackSuggestion,
  type TestSetSummary,
} from "@/app/(dashboard)/eval/actions";

export function FeedbackSuggestions({
  suggestions,
  testSets,
}: {
  suggestions: FeedbackSuggestion[];
  testSets: TestSetSummary[];
}) {
  const [converting, setConverting] = useState<string | null>(null);
  const [targetSetId, setTargetSetId] = useState("");
  const [expectedAnswer, setExpectedAnswer] = useState("");

  if (suggestions.length === 0) {
    return null;
  }

  async function handleConvert(suggestion: FeedbackSuggestion) {
    if (!targetSetId) {
      toast.error("Select a test set");
      return;
    }

    const result = await convertFeedbackToTestCase(
      suggestion.feedbackId,
      targetSetId,
      suggestion.queryText,
      expectedAnswer
    );

    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Converted to test case");
      setConverting(null);
      setExpectedAnswer("");
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">Suggested from Feedback</h3>
      <p className="text-sm text-muted-foreground">
        These messages received negative feedback. Convert them to test cases to track improvements.
      </p>

      {suggestions.map((s) => (
        <Card key={s.feedbackId}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Q: {s.queryText || "(no query text)"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground truncate">
              A: {s.assistantAnswer}
            </p>
            {s.comment && (
              <p className="text-orange-600">
                Feedback: {s.comment}
              </p>
            )}

            {converting === s.feedbackId ? (
              <div className="space-y-2 border-t pt-2">
                <Select value={targetSetId} onValueChange={setTargetSetId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select test set" />
                  </SelectTrigger>
                  <SelectContent>
                    {testSets.map((ts) => (
                      <SelectItem key={ts.id} value={ts.id}>
                        {ts.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  value={expectedAnswer}
                  onChange={(e) => setExpectedAnswer(e.target.value)}
                  placeholder="Write the expected answer..."
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleConvert(s)}>
                    Convert
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConverting(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConverting(s.feedbackId)}
              >
                Convert to Test Case
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

**Step 2: Update the eval page to include feedback suggestions**

In `app/(dashboard)/eval/page.tsx`, add the feedback suggestions component to the Test Sets tab. Replace the test-sets TabsContent with:

```typescript
        <TabsContent value="test-sets" className="mt-4 space-y-8">
          <TestSetManager testSets={testSets} />
          <FeedbackSuggestions suggestions={suggestions} testSets={testSets} />
        </TabsContent>
```

Add the import at the top:
```typescript
import { FeedbackSuggestions } from "@/components/eval/feedback-suggestions";
```

**Step 3: Verify build passes**

Run: `pnpm build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add components/eval/feedback-suggestions.tsx "app/(dashboard)/eval/page.tsx"
git commit -m "feat: add feedback-to-test-case conversion UI (Phase 5)"
```

---

## Task 21: Run All Tests + Final Build Verification

**Step 1: Run all TypeScript tests**

Run: `pnpm vitest run`
Expected: All tests pass (existing 40 + new cost + eval-metrics + judge tests).

**Step 2: Run build**

Run: `pnpm build`
Expected: Clean production build.

**Step 3: Final commit if any adjustments were needed**

```bash
git add -A
git commit -m "chore: Phase 5 final verification and fixes"
```

---

## Summary of New Files

```
supabase/migrations/
  00014_usage_logs.sql            # usage_logs + model_rates tables
  00015_eval_tables.sql           # eval_test_sets, eval_test_cases, eval_results
  00016_message_feedback.sql      # message_feedback table

lib/rag/
  cost.ts                         # Cost calculation utility
  cost-tracker.ts                 # DB lookup + usage log insert
  eval-metrics.ts                 # P@k, R@k, MRR calculations
  eval-runner.ts                  # Eval orchestration
  judge.ts                        # LLM judge prompt + parsing

tests/unit/
  cost.test.ts                    # Cost calculation tests
  eval-metrics.test.ts            # Eval metrics tests
  judge.test.ts                   # Judge prompt/parsing tests

app/(dashboard)/
  eval/
    page.tsx                      # Eval page with 3 tabs
    actions.ts                    # Server actions: CRUD + run eval
  usage/
    page.tsx                      # Usage dashboard
    actions.ts                    # Server actions: query usage data
  settings/
    page.tsx                      # Settings (model rates)
    actions.ts                    # Server actions: CRUD model rates

components/
  eval/
    test-set-manager.tsx          # Test set CRUD UI
    test-case-form.tsx            # Test case create form
    eval-runner.tsx               # Run evaluation UI
    eval-results.tsx              # Results display
    feedback-suggestions.tsx      # Feedback → test case converter
  usage/
    usage-dashboard.tsx           # Summary cards
    usage-table.tsx               # Recent queries table
  settings/
    model-rates-table.tsx         # Model rates CRUD table
  chat/
    message-feedback.tsx          # Thumbs up/down buttons
```

## Modified Files

```
app/api/chat/route.ts            # Added cost tracking in onFinish
app/(dashboard)/chat/actions.ts  # Added submitFeedback action
components/chat/chat-interface.tsx # Added feedback buttons to messages
types/database.types.ts          # Regenerated with new tables
```
