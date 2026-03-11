# RAG Auto-Optimizer — Concept & Design Notes

> Inspired by Karpathy's `autoresearch` pattern: an agent that runs iterative single-variable experiments, tracks deltas against a baseline, compounds wins, and posts structured session reports. Applied to RAG pipeline optimization.

**SanityCheck score:** 5/5 — https://www.sanitycheck.co/ideas/cb9a58e3-93ef-45aa-ae1f-ed608a0fc8c4

---

## The Core Insight

RAG performance is content-dependent. There is no universally optimal configuration — the best settings for a legal document corpus look completely different from a technical knowledge base, a collection of government reports, or a PropTech lease Q&A system.

The self-optimizer exploits this by running the existing eval infrastructure against a *configuration search loop* rather than a fixed config. Each instance of the boilerplate converges on its own optimal settings for its own content and query patterns. Two deployments built on the same boilerplate may end up with completely different configurations — and both will be correct for their context.

---

## Why This Boilerplate Is Already 80% There

The eval system in `lib/rag/eval-runner.ts` already provides everything needed for the scoring function:

**Phase 1 — Retrieval metrics** (per test case):
- `precisionAtK` — what fraction of retrieved docs are relevant
- `recallAtK` — what fraction of expected docs were retrieved
- `mrr` — mean reciprocal rank (how high the first relevant result ranks)

**Phase 2 — Answer quality** (LLM-as-judge):
- `faithfulness` (1-5) — is the answer grounded in retrieved sources?
- `relevance` (1-5) — does it answer the question?
- `completeness` (1-5) — does it cover all key points?

**What's missing** to close the loop:
1. A persistent results log that tracks *config changes* and their delta impact
2. An agent "Decide" step that reads failure patterns and picks the next experiment
3. A config mutation layer that can programmatically swap parameters between runs

---

## The Autoresearch Loop Applied to RAG

```
BASELINE RUN
  -> score current config against test set
  -> store as baseline: { p@k, r@k, mrr, faithfulness, relevance, completeness }

LOOP:
  OBSERVE  -> run eval, capture per-case results
  ORIENT   -> analyze failure patterns (which cases fail? retrieval miss or answer quality miss?)
  DECIDE   -> agent picks highest-leverage variable to test next
  ACT      -> apply single-variable change, re-run eval

  delta = new_score - baseline_score
  if delta improves composite metric:
    keep -> new baseline
    log to results log
  else:
    discard -> revert
    log to results log

SESSION REPORT -> structured summary of kept/discarded experiments + final config
```

The "Orient" step is where the agent adds real value over brute-force grid search. It can look at per-case failures and reason: "the low-MRR cases are all multi-hop questions" or "completeness scores are low but faithfulness is high — retrieval is working but we're not pulling enough context." That reasoning drives *targeted* experiments rather than random parameter sweeps.

---

## Current Tunable Knobs

These exist today in the codebase and are immediately available for optimization:

| Knob | Location | Current Default | Notes |
|------|----------|-----------------|-------|
| topK / matchCount | EvalConfig, search.ts | 5 | Candidates retrieved |
| fullTextWeight | search.ts RPC call | 1.0 | BM25 contribution to RRF |
| semanticWeight | search.ts RPC call | 1.0 | Vector similarity contribution |
| SIMILARITY_THRESHOLD | env var | 0.7 | Refusal cutoff |
| Rerank on/off | COHERE_API_KEY presence | off | Cohere cross-encoder |
| Rerank candidate multiplier | search.ts (hardcoded 4x) | 4x | Over-fetch before reranking |
| CHUNK_MAX_TOKENS | Python worker env | 512 | Chunk size |
| CHUNK_OVERLAP | Python worker env | 0.15 | Overlap ratio |
| CACHE_SIMILARITY_THRESHOLD | env var | 0.95 | Cache hit sensitivity |
| LLM model | EvalConfig.model | claude-sonnet | Generation model |
| CONTEXTUAL_CHUNKING_ENABLED | env var | false | LLM-generated chunk context |

---

## New Knobs That Become Viable With a Smart Optimizer

