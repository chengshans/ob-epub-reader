import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { AnnotationVaultStore } from "../src/AnnotationVaultStore";
import { DEFAULT_SETTINGS, type EpubPluginSettings } from "../src/types";

import { GOTO_WIKI_LINK_RE } from "../src/epubSubpath";

const SAMPLE_CFI = "epubcfi(/6/14!/4/2,/1:0,/1:42)";
const CALIBRE_CFI = "epubcfi(/6/50!/4/2[calibre_pb_0]/14,/1:3,/1:118)";
const ANN_ID = "ann-test001";
const EPUB_SOURCE = "books/demo.epub";
const CALIBRE_EPUB = "epub-books/最小阻力之路 (罗伯特·弗里茨).epub";

function countSourceLinks(chunk: string): number {
  const md = chunk.match(/\[回到原文\]\([^)\n]+\)/g)?.length ?? 0;
  const wiki = chunk.match(GOTO_WIKI_LINK_RE)?.length ?? 0;
  return md + wiki;
}

function countCfiComments(chunk: string): number {
  return chunk.match(/<!--\s*ob-epub-cfi:/g)?.length ?? 0;
}

function makeSampleChunk(opts: {
  links?: string[];
  note?: string;
  cfiComment?: boolean;
}): string {
  const lines = [
    `> [!ob-epub|yellow] 第三章 · 2026-05-23 18:15:42 ^${ANN_ID}`,
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
  it("converts wiki-only link to block-ref with CFI comment", () => {
    const store = createStore("block-ref");
    const chunk = makeSampleChunk({
      links: [`[[${EPUB_SOURCE}#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42|回到原文]]`],
    });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(countSourceLinks(result)).toBe(1);
    expect(result).toContain(`[回到原文](#^${ANN_ID})`);
    expect(countCfiComments(result)).toBe(1);
    expect(result).not.toMatch(/^\[\[/m);
  });

  it("removes wiki link with calibre CFI brackets when converting to block-ref", () => {
    const store = createStore("block-ref");
    const wikiLink =
      `[[${CALIBRE_EPUB}#cfi=/6/50!/4/2[calibre_pb_0]/14/1:3&end=/6/50!/4/2[calibre_pb_0]/14/1:118&chapter=第一部分&color=red|回到原文]]`;
    const chunk = makeSampleChunk({ links: [wikiLink] });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, CALIBRE_EPUB);

    expect(countSourceLinks(result)).toBe(1);
    expect(result).not.toContain("[[");
    expect(result).toContain(`[回到原文](#^${ANN_ID})`);
    expect(result).toContain("[calibre_pb_0]");
  });

  it("deduplicates double markdown links when converting to block-ref", () => {
    const store = createStore("block-ref");
    const chunk = makeSampleChunk({
      cfiComment: true,
      links: [
        `[回到原文](#^${ANN_ID})`,
        `[回到原文](obsidian://ob-epub-goto?file=books%2Fdemo.epub&cfi=${encodeURIComponent(SAMPLE_CFI)})`,
      ],
    });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(countSourceLinks(result)).toBe(1);
    expect(result).toContain(`[回到原文](#^${ANN_ID})`);
  });

  it("removes callout-prefixed link and keeps a single block-ref outside", () => {
    const store = createStore("block-ref");
    const chunk = [
      `> [!ob-epub|yellow] 第三章 · 2026-05-23 18:15:42 ^${ANN_ID}`,
      "> 摘录正文",
      `> [回到原文](#^${ANN_ID})`,
      "",
      `[回到原文](#^${ANN_ID})`,
    ].join("\n");
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(countSourceLinks(result)).toBe(1);
    expect(result).not.toMatch(/^>\s*\[回到原文\]/m);
    expect(result).toMatch(/\n\[回到原文\]\(#\^ann-test001\)\n\n$/);
  });

  it("wraps source link block with blank lines (no blank between CFI comment and link)", () => {
    const store = createStore("block-ref");
    const chunk = makeSampleChunk({ note: "想法文字" });
    const result = store.rewriteGotoLinksToCurrentFormat(
      `${chunk}\n<!-- ob-epub-cfi: ${SAMPLE_CFI} -->\n[回到原文](#^${ANN_ID})`,
      EPUB_SOURCE
    );

    expect(result).toMatch(/想法文字\n\n<!-- ob-epub-cfi:/);
    expect(result).toMatch(/<!-- ob-epub-cfi:[^\n]+\n\[回到原文\]\(#\^ann-test001\)\n\n$/);
    expect(result).not.toMatch(/<!-- ob-epub-cfi:[\s\S]*?\n\n\[回到原文\]/);
  });

  it("wraps wiki link block with blank lines when converting to wiki-link", () => {
    const store = createStore("wiki-link");
    const chunk = makeSampleChunk({
      cfiComment: true,
      links: [`[回到原文](#^${ANN_ID})`],
    });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(result).toMatch(/摘录正文第二行\n\n\[\[books\/demo\.epub#cfi=/);
    expect(result).toMatch(/\|回到原文\]\]\n\n$/);
  });

  it("converts verbose wiki link to slim wiki link", () => {
    const store = createStore("wiki-link");
    const verbose =
      `[[${EPUB_SOURCE}#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42&text=abc&chapter=第三章&color=yellow|回到原文]]`;
    const chunk = makeSampleChunk({ links: [verbose] });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(countSourceLinks(result)).toBe(1);
    expect(result).toContain(
      "[[books/demo.epub#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42|回到原文]]"
    );
    expect(result).not.toContain("&text=");
    expect(result).not.toContain("&chapter=");
    expect(result).not.toContain("&color=");
  });

  it("converts block-ref with CFI comment to wiki link", () => {
    const store = createStore("wiki-link");
    const chunk = makeSampleChunk({
      cfiComment: true,
      links: [`[回到原文](#^${ANN_ID})`],
    });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(countSourceLinks(result)).toBe(1);
    expect(result).toMatch(/\n\n\[\[books\/demo\.epub#cfi=/);
    expect(result).toMatch(/\|回到原文\]\]\n\n$/);
    expect(countCfiComments(result)).toBe(0);
  });

  it("appends wiki link when note contains [回到原文] text without markdown link", () => {
    const store = createStore("wiki-link");
    const chunk = makeSampleChunk({
      note: "参见 [回到原文] 章节说明",
      cfiComment: true,
      links: [`[回到原文](#^${ANN_ID})`],
    });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(countSourceLinks(result)).toBe(1);
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
