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
