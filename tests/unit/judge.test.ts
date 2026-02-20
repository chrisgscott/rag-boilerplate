import { describe, it, expect } from "vitest";
import {
  buildJudgePrompt,
  parseJudgeResponse,
  type JudgeScores,
} from "@/lib/rag/judge";

describe("buildJudgePrompt", () => {
  it("includes question, expected answer, generated answer, and sources", () => {
    const prompt = buildJudgePrompt({
      question: "What is the pet policy?",
      expectedAnswer: "No pets allowed except service animals.",
      generatedAnswer: "The lease prohibits pets.",
      retrievedSources: ["Source 1: No pets...", "Source 2: Service animals..."],
    });

    expect(prompt).toContain("What is the pet policy?");
    expect(prompt).toContain("No pets allowed except service animals.");
    expect(prompt).toContain("The lease prohibits pets.");
    expect(prompt).toContain("Source 1: No pets...");
    expect(prompt).toContain("faithfulness");
    expect(prompt).toContain("relevance");
    expect(prompt).toContain("completeness");
    expect(prompt).toContain("JSON");
  });
});

describe("parseJudgeResponse", () => {
  it("parses valid JSON response with scores", () => {
    const response = `{"faithfulness": 4, "relevance": 5, "completeness": 3}`;
    const scores = parseJudgeResponse(response);
    expect(scores).toEqual({ faithfulness: 4, relevance: 5, completeness: 3 });
  });

  it("extracts JSON from markdown code blocks", () => {
    const response = `Here is my evaluation:\n\`\`\`json\n{"faithfulness": 3, "relevance": 4, "completeness": 2}\n\`\`\``;
    const scores = parseJudgeResponse(response);
    expect(scores).toEqual({ faithfulness: 3, relevance: 4, completeness: 2 });
  });

  it("returns null for unparseable response", () => {
    expect(parseJudgeResponse("I cannot evaluate this.")).toBeNull();
  });

  it("returns null when scores are out of range", () => {
    expect(
      parseJudgeResponse(
        `{"faithfulness": 6, "relevance": 5, "completeness": 3}`
      )
    ).toBeNull();
    expect(
      parseJudgeResponse(
        `{"faithfulness": 0, "relevance": 5, "completeness": 3}`
      )
    ).toBeNull();
  });

  it("returns null when keys are missing", () => {
    expect(
      parseJudgeResponse(`{"faithfulness": 4, "relevance": 5}`)
    ).toBeNull();
  });
});
