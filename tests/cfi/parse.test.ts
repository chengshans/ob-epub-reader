import { describe, expect, it } from "vitest";
import { extractEpubCfiLiteral } from "../../src/cfi/cfiString";
import { parseCfi } from "../../src/cfi/parse";

describe("extractEpubCfiLiteral", () => {
  it("extracts range CFI with commas", () => {
    const text = "<!-- ob-epub-cfi: epubcfi(/6/4!/2,/1:0,/1:5) -->";
    expect(extractEpubCfiLiteral(text)).toBe("epubcfi(/6/4!/2,/1:0,/1:5)");
  });
});

describe("parseCfi", () => {
  it("parses point CFI", () => {
    const parsed = parseCfi("epubcfi(/6/4!/4/2/1:3)");
    expect(parsed?.base.steps.length).toBeGreaterThan(0);
    expect(parsed?.path.terminal?.offset).toBe(3);
    expect(parsed?.range).toBe(false);
  });
});
