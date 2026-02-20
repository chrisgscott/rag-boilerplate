# Eval: Fix Retrieval Metrics + Detail View

**Date:** 2026-02-20
**Status:** Approved

## Problem

1. **Retrieval column shows "-- -- --"** — two root causes:
   - Demo test cases have no `expected_source_ids`, so retrieval metrics compute to `0`
   - Truthiness bug in `getEvalResults()` maps `0` to `null` (JS falsy), rendering as `--`
2. **No way to inspect individual results** — the results table shows aggregate scores only, with no drill-down into per-case data

## Solution

### Fix 1: Truthiness Bug

In `app/(dashboard)/eval/actions.ts` line 268-270, change:
```typescript
precisionAtK: r.precision_at_k ? Number(r.precision_at_k) : null,
```
to:
```typescript
precisionAtK: r.precision_at_k !== null ? Number(r.precision_at_k) : null,
```

Same for `recallAtK`, `mrr`, `avgFaithfulness`, `avgRelevance`, `avgCompleteness`.

### Fix 2: Add `expected_source_ids` to Demo Test Cases

Add an `expectedDocNames` field to each entry in `DEMO_EVAL_TEST_CASES` mapping questions to their source document filenames. During seeding (`seedDemo` in `admin/actions.ts`), collect document IDs as they're created, then resolve `expectedDocNames` to real UUIDs when inserting test cases.

Document-to-question mapping:
- Rent question → Residential-Lease-Agreement.md
- Noise violation → Residential-Lease-Agreement.md, HOA-Rules-and-Regulations.md
- Dog restrictions → Residential-Lease-Agreement.md, Community-Guidelines.md
- Rooftop terrace → Community-Guidelines.md
- Move-out/deposit → Residential-Lease-Agreement.md, Community-Guidelines.md
- Pool hours/guests → HOA-Rules-and-Regulations.md, Community-Guidelines.md
- Parking/moving truck → HOA-Rules-and-Regulations.md, Community-Guidelines.md

### Feature: Expandable Row Detail View

Make result rows in `EvalResults` clickable. On click, expand inline to show per-case breakdown fetched from `per_case_results` JSONB via the existing `getEvalResultDetail` server action.

**Expanded row shows a sub-table with columns:**
- Question (truncated with expand)
- Expected Answer (truncated with expand)
- Generated Answer (truncated with expand)
- Retrieved Docs (list of doc IDs or names)
- Expected Docs (list of doc IDs or names)
- P@k, R@k, MRR (color-coded badges, same thresholds as summary)
- Faithfulness, Relevance, Completeness (scored /5)

**UX details:**
- Click row to expand, click again to collapse
- Chevron icon indicates expandable state
- Fetches detail data on first expand, caches in client state
- No new routes — stays within existing `eval-results.tsx` component

## Files Changed

- `app/(dashboard)/eval/actions.ts` — fix truthiness bug
- `lib/demo/content.ts` — add `expectedDocNames` to test cases
- `app/(dashboard)/admin/actions.ts` — resolve doc names to IDs during seeding
- `components/eval/eval-results.tsx` — expandable row with per-case detail
