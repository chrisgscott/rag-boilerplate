import { describe, it, expect } from "vitest";
import { chunkText, type ChunkOptions, type Chunk } from "@/lib/rag/chunker";

describe("chunkText", () => {
  const defaults: ChunkOptions = {
    maxTokens: 512,
    overlap: 0.15,
  };

  it("returns a single chunk for short text", () => {
    const text = "This is a short paragraph.";
    const chunks = chunkText(text, defaults);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(text);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
  });

  it("splits long text into multiple chunks", () => {
    // Create text that's clearly longer than 512 tokens (~2048 chars)
    const paragraph = "The quick brown fox jumps over the lazy dog. ";
    const text = paragraph.repeat(100); // ~4500 chars ≈ 1125 tokens

    const chunks = chunkText(text, defaults);

    expect(chunks.length).toBeGreaterThan(1);
    // All chunks should have content
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });

  it("respects maxTokens limit on each chunk", () => {
    const paragraph = "The quick brown fox jumps over the lazy dog. ";
    const text = paragraph.repeat(100);

    const chunks = chunkText(text, { maxTokens: 100, overlap: 0.15 });

    for (const chunk of chunks) {
      // Allow 10% tolerance for boundary splitting
      expect(chunk.tokenCount).toBeLessThanOrEqual(110);
    }
  });

  it("creates overlap between consecutive chunks", () => {
    const sentences: string[] = [];
    for (let i = 0; i < 50; i++) {
      sentences.push(`Sentence number ${i} contains some content here.`);
    }
    const text = sentences.join(" ");

    const chunks = chunkText(text, { maxTokens: 100, overlap: 0.15 });

    if (chunks.length >= 2) {
      // Last portion of chunk N should appear at start of chunk N+1
      const firstEnd = chunks[0].content.slice(-50);
      const secondStart = chunks[1].content.slice(0, 100);
      // There should be some overlapping text
      const hasOverlap = firstEnd
        .split(" ")
        .some((word) => secondStart.includes(word));
      expect(hasOverlap).toBe(true);
    }
  });

  it("assigns sequential indexes", () => {
    const paragraph = "Some medium length content that will split. ";
    const text = paragraph.repeat(80);

    const chunks = chunkText(text, { maxTokens: 100, overlap: 0.15 });

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
    }
  });

  it("splits on paragraph boundaries first", () => {
    // Each paragraph is ~20 tokens, so 3 paragraphs won't fit in 25 tokens
    const text = `First paragraph with enough content to stand on its own as a complete unit of text here.

Second paragraph that is also substantial enough to warrant its own separate chunk of content.

Third paragraph with additional material here that rounds out the document content nicely.`;

    const chunks = chunkText(text, { maxTokens: 30, overlap: 0 });

    // Should produce multiple chunks, and at least one should start at a paragraph boundary
    expect(chunks.length).toBeGreaterThan(1);
    const startsWithParagraph = chunks.some(
      (c) =>
        c.content.startsWith("Second paragraph") ||
        c.content.startsWith("Third paragraph")
    );
    expect(startsWithParagraph).toBe(true);
  });

  it("splits on sentence boundaries when paragraphs are too large", () => {
    // One giant paragraph with multiple sentences
    const sentences = Array.from(
      { length: 30 },
      (_, i) => `This is sentence ${i} and it has a reasonable length.`
    );
    const text = sentences.join(" ");

    const chunks = chunkText(text, { maxTokens: 100, overlap: 0 });

    // Chunks should generally end at sentence boundaries (period + space)
    for (const chunk of chunks.slice(0, -1)) {
      // Last word should end with a period (sentence boundary)
      const trimmed = chunk.content.trim();
      expect(trimmed.endsWith(".")).toBe(true);
    }
  });

  it("handles empty text", () => {
    const chunks = chunkText("", defaults);
    expect(chunks).toHaveLength(0);
  });

  it("handles whitespace-only text", () => {
    const chunks = chunkText("   \n\n   ", defaults);
    expect(chunks).toHaveLength(0);
  });

  it("prepends header context when provided", () => {
    const text = "Some chunk content that needs context.";
    const chunks = chunkText(text, {
      ...defaults,
      documentTitle: "Lease Agreement",
      sectionHeader: "Section 5: Maintenance",
    });

    expect(chunks[0].content).toContain("Lease Agreement");
    expect(chunks[0].content).toContain("Section 5: Maintenance");
    expect(chunks[0].content).toContain(
      "Some chunk content that needs context."
    );
  });

  it("counts tokens using approximate tokenizer", () => {
    const text = "Hello world"; // ~2-3 tokens
    const chunks = chunkText(text, defaults);

    expect(chunks[0].tokenCount).toBeGreaterThanOrEqual(2);
    expect(chunks[0].tokenCount).toBeLessThanOrEqual(5);
  });
});
