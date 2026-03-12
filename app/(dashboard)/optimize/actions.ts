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

export type OptimizePageData = {
  bestConfig: OptimizationConfigRow | null;
  latestSessions: OptimizationRunRow[];
  experiments: OptimizationExperimentRow[];
  insights: CumulativeInsights | null;
  flaggedTestCases: Array<{
    id: string;
    question: string;
    expected_answer: string;
    grounding_score: number | null;
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
      .select("id, question, expected_answer, grounding_score", { count: "exact" })
      .in("test_set_id", testSetIds)
      .eq("status", "flagged")
      .limit(20);
    flaggedCases = (data ?? []) as OptimizePageData["flaggedTestCases"];
    flaggedCount = count ?? 0;
  }

  return {
    bestConfig: (bestConfig as OptimizationConfigRow) ?? null,
    latestSessions: (latestSessions ?? []) as OptimizationRunRow[],
    experiments,
    insights: insightsRow ? (insightsRow.insights as CumulativeInsights) : null,
    flaggedTestCases: flaggedCases,
    flaggedCount,
  };
}

export async function runOptimizationSession(): Promise<{ sessionId: string }> {
  const { organizationId } = await getCurrentOrg();
  const admin = createAdminClient();

  // Check for active session
  const { data: activeRun } = await admin
    .from("optimization_runs")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("status", "running")
    .limit(1)
    .maybeSingle();

  if (activeRun) {
    throw new Error("An optimization session is already running");
  }

  // Create run record
  const { data: run, error } = await admin
    .from("optimization_runs")
    .insert({
      organization_id: organizationId,
      status: "running",
      baseline_config: {},
      composite_weights: {},
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  // Fire-and-forget: actual session will run in background
  // Full wiring deferred — for now, just create the record

  revalidatePath("/optimize");
  return { sessionId: run.id };
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
