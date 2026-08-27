import { describe, expect, it } from "vitest";
import {
  clampLetterSpacing,
  clampLineHeight,
  clampParagraphSpacing,
} from "../src/types";

describe("typography clamps", () => {
  it("avoids floating-point display noise for line height", () => {
    expect(clampLineHeight(2.4)).toBe(2.4);
    expect(String(clampLineHeight(2.4))).toBe("2.4");
    expect(clampLineHeight(2.4000000000000004)).toBe(2.4);
    expect(clampLineHeight(1.7999999999999998)).toBe(1.8);
  });

  it("quantizes paragraph and letter spacing cleanly", () => {
    expect(clampParagraphSpacing(10.0000001)).toBe(10);
    expect(clampLetterSpacing(0.5)).toBe(0.5);
    expect(String(clampLetterSpacing(1.5000000000000002))).toBe("1.5");
  });
});
