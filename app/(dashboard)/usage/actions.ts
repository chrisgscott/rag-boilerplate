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
