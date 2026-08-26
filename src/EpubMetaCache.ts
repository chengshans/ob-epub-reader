import { normalizePath, Plugin, TFile } from "obsidian";
import ePub from "epubjs";

export interface EpubBookMeta {
  path: string;
  mtime: number;
  title: string;
  author: string;
  /** 插件目录 covers/ 下的文件名；无封面时为 null */
  coverFile: string | null;
  /** 可供 <img src> 使用的资源 URL */
  coverUrl: string | null;
}

interface EpubMetaIndexEntry {
  path: string;
  mtime: number;
  title: string;
  author: string;
  coverFile: string | null;
}

const MAX_CONCURRENT = 2;

/** 将 EPUB 路径映射为稳定的封面文件名（不含扩展名） */
function coverStem(epubPath: string): string {
  let hash = 2166136261;
  for (let i = 0; i < epubPath.length; i++) {
    hash ^= epubPath.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function extFromMime(mime: string | null | undefined): string {
  if (!mime) return ".img";
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("svg")) return ".svg";
  return ".img";
}

/**
 * 懒加载并缓存 EPUB 的 OPF 书名/作者与封面图（落盘到插件 covers/）。
 */
export class EpubMetaCache {
  private plugin: Plugin;
  private index: Record<string, EpubMetaIndexEntry> = {};
  private indexLoaded = false;
  private memory = new Map<string, EpubBookMeta>();
  private inflight = new Map<string, Promise<EpubBookMeta>>();
  private active = 0;
  private waitQueue: Array<() => void> = [];

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  private get coversDir(): string {
    return normalizePath(`${this.plugin.manifest.dir}/covers`);
  }

  private get indexPath(): string {
    return normalizePath(`${this.coversDir}/index.json`);
  }

  private coverPath(fileName: string): string {
    return normalizePath(`${this.coversDir}/${fileName}`);
  }

  private get adapter() {
    return this.plugin.app.vault.adapter;
  }

  private async ensureCoversDir(): Promise<void> {
    const dir = this.coversDir;
    if (!(await this.adapter.exists(dir))) {
      await this.adapter.mkdir(dir);
    }
  }

  private async loadIndex(): Promise<void> {
    if (this.indexLoaded) return;
    this.indexLoaded = true;
    try {
      if (!(await this.adapter.exists(this.indexPath))) return;
      const raw = await this.adapter.read(this.indexPath);
      const parsed = JSON.parse(raw) as Record<string, EpubMetaIndexEntry>;
      if (parsed && typeof parsed === "object") {
        this.index = parsed;
      }
    } catch (err) {
      console.warn("ob-epub: failed to load cover meta index", err);
      this.index = {};
    }
  }

  private async saveIndex(): Promise<void> {
    try {
      await this.ensureCoversDir();
      await this.adapter.write(this.indexPath, JSON.stringify(this.index));
    } catch (err) {
      console.warn("ob-epub: failed to save cover meta index", err);
    }
  }

  private toMeta(entry: EpubMetaIndexEntry): EpubBookMeta {
    const coverUrl = entry.coverFile
      ? this.adapter.getResourcePath(this.coverPath(entry.coverFile))
      : null;
    return {
      path: entry.path,
      mtime: entry.mtime,
      title: entry.title,
      author: entry.author,
      coverFile: entry.coverFile,
      coverUrl,
    };
  }

  private async acquireSlot(): Promise<void> {
    if (this.active < MAX_CONCURRENT) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
    this.active += 1;
  }

  private releaseSlot(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waitQueue.shift();
    if (next) next();
  }

  /** 使某本书的缓存失效（文件变更/删除时） */
  invalidate(epubPath: string): void {
    this.memory.delete(epubPath);
    this.inflight.delete(epubPath);
    const prev = this.index[epubPath];
    if (prev?.coverFile) {
      void this.adapter.remove(this.coverPath(prev.coverFile)).catch(() => {});
    }
    if (prev) {
      delete this.index[epubPath];
      void this.saveIndex();
    }
  }

  /** 同步返回已缓存元数据（未命中则为 null） */
  peek(epubPath: string): EpubBookMeta | null {
    return this.memory.get(epubPath) ?? null;
  }

  /**
   * 获取元数据；命中且 mtime 一致则立即返回，否则排队解析 EPUB。
   */
  async getMeta(file: TFile): Promise<EpubBookMeta> {
    await this.loadIndex();
    const path = file.path;
    const mtime = file.stat.mtime;

    const cached = this.memory.get(path);
    if (cached && cached.mtime === mtime) return cached;

    const indexed = this.index[path];
    if (indexed && indexed.mtime === mtime) {
      if (indexed.coverFile) {
        const exists = await this.adapter.exists(this.coverPath(indexed.coverFile));
        if (!exists) {
          // 封面文件丢失，重新提取
        } else {
          const meta = this.toMeta(indexed);
          this.memory.set(path, meta);
          return meta;
        }
      } else {
        const meta = this.toMeta(indexed);
        this.memory.set(path, meta);
        return meta;
      }
    }

    const existing = this.inflight.get(path);
    if (existing) return existing;

    const promise = this.extractMeta(file);
    this.inflight.set(path, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(path);
    }
  }

  private async extractMeta(file: TFile): Promise<EpubBookMeta> {
    await this.acquireSlot();
    let book: ReturnType<typeof ePub> | null = null;
    try {
      const data = await this.adapter.readBinary(file.path);
      book = ePub(data);
      await book.ready;

      let title = "";
      let author = "";
      try {
        const metadata = await book.loaded.metadata;
        title = (metadata?.title || "").trim();
        author = (metadata?.creator || "").trim();
      } catch (err) {
        console.warn("ob-epub: metadata load failed for", file.path, err);
      }

      let coverFile: string | null = null;
      try {
        const coverPath = await book.loaded.cover;
        if (coverPath && book.archive) {
          const blob = await book.archive.getBlob(coverPath);
          const buf = await blob.arrayBuffer();
          if (buf.byteLength > 0) {
            await this.ensureCoversDir();
            const fileName = `${coverStem(file.path)}${extFromMime(blob.type)}`;
            const prev = this.index[file.path];
            if (prev?.coverFile && prev.coverFile !== fileName) {
              await this.adapter.remove(this.coverPath(prev.coverFile)).catch(() => {});
            }
            await this.adapter.writeBinary(this.coverPath(fileName), buf);
            coverFile = fileName;
          }
        }
      } catch (err) {
        console.warn("ob-epub: cover extract failed for", file.path, err);
      }

      const entry: EpubMetaIndexEntry = {
        path: file.path,
        mtime: file.stat.mtime,
        title,
        author,
        coverFile,
      };
      this.index[file.path] = entry;
      await this.saveIndex();

      const meta = this.toMeta(entry);
      this.memory.set(file.path, meta);
      return meta;
    } catch (err) {
      console.warn("ob-epub: epub meta extract failed for", file.path, err);
      const fallback: EpubBookMeta = {
        path: file.path,
        mtime: file.stat.mtime,
        title: "",
        author: "",
        coverFile: null,
        coverUrl: null,
      };
      this.memory.set(file.path, fallback);
      return fallback;
    } finally {
      try {
        book?.destroy();
      } catch {
        /* ignore */
      }
      this.releaseSlot();
    }
  }
}
