import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";

export function getLLMProvider() {
  const provider = process.env.LLM_PROVIDER;
  switch (provider) {
    case "anthropic":
      return createAnthropic();
    case "openai":
      return createOpenAI();
    default:
      throw new Error(
        `LLM_PROVIDER must be "anthropic" or "openai", got "${provider}"`
      );
  }
}

export function getModelId(): string {
  const provider = process.env.LLM_PROVIDER;
  switch (provider) {
    case "anthropic":
      return "claude-sonnet-4-20250514";
    case "openai":
      return "gpt-4o";
    default:
      throw new Error(
        `LLM_PROVIDER must be "anthropic" or "openai", got "${provider}"`
      );
  }
}
