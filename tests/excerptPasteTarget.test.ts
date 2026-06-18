import { describe, expect, it } from "vitest";
import { formatExcerptInsertSnippet } from "../src/ExcerptPasteTarget";

function mockEditor(lines: string[]) {
  return {
    getLine(line: number): string {
      return lines[line] ?? "";
    },
  };
}

describe("formatExcerptInsertSnippet", () => {
  const excerpt = "> [!ob-epub|yellow] [[book.epub#cfi=...|Chapter]]\n> Selected text";

  it("inserts at document start without leading blank lines", () => {
    const result = formatExcerptInsertSnippet(excerpt, { line: 0, ch: 0 }, mockEditor([""]));
    expect(result).toBe(`${excerpt}\n\n`);
    expect(result.startsWith("\n\n")).toBe(false);
  });

  it("inserts after existing text on same line with leading blank lines", () => {
    const result = formatExcerptInsertSnippet(
      excerpt,
      { line: 2, ch: 5 },
      mockEditor(["# Title", "", "Some paragraph text"])
    );
    expect(result.startsWith("\n\n")).toBe(true);
    expect(result.endsWith("\n\n")).toBe(true);
    expect(result).toContain(excerpt);
  });

  it("inserts at start of non-first line without leading when line is empty", () => {
    const result = formatExcerptInsertSnippet(
      excerpt,
      { line: 1, ch: 0 },
      mockEditor(["# Title", ""])
    );
    expect(result.startsWith("\n\n")).toBe(false);
    expect(result.endsWith("\n\n")).toBe(true);
  });

  it("trims trailing whitespace from excerpt body", () => {
    const result = formatExcerptInsertSnippet(
      `${excerpt}   \n`,
      { line: 0, ch: 0 },
      mockEditor([""])
    );
    expect(result).toBe(`${excerpt}\n\n`);
  });
});
