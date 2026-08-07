import { describe, expect, it } from "vitest";
import {
  computeTocEntryKeys,
  joinTocPath,
  resolveChapterLabel,
  shouldMigrateAnnotationChapter,
  TOC_PATH_SEP,
} from "../src/ChapterResolver";

describe("joinTocPath", () => {
  it("joins with path separator and skips empty parts", () => {
    expect(joinTocPath(["上篇", "3/"])).toBe(`上篇${TOC_PATH_SEP}3/`);
    expect(joinTocPath(["", "3/"])).toBe("3/");
  });
});

describe("computeTocEntryKeys", () => {
  it("always uses full path as key, even for unique labels", () => {
    const keys = computeTocEntryKeys([
      { label: "序", path: "序", href: "a.xhtml", spineIndex: 0 },
      { label: "第一章", path: `上篇${TOC_PATH_SEP}第一章`, href: "b.xhtml", spineIndex: 1 },
    ]);
    expect(keys.map((e) => e.key)).toEqual(["序", `上篇${TOC_PATH_SEP}第一章`]);
  });

  it("uses full path when the same leaf label appears under different parents", () => {
    const keys = computeTocEntryKeys([
      { label: "上篇", path: "上篇", href: "p1.xhtml", spineIndex: 0 },
      { label: "3/", path: `上篇${TOC_PATH_SEP}3/`, href: "c3.xhtml", spineIndex: 3 },
      { label: "下篇", path: "下篇", href: "p2.xhtml", spineIndex: 10 },
      { label: "3/", path: `下篇${TOC_PATH_SEP}3/`, href: "d3.xhtml", spineIndex: 13 },
    ]);
    expect(keys.find((e) => e.href === "c3.xhtml")?.key).toBe(`上篇${TOC_PATH_SEP}3/`);
    expect(keys.find((e) => e.href === "d3.xhtml")?.key).toBe(`下篇${TOC_PATH_SEP}3/`);
    expect(keys.find((e) => e.label === "上篇")?.key).toBe("上篇");
  });

  it("appends href when path is still duplicated", () => {
    const path = `同章${TOC_PATH_SEP}3/`;
    const keys = computeTocEntryKeys([
      { label: "3/", path, href: "a.xhtml", spineIndex: 1 },
      { label: "3/", path, href: "b.xhtml", spineIndex: 2 },
    ]);
    expect(keys[0].key).toBe(`${path} a.xhtml`);
    expect(keys[1].key).toBe(`${path} b.xhtml`);
  });
});

describe("resolveChapterLabel", () => {
  it("returns entry.key for the last spine entry at or before index", () => {
    const entries = computeTocEntryKeys([
      { label: "3/", path: `上篇${TOC_PATH_SEP}3/`, href: "c3.xhtml", spineIndex: 3 },
      { label: "3/", path: `下篇${TOC_PATH_SEP}3/`, href: "d3.xhtml", spineIndex: 13 },
    ]);
    expect(resolveChapterLabel(entries, 3)).toBe(`上篇${TOC_PATH_SEP}3/`);
    expect(resolveChapterLabel(entries, 12)).toBe(`上篇${TOC_PATH_SEP}3/`);
    expect(resolveChapterLabel(entries, 13)).toBe(`下篇${TOC_PATH_SEP}3/`);
  });
});

describe("shouldMigrateAnnotationChapter", () => {
  it("does not migrate when chapter already matches key", () => {
    expect(shouldMigrateAnnotationChapter(`上篇${TOC_PATH_SEP}3/`, `上篇${TOC_PATH_SEP}3/`)).toBe(
      false
    );
  });

  it("migrates legacy leaf to path key", () => {
    expect(shouldMigrateAnnotationChapter("3/", `上篇${TOC_PATH_SEP}3/`)).toBe(true);
  });

  it("migrates unique leaf to nested path key", () => {
    expect(shouldMigrateAnnotationChapter("第一章", `上篇${TOC_PATH_SEP}第一章`)).toBe(true);
  });

  it("does not migrate when newKey is empty", () => {
    expect(shouldMigrateAnnotationChapter("序", "")).toBe(false);
  });
});
