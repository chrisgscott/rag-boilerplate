import { parsePdf, type ParseResult } from "./pdf";

export type { ParseResult };

type ParserFn = (data: Uint8Array) => Promise<ParseResult>;

const PARSERS: Record<string, ParserFn> = {
  "application/pdf": parsePdf,
  "text/markdown": parseText,
  "text/plain": parseText,
};

/**
 * Plain text / markdown parser — text is returned as-is.
 */
async function parseText(data: Uint8Array): Promise<ParseResult> {
  const text = new TextDecoder().decode(data).trim();
  return { text, pageCount: 1 };
}

/**
 * Get the appropriate parser for a MIME type.
 * Throws if the MIME type is not supported.
 */
export function getParser(mimeType: string): ParserFn {
  const parser = PARSERS[mimeType];
  if (!parser) {
    throw new Error(`Unsupported MIME type: ${mimeType}`);
  }
  return parser;
}

/**
 * Parse a document buffer based on its MIME type.
 */
export async function parseDocument(
  data: Uint8Array,
  mimeType: string
): Promise<ParseResult> {
  const parser = getParser(mimeType);
  return parser(data);
}
