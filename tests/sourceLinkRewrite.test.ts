import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { AnnotationVaultStore } from "../src/AnnotationVaultStore";
import { buildCalloutHeaderLine } from "../src/excerptHeader";
import { DEFAULT_SETTINGS, type EpubPluginSettings } from "../src/types";

import { LEGACY_GOTO_WIKI_LINK_RE } from "../src/epubSubpath";

const SAMPLE_CFI = "epubcfi(/6/14!/4/2,/1:0,/1:42)";
const CALIBRE_CFI = "epubcfi(/6/50!/4/2[calibre_pb_0]/14,/1:3,/1:118)";
const ANN_ID = "ann-test001";
const EPUB_SOURCE = "books/demo.epub";
const CALIBRE_EPUB = "epub-books/最小阻力之路 (罗伯特·弗里茨).epub";
const CREATED = "2026-05-23T18:15:42.000Z";
const CHAPTER = "第三章";

function countLegacyGotoLinks(chunk: string): number {
  const md = chunk.match(/\[回到原文\]\([^)\n]+\)/g)?.length ?? 0;
  const wiki = chunk.match(LEGACY_GOTO_WIKI_LINK_RE)?.length ?? 0;
  return md + wiki;
}

function countCfiComments(chunk: string): number {
  return chunk.match(/<!--\s*ob-epub-cfi:/g)?.length ?? 0;
}

function expectedBlockRefHeader(): string {
  return buildCalloutHeaderLine(
    {
      id: ANN_ID,
      cfiRange: SAMPLE_CFI,
      text: "摘录正文",
      color: "yellow",
      chapter: CHAPTER,
      created: CREATED,
    },
    EPUB_SOURCE,
    "block-ref",
    () => "2026-05-23 18:15:42"
  );
}

function makeSampleChunk(opts: {
  links?: string[];
  note?: string;
  cfiComment?: boolean;
}): string {
  const lines = [
    `> [!ob-epub|yellow] ${CHAPTER} · 2026-05-23 18:15:42 ^${ANN_ID}`,
    "> 摘录正文第一行",
    "> 摘录正文第二行",
    "",
  ];
  if (opts.note) {
    lines.push(opts.note, "");
  }
  if (opts.cfiComment) {
    lines.push(`<!-- ob-epub-cfi: ${SAMPLE_CFI} -->`);
  }
  if (opts.links) {
    lines.push(...opts.links);
  }
  return lines.join("\n");
}

function createStore(sourceLinkFormat: EpubPluginSettings["sourceLinkFormat"]): AnnotationVaultStore {
  return new AnnotationVaultStore({} as App, {
    ...DEFAULT_SETTINGS,
    sourceLinkFormat,
  });
}

