import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  embedTexts,
  embedQuery,
  setEmbeddingClient,
  type EmbeddingClient,
} from "@/lib/rag/embedder";

function makeFakeEmbedding(dim = 1536): number[] {
  return Array.from({ length: dim }, () => Math.random());
}

function createMockClient() {
  const mockCreate = vi.fn();
  const client: EmbeddingClient = {
    embeddings: { create: mockCreate },
  };
  return { client, mockCreate };
}

describe("embedTexts", () => {
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const mock = createMockClient();
    mockCreate = mock.mockCreate;
    setEmbeddingClient(mock.client);
  });

  afterEach(() => {
    setEmbeddingClient(null);
  });

  it("returns embeddings for a batch of texts", async () => {
    const fakeEmbeddings = [makeFakeEmbedding(), makeFakeEmbedding()];
    mockCreate.mockResolvedValueOnce({
      data: [
        { embedding: fakeEmbeddings[0], index: 0 },
        { embedding: fakeEmbeddings[1], index: 1 },
      ],
      usage: { prompt_tokens: 20, total_tokens: 20 },
    });

    const results = await embedTexts(["Hello world", "Goodbye world"]);

    expect(results.embeddings).toHaveLength(2);
    expect(results.embeddings[0]).toEqual(fakeEmbeddings[0]);
    expect(results.embeddings[1]).toEqual(fakeEmbeddings[1]);
    expect(results.tokenCount).toBe(20);
  });

  it("calls OpenAI API with correct model and input", async () => {
    mockCreate.mockResolvedValueOnce({
      data: [{ embedding: makeFakeEmbedding(), index: 0 }],
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });

    await embedTexts(["Test input"]);

    expect(mockCreate).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: ["Test input"],
    });
  });

  it("handles large batches by splitting into sub-batches", async () => {
    const texts = Array.from({ length: 150 }, (_, i) => `Text ${i}`);

    mockCreate
      .mockResolvedValueOnce({
        data: Array.from({ length: 100 }, (_, i) => ({
          embedding: makeFakeEmbedding(),
          index: i,
        })),
        usage: { prompt_tokens: 500, total_tokens: 500 },
      })
      .mockResolvedValueOnce({
        data: Array.from({ length: 50 }, (_, i) => ({
          embedding: makeFakeEmbedding(),
          index: i,
        })),
        usage: { prompt_tokens: 250, total_tokens: 250 },
      });

    const results = await embedTexts(texts);

    expect(results.embeddings).toHaveLength(150);
    expect(results.tokenCount).toBe(750);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("returns empty result for empty input", async () => {
    const results = await embedTexts([]);

    expect(results.embeddings).toHaveLength(0);
    expect(results.tokenCount).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("propagates API errors", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Rate limit exceeded"));

    await expect(embedTexts(["test"])).rejects.toThrow("Rate limit exceeded");
  });
});

describe("embedQuery", () => {
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const mock = createMockClient();
    mockCreate = mock.mockCreate;
    setEmbeddingClient(mock.client);
  });

  afterEach(() => {
    setEmbeddingClient(null);
  });

  it("returns a single embedding for a query string", async () => {
    const fakeEmbedding = makeFakeEmbedding();
    mockCreate.mockResolvedValueOnce({
      data: [{ embedding: fakeEmbedding, index: 0 }],
      usage: { prompt_tokens: 5, total_tokens: 5 },
    });

    const result = await embedQuery("What is the pet policy?");

    expect(result.embedding).toEqual(fakeEmbedding);
    expect(result.tokenCount).toBe(5);
  });

  it("calls API with a single string input", async () => {
    mockCreate.mockResolvedValueOnce({
      data: [{ embedding: makeFakeEmbedding(), index: 0 }],
      usage: { prompt_tokens: 3, total_tokens: 3 },
    });

    await embedQuery("test query");

    expect(mockCreate).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: ["test query"],
    });
  });
});
