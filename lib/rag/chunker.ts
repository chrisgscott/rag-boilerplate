export type Chunk = {
  content: string;
  index: number;
  tokenCount: number;
};

export type ChunkOptions = {
  /** Target max tokens per chunk (default: 512) */
  maxTokens: number;
  /** Overlap ratio between consecutive chunks, 0-1 (default: 0.15) */
  overlap: number;
  /** Document title to prepend as context */
  documentTitle?: string;
  /** Section header to prepend as context */
  sectionHeader?: string;
};

/**
 * Approximate token count using char/4 heuristic.
 * Good enough for text-embedding-3-small; swap for tiktoken if precision needed.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split text at paragraph boundaries (double newline).
 */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Split text at sentence boundaries.
 */
function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by space or end
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g);
  if (!sentences) return [text];
  return sentences.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Recursively split a segment that exceeds maxTokens.
 * Priority: paragraphs → sentences → hard split at word boundary.
 */
function splitSegment(text: string, maxTokens: number): string[] {
  if (estimateTokens(text) <= maxTokens) {
    return [text];
  }

  // Try paragraph split first
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length > 1) {
    return mergeSegments(paragraphs, maxTokens);
  }

  // Try sentence split
  const sentences = splitSentences(text);
  if (sentences.length > 1) {
    return mergeSegments(sentences, maxTokens);
  }

  // Hard split at word boundary as last resort
  const words = text.split(/\s+/);
  return mergeSegments(words, maxTokens);
}

/**
 * Greedily merge small segments into chunks up to maxTokens.
 * Recursively split any individual segment that's still too large.
 */
function mergeSegments(segments: string[], maxTokens: number): string[] {
  const result: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const segment of segments) {
    const segTokens = estimateTokens(segment);

    // If a single segment exceeds maxTokens, recursively split it
    if (segTokens > maxTokens) {
      // Flush current buffer
      if (current.length > 0) {
        result.push(current.join(" "));
        current = [];
        currentTokens = 0;
      }
      // Recursively split the large segment
      const subChunks = splitSegment(segment, maxTokens);
      result.push(...subChunks);
      continue;
    }

    // Adding this segment would exceed limit — flush and start new chunk
    if (currentTokens + segTokens > maxTokens && current.length > 0) {
      result.push(current.join(" "));
      current = [];
      currentTokens = 0;
    }

    current.push(segment);
    currentTokens += segTokens;
  }

  if (current.length > 0) {
    result.push(current.join(" "));
  }

  return result;
}

/**
 * Apply overlap: take the last `overlapTokens` worth of text from the
 * previous chunk and prepend it to the current chunk.
 */
function applyOverlap(
  chunks: string[],
  overlapRatio: number,
  maxTokens: number
): string[] {
  if (chunks.length <= 1 || overlapRatio <= 0) return chunks;

  const overlapTokens = Math.floor(maxTokens * overlapRatio);
  const result: string[] = [chunks[0]];

  for (let i = 1; i < chunks.length; i++) {
    const prevWords = chunks[i - 1].split(/\s+/);
    // Take last N words that approximate overlapTokens
    let overlapText = "";
    const words: string[] = [];
    for (let j = prevWords.length - 1; j >= 0; j--) {
      const candidate = [prevWords[j], ...words].join(" ");
      if (estimateTokens(candidate) > overlapTokens) break;
      words.unshift(prevWords[j]);
      overlapText = candidate;
    }

    if (overlapText.length > 0) {
      result.push(overlapText + " " + chunks[i]);
    } else {
      result.push(chunks[i]);
    }
  }

  return result;
}

/**
 * Build the context prefix from document title and section header.
 */
function buildPrefix(
  documentTitle?: string,
  sectionHeader?: string
): string {
  const parts: string[] = [];
  if (documentTitle) parts.push(documentTitle);
  if (sectionHeader) parts.push(sectionHeader);
  if (parts.length === 0) return "";
  return parts.join(" > ") + "\n\n";
}

/**
 * Chunk text using recursive splitting strategy.
 *
 * Splits at paragraph boundaries first, then sentence boundaries,
 * then word boundaries. Applies overlap between consecutive chunks.
 * Optionally prepends document title and section header as context.
 */
export function chunkText(text: string, options: ChunkOptions): Chunk[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const prefix = buildPrefix(options.documentTitle, options.sectionHeader);
  const prefixTokens = estimateTokens(prefix);
  const contentMaxTokens = options.maxTokens - prefixTokens;

  // Reserve space for overlap so chunks stay within maxTokens after overlap is applied
  const overlapBudget = Math.floor(contentMaxTokens * options.overlap);
  const splitTarget = contentMaxTokens - overlapBudget;

  // Split into raw chunks (smaller to leave room for overlap)
  let rawChunks = splitSegment(trimmed, splitTarget);

  // Apply overlap (prepend tail of previous chunk to each subsequent chunk)
  rawChunks = applyOverlap(rawChunks, options.overlap, contentMaxTokens);

  // Build final chunks with prefix and metadata
  return rawChunks.map((content, index) => {
    const fullContent = prefix + content;
    return {
      content: fullContent,
      index,
      tokenCount: estimateTokens(fullContent),
    };
  });
}
