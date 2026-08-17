import { Book, NavItem } from "epubjs";

/** TOC path separator — rare in titles, Obsidian-heading safe. */
export const TOC_PATH_SEP = " › ";

export interface TocSpineEntry {
  /** Leaf title (display fallback). */
  label: string;
  /** Root-to-leaf path joined with TOC_PATH_SEP. */
  path: string;
  /** Stable chapter key: full path (path + href if path still duplicates). */
  key: string;
  href: string;
  spineIndex: number;
}

export interface TocSpineEntryInput {
  label: string;
  path: string;
  href: string;
  spineIndex: number;
}

export function joinTocPath(parts: string[]): string {
  return parts.filter((p) => p.length > 0).join(TOC_PATH_SEP);
}

/** Assign path-based keys from raw TOC spine rows (pure, testable). */
export function computeTocEntryKeys(inputs: TocSpineEntryInput[]): TocSpineEntry[] {
  const pathFreq = new Map<string, number>();
  for (const e of inputs) {
    pathFreq.set(e.path, (pathFreq.get(e.path) ?? 0) + 1);
  }

  return inputs.map((e) => ({
    ...e,
    key: (pathFreq.get(e.path) ?? 0) > 1 ? `${e.path} ${e.href}` : e.path,
  }));
}

/**
 * Whether a stored annotation chapter should be rewritten to `newKey`.
 * `resolveChapterKeyForMigration` already constrains the target; here we only
 * skip no-ops / empty keys.
 */
export function shouldMigrateAnnotationChapter(oldChapter: string, newKey: string): boolean {
  const old = oldChapter.trim();
  if (!newKey || old === newKey) return false;
  return true;
}

/** Last segment of a TOC path key (or the whole string if flat). */
export function tocPathLeaf(chapter: string): string {
  const parts = chapter.split(TOC_PATH_SEP).map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : chapter.trim();
}

/**
 * Resolve chapter key for annotation migration.
 *
 * - Exact TOC key + CFI still in that spine file → keep (do not jump among
 *   same-named leaves like `2/` under Chapter3 vs Chapter6).
 * - Exact TOC key + CFI in a different spine file → re-resolve from CFI.
 * - Legacy leaf / unknown → upgrade among same-leaf TOC entries only.
 */
export function resolveChapterKeyForMigration(
  entries: TocSpineEntry[],
  spineIndex: number,
  oldChapter: string
): string {
  const old = oldChapter.trim();
  if (!old) return resolveChapterLabel(entries, spineIndex);

  const exact = entries.find((e) => e.key === old);
  if (exact) {
    if (exact.spineIndex === spineIndex) return old;
    return resolveChapterLabel(entries, spineIndex);
  }

  const leaf = tocPathLeaf(old);
  const candidates = entries.filter(
    (e) => e.label === leaf || tocPathLeaf(e.key) === leaf
  );
  if (candidates.length === 0) {
    return old.includes(TOC_PATH_SEP) ? old : resolveChapterLabel(entries, spineIndex);
  }
  return resolveChapterLabel(candidates, spineIndex) || candidates[0].key;
}

/** 深度优先遍历 TOC，解析每项对应的 spine index，并填入消歧 key */
export function buildTocSpineIndex(book: Book, tocItems: NavItem[]): TocSpineEntry[] {
  const raw: TocSpineEntryInput[] = [];

  function walk(items: NavItem[], parentLabels: string[]) {
    for (const item of items) {
      const label = item.label.trim();
      const pathParts = label ? [...parentLabels, label] : [...parentLabels];
      const path = joinTocPath(pathParts);
      const section = book.spine.get(item.href);
      if (section != null && Number.isFinite(section.index)) {
        raw.push({
          label,
          path,
          href: item.href,
          spineIndex: section.index,
        });
      }
      if (item.subitems && item.subitems.length > 0) {
        walk(item.subitems, pathParts);
      }
    }
  }

  walk(tocItems, []);

  const entries = computeTocEntryKeys(raw);
  entries.sort((a, b) => {
    if (a.spineIndex !== b.spineIndex) return a.spineIndex - b.spineIndex;
    return 0;
  });

  return entries;
}

/** Look up TOC entry for a nav item by path (preferred) or href+label. */
export function findTocEntryForNavItem(
  entries: TocSpineEntry[],
  href: string,
  label: string,
  path: string
): TocSpineEntry | undefined {
  return (
    entries.find((e) => e.path === path && e.href === href) ??
    entries.find((e) => e.path === path) ??
    entries.find((e) => e.href === href && e.label === label)
  );
}

/** 取 spineIndex <= current 的最后一条（同 index 时后出现的子项优先），返回 entry.key */
export function resolveChapterLabel(entries: TocSpineEntry[], spineIndex: number): string {
  if (!Number.isFinite(spineIndex) || entries.length === 0) return "";

  let best = "";
  for (const entry of entries) {
    if (entry.spineIndex <= spineIndex) {
      best = entry.key;
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