Manual tuning is limited to knobs that are cheap to reason about. When an agent is doing the Decide step, you can expose parameters that would be impractical to tune by hand:

### Query Processing
- **Query rewriting strategy** — expand as-is vs. HyDE (generate a hypothetical answer and embed that) vs. multi-query decomposition (break complex questions into sub-questions)
- **Query type routing** — factual lookups, comparison questions, and multi-hop reasoning may each warrant different retrieval strategies
- **Query expansion** — add synonyms or domain terms before embedding

### Retrieval Architecture
- **RRF blend shape** — the ratio is not necessarily constant; short queries may favor BM25, long queries may favor semantic
- **Per-query-type topK** — simple factual queries need fewer candidates than open-ended ones
- **Embedding model selection** — text-embedding-3-small vs. 3-large vs. domain-specific; optimizer scores cost/quality tradeoff against real eval data
- **Rerank model** — Cohere rerank-v3.5 vs. alternatives; the optimizer can score whether reranking is even worth the latency/cost for this corpus

### Chunking Strategy
- **Chunk boundary strategy** — not just size/overlap, but where to split: sentence boundaries vs. paragraph vs. semantic units
- **Contextual chunking threshold** — which chunk types benefit from LLM-generated context vs. which do not (currently all-or-nothing)
- **Chunk size by document type** — dense technical docs may need smaller chunks than narrative prose

### Context Assembly
- **Context window composition** — how many chunks, in what order, with what surrounding metadata presented to the LLM
- **Context formatting** — numbered list vs. prose vs. labeled sections; how much metadata to include; how citation instructions are framed
- **Source diversity** — force retrieval from N distinct documents vs. allow multiple chunks from the same doc

### Answer Generation
- **System prompt variations** — how retrieved context is framed to the LLM directly affects answer quality; this is effectively automatic prompt engineering for RAG
- **Judge rubric weights** — Faithfulness/Relevance/Completeness are not necessarily equal priority for every use case
- **Temperature** — affects answer quality differently depending on query type

---

## The Composite Score

The optimizer needs a single scalar to optimize against (like val_bpb in autoresearch). The composite can be weighted by use case priority:

```typescript
type CompositeWeights = {
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
  faithfulness: number;
  relevance: number;
  completeness: number;
};

// Example: precision-focused use case (legal, compliance)
const legalWeights = { precisionAtK: 0.3, recallAtK: 0.1, mrr: 0.2, faithfulness: 0.25, relevance: 0.1, completeness: 0.05 };

// Example: recall-focused use case (research, discovery)
const researchWeights = { precisionAtK: 0.1, recallAtK: 0.35, mrr: 0.1, faithfulness: 0.15, relevance: 0.2, completeness: 0.1 };
```

The user declares their priority profile once; the optimizer chases the right composite from there.

---

## The Compounding Effect

This is not just "find good settings once." As the document corpus grows or shifts, the optimal configuration drifts. The optimizer becomes a continuous background process:

1. New documents ingested -> run a quick eval pass -> check if baseline has drifted
2. If drift detected -> trigger an optimization session
3. Compounding: each session starts from the previous session's best config, not from defaults

Over time, the system learns which knobs matter for this corpus and which are noise — the dead-ends log is as valuable as the wins log.

---

## Implementation Sketch

### New files needed
```
lib/rag/optimizer/
  config.ts          — ExperimentConfig type, config serialization/diffing
  results-log.ts     — persistent experiment log (Supabase table)
  experiment.ts      — single experiment runner (mutate config -> run eval -> score -> revert or keep)
  session.ts         — full optimization session loop
  agent.ts           — the "Decide" step: reads failure patterns, proposes next experiment
  report.ts          — session report generator

lib/rag/test-set/
  generator.ts       — synthetic test case generator (see below)
  validator.ts       — grounding verification pipeline
  splitter.ts        — train/validation set management
```

