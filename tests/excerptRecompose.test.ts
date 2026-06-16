import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { AnnotationVaultStore } from "../src/AnnotationVaultStore";
import {
  EXCERPT_CHUNK_SEPARATOR,
  CHAPTER_BODY_END,
  CHAPTER_TOC_START,
} from "../src/excerptChapterLayout";
import { DEFAULT_SETTINGS, type Annotation } from "../src/types";
import { buildCalloutHeaderLine } from "../src/excerptHeader";

const EPUB_SOURCE = "books/demo.epub";
const SAMPLE_CFI = "epubcfi(/6/14!/4/2,/1:0,/1:42)";
const CFI_B = "epubcfi(/6/20!/4/2,/1:0,/1:10)";

function createStore(): AnnotationVaultStore {
  return new AnnotationVaultStore({} as App, { ...DEFAULT_SETTINGS });
}

function makeFlatExcerpt(): string {
  return [
    "---",
    `epub-source: ${EPUB_SOURCE}`,
    "created: 2026-06-16",
    "---",
    "",
    "# 《demo》摘录",
    "",
    "> [!ob-epub|yellow] [语言的萎缩 · 2026-06-16 08:22:26](#^ann-1) ^ann-1",
    "> 第一条摘录",
    "",
    `<!-- ob-epub-cfi: ${SAMPLE_CFI} -->`,
    "",
    "---",
    "",
    "> [!ob-epub|purple] [时间与贫血 · 2026-06-16 11:03:10](#^ann-2) ^ann-2",
    "> 第二条摘录",
    "",
    `<!-- ob-epub-cfi: ${CFI_B} -->`,
    "",
    "---",
    "",
    "> [!note] AI 解读 · 2026-06-16 12:00:00",
    "> AI 回答内容",
    "",
    "---",
    "",
  ].join("\n");
}

function parseAnnotations(store: AnnotationVaultStore, content: string): Annotation[] {
  return store.parseContent(content, EPUB_SOURCE);
}

describe("recomposeExcerptFromContent", () => {
  it("regroups flat file into chapter TOC and sections", () => {
    const store = createStore();
    const flat = makeFlatExcerpt();
    const annotations = parseAnnotations(store, flat);
    const result = store.recomposeExcerptFromContent(flat, EPUB_SOURCE, annotations);

    expect(result).toContain("# 《demo》摘录");
    expect(result).toContain(CHAPTER_TOC_START);
    expect(result).toContain("## 章节目录");
    expect(result).toContain("- [[#语言的萎缩|语言的萎缩]]（1）");
    expect(result).toContain("- [[#时间与贫血|时间与贫血]]（1）");
    expect(result).toContain("## 语言的萎缩");
    expect(result).toContain("## 时间与贫血");
    expect(result).toContain(CHAPTER_BODY_END);
    expect(result.indexOf("## 语言的萎缩")).toBeLessThan(result.indexOf("## 时间与贫血"));
  });

  it("preserves title block-ref links and CFI comments", () => {
    const store = createStore();
    const flat = makeFlatExcerpt();
    const annotations = parseAnnotations(store, flat);
    const result = store.recomposeExcerptFromContent(flat, EPUB_SOURCE, annotations);

    const expected1 = buildCalloutHeaderLine(
      annotations.find((a) => a.id === "ann-1")!,
      EPUB_SOURCE,
      "block-ref",
      () => "2026-06-16 08:22:26"
    );
    expect(result).toContain(expected1);
    expect(result).not.toContain("[回到原文]");
    expect(result).toContain(`<!-- ob-epub-cfi: ${SAMPLE_CFI} -->`);
    expect(result).toContain(`<!-- ob-epub-cfi: ${CFI_B} -->`);
  });

  it("recomposed blocks use blank lines around --- separators", () => {
    const store = createStore();
    const flat = makeFlatExcerpt();
    const annotations = parseAnnotations(store, flat);
    const result = store.recomposeExcerptFromContent(flat, EPUB_SOURCE, annotations);
    expect(result).toContain(EXCERPT_CHUNK_SEPARATOR);
  });

  it("preserves AI suffix after regroup", () => {
    const store = createStore();
    const flat = makeFlatExcerpt();
    const annotations = parseAnnotations(store, flat);
    const result = store.recomposeExcerptFromContent(flat, EPUB_SOURCE, annotations);

    expect(result).toContain("[!note] AI 解读");
    expect(result).toContain("AI 回答内容");
    expect(result.indexOf("[!note] AI 解读")).toBeGreaterThan(result.indexOf(CHAPTER_BODY_END));
  });

  it("preserves suffix when one annotation is removed", () => {
    const store = createStore();
    const flat = makeFlatExcerpt();
    const annotations = parseAnnotations(store, flat);
    const remaining = annotations.filter((a) => a.id !== "ann-1");
    const result = store.recomposeExcerptFromContent(flat, EPUB_SOURCE, remaining);

    expect(result).not.toContain("^ann-1");
    expect(result).toContain("^ann-2");
    expect(result).toContain("[!note] AI 解读");
  });

  it("round-trips parse after recompose", () => {
    const store = createStore();
    const flat = makeFlatExcerpt();
    const annotations = parseAnnotations(store, flat);
    const result = store.recomposeExcerptFromContent(flat, EPUB_SOURCE, annotations);
    const reparsed = parseAnnotations(store, result);

    expect(reparsed).toHaveLength(2);
    expect(reparsed.map((a) => a.id).sort()).toEqual(["ann-1", "ann-2"]);
    expect(reparsed.find((a) => a.id === "ann-1")?.chapter).toBe("语言的萎缩");
  });
});
