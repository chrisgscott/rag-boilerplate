import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExperimentProposal, AgentContext } from "@/lib/rag/optimizer/agent";

// Mock the ai module before import
vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));
vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn().mockReturnValue("mock-model"),
}));

import { proposeExperiment } from "@/lib/rag/optimizer/agent";
import { generateObject } from "ai";

const mockGenerateObject = vi.mocked(generateObject);

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    currentConfig: {
      model: "claude-sonnet-4-5-20250514",
      topK: 5,
      similarityThreshold: 0.3,
      fullTextWeight: 1.0,
      semanticWeight: 1.0,
      rerankEnabled: false,
      rerankCandidateMultiplier: 4,
    },
    perCaseMetrics: [
      {
        testCaseId: "tc-1",
        question: "What is the late fee?",
        compositeScore: 0.9,
        precisionAtK: 1.0,
        recallAtK: 1.0,
        mrr: 1.0,
        faithfulness: 4.5,
        relevance: 4.5,
        completeness: 4.0,
      },
      {
        testCaseId: "tc-2",
        question: "Compare pet policies across buildings",
        compositeScore: 0.4,
        precisionAtK: 0.4,
        recallAtK: 0.6,
        mrr: 0.5,
        faithfulness: 2.0,
        relevance: 3.0,
        completeness: 2.0,
      },
    ],
    sessionHistory: [],
    cumulativeInsights: null,
    corpusFingerprint: { docCount: 10, chunkCount: 500, lastIngestedAt: "2026-03-01T00:00:00Z" },
    ...overrides,
  };
}

describe("proposeExperiment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a proposal with knob, value, reasoning, and hypothesis", async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        stop: false,
        knob: "topK",
        value: 8,
        reasoning: "Low recall on multi-hop questions suggests we need more candidates",
        hypothesis: "Increasing topK from 5 to 8 should improve recall on cases tc-2",
      },
    } as any);

    const result = await proposeExperiment(makeContext());
    expect(result).toEqual({
      stop: false,
      knob: "topK",
      value: 8,
      reasoning: expect.any(String),
      hypothesis: expect.any(String),
    });
  });

  it("returns stop=true when agent decides no improvements possible", async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        stop: true,
        knob: null,
        value: null,
        reasoning: "Last 3 experiments showed <0.5% improvement",
        hypothesis: null,
      },
    } as any);

    const result = await proposeExperiment(makeContext());
    expect(result.stop).toBe(true);
    expect(result.reasoning).toBeTruthy();
  });

  it("passes session history to the agent for context", async () => {
    const context = makeContext({
      sessionHistory: [
        {
          experimentIndex: 0,
          knob: "topK",
          valueTested: 8,
          delta: 0.05,
          status: "kept",
          reasoning: "More candidates helped recall",
        },
      ],
    });

    mockGenerateObject.mockResolvedValue({
      object: {
        stop: false,
        knob: "fullTextWeight",
        value: 1.3,
        reasoning: "topK helped, now try BM25 weight",
        hypothesis: "Increasing BM25 weight may help keyword-heavy queries",
      },
    } as any);

    await proposeExperiment(context);

    expect(mockGenerateObject).toHaveBeenCalledOnce();
    const callArgs = mockGenerateObject.mock.calls[0][0];
    expect(callArgs.prompt).toContain("topK");
    expect(callArgs.prompt).toContain("kept");
  });

  it("includes corpus fingerprint in the prompt", async () => {
    mockGenerateObject.mockResolvedValue({
      object: { stop: false, knob: "topK", value: 8, reasoning: "test", hypothesis: "test" },
    } as any);

    await proposeExperiment(makeContext());

    const callArgs = mockGenerateObject.mock.calls[0][0];
    expect(callArgs.prompt).toContain("10 documents");
    expect(callArgs.prompt).toContain("500 chunks");
  });

  it("includes cumulative insights when available", async () => {
    const context = makeContext({
      cumulativeInsights: {
        knobFindings: [
          { knob: "rerankEnabled", finding: "Not beneficial below 1000 chunks", testedCount: 3 },
        ],
      },
    });

    mockGenerateObject.mockResolvedValue({
      object: { stop: false, knob: "topK", value: 8, reasoning: "test", hypothesis: "test" },
    } as any);

    await proposeExperiment(context);

    const callArgs = mockGenerateObject.mock.calls[0][0];
    expect(callArgs.prompt).toContain("rerankEnabled");
    expect(callArgs.prompt).toContain("Not beneficial below 1000 chunks");
  });
});
