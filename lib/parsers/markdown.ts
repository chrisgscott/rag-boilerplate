import type { ParseResult } from "./pdf";

export type Section = {
  content: string;
  headers: string[];
  level: number;
};

export type MarkdownParseResult = ParseResult & {
  sections: Section[];
};

const HEADER_RE = /^(#{1,6})\s+(.+)$/;

/**
 * Parse markdown content, extracting text and header hierarchy.
 *
 * Returns the full text plus an array of sections, each annotated
 * with its header breadcrumb trail (e.g. ["Title", "Section", "Subsection"]).
 */
export async function parseMarkdown(
  data: Uint8Array
): Promise<MarkdownParseResult> {
  const raw = new TextDecoder().decode(data).trim();

  const lines = raw.split("\n");

  // Track the current header stack: index = header level (1-6), value = header text
  const headerStack: string[] = [];
  const sections: Section[] = [];
  let currentContent: string[] = [];
  let currentLevel = 0;

  function flushSection() {
    const content = currentContent
      .join("\n")
      .trim();
    if (content.length > 0) {
      sections.push({
        content,
        headers: [...headerStack],
        level: currentLevel,
      });
    }
    currentContent = [];
  }

  for (const line of lines) {
    const match = line.match(HEADER_RE);
    if (match) {
      // Flush any accumulated content before this header
      flushSection();

      const level = match[1].length;
      const title = match[2].trim();

      // Truncate the header stack to the parent level, then set current
      headerStack.length = level - 1;
      headerStack[level - 1] = title;
      currentLevel = level;
    } else {
      currentContent.push(line);
    }
  }

  // Flush remaining content
  flushSection();

  // If no sections were created (no headers at all), create one section
  if (sections.length === 0 && raw.length > 0) {
    sections.push({
      content: raw,
      headers: [],
      level: 0,
    });
  }

  return {
    text: raw,
    pageCount: 1,
    sections,
  };
}
