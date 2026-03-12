"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type {
  OptimizationRunRow,
  OptimizationExperimentRow,
  OptimizationConfigRow,
} from "@/lib/rag/optimizer/results-log";
import type { CumulativeInsights } from "@/lib/rag/optimizer/agent";

// --- Helper: Get current user's org ---

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

// --- Types ---

export type BestConfigMetrics = {
  retrievalMetrics: { precisionAtK: number; recallAtK: number; mrr: number } | null;
  judgeScores: { faithfulness: number; relevance: number; completeness: number } | null;
};

export type OptimizePageData = {
  bestConfig: OptimizationConfigRow | null;
  bestConfigMetrics: BestConfigMetrics | null;
  latestSessions: OptimizationRunRow[];
  experiments: OptimizationExperimentRow[];
  insights: CumulativeInsights | null;
  flaggedTestCases: Array<{
    id: string;
    question: string;
    expected_answer: string;
    grounding_score: number | null;
    document_chunks: { content: string } | null;
  }>;
  flaggedCount: number;
};

// --- Server Actions ---

export async function getOptimizePageData(): Promise<OptimizePageData> {
  const { organizationId } = await getCurrentOrg();
  const admin = createAdminClient();

  // Best config
  const { data: bestConfig } = await admin
    .from("optimization_configs")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  // Latest 10 sessions
  const { data: latestSessions } = await admin
    .from("optimization_runs")
    .select("*")
    .eq("organization_id", organizationId)
    .order("started_at", { ascending: false })
    .limit(10);

  // Experiments for latest session
  let experiments: OptimizationExperimentRow[] = [];
  if (latestSessions && latestSessions.length > 0) {
    const { data: exps } = await admin
      .from("optimization_experiments")
      .select("*")
      .eq("run_id", latestSessions[0].id)
      .order("experiment_index", { ascending: true });
    experiments = (exps ?? []) as OptimizationExperimentRow[];
  }

  // Insights
  const { data: insightsRow } = await admin
    .from("optimization_insights")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  // Flagged test cases — scoped to org via test_set_id
  // First get test set IDs for this org
  const { data: testSets } = await admin
    .from("eval_test_sets")
    .select("id")
    .eq("organization_id", organizationId);

  const testSetIds = (testSets ?? []).map((ts: { id: string }) => ts.id);

  let flaggedCases: OptimizePageData["flaggedTestCases"] = [];
  let flaggedCount = 0;

  if (testSetIds.length > 0) {
    const { data, count } = await admin
      .from("eval_test_cases")
      .select("id, question, expected_answer, grounding_score, document_chunks(content)", { count: "exact" })
      .in("test_set_id", testSetIds)
      .eq("status", "flagged")
      .limit(20);
    flaggedCases = (data ?? []) as unknown as OptimizePageData["flaggedTestCases"];
    flaggedCount = count ?? 0;
  }

  // Metrics for best config — find the "kept" experiment from the winning run
  let bestConfigMetrics: BestConfigMetrics | null = null;
  if (bestConfig?.run_id) {
    const { data: keptExp } = await admin
      .from("optimization_experiments")
      .select("retrieval_metrics, judge_scores")
      .eq("run_id", bestConfig.run_id)
      .eq("status", "kept")
      .order("experiment_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (keptExp) {
      bestConfigMetrics = {
        retrievalMetrics: keptExp.retrieval_metrics as BestConfigMetrics["retrievalMetrics"],
        judgeScores: keptExp.judge_scores as BestConfigMetrics["judgeScores"],
      };
    }
  }

  return {
    bestConfig: (bestConfig as OptimizationConfigRow) ?? null,
    bestConfigMetrics,
    latestSessions: (latestSessions ?? []) as OptimizationRunRow[],
    experiments,
    insights: insightsRow ? (insightsRow.insights as CumulativeInsights) : null,
    flaggedTestCases: flaggedCases,
    flaggedCount,
  };
}

