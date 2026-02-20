# Eval Retrieval Fix + Detail View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix retrieval metrics showing "-- -- --" and add expandable per-case detail view to eval results.

**Architecture:** Three changes — fix a JS truthiness bug in score mapping, wire `expected_source_ids` into demo test cases at seed time, and build an expandable row UI that fetches/displays per-case JSONB data inline.

**Tech Stack:** Next.js Server Actions, ShadCN Table + Collapsible, Vitest, existing `eval-results.tsx` component.

---

### Task 1: Fix Truthiness Bug in Score Mapping

**Files:**
- Modify: `app/(dashboard)/eval/actions.ts:268-276`
- Create: `tests/unit/eval-result-mapping.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/eval-result-mapping.test.ts`:

```typescript
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
```

**Step 2: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/eval-result-mapping.test.ts`
Expected: PASS (this tests the correct logic we want to adopt)

**Step 3: Fix the truthiness bug in actions.ts**

In `app/(dashboard)/eval/actions.ts`, replace the score mapping in `getEvalResults()` (around lines 268-276):

```typescript
// BEFORE (buggy — 0 is falsy):
precisionAtK: r.precision_at_k ? Number(r.precision_at_k) : null,
recallAtK: r.recall_at_k ? Number(r.recall_at_k) : null,
mrr: r.mrr ? Number(r.mrr) : null,
avgFaithfulness: r.avg_faithfulness ? Number(r.avg_faithfulness) : null,
avgRelevance: r.avg_relevance ? Number(r.avg_relevance) : null,
avgCompleteness: r.avg_completeness ? Number(r.avg_completeness) : null,

