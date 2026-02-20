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