export async function cancelOptimizationSession(
  runId: string
): Promise<void> {
  const { organizationId } = await getCurrentOrg();
  const admin = createAdminClient();

  // Verify run belongs to user's org and is actually running
  const { data: run } = await admin
    .from("optimization_runs")
    .select("id, status")
    .eq("id", runId)
    .eq("organization_id", organizationId)
    .single();

  if (!run) throw new Error("Session not found");

  // Mark as error/cancelled
  const { error } = await admin
    .from("optimization_runs")
    .update({
      status: "error",
      error_message: "Cancelled by user",
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (error) throw new Error(error.message);
  revalidatePath("/optimize");
}

export async function runOptimizationSession(): Promise<{ status: string }> {
  const { organizationId } = await getCurrentOrg();
  const admin = createAdminClient();

  // Check for active session (pending or running)
  const { data: activeRun } = await admin
    .from("optimization_runs")
    .select("id")
    .eq("organization_id", organizationId)
    .in("status", ["running", "pending"])
    .limit(1)
    .maybeSingle();

  if (activeRun) {
    throw new Error("An optimization session is already running");
  }

  // Start the session — runs in background, returns immediately
  const { startOptimizationSession } = await import(
    "@/lib/rag/optimizer/wire"
  );
  await startOptimizationSession(admin, organizationId);

  revalidatePath("/optimize");
  return { status: "started" };
}

export async function generateTestSet(): Promise<{ generated: number; validated: number; flagged: number; rejected: number }> {
  const { organizationId } = await getCurrentOrg();
  const admin = createAdminClient();

  // Dynamically import to keep cold start light
  const { generateTestCases } = await import("@/lib/rag/test-set/generator");
  const { validateTestCases } = await import("@/lib/rag/test-set/validator");
  const { hybridSearch } = await import("@/lib/rag/search");
  const { generateText } = await import("ai");
  const { getLLMProvider, getModelId } = await import("@/lib/rag/provider");

  // Get or create test set
  let testSetId: string;
  const { data: existingSet } = await admin
    .from("eval_test_sets")
    .select("id")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingSet) {
    testSetId = existingSet.id;
  } else {
    const { data: newSet, error } = await admin
      .from("eval_test_sets")
      .insert({
        organization_id: organizationId,
        name: "Auto-generated",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    testSetId = newSet.id;
  }

  const sampleSize = parseInt(process.env.BOOTSTRAP_SAMPLE_SIZE ?? "20", 10);

  // Wire generator deps
  const generatorDeps = {
    generateQA: async (chunkContent: string, question?: string) => {
      const provider = getLLMProvider();
      const modelId = getModelId();
      const prompt = question
        ? `Given this text chunk and the user query "${question}", generate a Q&A pair.\n\nChunk:\n${chunkContent}\n\nRespond in JSON: {"question": "...", "expectedAnswer": "..."}`
        : `Given this text chunk, generate a question-answer pair that tests understanding.\n\nChunk:\n${chunkContent}\n\nRespond in JSON: {"question": "...", "expectedAnswer": "..."}`;

      const { text } = await generateText({
        model: provider(modelId),
        prompt,
      });

      const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim());
      return { question: parsed.question, expectedAnswer: parsed.expectedAnswer };
    },

    getChunks: async (orgId: string, limit: number) => {
      const { data } = await admin
        .from("document_chunks")
        .select("id, document_id, content, token_count")
        .eq("organization_id", orgId)
        .order("token_count", { ascending: false })
        .limit(limit);
      return (data ?? []).map((c: Record<string, unknown>) => ({
        id: String(c.id),
        documentId: c.document_id as string,
        content: c.content as string,
        tokenCount: (c.token_count as number) ?? 0,
      }));
    },

    getAccessLogs: async (orgId: string, limit: number) => {
      const { data } = await admin
        .from("document_access_logs")
        .select("query_text, document_id, chunks_returned")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(limit);
      return (data ?? []).map((l: Record<string, unknown>) => ({
        queryText: l.query_text as string,
        documentId: l.document_id as string,
        chunksReturned: (l.chunks_returned as number) ?? 0,
      }));
    },

    searchForChunks: async (query: string, orgId: string) => {
      const result = await hybridSearch(admin, { query, organizationId: orgId, matchCount: 5, rerankEnabled: false });
      return result.results.map((r) => ({
        id: String(r.chunkId),
        content: r.content,
        similarity: r.similarity,
      }));
    },
  };

  // Generate
  const generated = await generateTestCases(
    "bootstrap",
    organizationId,
    testSetId,
    generatorDeps,
    { sampleSize }
  );

  // Validate
  const validatorDeps = {
    search: async (query: string, orgId: string) => {
      const result = await hybridSearch(admin, { query, organizationId: orgId, matchCount: 20, rerankEnabled: false });
      return result.results.map((r) => ({
        id: String(r.chunkId),
        content: r.content,
        similarity: r.similarity,
      }));
    },
    scoreEntailment: async (chunkContent: string, answer: string) => {
      const provider = getLLMProvider();
      const modelId = getModelId();
      const { text } = await generateText({
        model: provider(modelId),
        prompt: `Score how well the answer is grounded in the source text on a scale of 1-5.\n\nSource:\n${chunkContent}\n\nAnswer:\n${answer}\n\nRespond with ONLY a number 1-5.`,
      });
      return parseInt(text.trim(), 10) || 3;
    },
  };

  const autoApprove = parseInt(process.env.ENTAILMENT_AUTO_APPROVE ?? "4", 10);
  const autoReject = parseInt(process.env.ENTAILMENT_AUTO_REJECT ?? "1", 10);

  const validated = await validateTestCases(generated, organizationId, validatorDeps, {
    autoApproveThreshold: autoApprove,
    autoRejectThreshold: autoReject,
  });

  // Persist non-rejected test cases to DB
  const toInsert = validated.filter((tc) => tc.status !== "rejected");
  for (const tc of toInsert) {
    const { error: insertErr } = await admin
      .from("eval_test_cases")
      .insert({
        test_set_id: testSetId,
        question: tc.question,
        expected_answer: tc.expectedAnswer,
        expected_source_ids: tc.expectedSourceIds,
        split: tc.split,
        generation_mode: tc.generationMode,
        status: tc.status,
        grounding_score: tc.groundingScore,
        source_chunk_id: tc.sourceChunkId ? Number(tc.sourceChunkId) : null,
      });
    if (insertErr) {
      console.error("Failed to insert test case:", insertErr.message);
    }
  }

  revalidatePath("/optimize");

  const validatedCount = validated.filter((tc) => tc.status === "validated").length;
  const flaggedCount = validated.filter((tc) => tc.status === "flagged").length;
  const rejectedCount = validated.filter((tc) => tc.status === "rejected").length;

  return { generated: validated.length, validated: validatedCount, flagged: flaggedCount, rejected: rejectedCount };
}

export async function reviewTestCase(
  testCaseId: string,
  decision: "validated" | "rejected"
): Promise<void> {
  const { organizationId } = await getCurrentOrg();
  const admin = createAdminClient();

  // Verify test case belongs to user's org via test_set_id
  const { data: testCase } = await admin
    .from("eval_test_cases")
    .select("id, test_set_id")
    .eq("id", testCaseId)
    .single();

  if (!testCase) throw new Error("Test case not found");

  const { data: testSet } = await admin
    .from("eval_test_sets")
    .select("id")
    .eq("id", testCase.test_set_id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!testSet) throw new Error("Test case not found");

  const { error } = await admin
    .from("eval_test_cases")
    .update({ status: decision })
    .eq("id", testCaseId);

  if (error) throw new Error(error.message);
  revalidatePath("/optimize");
}
