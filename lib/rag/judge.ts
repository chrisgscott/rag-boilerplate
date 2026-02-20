export type JudgeInput = {
  question: string;
  expectedAnswer: string;
  generatedAnswer: string;
  retrievedSources: string[];
};

export type JudgeScores = {
  faithfulness: number;
  relevance: number;
  completeness: number;
};

/**
 * Build the LLM judge prompt for answer quality evaluation.
 */
export function buildJudgePrompt(input: JudgeInput): string {
  const sourcesBlock = input.retrievedSources
    .map((s, i) => `[Source ${i + 1}]: ${s}`)
    .join("\n\n");

  return `You are an evaluation judge. Score the following generated answer on three dimensions.

## Rubric

- **faithfulness** (1-5): Is the generated answer grounded in the retrieved sources? 5 = fully grounded, 1 = hallucinated.
- **relevance** (1-5): Does the generated answer address the question? 5 = directly answers, 1 = off-topic.
- **completeness** (1-5): Does the generated answer cover all key points from the expected answer? 5 = complete, 1 = missing most points.

## Question
${input.question}

## Expected Answer
${input.expectedAnswer}

## Generated Answer
${input.generatedAnswer}

## Retrieved Sources
${sourcesBlock}

## Instructions
Respond with ONLY a JSON object (no other text):
{"faithfulness": <1-5>, "relevance": <1-5>, "completeness": <1-5>}`;
}

/**
 * Parse the LLM judge response to extract scores.
 * Returns null if the response cannot be parsed or scores are invalid.
 */
export function parseJudgeResponse(response: string): JudgeScores | null {
  // Try to extract JSON from code blocks first
  const codeBlockMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : response.trim();

  try {
    const parsed = JSON.parse(jsonStr);

    const { faithfulness, relevance, completeness } = parsed;

    // Validate all three keys exist and are numbers 1-5
    if (
      typeof faithfulness !== "number" ||
      typeof relevance !== "number" ||
      typeof completeness !== "number"
    ) {
      return null;
    }

    if (
      faithfulness < 1 ||
      faithfulness > 5 ||
      relevance < 1 ||
      relevance > 5 ||
      completeness < 1 ||
      completeness > 5
    ) {
      return null;
    }

    return { faithfulness, relevance, completeness };
  } catch {
    return null;
  }
}
