import { describe, expect, it } from "vitest";
import { compareCfi, compareCfiSpinePath, isCfiAhead } from "../../src/cfi/compare";

describe("compareCfiSpinePath", () => {
  it("orders /6/4 before /6/16 numerically (not as strings)", () => {
    expect(compareCfiSpinePath("/6/4", "/6/16")).toBeLessThan(0);
    expect(compareCfiSpinePath("/6/16", "/6/4")).toBeGreaterThan(0);
    expect(compareCfiSpinePath("/6/14", "/6/4")).toBeGreaterThan(0);
  });
});

describe("compareCfi", () => {
  it("orders later character offset after earlier in same path", () => {
    const a = "epubcfi(/6/4!/4/2/1:1)";
    const b = "epubcfi(/6/4!/4/2/1:9)";
    expect(compareCfi(a, b)).toBeLessThan(0);
    expect(isCfiAhead(a, b)).toBe(true);
  });

  it("orders spine /6/4 before /6/16 so Chapter3 sorts before Chapter16", () => {
    const ch3 = "epubcfi(/6/4!/4/2,/1:0,/1:10)";
    const ch4 = "epubcfi(/6/6!/4/2,/1:0,/1:10)";
    const ch16 = "epubcfi(/6/16!/4/2,/1:0,/1:10)";
    expect(compareCfi(ch3, ch16)).toBeLessThan(0);
    expect(compareCfi(ch4, ch16)).toBeLessThan(0);
    expect(compareCfi(ch3, ch4)).toBeLessThan(0);
  });
});