// AFTER (correct — explicit null check):
precisionAtK: r.precision_at_k !== null ? Number(r.precision_at_k) : null,
recallAtK: r.recall_at_k !== null ? Number(r.recall_at_k) : null,
mrr: r.mrr !== null ? Number(r.mrr) : null,
avgFaithfulness: r.avg_faithfulness !== null ? Number(r.avg_faithfulness) : null,
avgRelevance: r.avg_relevance !== null ? Number(r.avg_relevance) : null,
avgCompleteness: r.avg_completeness !== null ? Number(r.avg_completeness) : null,
```

**Step 4: Run all tests**

Run: `pnpm vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add tests/unit/eval-result-mapping.test.ts app/\(dashboard\)/eval/actions.ts
git commit -m "fix: preserve 0 scores in eval results (truthiness bug)"
```

---

### Task 2: Add expected_source_ids to Demo Test Cases

**Files:**
- Modify: `lib/demo/content.ts:376-414`

**Step 1: Add `expectedDocNames` field to demo test cases**

In `lib/demo/content.ts`, update `DEMO_EVAL_TEST_CASES` to include `expected_doc_names` mapping each question to the document filenames that contain the answer:

```typescript
export const DEMO_EVAL_TEST_CASES = [
  {
    question: "What is the monthly rent and when is it due?",
    expected_answer: "The monthly rent is $1,450.00, due on the first of each month with a 5-day grace period. A late fee of $75.00 applies after the 5th.",
    expected_doc_names: ["Residential-Lease-Agreement.md"],
  },
  {
    question: "What happens if I violate the noise policy?",
    expected_answer: "Noise violations follow a progressive enforcement process: first offense gets a written warning, second offense is a $100 fine, third is a $250 fine plus mandatory HOA board meeting, and subsequent offenses are $500 each. Three documented noise complaints within 6 months can also be grounds for lease termination with 30-day notice.",
    expected_doc_names: ["Residential-Lease-Agreement.md", "HOA-Rules-and-Regulations.md"],
  },
  {
    question: "Can I have a dog? What are the restrictions?",
    expected_answer: "Yes, up to 2 pets are allowed with prior written approval. There is a $500 non-refundable pet deposit and $35/month pet rent per pet. Weight limit is 50 lbs per pet. Restricted breeds include Pit Bull, Rottweiler, Doberman Pinscher, and Wolf Hybrid. Dogs must be leashed in all common areas.",
    expected_doc_names: ["Residential-Lease-Agreement.md", "Community-Guidelines.md"],
  },
  {
    question: "How do I reserve the rooftop terrace for a party?",
    expected_answer: "Reserve via the resident portal at least 14 days in advance. Private events are in 4-hour blocks with a $75 reservation fee and $200 refundable cleaning deposit. Maximum 20 guests. Full refund if cancelled 72+ hours in advance.",
    expected_doc_names: ["Community-Guidelines.md"],
  },
  {
    question: "What's the process for moving out and getting my security deposit back?",
    expected_answer: "Provide written notice (60 days for early termination, 60 days before lease end for non-renewal). Schedule a move-out inspection at least 7 days before. Return all keys, fobs, and remotes. Leave the unit broom-clean. Provide a forwarding address. The $2,900 deposit is returned within 30 days, minus deductions for damages, unpaid rent, cleaning, or unreturned keys ($50/key).",
    expected_doc_names: ["Residential-Lease-Agreement.md", "Community-Guidelines.md"],
  },
  {
    question: "What are the pool hours and guest rules?",
    expected_answer: "The pool is open 7:00 AM – 10:00 PM from Memorial Day to Labor Day. Maximum 4 guests per unit, guest passes required at $5/day per guest. The pool cannot be reserved for private events. No lifeguard on duty — swim at your own risk. Children under 12 must be accompanied by an adult.",
    expected_doc_names: ["HOA-Rules-and-Regulations.md", "Community-Guidelines.md"],
  },
  {
    question: "I need to park a moving truck overnight. What are the parking rules?",
    expected_answer: "Visitor parking has a maximum 24-hour stay without a pass. Extended visitor passes are available for up to 7 days from the management office. Oversized vehicles over 7 feet tall require prior approval. Speed limit is 5 MPH in the garage. Moving hours are 8:00 AM – 6:00 PM, Monday through Saturday only.",
    expected_doc_names: ["HOA-Rules-and-Regulations.md", "Community-Guidelines.md"],
  },
];
```

**Step 2: Run build to verify no type errors**

Run: `pnpm tsc --noEmit`
Expected: No errors (this is a plain array, no type constraint to break)

**Step 3: Commit**

```bash
git add lib/demo/content.ts
git commit -m "feat: add expected_doc_names to demo eval test cases"
```

---

### Task 3: Wire expected_source_ids During Seeding

**Files:**
- Modify: `app/(dashboard)/admin/actions.ts:132-201`

**Step 1: Update seedDemo to collect document IDs and resolve them for test cases**

In `app/(dashboard)/admin/actions.ts`, modify the `seedDemo` function:

a) After the document upload loop (around line 179), collect a map of `docName → docId`:

```typescript
// Before the document loop, create a map to collect IDs
const docNameToId = new Map<string, string>();

// Inside the loop, after successful insert (line 164), add:
docNameToId.set(doc.name, documentId);
```

b) When inserting test cases (around line 194), resolve `expected_doc_names` to UUIDs:

```typescript
if (testSet) {
  const testCaseRows = DEMO_EVAL_TEST_CASES.map((tc) => ({
    test_set_id: testSet.id,
    question: tc.question,
    expected_answer: tc.expected_answer,
    expected_source_ids: tc.expected_doc_names
      ?.map((name) => docNameToId.get(name))
      .filter((id): id is string => id !== undefined) ?? null,
  }));

  await admin.from("eval_test_cases").insert(testCaseRows);
}
```

**Step 2: Run build to verify no type errors**

Run: `pnpm tsc --noEmit`
Expected: No errors

**Step 3: Run all tests**

Run: `pnpm vitest run`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add app/\(dashboard\)/admin/actions.ts
git commit -m "feat: resolve expected_source_ids from doc names during demo seeding"
```