### New Supabase tables needed
```sql
-- Optimization runs (one per session)
optimization_runs (id, organization_id, started_at, completed_at, baseline_score, best_score, experiments_run)

-- Individual experiment results (the results.tsv equivalent)
optimization_experiments (id, run_id, config_delta, composite_score, delta, status, retrieval_metrics, judge_scores, created_at)

-- Best known config per org (the "keep" accumulation)
optimization_configs (organization_id, config, composite_score, updated_at)

-- Generated test cases with split assignment
test_cases (id, organization_id, question, expected_answer, expected_source_ids, split, grounding_score, created_at)
```

---

## Test Set Generation From Real Data

The hardest part of building a reliable eval set is not writing questions — it is writing questions that are *representative of how real users actually query your corpus*. Hand-crafted test cases bias toward questions you think users will ask. Generated test cases from actual query logs reflect questions users actually asked, grounded in documents that were actually retrieved.

The boilerplate already has the raw material:
- `document_access_logs` — real queries, which docs they hit, similarity scores
- The chunks themselves — actual content to generate expected answers from
- The existing eval schema — ready to receive generated test cases

### Generation pipeline

1. Pull high-confidence query/document pairs from `document_access_logs` (queries that retrieved chunks with high similarity scores — those are the clean signal)
2. For each pair, feed the chunk content + query to an LLM: "given only this source, write the expected answer to this question"
3. Auto-populate `expected_source_ids` from the retrieved doc IDs
4. Run the grounding verification pipeline (see below)
5. Split the validated set: 70% optimization set, 30% held-out validation — enforced at generation time, never mixed

### The hallucination problem

Synthetic test data carries a real risk: the LLM generating expected answers can hallucinate. An answer that sounds plausible but is not actually supported by the source chunk is worse than no test case — it corrupts the optimization signal. The optimizer may converge on a config that scores well against *wrong* expected answers, which can mean worse real-world performance.

**Failure modes:**
- **Hallucinated answer** — expected answer contains facts not in the source chunk; judge scores real answers against wrong ground truth
- **Hallucinated question** — question premises something not in the document; retrieval gets blamed for misses that are the generator's fault
- **Compounding corruption** — even 10% bad test cases can steer the optimizer toward configs that score well on those bad cases specifically

### Grounding verification pipeline

Three layers, applied in order of cost:

**1. Round-trip retrieval check (free)**
After generating a question, run it through the retrieval system and verify the source chunk appears in the top results. If the generated question cannot retrieve its own source document, it is malformed or too vague to be a useful test case.

**2. Entailment scoring (cheap)**
A second LLM pass: "given only this source chunk, is this answer fully supported? Score 1-5." Only promote test cases above a confidence threshold (e.g., 4/5) into the optimization set.

**3. Human review queue (targeted)**
Flag low-confidence pairs (below entailment threshold but not outright failures) for spot-check review. Keeps human oversight focused where the signal is weakest.

### Why this solves the overfitting problem too

The overfitting fix is structural, not disciplinary. The generator owns the train/validation split and the optimizer never touches the validation set — enforced in code, not by convention. A larger generated set also enables a two-tier eval cost strategy: run retrieval-only metrics on the full optimization set (cheap) and escalate to full LLM judge scoring only when retrieval metrics show genuine improvement.

### The flywheel

New deployment has no test cases? Generate from the first batch of real queries. More usage = better test cases = better optimization signal = better retrieval = more confident users = more queries. The system gets smarter as it gets used.

---

## Open Questions

- Should optimization run on a schedule (nightly) or trigger on corpus changes?
- What is the minimum test set size to make optimization signal reliable vs. noise?
- Should the optimizer have a hard budget cap (max experiments per session, max API cost)?
- Is the "Decide" agent step worth the complexity vs. a smarter-than-random search strategy (e.g., Bayesian optimization)?
- What is the right entailment threshold for the grounding verification step? (Too strict = too few test cases; too loose = corrupted signal)
- How do you handle corpus drift — when old test cases become stale because the documents they were generated from have changed or been deleted?

---

*First documented: March 10, 2026. Conversation context: Karpathy autoresearch -> OODA optimization loop -> RAG config search space -> boilerplate fit analysis -> synthetic test set generation and hallucination risk.*
