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

export function buildAgentPrompt(context: AgentContext): string {
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