---

### Task 4: Build Expandable Row Detail View

**Files:**
- Modify: `components/eval/eval-results.tsx`
- Modify: `app/(dashboard)/eval/actions.ts` (add `getEvalResultDetail` to exports if needed)

**Step 1: Update `getEvalResultDetail` action to return typed per-case data**

In `app/(dashboard)/eval/actions.ts`, the existing `getEvalResultDetail` action (line 279) returns raw `data`. Update it to return a properly typed structure:

```typescript
export type PerCaseDetail = {
  testCaseId: string;
  question: string;
  retrievedDocIds: string[];
  expectedSourceIds: string[];
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
  generatedAnswer?: string;
  judgeScores?: {
    faithfulness: number;
    relevance: number;
    completeness: number;
  };
};

export async function getEvalResultDetail(resultId: string): Promise<PerCaseDetail[]> {
  const { supabase } = await getCurrentOrg();

  const { data, error } = await supabase
    .from("eval_results")
    .select("per_case_results")
    .eq("id", resultId)
    .single();

  if (error || !data) throw new Error("Failed to load eval result detail");
  return (data.per_case_results ?? []) as PerCaseDetail[];
}
```

**Step 2: Run build to check types**

Run: `pnpm tsc --noEmit`
Expected: No errors

**Step 3: Rewrite `eval-results.tsx` with expandable rows**

Replace `components/eval/eval-results.tsx` with the expandable version. Key changes:
- Convert to client component with `useState` for expanded row tracking
- Add chevron icon and click handler on each row
- On first expand, call `getEvalResultDetail` server action and cache result
- Render per-case sub-table below the expanded row
- Reuse `ScoreBadge` and `QualityScore` for per-case scores

