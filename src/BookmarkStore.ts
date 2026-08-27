import { App, normalizePath } from "obsidian";
import { EpubBookmark } from "./types";
import { normalizeCfi } from "./ProgressStore";

export type BookmarkPersistence = {
  loadBookmarks: () => Promise<Record<string, EpubBookmark[]>>;
  saveBookmarks: (bookmarks: Record<string, EpubBookmark[]>) => Promise<void>;
};

function normalizeBookmark(raw: Partial<EpubBookmark>): EpubBookmark | null {
  if (!raw?.id || !raw.cfi) return null;
  return {
    id: String(raw.id),
    cfi: normalizeCfi(raw.cfi),
    label: String(raw.label ?? ""),
    chapter: String(raw.chapter ?? ""),
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
  };
}

/** Bookmarks persist in plugin data.json only. */
export class BookmarkStore {
  private bookmarks: Record<string, EpubBookmark[]> = {};
  private loadBookmarks: () => Promise<Record<string, EpubBookmark[]>>;
  private saveBookmarks: (bookmarks: Record<string, EpubBookmark[]>) => Promise<void>;
  private loadPromise: Promise<void> | null = null;

  constructor(_app: App, persistence: BookmarkPersistence) {
    this.loadBookmarks = persistence.loadBookmarks;
    this.saveBookmarks = persistence.saveBookmarks;
  }

  async load(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const raw = await this.loadBookmarks();
        this.bookmarks = {};
        for (const [path, list] of Object.entries(raw)) {
          const normalized = (Array.isArray(list) ? list : [])
            .map((entry) => normalizeBookmark(entry))
            .filter((entry): entry is EpubBookmark => entry !== null);
          if (normalized.length > 0) {
            this.bookmarks[normalizePath(path)] = normalized;
          }
        }
      })();
    }
    await this.loadPromise;
  }

  getByFile(epubPath: string): EpubBookmark[] {
    return [...(this.bookmarks[normalizePath(epubPath)] ?? [])];
  }

  async add(epubPath: string, bookmark: EpubBookmark): Promise<void> {
    await this.load();
    const key = normalizePath(epubPath);
    const list = this.getByFile(key);
    list.push({
      ...bookmark,
      cfi: normalizeCfi(bookmark.cfi),
    });
    this.bookmarks[key] = list;
    await this.saveBookmarks({ ...this.bookmarks });
  }

  async remove(epubPath: string, id: string): Promise<void> {
    await this.load();
    const key = normalizePath(epubPath);
    const next = this.getByFile(key).filter((b) => b.id !== id);
    if (next.length === 0) {
      delete this.bookmarks[key];
    } else {
      this.bookmarks[key] = next;
    }
    await this.saveBookmarks({ ...this.bookmarks });
  }

  async removeAllForFile(epubPath: string): Promise<void> {
    await this.load();
    delete this.bookmarks[normalizePath(epubPath)];
    await this.saveBookmarks({ ...this.bookmarks });
  }
}
