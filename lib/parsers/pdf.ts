import { extractText } from "unpdf";

export type ParseResult = {
  text: string;
  pageCount: number;
};

/**
 * Extract text from a PDF file.
 * Returns combined text from all pages and the page count.
 */
export async function parsePdf(data: Uint8Array): Promise<ParseResult> {
  const result = await extractText(data);

  const text = result.text
    .join("\n\n")
    .trim();

  return {
    text,
    pageCount: result.totalPages,
  };
}
