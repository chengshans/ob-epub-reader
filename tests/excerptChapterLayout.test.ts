import { describe, expect, it } from "vitest";
import { TOC_PATH_SEP } from "../src/ChapterResolver";
import {
  buildChapterTocMarkdown,
  buildGroupedAnnotationBody,
  CHAPTER_BODY_END,
  CHAPTER_BODY_START,
  CHAPTER_TOC_END,
  CHAPTER_TOC_START,
  composeExcerptContent,
  EXCERPT_CHUNK_SEPARATOR,
  extractAnnotationBlocksWithContext,
  extractChapterFromSegment,
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

describe("extractAnnotationBlocksWithContext", () => {
  it("inherits chapter heading for blocks after --- in same chapter", () => {
    const content = [
      "<!-- ob-epub-chapter-body-start -->",
      "## 语言的萎缩",
      "",
      "> [!ob-epub|yellow] 第一条",
      "",
      "---",
      "",
      "第二条正文[[books/demo.epub#cfi=/6/20!/4/2/1:0&end=/6/20!/4/2/1:10|原文]]",
      "",
      "<!-- ob-epub-chapter-body-end -->",
    ].join("\n");

    const blocks = extractAnnotationBlocksWithContext(content);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].contextChapter).toBe("语言的萎缩");
    expect(blocks[1].contextChapter).toBe("语言的萎缩");
  });

  it("resolves nested ## / ### headings into a path key", () => {
    const content = [
      CHAPTER_BODY_START,
      "## Chapter5 城市多少盏灯",
      "",
      "### 1/",
      "",
      "> [!ob-epub|yellow] 第一节",
      "",
      "---",
      "",
      "### 2/",
      "",
      "第二节正文[[books/demo.epub#cfi=/6/20!/4/2/1:0&end=/6/20!/4/2/1:10|原文]]",
      "",
      CHAPTER_BODY_END,
    ].join("\n");

    const blocks = extractAnnotationBlocksWithContext(content);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].contextChapter).toBe(`Chapter5 城市多少盏灯${TOC_PATH_SEP}1/`);
    expect(blocks[1].contextChapter).toBe(`Chapter5 城市多少盏灯${TOC_PATH_SEP}2/`);
  });

  it("parses legacy flat ## Chapter › leaf as a single path key", () => {
    const flat = `Chapter5 城市多少盏灯${TOC_PATH_SEP}1/`;
    const content = [
      CHAPTER_BODY_START,
      `## ${flat}`,
      "",
      "> [!ob-epub|yellow] 旧扁平",
      "",
      "---",
      "",
      "同章第二条[[books/demo.epub#cfi=/6/20!/4/2/1:0&end=/6/20!/4/2/1:10|原文]]",
      "",
      CHAPTER_BODY_END,
    ].join("\n");

    const blocks = extractAnnotationBlocksWithContext(content);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].contextChapter).toBe(flat);
    expect(blocks[1].contextChapter).toBe(flat);
  });
});

describe("extractChapterFromSegment", () => {
  it("joins nested headings with TOC_PATH_SEP", () => {
    const segment = ["## Chapter5 城市多少盏灯", "", "### 1/", "", "body"].join("\n");
    expect(extractChapterFromSegment(segment)).toBe(`Chapter5 城市多少盏灯${TOC_PATH_SEP}1/`);
  });

  it("keeps legacy flat titles that already contain the separator", () => {
    const flat = `Chapter5 城市多少盏灯${TOC_PATH_SEP}1/`;
    expect(extractChapterFromSegment(`## ${flat}\n\nbody`)).toBe(flat);
  });
});

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

  it("uses numeric CFI spine order so Chapter16 sorts after Chapter3", () => {
    const ch1 = `Chapter1 山野${TOC_PATH_SEP}2/`;
    const ch3 = `Chapter3 做梦${TOC_PATH_SEP}2/`;
    const ch4 = `Chapter4 少女${TOC_PATH_SEP}2/`;
    const ch16 = `Chapter16 我爱你${TOC_PATH_SEP}2/`;
    const groups = groupAnnotationsByChapter([
      makeAnn({ id: "a16", chapter: ch16, cfiRange: "epubcfi(/6/16!/4/2,/1:0,/1:10)" }),
      makeAnn({ id: "a1", chapter: ch1, cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:10)" }),
      makeAnn({ id: "a4", chapter: ch4, cfiRange: "epubcfi(/6/6!/4/2,/1:0,/1:10)" }),
      makeAnn({ id: "a3", chapter: ch3, cfiRange: "epubcfi(/6/4!/4/2,/1:0,/1:10)" }),
    ]);
    const sorted = sortChapterNames([...groups.keys()], groups);
    expect(sorted).toEqual([ch1, ch3, ch4, ch16]);
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

  it("nests TOC and wikilinks only unique titles", () => {
    const ch5 = "Chapter5 城市多少盏灯";
    const ch6 = "Chapter6 别处";
    const md = buildChapterTocMarkdown(
      [`${ch5}${TOC_PATH_SEP}1/`, `${ch5}${TOC_PATH_SEP}2/`, `${ch6}${TOC_PATH_SEP}1/`],
      new Map([
        [`${ch5}${TOC_PATH_SEP}1/`, 1],
        [`${ch5}${TOC_PATH_SEP}2/`, 1],
        [`${ch6}${TOC_PATH_SEP}1/`, 1],
      ])
    );
    expect(md).toContain(`- [[#${ch5}|${ch5}]]（2）`);
    expect(md).toContain(`- [[#${ch6}|${ch6}]]（1）`);
    expect(md).toContain("  - 1/（1）");
    expect(md).toContain("  - [[#2/|2/]]（1）");
    expect(md).not.toContain("[[#1/|1/]]");
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
    expect(body).toContain(EXCERPT_CHUNK_SEPARATOR);
  });

  it("writes nested ## / ### and only emits changed heading levels", () => {
    const ch5 = "Chapter5 城市多少盏灯";
    const body = buildGroupedAnnotationBody(
      [
        makeAnn({ id: "ann-1", chapter: `${ch5}${TOC_PATH_SEP}1/`, cfiRange: CFI_A }),
        makeAnn({ id: "ann-2", chapter: `${ch5}${TOC_PATH_SEP}2/`, cfiRange: CFI_B }),
      ],
      (ann) => `BLOCK:${ann.id}`
    );
    expect(body).toContain(`## ${ch5}`);
    expect(body).toContain("### 1/");
    expect(body).toContain("### 2/");
    expect(body.match(new RegExp(`## ${ch5.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"))).toHaveLength(1);
    expect(body.indexOf(`## ${ch5}`)).toBeLessThan(body.indexOf("### 1/"));
    expect(body.indexOf("### 1/")).toBeLessThan(body.indexOf("BLOCK:ann-1"));
    expect(body.indexOf("BLOCK:ann-1")).toBeLessThan(body.indexOf("### 2/"));
    expect(body.indexOf("### 2/")).toBeLessThan(body.indexOf("BLOCK:ann-2"));
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
