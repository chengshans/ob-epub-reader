import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { AnnotationVaultStore } from "../src/AnnotationVaultStore";
import { DEFAULT_SETTINGS, type EpubPluginSettings } from "../src/types";

import { LEGACY_GOTO_WIKI_LINK_RE } from "../src/epubSubpath";

const SAMPLE_CFI = "epubcfi(/6/14!/4/2,/1:0,/1:42)";
const CALIBRE_CFI = "epubcfi(/6/50!/4/2[calibre_pb_0]/14,/1:3,/1:118)";
const ANN_ID = "ann-test001";
const EPUB_SOURCE = "books/demo.epub";
const CALIBRE_EPUB = "epub-books/最小阻力之路 (罗伯特·弗里茨).epub";
const CREATED = "2026-05-23T18:15:42.000Z";
const CHAPTER = "第三章";
const TEXT = "摘录正文第一行\n摘录正文第二行";

function countLegacyGotoLinks(chunk: string): number {
  const md = chunk.match(/\[回到原文\]\([^)\n]+\)/g)?.length ?? 0;
  const wiki = chunk.match(LEGACY_GOTO_WIKI_LINK_RE)?.length ?? 0;
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
  it("converts legacy wiki-only link to callout-title wiki link", () => {
    const store = createStore("callout-title");
    const chunk = makeSampleChunk({
      links: [`[[${EPUB_SOURCE}#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42|回到原文]]`],
    });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(countLegacyGotoLinks(result)).toBe(0);
    expect(result).toContain(`[[${EPUB_SOURCE}#cfi=`);
    expect(result).toContain(`|${CHAPTER}]]`);
    expect(result).toMatch(/^>\s*\[!ob-epub\|yellow\]\s+\[\[/m);
    expect(countCfiComments(result)).toBe(0);
  });

  it("converts callout-title to inline-suffix", () => {
    const store = createStore("inline-suffix");
    const chunk = [
      `> [!ob-epub|green] [[${EPUB_SOURCE}#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42|${CHAPTER} · 2026-05-23 18:15:42]]`,
      "> 摘录正文第一行",
      "> 摘录正文第二行",
    ].join("\n");
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(result).not.toMatch(/^>\s*\[!ob-epub/m);
    expect(result).toContain("摘录正文第二行[[");
    expect(result).toContain("|原文]]");
  });

  it("converts callout-title to inline-colored", () => {
    const store = createStore("inline-colored");
    const chunk = [
      `> [!ob-epub|purple] [[${EPUB_SOURCE}#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42|${CHAPTER} · 2026-05-23 18:15:42]]`,
      "> 摘录正文",
    ].join("\n");
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(result).toContain('<span style="color: #8b5cf6;">摘录正文</span>');
    expect(result).toContain("|原文]]");
  });

  it("converts callout-title to wiki-text-alias", () => {
    const store = createStore("wiki-text-alias");
    const chunk = [
      `> [!ob-epub|yellow] [[${EPUB_SOURCE}#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42|${CHAPTER} · 2026-05-23 18:15:42]]`,
      "> 摘录正文",
    ].join("\n");
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(result).toMatch(/^\[\[books\/demo\.epub#cfi=.*\|摘录正文\]\]$/m);
    expect(result).not.toContain("[!ob-epub");
  });

  it("converts callout-title to plain-text", () => {
    const store = createStore("plain-text");
    const chunk = [
      `> [!ob-epub|yellow] [[${EPUB_SOURCE}#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42|${CHAPTER} · 2026-05-23 18:15:42]]`,
      "> 摘录正文第一行",
      "> 摘录正文第二行",
    ].join("\n");
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(result).not.toMatch(/\[\[[^\]]+\.epub#cfi=/);
    expect(result).not.toContain("[!ob-epub");
    expect(result).toContain("摘录正文第一行\n摘录正文第二行");
    expect(countCfiComments(result)).toBe(0);
  });

  it("removes wiki link with calibre CFI brackets when converting to callout-title", () => {
    const store = createStore("callout-title");
    const wikiLink =
      `[[${CALIBRE_EPUB}#cfi=/6/50!/4/2[calibre_pb_0]/14/1:3&end=/6/50!/4/2[calibre_pb_0]/14/1:118&chapter=第一部分&color=red|回到原文]]`;
    const chunk = makeSampleChunk({ links: [wikiLink] });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, CALIBRE_EPUB);

    expect(countLegacyGotoLinks(result)).toBe(0);
    expect(result).toContain("[calibre_pb_0]");
    expect(result).toMatch(/^>\s*\[!ob-epub\|yellow\]\s+\[\[/m);
  });

  it("converts verbose legacy wiki link to callout-title", () => {
    const store = createStore("callout-title");
    const verbose =
      `[[${EPUB_SOURCE}#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42&text=abc&chapter=第三章&color=yellow|回到原文]]`;
    const chunk = makeSampleChunk({ links: [verbose] });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(countLegacyGotoLinks(result)).toBe(0);
    expect(result).toContain(
      `[[books/demo.epub#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42|第三章]]`
    );
    expect(result).not.toContain("&text=");
  });

  it("is idempotent for callout-title format", () => {
    const store = createStore("callout-title");
    const chunk = [
      `> [!ob-epub|yellow] [[${EPUB_SOURCE}#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42|${CHAPTER} · 2026-05-23 18:15:42]]`,
      "> 摘录正文第一行",
      "> 摘录正文第二行",
    ].join("\n");
    const once = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);
    const twice = store.rewriteGotoLinksToCurrentFormat(once, EPUB_SOURCE);
    expect(twice).toBe(once);
  });

  it("forceRewrite recomposes even when format already matches", () => {
    const store = createStore("callout-title");
    const chunk = [
      `> [!ob-epub|yellow] [[${EPUB_SOURCE}#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42|${CHAPTER}]]`,
      "> 摘录正文第一行",
      "> 摘录正文第二行",
    ].join("\n");
    const withoutForce = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);
    expect(withoutForce).toBe(chunk);

    const withForce = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE, {
      forceRewrite: true,
    });
    expect(withForce).not.toBe(chunk);
    expect(withForce).toContain("<!-- ob-epub-chapter-body-start -->");
  });

  it("is idempotent for inline-suffix format", () => {
    const store = createStore("inline-suffix");
    const chunk = `摘录正文[[${EPUB_SOURCE}#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42|原文]]`;
    const once = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);
    const twice = store.rewriteGotoLinksToCurrentFormat(once, EPUB_SOURCE);
    expect(twice).toBe(once);
  });

  it("leaves chunk unchanged when converting without epub-source", () => {
    const store = createStore("callout-title");
    const chunk = makeSampleChunk({
      cfiComment: true,
      links: [`[回到原文](#^${ANN_ID})`],
    });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk);

    expect(result).toBe(chunk);
  });

  it("leaves chunk unchanged when converting without extractable CFI", () => {
    const store = createStore("callout-title");
    const chunk = makeSampleChunk({
      links: [`[回到原文](#^${ANN_ID})`],
    });
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(result).toBe(chunk);
  });

  it("preserves chapter for second block in grouped inline layout", () => {
    const store = createStore("callout-title");
    const grouped = [
      "---",
      `epub-source: ${EPUB_SOURCE}`,
      "created: 2026-06-17",
      "---",
      "",
      "# 《demo》摘录",
      "",
      "<!-- ob-epub-chapter-toc-start -->",
      "## 章节目录",
      "",
      "- [[#语言的萎缩|语言的萎缩]]（2）",
      "<!-- ob-epub-chapter-toc-end -->",
      "",
      "<!-- ob-epub-chapter-body-start -->",
      "## 语言的萎缩",
      "",
      `> [!ob-epub|yellow] [[${EPUB_SOURCE}#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42|语言的萎缩 · 2026-05-23 18:15:42]]`,
      "> 第一条摘录",
      "",
      "---",
      "",
      `摘录正文[[${EPUB_SOURCE}#cfi=/6/20!/4/2/1:0&end=/6/20!/4/2/1:10|原文]]`,
      "",
      "<!-- ob-epub-chapter-body-end -->",
      "",
    ].join("\n");

    const result = store.rewriteGotoLinksToCurrentFormat(grouped, EPUB_SOURCE);

    expect(result).toContain("## 语言的萎缩");
    expect(result).not.toContain("## 未知章节");
    expect(result).toContain("语言的萎缩");
    expect(result).not.toContain("|语言的萎缩 · ");
    expect(result).not.toMatch(/\| · \d{4}-\d{2}-\d{2}/);
    const parsed = store.parseContent(result, EPUB_SOURCE);
    expect(parsed).toHaveLength(2);
    expect(parsed.every((a) => a.chapter === "语言的萎缩")).toBe(true);
  });

  it("strips legacy chapter-date alias when converting to callout-title", () => {
    const store = createStore("callout-title");
    const chunk = [
      `> [!ob-epub|yellow] [[${EPUB_SOURCE}#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42|${CHAPTER} · 2026-05-23 18:15:42]]`,
      "> 摘录正文",
    ].join("\n");
    const result = store.rewriteGotoLinksToCurrentFormat(chunk, EPUB_SOURCE);

    expect(result).toContain(`|${CHAPTER}]]`);
    expect(result).not.toContain("18:15:42");
  });

  it("converts grouped chapter layout without polluting wiki alias", () => {
    const store = createStore("wiki-text-alias");
    const grouped = [
      "---",
      `epub-source: ${EPUB_SOURCE}`,
      "created: 2026-06-17",
      "---",
      "",
      "# 《demo》摘录",
      "",
      "<!-- ob-epub-chapter-toc-start -->",
      "## 章节目录",
      "",
      "- [[#I|I]]（1）",
      "<!-- ob-epub-chapter-toc-end -->",
      "",
      "<!-- ob-epub-chapter-body-start -->",
      "## I",
      "",
      '<span style="color: #e0533d ;">我之所以活着，不过是因为我能够想什么时候去死就什么时候去死。</span> '
        + `[[${EPUB_SOURCE}#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42|原文]]`,
      "",
      "---",
      "",
      "## 未知章节",
      "",
      '<span style="color: #3b82c4 ;">当我身无分文的时候，我试着想象光音天。</span> '
        + `[[${EPUB_SOURCE}#cfi=/6/20!/4/2/1:0&end=/6/20!/4/2/1:10|原文]]`,
      "",
      "<!-- ob-epub-chapter-body-end -->",
      "",
    ].join("\n");

    const result = store.rewriteGotoLinksToCurrentFormat(grouped, EPUB_SOURCE);

    expect(result).toContain("## 章节目录");
    expect(result).toContain("<!-- ob-epub-chapter-body-start -->");
    expect(result).toContain("<!-- ob-epub-chapter-body-end -->");
    expect(result).toContain("[[#I|I]]");
    expect(result).not.toContain("<!-- ob-epub-chapter-toc-start -->[[");
    expect(result).toMatch(
      /\[\[books\/demo\.epub#cfi=\/6\/14!\/4\/2\/1:0&end=\/6\/14!\/4\/2\/1:42\|我之所以活着，不过是因为我能够想什么时候去死就什么时候去死。\]\]/
    );
    expect(result).toMatch(
      /\[\[books\/demo\.epub#cfi=\/6\/20!\/4\/2\/1:0&end=\/6\/20!\/4\/2\/1:10\|当我身无分文的时候，我试着想象光音天。\]\]/
    );
    const bodyEndCount = (result.match(/<!-- ob-epub-chapter-body-end -->/g) ?? []).length;
    expect(bodyEndCount).toBe(1);
  });

  it("converts using inferred epub path when frontmatter lacks epub-source", () => {
    const inferredEpub = "epub-books/demo.epub";
    const store = new AnnotationVaultStore({} as App, {
      ...DEFAULT_SETTINGS,
      excerptFolder: "{filefolder}/anno",
      sourceLinkFormat: "inline-suffix",
    });
    const chunk = [
      `> [!ob-epub|yellow] [[${inferredEpub}#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42|${CHAPTER} · 2026-05-23 18:15:42]]`,
      "> 摘录正文",
    ].join("\n");
    const excerptPath = "epub-books/anno/《demo》摘录.md";

    expect(store.resolveEpubSourceForExcerpt(excerptPath, chunk)).toBe(inferredEpub);

    const result = store.rewriteGotoLinksToCurrentFormat(
      chunk,
      store.resolveEpubSourceForExcerpt(excerptPath, chunk),
      { forceRewrite: true }
    );

    expect(result).not.toMatch(/^>\s*\[!ob-epub/m);
    expect(result).toContain("摘录正文[[");
    expect(result).toContain("|原文]]");
  });
});
