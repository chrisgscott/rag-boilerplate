import { describe, it, expect } from "vitest";
import { parsePdf } from "@/lib/parsers/pdf";
import { readFileSync } from "fs";
import { join } from "path";

function loadFixture(name: string): Uint8Array {
  const buf = readFileSync(join(__dirname, "../fixtures", name));
  return new Uint8Array(buf);
}

describe("parsePdf", () => {
  it("extracts text from a single-page PDF", async () => {
    const data = loadFixture("sample.pdf");
    const result = await parsePdf(data);

    expect(result.text).toContain("Section 1: Introduction");
    expect(result.text).toContain("This is test content for the PDF parser.");
    expect(result.pageCount).toBe(1);
  });

  it("returns page count", async () => {
    const data = loadFixture("sample.pdf");
    const result = await parsePdf(data);

    expect(result.pageCount).toBeGreaterThan(0);
  });

  it("returns a single combined string (pages joined)", async () => {
    const data = loadFixture("sample.pdf");
    const result = await parsePdf(data);

    expect(typeof result.text).toBe("string");
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("trims whitespace from extracted text", async () => {
    const data = loadFixture("sample.pdf");
    const result = await parsePdf(data);

    expect(result.text).toBe(result.text.trim());
  });

  it("throws on invalid PDF data", async () => {
    const garbage = new Uint8Array([0, 1, 2, 3, 4]);
    await expect(parsePdf(garbage)).rejects.toThrow();
  });
});
