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
    precisionAtK: r.precision_at_k !== null ? Number(r.precision_at_k) : null,
    recallAtK: r.recall_at_k !== null ? Number(r.recall_at_k) : null,
    mrr: r.mrr !== null ? Number(r.mrr) : null,
    avgFaithfulness: r.avg_faithfulness !== null ? Number(r.avg_faithfulness) : null,
    avgRelevance: r.avg_relevance !== null ? Number(r.avg_relevance) : null,
    avgCompleteness: r.avg_completeness !== null ? Number(r.avg_completeness) : null,
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
