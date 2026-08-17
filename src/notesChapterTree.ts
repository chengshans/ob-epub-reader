import type { NavItem } from "epubjs";
import {
  findTocEntryForNavItem,
  joinTocPath,
  TOC_PATH_SEP,
  type TocSpineEntry,
} from "./ChapterResolver";
import {
  groupAnnotationsByChapter,
  normalizeChapterName,
  sortChapterNames,
  UNKNOWN_CHAPTER,
} from "./excerptChapterLayout";
import type { Annotation } from "./types";

export interface NotesTreeNode {
  /** Leaf segment shown in the tree (e.g. `1/` or chapter title). */
  label: string;
  /** Full TOC path key (matches `Annotation.chapter` when resolved). */
  key: string;
  /** Annotations whose chapter exactly equals `key`. */
  annotations: Annotation[];
  children: NotesTreeNode[];
  /** Annotations in this node and all descendants. */
  totalCount: number;
}

/** Ancestor path keys for `Chapter5 › 1/` → [`Chapter5`]. */
export function tocPathAncestorKeys(chapterKey: string): string[] {
  const parts = chapterKey
    .split(TOC_PATH_SEP)
    .map((p) => p.trim())
    .filter(Boolean);
  const ancestors: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    ancestors.push(joinTocPath(parts.slice(0, i)));
  }
  return ancestors;
}

/** Collect every node key in preorder (for collapse-all). */
export function flattenNotesTreeKeys(nodes: NotesTreeNode[]): string[] {
  const keys: string[] = [];
  const walk = (list: NotesTreeNode[]) => {
    for (const node of list) {
      keys.push(node.key);
      walk(node.children);
    }
  };
  walk(nodes);
  return keys;
}

function sortAnnotationsNewestFirst(annotations: Annotation[]): Annotation[] {
  return [...annotations].sort((a, b) => b.created.localeCompare(a.created));
}

function buildFlatFallbackTree(annotations: Annotation[], tocKeys: string[]): NotesTreeNode[] {
  const groups = groupAnnotationsByChapter(annotations);
  const chapters = sortChapterNames([...groups.keys()], groups, tocKeys);
  return chapters
    .map((chapter) => {
      const anns = sortAnnotationsNewestFirst(groups.get(chapter) ?? []);
      if (anns.length === 0) return null;
      const parts = chapter.split(TOC_PATH_SEP).map((p) => p.trim()).filter(Boolean);
      const label = parts.length > 0 ? parts[parts.length - 1] : chapter;
      return {
        label,
        key: chapter,
        annotations: anns,
        children: [],
        totalCount: anns.length,
      } satisfies NotesTreeNode;
    })
    .filter((n): n is NotesTreeNode => n != null);
}

/**
 * Build a notes sidebar tree mirroring the book TOC.
 * Branches with no annotations are omitted; unmatched chapters become root orphans.
 */
export function buildNotesChapterTree(
  tocItems: NavItem[],
  tocEntries: TocSpineEntry[],
  annotations: Annotation[]
): NotesTreeNode[] {
  if (annotations.length === 0) return [];

  const tocKeys = tocEntries.map((e) => e.key);
  if (!tocItems.length) {
    return buildFlatFallbackTree(annotations, tocKeys);
  }

  const groups = groupAnnotationsByChapter(annotations);
  const claimed = new Set<string>();

  const takeAnns = (key: string): Annotation[] => {
    const direct = groups.get(key);
    if (direct && direct.length > 0) {
      claimed.add(key);
      return sortAnnotationsNewestFirst(direct);
    }
    const normalized = normalizeChapterName(key);
    if (normalized !== key) {
      const alt = groups.get(normalized);
      if (alt && alt.length > 0) {
        claimed.add(normalized);
        return sortAnnotationsNewestFirst(alt);
      }
    }
    return [];
  };

  function walk(items: NavItem[], parentLabels: string[]): NotesTreeNode[] {
    const nodes: NotesTreeNode[] = [];
    for (const item of items) {
      const itemLabel = item.label.trim();
      const pathParts = itemLabel ? [...parentLabels, itemLabel] : [...parentLabels];
      const path = joinTocPath(pathParts);
      const entry = findTocEntryForNavItem(tocEntries, item.href, itemLabel, path);
      const key = entry?.key ?? path;
      const label = itemLabel || key;
      const ownAnns = takeAnns(key);
      const children = item.subitems?.length ? walk(item.subitems, pathParts) : [];
      const totalCount = ownAnns.length + children.reduce((sum, c) => sum + c.totalCount, 0);
      if (totalCount === 0) continue;
      nodes.push({
        label,
        key,
        annotations: ownAnns,
        children,
        totalCount,
      });
    }
    return nodes;
  }

  const tree = walk(tocItems, []);

  const orphans: NotesTreeNode[] = [];
  for (const [chapter, list] of groups) {
    if (list.length === 0 || claimed.has(chapter)) continue;
    const parts = chapter.split(TOC_PATH_SEP).map((p) => p.trim()).filter(Boolean);
    const label = parts.length > 0 ? parts[parts.length - 1] : chapter;
    orphans.push({
      label: chapter === UNKNOWN_CHAPTER ? UNKNOWN_CHAPTER : label,
      key: chapter,
      annotations: sortAnnotationsNewestFirst(list),
      children: [],
      totalCount: list.length,
    });
  }

  orphans.sort((a, b) => {
    if (a.key === UNKNOWN_CHAPTER && b.key !== UNKNOWN_CHAPTER) return 1;
    if (b.key === UNKNOWN_CHAPTER && a.key !== UNKNOWN_CHAPTER) return -1;
    return a.key.localeCompare(b.key, "zh");
  });

  return [...tree, ...orphans];
}
