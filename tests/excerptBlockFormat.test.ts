import { describe, expect, it } from "vitest";
import {
  buildExcerptBlock,
  DEFAULT_EXCERPT_HIGHLIGHT_COLOR,
  highlightColorFromHex,
  isChunkInCurrentFormat,
  parseExcerptChunk,
} from "../src/excerptBlockFormat";
import { escapeWikiAlias, unescapeWikiAlias } from "../src/epubSubpath";
import { DEFAULT_SETTINGS, type Annotation, type SourceLinkFormat } from "../src/types";

const SAMPLE_CFI = "epubcfi(/6/14!/4/2,/1:0,/1:42)";
const EPUB_SOURCE = "epub-books/苦论 (E.M.齐奥朗) .epub";
const CREATED = "2026-06-17T18:29:31.000Z";
const CHAPTER = "语言的萎缩";
const TEXT = "未实现的艺术家的魔力……一个失败者的魔力。";
const NOTE_TYPES = DEFAULT_SETTINGS.noteTypes;

function sampleAnn(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "ann-test001",
    cfiRange: SAMPLE_CFI,
    text: TEXT,
    color: "purple",
    chapter: CHAPTER,
    created: CREATED,
    ...overrides,
  };
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function roundTrip(format: SourceLinkFormat, ann = sampleAnn()) {
  const built = buildExcerptBlock(ann, EPUB_SOURCE, format, formatDate);
  const parsed = parseExcerptChunk(built, EPUB_SOURCE, NOTE_TYPES);
  return { built, parsed };
}

describe("excerptBlockFormat", () => {
  it("round-trips callout-title format", () => {
    const { parsed } = roundTrip("callout-title");
    expect(parsed?.text).toBe(TEXT);
    expect(parsed?.color).toBe("purple");
    expect(parsed?.chapter).toBe(CHAPTER);
    expect(parsed?.cfiRange).toBe(SAMPLE_CFI);
  });

  it("round-trips inline-suffix with configured default color", () => {
    const { parsed } = roundTrip("inline-suffix");
    expect(parsed?.color).toBe(DEFAULT_EXCERPT_HIGHLIGHT_COLOR);

    const built = buildExcerptBlock(sampleAnn(), EPUB_SOURCE, "inline-suffix", formatDate);
    const withPurple = parseExcerptChunk(built, EPUB_SOURCE, NOTE_TYPES, { defaultColor: "purple" });
    expect(withPurple?.color).toBe("purple");
  });

  it("round-trips inline-colored format preserving color", () => {
    for (const color of ["yellow", "red", "green", "blue", "purple"] as const) {
      const { parsed } = roundTrip("inline-colored", sampleAnn({ color }));
      expect(parsed?.color).toBe(color);
      expect(parsed?.text).toBe(TEXT);
    }
  });

  it("round-trips wiki-text-alias format with yellow color", () => {
    const { parsed } = roundTrip("wiki-text-alias");
    expect(parsed?.text).toBe(TEXT);
    expect(parsed?.color).toBe(DEFAULT_EXCERPT_HIGHLIGHT_COLOR);
    expect(parsed?.cfiRange).toBe(SAMPLE_CFI);
  });

  it("merges multiline text into single-line wiki alias", () => {
    const ann = sampleAnn({ text: "第一行\n第二行" });
    const built = buildExcerptBlock(ann, EPUB_SOURCE, "wiki-text-alias", formatDate);
    expect(built).toContain("第一行 第二行");
    expect(built).not.toContain("\n第一行");
  });

  it("escapes pipe and bracket in wiki alias", () => {
    expect(escapeWikiAlias("a|b]c")).toBe("a\\|b\\]c");
    expect(unescapeWikiAlias("a\\|b\\]c")).toBe("a|b]c");
    const ann = sampleAnn({ text: "含|竖线]括号" });
    const { parsed } = roundTrip("wiki-text-alias", ann);
    expect(parsed?.text).toBe("含|竖线]括号");
  });

  it("round-trips note section for all formats", () => {
    const ann = sampleAnn({ note: "我的想法", noteType: "inspiration" });
    for (const format of [
      "callout-title",
      "inline-suffix",
      "inline-colored",
      "wiki-text-alias",
    ] as const) {
      const { parsed } = roundTrip(format, ann);
      expect(parsed?.note).toBe("我的想法");
      expect(parsed?.noteType).toBe("inspiration");
    }
  });

  it("isChunkInCurrentFormat is idempotent per format", () => {
    const ann = sampleAnn();
    for (const format of [
      "callout-title",
      "inline-suffix",
      "inline-colored",
      "wiki-text-alias",
    ] as const) {
      const built = buildExcerptBlock(ann, EPUB_SOURCE, format, formatDate);
      expect(isChunkInCurrentFormat(built, ann, EPUB_SOURCE, format, formatDate)).toBe(true);
    }
  });

  it("salvages quote from corrupted wiki alias", () => {
    const corrupt = [
      "[[books/demo.epub#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42|",
      "<!-- ob-epub-chapter-toc-start --> ## 章节目录",
      '<span style="color: #e0533d ;">我之所以活着。</span>]]',
    ].join("");
    const ann = parseExcerptChunk(corrupt, EPUB_SOURCE, DEFAULT_SETTINGS.noteTypes);
    expect(ann?.text).toBe("我之所以活着。");
  });
});