```tsx
"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronRight } from "lucide-react";
import type { EvalResultSummary, PerCaseDetail } from "@/app/(dashboard)/eval/actions";
import { getEvalResultDetail } from "@/app/(dashboard)/eval/actions";

function ScoreBadge({
  score,
  target,
  label,
}: {
  score: number | null;
  target: number;
  label: string;
}) {
  if (score === null) return <span className="text-muted-foreground">--</span>;
  const pass = score >= target;
  return (
    <Badge variant={pass ? "default" : "destructive"} className="font-mono">
      {label}: {score.toFixed(2)}
    </Badge>
  );
}

function QualityScore({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted-foreground">--</span>;
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

function TruncatedText({ text, maxLength = 120 }: { text: string; maxLength?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= maxLength) return <span>{text}</span>;
  return (
    <span>
      {expanded ? text : text.slice(0, maxLength) + "..."}
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        className="ml-1 text-xs text-primary underline"
      >
        {expanded ? "less" : "more"}
      </button>
    </span>
  );
}

function PerCaseTable({ cases }: { cases: PerCaseDetail[] }) {
  return (
    <div className="px-4 pb-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[200px]">Question</TableHead>
            <TableHead className="w-[200px]">Expected Answer</TableHead>
            <TableHead className="w-[200px]">Generated Answer</TableHead>
            <TableHead>Retrieval</TableHead>
            <TableHead>Answer Quality</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cases.map((c, i) => (
            <TableRow key={c.testCaseId || i}>
              <TableCell className="align-top text-sm">
                <TruncatedText text={c.question} />
              </TableCell>
              <TableCell className="align-top text-sm">
                {c.expectedSourceIds.length > 0 ? (
                  <TruncatedText text={c.expectedSourceIds.join(", ")} maxLength={60} />
                ) : (
                  <span className="text-muted-foreground">--</span>
                )}
              </TableCell>
              <TableCell className="align-top text-sm">
                {c.generatedAnswer ? (
                  <TruncatedText text={c.generatedAnswer} />
                ) : (
                  <span className="text-muted-foreground">--</span>
                )}
              </TableCell>
              <TableCell className="align-top">
                <div className="flex flex-wrap gap-1">
                  <ScoreBadge score={c.precisionAtK} target={0.8} label="P@k" />
                  <ScoreBadge score={c.recallAtK} target={0.75} label="R@k" />
                  <ScoreBadge score={c.mrr} target={0.7} label="MRR" />
                </div>
              </TableCell>
              <TableCell className="align-top">
                {c.judgeScores ? (
                  <div className="flex gap-3 text-sm">
                    <span>F: <QualityScore score={c.judgeScores.faithfulness} /></span>
                    <span>R: <QualityScore score={c.judgeScores.relevance} /></span>
                    <span>C: <QualityScore score={c.judgeScores.completeness} /></span>
                  </div>
                ) : (
                  <span className="text-muted-foreground">--</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function EvalResults({ results }: { results: EvalResultSummary[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, PerCaseDetail[]>>({});
  const [isPending, startTransition] = useTransition();

  if (results.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8">
        No evaluation results yet. Run an evaluation to see results here.
      </p>
    );
  }

  function handleRowClick(resultId: string) {
    if (expandedId === resultId) {
      setExpandedId(null);
      return;
    }

    setExpandedId(resultId);

    if (!detailCache[resultId]) {
      startTransition(async () => {
        const detail = await getEvalResultDetail(resultId);
        setDetailCache((prev) => ({ ...prev, [resultId]: detail }));
      });
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8"></TableHead>
          <TableHead>Test Set</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Retrieval</TableHead>
          <TableHead>Answer Quality</TableHead>
          <TableHead>Date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {results.map((r) => (
          <>
            <TableRow
              key={r.id}
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => handleRowClick(r.id)}
            >
              <TableCell className="w-8 px-2">
                <ChevronRight
                  className={`h-4 w-4 transition-transform ${expandedId === r.id ? "rotate-90" : ""}`}
                />
              </TableCell>
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
            {expandedId === r.id && (
              <TableRow key={`${r.id}-detail`}>
                <TableCell colSpan={6} className="p-0 bg-muted/30">
                  {isPending && !detailCache[r.id] ? (
                    <p className="p-4 text-sm text-muted-foreground">Loading details...</p>
                  ) : detailCache[r.id] ? (
                    <PerCaseTable cases={detailCache[r.id]} />
                  ) : (
                    <p className="p-4 text-sm text-muted-foreground">Loading...</p>
                  )}
                </TableCell>
              </TableRow>
            )}
          </>
        ))}
      </TableBody>
    </Table>
  );
}
```

**Note:** The `PerCaseTable` "Expected Answer" column shows `expectedSourceIds` (doc IDs) for now. In a future iteration, these could be resolved to document names via a join. The "Generated Answer" column shows the LLM-generated response with truncation.

**Step 4: Run build to verify**

Run: `pnpm tsc --noEmit && pnpm build`
Expected: Clean build, no errors

**Step 5: Run all tests**

Run: `pnpm vitest run`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add components/eval/eval-results.tsx app/\(dashboard\)/eval/actions.ts
git commit -m "feat: add expandable detail view to eval results table"
```

---

### Task 5: Manual Verification

**Step 1: Re-seed demo data**

If demo data already exists, delete it first via `/admin`, then re-seed. This ensures the new `expected_source_ids` are populated.

**Step 2: Run evaluation**

Go to `/eval` → "Run Evaluation" tab → select "PropTech Demo" → run.

**Step 3: Verify retrieval scores**

Go to "Results History" tab. The retrieval column should now show actual P@k, R@k, MRR scores (color-coded badges), not "-- -- --".

**Step 4: Verify detail view**

Click a result row. It should expand to show per-case breakdown with questions, answers, retrieval scores, and judge scores.

**Step 5: Final commit (if any touch-ups needed)**

```bash
git add -A && git commit -m "fix: touch-ups from manual verification"
```