describe("rewriteGotoLinksToCurrentFormat", () => {
  it("converts wiki title link without ^ann-id to block-ref title", () => {
    const store = createStore("block-ref");
    const chunk = [
      "> [!ob-epub|green] [[epub-books/苦论 (E.M.齐奥朗) .epub#cfi=/6/6!/4/2/10/1:0&end=/6/6!/4/2/10/1:44|语言的萎缩 · 2026-06-15 18:32:00]]",
      "> 有浩繁的卷帙作为我们的情感之源",
    ].join("\n");
    const result = store.rewriteGotoLinksToCurrentFormat(
      chunk,
      "epub-books/苦论 (E.M.齐奥朗) .epub"
    );

    expect(countLegacyGotoLinks(result)).toBe(0);
    expect(result).not.toMatch(/\[\[.*\.epub#cfi=/);
    expect(result).toContain("[语言的萎缩 · 2026-06-15 18:32:00](#^ann-");
    expect(result).toContain("^ann-");
    expect(countCfiComments(result)).toBe(1);
  });

  it("converts legacy wiki-only link to title wiki link", () => {
    const store = createStore("wiki-link");
    const chunk = makeSampleChunk({
      links: [`[[${EPUB_SOURCE}#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42|回到原文]]`],
    });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(countLegacyGotoLinks(result)).toBe(0);
    expect(result).toContain(`[[${EPUB_SOURCE}#cfi=`);
    expect(result).toContain(`${CHAPTER} · 2026-05-23 18:15:42]] ^${ANN_ID}`);
    expect(result).toMatch(/^>\s*\[!ob-epub\|yellow\]\s+\[\[/m);
    expect(countCfiComments(result)).toBe(0);
  });

  it("converts legacy block-ref to title block-ref with CFI comment", () => {
    const store = createStore("block-ref");
    const chunk = makeSampleChunk({
      cfiComment: true,
      links: [`[回到原文](#^${ANN_ID})`],
    });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(countLegacyGotoLinks(result)).toBe(0);
    expect(result).toContain(expectedBlockRefHeader());
    expect(countCfiComments(result)).toBe(1);
  });

  it("removes wiki link with calibre CFI brackets when converting to block-ref title", () => {
    const store = createStore("block-ref");
    const wikiLink =
      `[[${CALIBRE_EPUB}#cfi=/6/50!/4/2[calibre_pb_0]/14/1:3&end=/6/50!/4/2[calibre_pb_0]/14/1:118&chapter=第一部分&color=red|回到原文]]`;
    const chunk = makeSampleChunk({ links: [wikiLink] });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, CALIBRE_EPUB);

    expect(countLegacyGotoLinks(result)).toBe(0);
    expect(result).not.toContain("[[");
    expect(result).toContain("[calibre_pb_0]");
    expect(countCfiComments(result)).toBe(1);
  });

  it("deduplicates double legacy markdown links when converting to block-ref title", () => {
    const store = createStore("block-ref");
    const chunk = makeSampleChunk({
      cfiComment: true,
      links: [
        `[回到原文](#^${ANN_ID})`,
        `[回到原文](obsidian://ob-epub-goto?file=books%2Fdemo.epub&cfi=${encodeURIComponent(SAMPLE_CFI)})`,
      ],
    });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(countLegacyGotoLinks(result)).toBe(0);
    expect(result).toContain(expectedBlockRefHeader());
  });

  it("removes callout-prefixed legacy link and uses title block-ref", () => {
    const store = createStore("block-ref");
    const chunk = [
      `> [!ob-epub|yellow] ${CHAPTER} · 2026-05-23 18:15:42 ^${ANN_ID}`,
      "> 摘录正文",
      `> [回到原文](#^${ANN_ID})`,
      "",
      `<!-- ob-epub-cfi: ${SAMPLE_CFI} -->`,
      `[回到原文](#^${ANN_ID})`,
    ].join("\n");
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(countLegacyGotoLinks(result)).toBe(0);
    expect(result).not.toMatch(/^>\s*\[回到原文\]/m);
    expect(result).toContain(expectedBlockRefHeader());
  });

  it("wraps block-ref metadata with blank lines (CFI comment only)", () => {
    const store = createStore("block-ref");
    const chunk = makeSampleChunk({ note: "想法文字", links: [`[回到原文](#^${ANN_ID})`] });
    chunk.concat(`\n<!-- ob-epub-cfi: ${SAMPLE_CFI} -->`);
    const result = store.rewriteGotoLinksToCurrentFormat(
      `${chunk}\n<!-- ob-epub-cfi: ${SAMPLE_CFI} -->\n[回到原文](#^${ANN_ID})`,
      EPUB_SOURCE
    );

    expect(result).toMatch(/想法文字\n\n<!-- ob-epub-cfi:/);
    expect(result).toMatch(/<!-- ob-epub-cfi:[^\n]+$/);
    expect(countLegacyGotoLinks(result)).toBe(0);
  });

  it("converts legacy block-ref to title wiki link", () => {
    const store = createStore("wiki-link");
    const chunk = makeSampleChunk({
      cfiComment: true,
      links: [`[回到原文](#^${ANN_ID})`],
    });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(countLegacyGotoLinks(result)).toBe(0);
    expect(result).toMatch(/^>\s*\[!ob-epub\|yellow\]\s+\[\[books\/demo\.epub#cfi=/m);
    expect(result).toContain(`${CHAPTER} · 2026-05-23 18:15:42]] ^${ANN_ID}`);
    expect(countCfiComments(result)).toBe(0);
  });

  it("converts verbose legacy wiki link to title wiki link", () => {
    const store = createStore("wiki-link");
    const verbose =
      `[[${EPUB_SOURCE}#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42&text=abc&chapter=第三章&color=yellow|回到原文]]`;
    const chunk = makeSampleChunk({ links: [verbose] });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(countLegacyGotoLinks(result)).toBe(0);
    expect(result).toContain(
      `[[books/demo.epub#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42|第三章 · 2026-05-23 18:15:42]] ^${ANN_ID}`
    );
    expect(result).not.toContain("&text=");
  });

  it("is idempotent for block-ref title format", () => {
    const store = createStore("block-ref");
    const once = store.rewriteGotoLinksToCurrentFormat(
      makeSampleChunk({ cfiComment: true, links: [`[回到原文](#^${ANN_ID})`] }),
      EPUB_SOURCE
    );
    const twice = store.rewriteGotoLinksToCurrentFormat(once, EPUB_SOURCE);
    expect(twice).toBe(once);
  });

  it("appends title wiki link when note contains [回到原文] text without markdown link", () => {
    const store = createStore("wiki-link");
    const chunk = makeSampleChunk({
      note: "参见 [回到原文] 章节说明",
      cfiComment: true,
      links: [`[回到原文](#^${ANN_ID})`],
    });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(countLegacyGotoLinks(result)).toBe(0);
    expect(result).toContain("参见 [回到原文] 章节说明");
    expect(result).toMatch(/\[\[books\/demo\.epub#cfi=/);
  });

  it("leaves chunk unchanged when converting to wiki without epub-source", () => {
    const store = createStore("wiki-link");
    const chunk = makeSampleChunk({
      cfiComment: true,
      links: [`[回到原文](#^${ANN_ID})`],
    });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk);

    expect(result).toBe(chunk);
  });

  it("leaves chunk unchanged when converting to wiki without extractable CFI", () => {
    const store = createStore("wiki-link");
    const chunk = makeSampleChunk({
      links: [`[回到原文](#^${ANN_ID})`],
    });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(result).toBe(chunk);
  });
});
