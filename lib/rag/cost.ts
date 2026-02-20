export type ModelRates = {
  input_rate: number;
  output_rate: number;
  embedding_rate: number | null;
};

export type CostInput = {
  embeddingTokens: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  rates: ModelRates;
};

export type CostResult = {
  embeddingCost: number;
  llmCost: number;
  totalCost: number;
};

/**
 * Calculate cost for a single query given token counts and rates.
 */
export function calculateCost(input: CostInput): CostResult {
  const embeddingCost = input.rates.embedding_rate
    ? input.embeddingTokens * input.rates.embedding_rate
    : 0;

  const llmCost =
    input.llmInputTokens * input.rates.input_rate +
    input.llmOutputTokens * input.rates.output_rate;

  return {
    embeddingCost,
    llmCost,
    totalCost: embeddingCost + llmCost,
  };
}

/**
 * Default rates (as of Feb 2026) used when no org-specific rates exist.
 * Rates are per-token (not per-million).
 */
export const DEFAULT_MODEL_RATES: Record<string, ModelRates> = {
  "text-embedding-3-small": {
    input_rate: 0,
    output_rate: 0,
    embedding_rate: 0.00000002, // $0.02/M tokens
  },
  "gpt-4o": {
    input_rate: 0.0000025, // $2.50/M input
    output_rate: 0.00001, // $10/M output
    embedding_rate: null,
  },
  "gpt-4o-mini": {
    input_rate: 0.00000015, // $0.15/M input
    output_rate: 0.0000006, // $0.60/M output
    embedding_rate: null,
  },
  "claude-sonnet-4-20250514": {
    input_rate: 0.000003, // $3/M input
    output_rate: 0.000015, // $15/M output
    embedding_rate: null,
  },
  "claude-haiku-3-5-20241022": {
    input_rate: 0.0000008, // $0.80/M input
    output_rate: 0.000004, // $4/M output
    embedding_rate: null,
  },
};
