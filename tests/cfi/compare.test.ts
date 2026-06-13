import { describe, expect, it } from "vitest";
import { compareCfi, isCfiAhead } from "../../src/cfi/compare";

describe("compareCfi", () => {
  it("orders later character offset after earlier in same path", () => {
    const a = "epubcfi(/6/4!/4/2/1:1)";
    const b = "epubcfi(/6/4!/4/2/1:9)";
    expect(compareCfi(a, b)).toBeLessThan(0);
    expect(isCfiAhead(a, b)).toBe(true);
  });
});
