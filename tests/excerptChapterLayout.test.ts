import { describe, expect, it } from "vitest";
import {
  buildChapterTocMarkdown,
  buildGroupedAnnotationBody,
  CHAPTER_BODY_END,
  CHAPTER_BODY_START,
  CHAPTER_TOC_END,
  CHAPTER_TOC_START,
  composeExcerptContent,
  extractExcerptPreamble,
  extractExcerptSuffix,
  groupAnnotationsByChapter,
  sortChapterNames,
  sortAnnotationsByCfi,
  UNKNOWN_CHAPTER,
} from "../src/excerptChapterLayout";
import type { Annotation } from "../src/types";

const CFI_A = "epubcfi(/6/10!/4/2,/1:0,/1:10)";
const CFI_B = "epubcfi(/6/20!/4/2,/1:0,/1:10)";
const CFI_C = "epubcfi(/6/30!/4/2,/1:0,/1:10)";

function makeAnn(overrides: Partial<Annotation> & Pick<Annotation, "id" | "chapter" | "cfiRange">): Annotation {
  return {
    text: "摘录正文",
    color: "yellow",
    created: "2026-06-16T08:00:00.000Z",
    ...overrides,
  };
}

describe("groupAnnotationsByChapter", () => {
  it("groups by chapter and normalizes empty to 未知章节", () => {
    const groups = groupAnnotationsByChapter([
      makeAnn({ id: "ann-1", chapter: "语言的萎缩", cfiRange: CFI_A }),
      makeAnn({ id: "ann-2", chapter: "语言的萎缩", cfiRange: CFI_B }),
      makeAnn({ id: "ann-3", chapter: "  ", cfiRange: CFI_C }),
    ]);
    expect(groups.get("语言的萎缩")?.length).toBe(2);
    expect(groups.get(UNKNOWN_CHAPTER)?.length).toBe(1);
  });
});

describe("sortChapterNames", () => {
  it("orders by TOC labels first, then CFI, with 未知章节 last", () => {
    const groups = groupAnnotationsByChapter([
      makeAnn({ id: "ann-1", chapter: UNKNOWN_CHAPTER, cfiRange: CFI_C }),
      makeAnn({ id: "ann-2", chapter: "时间与贫血", cfiRange: CFI_B }),
      makeAnn({ id: "ann-3", chapter: "语言的萎缩", cfiRange: CFI_A }),
    ]);
    const sorted = sortChapterNames(
      [...groups.keys()],
      groups,
      ["语言的萎缩", "时间与贫血"]
    );
    expect(sorted).toEqual(["语言的萎缩", "时间与贫血", UNKNOWN_CHAPTER]);
  });

  it("falls back to CFI order when TOC labels missing", () => {
    const groups = groupAnnotationsByChapter([
      makeAnn({ id: "ann-1", chapter: "第三章", cfiRange: CFI_B }),
      makeAnn({ id: "ann-2", chapter: "第一章", cfiRange: CFI_A }),
    ]);
    const sorted = sortChapterNames([...groups.keys()], groups);
    expect(sorted).toEqual(["第一章", "第三章"]);
  });
});

describe("buildChapterTocMarkdown", () => {
  it("generates wikilink TOC with counts", () => {
    const md = buildChapterTocMarkdown(
      ["语言的萎缩", "时间与贫血"],
      new Map([
        ["语言的萎缩", 2],
        ["时间与贫血", 1],
      ])
    );
    expect(md).toContain(CHAPTER_TOC_START);
    expect(md).toContain(CHAPTER_TOC_END);
    expect(md).toContain("- [[#语言的萎缩|语言的萎缩]]（2）");
    expect(md).toContain("- [[#时间与贫血|时间与贫血]]（1）");
  });
});

describe("buildGroupedAnnotationBody", () => {
  it("wraps grouped blocks with markers and chapter headings", () => {
    const body = buildGroupedAnnotationBody(
      [
        makeAnn({ id: "ann-2", chapter: "时间与贫血", cfiRange: CFI_B }),
        makeAnn({ id: "ann-1", chapter: "语言的萎缩", cfiRange: CFI_A }),
      ],
      (ann) => `BLOCK:${ann.id}\n---\n\n`,
      ["语言的萎缩", "时间与贫血"]
    );
    expect(body).toContain(CHAPTER_TOC_START);
    expect(body).toContain(CHAPTER_BODY_START);
    expect(body).toContain(CHAPTER_BODY_END);
    expect(body.indexOf("## 语言的萎缩")).toBeLessThan(body.indexOf("## 时间与贫血"));
    expect(body.indexOf("BLOCK:ann-1")).toBeLessThan(body.indexOf("BLOCK:ann-2"));
  });
});

describe("sortAnnotationsByCfi", () => {
  it("sorts annotations in reading order", () => {
    const sorted = sortAnnotationsByCfi([
      makeAnn({ id: "ann-2", chapter: "x", cfiRange: CFI_B }),
      makeAnn({ id: "ann-1", chapter: "x", cfiRange: CFI_A }),
    ]);
    expect(sorted.map((a) => a.id)).toEqual(["ann-1", "ann-2"]);
  });
});

describe("extractExcerptPreamble and suffix", () => {
  const flatContent = [
    "---",
    "epub-source: books/demo.epub",
    "---",
    "",
    "# 《demo》摘录",
    "",
    "> [!ob-epub|yellow] 第一章 · 2026-06-16 08:00:00 ^ann-1",
    "> 正文",
    "",
    "[回到原文](#^ann-1)",
    "",
    "---",
    "",
    "> [!note] AI 解读 · 2026-06-16 09:00:00",
    "> AI 内容",
    "",
    "---",
    "",
  ].join("\n");

  it("extracts preamble before first ob-epub block", () => {
    const pre = extractExcerptPreamble(flatContent);
    expect(pre).toContain("# 《demo》摘录");
    expect(pre).not.toContain("[!ob-epub");
  });

  it("extracts suffix after last ob-epub block including AI block", () => {
    const suffix = extractExcerptSuffix(flatContent);
    expect(suffix).toContain("[!note] AI 解读");
    expect(suffix).not.toContain("[!ob-epub");
  });

  it("extracts suffix after body-end marker", () => {
    const grouped = [
      "preamble",
      CHAPTER_BODY_END,
      "",
      "> [!note] AI 解读",
      "",
    ].join("\n");
    expect(extractExcerptSuffix(grouped)).toContain("[!note] AI 解读");
  });
});

describe("composeExcerptContent", () => {
  it("joins preamble, body, and suffix", () => {
    const result = composeExcerptContent(
      "# title\n",
      `${CHAPTER_TOC_START}\n## 章节目录\n${CHAPTER_TOC_END}`,
      "> [!note] AI\n"
    );
    expect(result).toContain("# title");
    expect(result).toContain("## 章节目录");
    expect(result).toContain("[!note] AI");
  });
});
