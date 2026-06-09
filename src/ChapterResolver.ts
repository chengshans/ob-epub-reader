import { Book, NavItem } from "epubjs";

export interface TocSpineEntry {
  label: string;
  spineIndex: number;
}

/** 深度优先遍历 TOC，解析每项对应的 spine index */
export function buildTocSpineIndex(book: Book, tocItems: NavItem[]): TocSpineEntry[] {
  const entries: TocSpineEntry[] = [];

  function walk(items: NavItem[]) {
    for (const item of items) {
      const section = book.spine.get(item.href);
      if (section != null && Number.isFinite(section.index)) {
        entries.push({ label: item.label.trim(), spineIndex: section.index });
      }
      if (item.subitems && item.subitems.length > 0) {
        walk(item.subitems);
      }
    }
  }

  walk(tocItems);

  entries.sort((a, b) => {
    if (a.spineIndex !== b.spineIndex) return a.spineIndex - b.spineIndex;
    return 0;
  });

  return entries;
}

/** 取 spineIndex <= current 的最后一条（同 index 时后出现的子项优先） */
export function resolveChapterLabel(entries: TocSpineEntry[], spineIndex: number): string {
  if (!Number.isFinite(spineIndex) || entries.length === 0) return "";

  let best = "";
  for (const entry of entries) {
    if (entry.spineIndex <= spineIndex) {
      best = entry.label;
    } else {
      break;
    }
  }
  return best;
}

/** 从 epub.js location 或 CFI 提取 spine index（与 section.index 一致） */
export function spineIndexFromLocation(
  location: any,
  cfi?: string,
  book?: Book | null
): number | null {
  const index = location?.start?.index;
  if (typeof index === "number" && Number.isFinite(index)) {
    return index;
  }

  const cfiStr = cfi ?? location?.start?.cfi;
  if (cfiStr && book) {
    const section = book.spine.get(typeof cfiStr === "string" ? cfiStr : String(cfiStr));
    if (section != null && Number.isFinite(section.index)) {
      return section.index;
    }
  }

  return null;
}
