import type Book from "epubjs/types/book";

export interface EpubSearchHit {
  cfi: string;
  excerpt: string;
  sectionIndex: number;
  sectionHref: string;
}

interface SectionLike {
  index: number;
  href: string;
  load: (request?: unknown) => Promise<unknown>;
  find: (query: string) => Array<{ cfi: string; excerpt: string }>;
  search: (query: string, maxSeqEle?: number) => Array<{ cfi: string; excerpt: string }>;
  unload?: () => void;
}

/** Search all spine sections; returns hits with EPUB CFI for navigation. */
export async function searchEpubBook(book: Book, query: string): Promise<EpubSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const hits: EpubSearchHit[] = [];
  const spine = book.spine as { spineItems?: SectionLike[]; each?: (fn: (item: SectionLike) => void) => void };
  const items: SectionLike[] = [];

  if (spine.spineItems?.length) {
    items.push(...spine.spineItems);
  } else if (typeof spine.each === "function") {
    spine.each((item) => items.push(item));
  }

  for (const section of items) {
    try {
      await section.load(book.load.bind(book));
      const searchFn = typeof section.search === "function" ? section.search.bind(section) : section.find.bind(section);
      const matches = searchFn(trimmed) ?? [];
      for (const match of matches) {
        if (!match?.cfi) continue;
        hits.push({
          cfi: match.cfi,
          excerpt: match.excerpt ?? "",
          sectionIndex: section.index,
          sectionHref: section.href,
        });
      }
    } catch (err) {
      console.warn(`ob-epub: search failed in section ${section.href}`, err);
    } finally {
      try {
        section.unload?.();
      } catch {
        /* ignore */
      }
    }
  }

  return hits;
}
