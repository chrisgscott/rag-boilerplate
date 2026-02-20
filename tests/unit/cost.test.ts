import { describe, it, expect } from "vitest";
import {
  calculateCost,
  DEFAULT_MODEL_RATES,
  type ModelRates,
} from "@/lib/rag/cost";

describe("calculateCost", () => {
  const customRates: ModelRates = {
    input_rate: 0.000003, // $3/M input tokens
    output_rate: 0.000015, // $15/M output tokens
    embedding_rate: 0.00000002, // $0.02/M embedding tokens
  };

  it("calculates cost with custom rates", () => {
    const result = calculateCost({
      embeddingTokens: 10,
      llmInputTokens: 1000,
      llmOutputTokens: 500,
      rates: customRates,
    });

    expect(result.embeddingCost).toBeCloseTo(0.0000002, 10);
    expect(result.llmCost).toBeCloseTo(0.0105, 6);
    expect(result.totalCost).toBeCloseTo(0.0105002, 6);
  });

  it("returns zero cost when all tokens are zero", () => {
    const result = calculateCost({
      embeddingTokens: 0,
      llmInputTokens: 0,
      llmOutputTokens: 0,
      rates: customRates,
    });

    expect(result.embeddingCost).toBe(0);
    expect(result.llmCost).toBe(0);
    expect(result.totalCost).toBe(0);
  });

  it("handles null embedding_rate by treating embedding cost as zero", () => {
    const ratesNoEmbed: ModelRates = {
      input_rate: 0.000003,
      output_rate: 0.000015,
      embedding_rate: null,
    };

    const result = calculateCost({
      embeddingTokens: 100,
      llmInputTokens: 1000,
      llmOutputTokens: 500,
      rates: ratesNoEmbed,
    });

    expect(result.embeddingCost).toBe(0);
    expect(result.llmCost).toBeCloseTo(0.0105, 6);
  });

  it("exports DEFAULT_MODEL_RATES with expected models", () => {
    expect(DEFAULT_MODEL_RATES).toHaveProperty("text-embedding-3-small");
    expect(DEFAULT_MODEL_RATES).toHaveProperty("gpt-4o");
    expect(DEFAULT_MODEL_RATES).toHaveProperty("claude-sonnet-4-20250514");
    expect(DEFAULT_MODEL_RATES["text-embedding-3-small"].embedding_rate).not.toBeNull();
  });
});
