import { describe, expect, it } from "vitest";
import type { NavItem } from "epubjs";
import { computeTocEntryKeys, TOC_PATH_SEP } from "../src/ChapterResolver";
import { UNKNOWN_CHAPTER } from "../src/excerptChapterLayout";
import {
  buildNotesChapterTree,
  flattenNotesTreeKeys,
  tocPathAncestorKeys,
} from "../src/notesChapterTree";
import type { Annotation } from "../src/types";

function ann(partial: Partial<Annotation> & Pick<Annotation, "id" | "chapter">): Annotation {
  return {
    cfiRange: "epubcfi(/6/2!/4/2,/1:0,/1:1)",
    text: partial.id,
    color: "yellow",
    created: partial.created ?? "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function nav(label: string, href: string, subitems: NavItem[] = []): NavItem {
  return { id: href, label, href, subitems };
}

describe("tocPathAncestorKeys", () => {
  it("returns parent path segments", () => {
    expect(tocPathAncestorKeys(`Chapter5${TOC_PATH_SEP}1/`)).toEqual(["Chapter5"]);
    expect(tocPathAncestorKeys(`A${TOC_PATH_SEP}B${TOC_PATH_SEP}C`)).toEqual([
      "A",
      `A${TOC_PATH_SEP}B`,
    ]);
    expect(tocPathAncestorKeys("序")).toEqual([]);
  });
});

describe("buildNotesChapterTree", () => {
  const tocItems: NavItem[] = [
    nav("Chapter4", "c4.xhtml"),
    nav("Chapter5", "c5.xhtml", [
      nav("1/", "c5-1.xhtml"),
      nav("2/", "c5-2.xhtml"),
      nav("3/", "c5-3.xhtml"),
    ]),
    nav("Chapter6", "c6.xhtml", [nav("1/", "c6-1.xhtml")]),
  ];

  const entries = computeTocEntryKeys([
    { label: "Chapter4", path: "Chapter4", href: "c4.xhtml", spineIndex: 4 },
    { label: "Chapter5", path: "Chapter5", href: "c5.xhtml", spineIndex: 5 },
    { label: "1/", path: `Chapter5${TOC_PATH_SEP}1/`, href: "c5-1.xhtml", spineIndex: 6 },
    { label: "2/", path: `Chapter5${TOC_PATH_SEP}2/`, href: "c5-2.xhtml", spineIndex: 7 },
    { label: "3/", path: `Chapter5${TOC_PATH_SEP}3/`, href: "c5-3.xhtml", spineIndex: 8 },
    { label: "Chapter6", path: "Chapter6", href: "c6.xhtml", spineIndex: 9 },
    { label: "1/", path: `Chapter6${TOC_PATH_SEP}1/`, href: "c6-1.xhtml", spineIndex: 10 },
  ]);

  it("nests notes under TOC parents and omits empty branches", () => {
    const tree = buildNotesChapterTree(tocItems, entries, [
      ann({ id: "a1", chapter: `Chapter5${TOC_PATH_SEP}1/` }),
      ann({ id: "a2", chapter: `Chapter5${TOC_PATH_SEP}2/` }),
      ann({ id: "a6", chapter: `Chapter6${TOC_PATH_SEP}1/` }),
    ]);

    expect(tree.map((n) => n.label)).toEqual(["Chapter5", "Chapter6"]);
    expect(tree[0].children.map((c) => c.label)).toEqual(["1/", "2/"]);
    expect(tree[0].totalCount).toBe(2);
    expect(tree[0].children[0].annotations.map((a) => a.id)).toEqual(["a1"]);
    expect(tree[1].children.map((c) => c.label)).toEqual(["1/"]);
    expect(flattenNotesTreeKeys(tree)).toEqual([
      "Chapter5",
      `Chapter5${TOC_PATH_SEP}1/`,
      `Chapter5${TOC_PATH_SEP}2/`,
      "Chapter6",
      `Chapter6${TOC_PATH_SEP}1/`,
    ]);
  });

  it("keeps unmatched chapters as root orphans", () => {
    const tree = buildNotesChapterTree(tocItems, entries, [
      ann({ id: "orphan", chapter: "手写章节" }),
      ann({ id: "unk", chapter: UNKNOWN_CHAPTER }),
    ]);
    expect(tree.map((n) => n.key)).toEqual(["手写章节", UNKNOWN_CHAPTER]);
  });

  it("falls back to flat groups when TOC is empty", () => {
    const tree = buildNotesChapterTree([], entries, [
      ann({ id: "b", chapter: `Chapter5${TOC_PATH_SEP}2/`, created: "2026-01-02T00:00:00.000Z" }),
      ann({ id: "a", chapter: `Chapter5${TOC_PATH_SEP}1/`, created: "2026-01-01T00:00:00.000Z" }),
    ]);
    expect(tree.map((n) => n.key)).toEqual([
      `Chapter5${TOC_PATH_SEP}1/`,
      `Chapter5${TOC_PATH_SEP}2/`,
    ]);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });
});
