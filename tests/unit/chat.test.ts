import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// --- Mock AI SDK providers (must be before imports) ---

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => "mock-anthropic-provider"),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => "mock-openai-provider"),
}));

import { getLLMProvider, getModelId } from "@/lib/rag/provider";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";

// --- Provider Factory Tests ---

describe("Provider Factory", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getLLMProvider", () => {
    it("returns anthropic provider when LLM_PROVIDER=anthropic", () => {
      process.env.LLM_PROVIDER = "anthropic";
      const provider = getLLMProvider();
      expect(createAnthropic).toHaveBeenCalled();
      expect(provider).toBe("mock-anthropic-provider");
    });

    it("returns openai provider when LLM_PROVIDER=openai", () => {
      process.env.LLM_PROVIDER = "openai";
      const provider = getLLMProvider();
      expect(createOpenAI).toHaveBeenCalled();
      expect(provider).toBe("mock-openai-provider");
    });

    it("throws when LLM_PROVIDER is not set", () => {
      delete process.env.LLM_PROVIDER;
      expect(() => getLLMProvider()).toThrow("LLM_PROVIDER");
    });

    it("throws when LLM_PROVIDER is invalid", () => {
      process.env.LLM_PROVIDER = "gemini";
      expect(() => getLLMProvider()).toThrow("LLM_PROVIDER");
    });
  });

  describe("getModelId", () => {
    it("returns Claude model for anthropic", () => {
      process.env.LLM_PROVIDER = "anthropic";
      expect(getModelId()).toBe("claude-sonnet-4-20250514");
    });

    it("returns GPT-4o for openai", () => {
      process.env.LLM_PROVIDER = "openai";
      expect(getModelId()).toBe("gpt-4o");
    });

    it("throws for unknown provider", () => {
      process.env.LLM_PROVIDER = "invalid";
      expect(() => getModelId()).toThrow();
    });
  });
});
