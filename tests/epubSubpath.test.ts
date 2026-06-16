import { describe, expect, it } from "vitest";
import {
  buildCfiRangeLiteral,
  compactCfiToWire,
  expandWireToNavigateCfi,
  parseCfiRangeLiteral,
} from "../src/cfi/cfiCompact";
import {
  buildEpubSubpath,
  buildEpubWikiLink,
  extractCfiFromWikiLink,
  parseEpubSubpath,
  parseWikiEpubLinkText,
  slimWikiGotoLink,
  slimWikiGotoLinksInContent,
} from "../src/epubSubpath";

describe("cfiCompact", () => {
  it("round-trips range CFI to EPUB++ wire", () => {
    const range = "epubcfi(/6/14!/4/2,/1:0,/1:42)";
    const wire = compactCfiToWire(range);
    expect(wire).toEqual({ cfi: "/6/14!/4/2/1:0", end: "/6/14!/4/2/1:42" });
    expect(expandWireToNavigateCfi(wire)).toBe(range);
  });

  it("handles calibre assertion in range", () => {
    const range = "epubcfi(/6/50!/4/2[calibre_pb_0]/14,/1:3,/1:118)";
    const { start, end } = parseCfiRangeLiteral(range);
    expect(start).toBe("/6/50!/4/2[calibre_pb_0]/14/1:3");
    expect(end).toBe("/6/50!/4/2[calibre_pb_0]/14/1:118");
    expect(buildCfiRangeLiteral(start, end)).toBe(range);
  });
});

describe("parseEpubSubpath", () => {
  it("parses EPUB++ bare cfi with end", () => {
    const parsed = parseEpubSubpath("#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42&color=yellow");
    expect(parsed?.cfi).toBe("epubcfi(/6/14!/4/2,/1:0,/1:42)");
    expect(parsed?.color).toBe("yellow");
  });

  it("still parses legacy epubcfi() in links", () => {
    const subpath =
      "#cfi=epubcfi(/6/22!/4/14,/1:0,/1:86)&text=hello&chapter=10";
    const parsed = parseEpubSubpath(subpath);
    expect(parsed?.cfi).toBe("epubcfi(/6/22!/4/14,/1:0,/1:86)");
  });

  it("builds EPUB++ subpath without epubcfi wrapper or metadata params", () => {
    const subpath = buildEpubSubpath({
      cfiRange: "epubcfi(/6/4!/4/2,/1:0,/1:5)",
    });
    expect(subpath).toMatch(/^#cfi=\/6\/4/);
    expect(subpath).toContain("&end=");
    expect(subpath).not.toContain("epubcfi(");
    expect(subpath).not.toContain("&text=");
    expect(subpath).not.toContain("&chapter=");
    expect(subpath).not.toContain("&color=");
    const parsed = parseEpubSubpath(subpath);
    expect(parsed?.cfi).toBe("epubcfi(/6/4!/4/2,/1:0,/1:5)");
  });

  it("still parses legacy text/chapter/color params in links", () => {
    const subpath =
      "#cfi=epubcfi(/6/22!/4/14,/1:0,/1:86)&text=hello&chapter=10&color=yellow";
    const parsed = parseEpubSubpath(subpath);
    expect(parsed?.cfi).toBe("epubcfi(/6/22!/4/14,/1:0,/1:86)");
    expect(parsed?.text).toBe("hello");
    expect(parsed?.chapter).toBe("10");
    expect(parsed?.color).toBe("yellow");
  });
});

describe("buildEpubWikiLink", () => {
  it("builds EPUB++ wiki link with cfi/end only", () => {
    const link = buildEpubWikiLink("books/demo.epub", {
      cfiRange: "epubcfi(/6/4!/4/2/1:0)",
    });
    expect(link).toMatch(/^\[\[books\/demo\.epub#cfi=\/6\/4/);
    expect(link).not.toContain("epubcfi(");
    expect(link).not.toContain("&text=");
    expect(link).not.toContain("&chapter=");
    expect(link).not.toContain("&color=");
    expect(link.endsWith("|回到原文]]")).toBe(true);
    expect(extractCfiFromWikiLink(link)).toBe("epubcfi(/6/4!/4/2/1:0)");
  });

  it("extracts CFI from wiki link with calibre assertion brackets", () => {
    const link =
      "[[epub-books/最小阻力之路 (罗伯特·弗里茨).epub#cfi=/6/50!/4/2[calibre_pb_0]/14/1:3&end=/6/50!/4/2[calibre_pb_0]/14/1:118&chapter=第一部分&color=red|回到原文]]";
    expect(extractCfiFromWikiLink(link)).toBe(
      "epubcfi(/6/50!/4/2[calibre_pb_0]/14,/1:3,/1:118)"
    );
  });

  it("slims verbose wiki link to cfi/end only", () => {
    const verbose =
      "[[epub-books/苦论 (E.M.齐奥朗) .epub#cfi=/6/6!/4/2/10/1:0&end=/6/6!/4/2/10/1:44&text=hello&chapter=语言的萎缩&color=green|回到原文]]";
    const slim = slimWikiGotoLink(verbose);
    expect(slim).toBe(
      "[[epub-books/苦论 (E.M.齐奥朗) .epub#cfi=/6/6!/4/2/10/1:0&end=/6/6!/4/2/10/1:44|回到原文]]"
    );
  });

  it("slimWikiGotoLinksInContent replaces verbose links in markdown", () => {
    const verbose =
      "[[books/demo.epub#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42&text=abc&chapter=ch1&color=yellow|回到原文]]";
    const content = `> quote\n\n${verbose}\n`;
    const slimmed = slimWikiGotoLinksInContent(content);
    expect(slimmed).toContain(
      "[[books/demo.epub#cfi=/6/14!/4/2/1:0&end=/6/14!/4/2/1:42|回到原文]]"
    );
    expect(slimmed).not.toContain("&text=");
  });
});

describe("parseWikiEpubLinkText", () => {
  it("parses chinese path EPUB++ link", () => {
    const link =
      "epub-books/最小阻力之路 (罗伯特·弗里茨).epub#cfi=/6/50!/4/2[calibre_pb_0]/14/1:3&end=/6/50!/4/2[calibre_pb_0]/14/1:118&chapter=第一部分&color=yellow|回到原文";
    const parsed = parseWikiEpubLinkText(link, (path) =>
      path.includes("最小阻力之路") ? "epub-books/最小阻力之路 (罗伯特·弗里茨).epub" : null
    );
    expect(parsed?.cfi).toBe("epubcfi(/6/50!/4/2[calibre_pb_0]/14,/1:3,/1:118)");
  });
});
