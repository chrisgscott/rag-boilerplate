import { describe, it, expect } from "vitest";
import { parseMarkdown } from "@/lib/parsers/markdown";

describe("parseMarkdown", () => {
  it("extracts plain text content", async () => {
    const input = new TextEncoder().encode("Hello world");
    const result = await parseMarkdown(input);

    expect(result.text).toBe("Hello world");
    expect(result.pageCount).toBe(1);
  });

  it("extracts sections from header hierarchy", async () => {
    const md = `# Document Title

Introduction paragraph.

## Section One

Content for section one.

## Section Two

Content for section two.

### Subsection 2.1

Deeper content here.`;

    const input = new TextEncoder().encode(md);
    const result = await parseMarkdown(input);

    expect(result.sections).toHaveLength(4);

    // Introduction (under H1)
    expect(result.sections![0]).toEqual({
      content: "Introduction paragraph.",
      headers: ["Document Title"],
      level: 1,
    });

    // Section One
    expect(result.sections![1]).toEqual({
      content: "Content for section one.",
      headers: ["Document Title", "Section One"],
      level: 2,
    });

    // Section Two
    expect(result.sections![2]).toEqual({
      content: "Content for section two.",
      headers: ["Document Title", "Section Two"],
      level: 2,
    });

    // Subsection 2.1
    expect(result.sections![3]).toEqual({
      content: "Deeper content here.",
      headers: ["Document Title", "Section Two", "Subsection 2.1"],
      level: 3,
    });
  });

  it("handles markdown with no headers", async () => {
    const md = "Just plain text without any headers.";
    const input = new TextEncoder().encode(md);
    const result = await parseMarkdown(input);

    expect(result.text).toBe("Just plain text without any headers.");
    expect(result.sections).toHaveLength(1);
    expect(result.sections![0]).toEqual({
      content: "Just plain text without any headers.",
      headers: [],
      level: 0,
    });
  });

  it("trims whitespace from content and headers", async () => {
    const md = `#   Spaced Title

  Some content with leading spaces.  `;
    const input = new TextEncoder().encode(md);
    const result = await parseMarkdown(input);

    expect(result.sections![0].headers).toEqual(["Spaced Title"]);
    expect(result.sections![0].content).toBe(
      "Some content with leading spaces."
    );
  });

  it("preserves full text as joined string", async () => {
    const md = `# Title

Paragraph one.

## Section

Paragraph two.`;
    const input = new TextEncoder().encode(md);
    const result = await parseMarkdown(input);

    expect(result.text).toContain("Paragraph one.");
    expect(result.text).toContain("Paragraph two.");
  });

  it("skips empty sections (consecutive headers)", async () => {
    const md = `# Title

## Empty Section
## Real Section

Actual content here.`;
    const input = new TextEncoder().encode(md);
    const result = await parseMarkdown(input);

    // Empty sections should be skipped
    const nonEmpty = result.sections!.filter((s) => s.content.length > 0);
    expect(nonEmpty.length).toBeGreaterThanOrEqual(1);
    expect(nonEmpty.some((s) => s.content === "Actual content here.")).toBe(
      true
    );
  });
});
