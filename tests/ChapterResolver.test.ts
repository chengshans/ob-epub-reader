import { describe, expect, it } from "vitest";
import {
  computeTocEntryKeys,
  joinTocPath,
  resolveChapterKeyForMigration,
  resolveChapterLabel,
  shouldMigrateAnnotationChapter,
  tocPathLeaf,
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

describe("resolveChapterKeyForMigration", () => {
  const entries = computeTocEntryKeys([
    { label: "2/", path: `Chapter1${TOC_PATH_SEP}2/`, href: "c1.xhtml", spineIndex: 2 },
    { label: "2/", path: `Chapter3${TOC_PATH_SEP}2/`, href: "c3.xhtml", spineIndex: 15 },
    { label: "4/", path: `Chapter4${TOC_PATH_SEP}4/`, href: "c4.xhtml", spineIndex: 20 },
    { label: "1/", path: `Chapter6${TOC_PATH_SEP}1/`, href: "c6.xhtml", spineIndex: 40 },
    { label: "2/", path: `Chapter6${TOC_PATH_SEP}2/`, href: "c6b.xhtml", spineIndex: 41 },
    { label: "2/", path: `Chapter16${TOC_PATH_SEP}2/`, href: "c16.xhtml", spineIndex: 80 },
  ]);

  it("upgrades legacy leaf among same-label candidates only", () => {
    expect(resolveChapterKeyForMigration(entries, 2, "2/")).toBe(`Chapter1${TOC_PATH_SEP}2/`);
    expect(resolveChapterKeyForMigration(entries, 80, "2/")).toBe(`Chapter16${TOC_PATH_SEP}2/`);
  });

  it("keeps exact TOC key when CFI spine still matches (no same-leaf parent jump)", () => {
    expect(
      resolveChapterKeyForMigration(entries, 15, `Chapter3${TOC_PATH_SEP}2/`)
    ).toBe(`Chapter3${TOC_PATH_SEP}2/`);
    // Coarse resolve would pick Chapter6 › 2/ for spine 41; exact key at its own spine stays
    expect(
      resolveChapterKeyForMigration(entries, 41, `Chapter6${TOC_PATH_SEP}2/`)
    ).toBe(`Chapter6${TOC_PATH_SEP}2/`);
  });

  it("does not move Chapter3 › 2/ to Chapter6 when spines still match", () => {
    // Regression: drawing elsewhere used to re-resolve same leaf and merge Ch3 into Ch6
    expect(
      resolveChapterKeyForMigration(entries, 15, `Chapter3${TOC_PATH_SEP}2/`)
    ).toBe(`Chapter3${TOC_PATH_SEP}2/`);
  });

  it("re-resolves exact TOC key when CFI spine moved to another file", () => {
    expect(
      resolveChapterKeyForMigration(entries, 15, `Chapter6${TOC_PATH_SEP}1/`)
    ).toBe(`Chapter3${TOC_PATH_SEP}2/`);
    expect(
      resolveChapterKeyForMigration(entries, 2, `Chapter16${TOC_PATH_SEP}2/`)
    ).toBe(`Chapter1${TOC_PATH_SEP}2/`);
  });

  it("does not jump legacy leaf to a different leaf via global spine resolve", () => {
    expect(resolveChapterKeyForMigration(entries, 20, "2/")).toBe(`Chapter3${TOC_PATH_SEP}2/`);
    expect(
      resolveChapterKeyForMigration(entries, 20, `Chapter4${TOC_PATH_SEP}4/`)
    ).toBe(`Chapter4${TOC_PATH_SEP}4/`);
  });
});

describe("shouldMigrateAnnotationChapter", () => {
  it("does not migrate when chapter already matches key", () => {
    expect(shouldMigrateAnnotationChapter(`上篇${TOC_PATH_SEP}3/`, `上篇${TOC_PATH_SEP}3/`)).toBe(
      false
    );
  });

  it("migrates when keys differ", () => {
    expect(shouldMigrateAnnotationChapter("3/", `上篇${TOC_PATH_SEP}3/`)).toBe(true);
    expect(
      shouldMigrateAnnotationChapter(
        `Chapter6${TOC_PATH_SEP}1/`,
        `Chapter3${TOC_PATH_SEP}2/`
      )
    ).toBe(true);
  });

  it("does not migrate when newKey is empty", () => {
    expect(shouldMigrateAnnotationChapter("序", "")).toBe(false);
  });
});

describe("tocPathLeaf", () => {
  it("returns last path segment", () => {
    expect(tocPathLeaf(`Chapter1${TOC_PATH_SEP}2/`)).toBe("2/");
    expect(tocPathLeaf("序")).toBe("序");
  });
});
