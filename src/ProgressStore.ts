import { App, TFile, normalizePath } from "obsidian";
import { BookProgress, EpubPluginSettings } from "./types";

/** 主进度文件（Vault 可索引，用 vault API 读写） */
const PROGRESS_FILENAME = "reading-progress.json";
/** 旧版隐藏文件（adapter 读写，加载后迁移到主文件） */
const HIDDEN_PROGRESS_FILENAME = ".reading-progress.json";

/** 将 epub.js 的 EpubCFI 对象或历史 JSON 对象统一为 CFI 字符串 */
export function normalizeCfi(cfi: unknown): string {
  if (!cfi) return "";
  if (typeof cfi === "string") return cfi;
  if (typeof cfi === "object" && cfi !== null) {
    const obj = cfi as { str?: unknown; toString?: () => string };
    if (typeof obj.str === "string" && obj.str.startsWith("epubcfi(")) return obj.str;
    if (typeof obj.toString === "function") {
      const s = obj.toString();
      if (s.startsWith("epubcfi(")) return s;
    }
  }
  return "";
}

/** epub.js 使用 0–1；兼容历史误存为 0–100 的数据 */
export function normalizePercent(percent: number): number {
  if (!Number.isFinite(percent) || percent < 0) return 0;
  if (percent > 1) return Math.min(percent / 100, 1);
  return percent;
}

function normalizeProgress(progress: BookProgress): BookProgress {
  return {
    ...progress,
    cfi: normalizeCfi(progress.cfi),
    percent: normalizePercent(progress.percent),
  };
}

export class ProgressStore {
  private progress: Record<string, BookProgress> = {};
  private app: App;
  private settings: EpubPluginSettings;

  constructor(app: App, settings: EpubPluginSettings) {
    this.app = app;
    this.settings = settings;
  }

  async updateSettings(settings: EpubPluginSettings) {
    this.settings = settings;
    await this.load();
  }

  private getExcerptFolder(): string {
    const folder = (this.settings.excerptFolder || "co-books").trim().replace(/\/$/, "");
    if (!folder) {
      throw new Error("摘录文件夹未设置");
    }
    return normalizePath(folder);
  }

  getProgressFilePath(): string {
    return normalizePath(`${this.getExcerptFolder()}/${PROGRESS_FILENAME}`);
  }

  private getHiddenProgressFilePath(): string {
    return normalizePath(`${this.getExcerptFolder()}/${HIDDEN_PROGRESS_FILENAME}`);
  }

  private get adapter() {
    return this.app.vault.adapter;
  }

  private async adapterExists(path: string): Promise<boolean> {
    try {
      return await this.adapter.exists(normalizePath(path));
    } catch {
      return false;
    }
  }

  /** 与 AnnotationVaultStore 一致：优先 vault.createFolder */
  private async ensureFolder(folder: string): Promise<void> {
    const normalized = normalizePath(folder.replace(/\/$/, ""));
    const parts = normalized.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const path = normalizePath(current);
      if (this.app.vault.getAbstractFileByPath(path)) continue;
      try {
        await this.app.vault.createFolder(path);
      } catch {
        if (!(await this.adapterExists(path))) {
          await this.adapter.mkdir(path);
        }
      }
    }
  }

  private parseProgressFile(content: string): Record<string, BookProgress> {
    const raw = JSON.parse(content) || {};
    const progress: Record<string, BookProgress> = {};
    for (const [filePath, entry] of Object.entries(raw)) {
      progress[filePath] = normalizeProgress(entry as BookProgress);
    }
    return progress;
  }

  private async readVaultProgressFile(path: string): Promise<Record<string, BookProgress> | null> {
    const normalized = normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (!(file instanceof TFile)) return null;
    try {
      const content = await this.app.vault.read(file);
      return this.parseProgressFile(content);
    } catch (err) {
      console.warn(`ob-epub: failed to read progress file ${normalized}`, err);
      return null;
    }
  }

  /** 读取旧版隐藏进度文件（Obsidian Vault API 无法索引） */
  private async readHiddenProgressFile(path: string): Promise<Record<string, BookProgress> | null> {
    const normalized = normalizePath(path);
    if (!(await this.adapterExists(normalized))) return null;
    try {
      const content = await this.adapter.read(normalized);
      return this.parseProgressFile(content);
    } catch (err) {
      console.warn(`ob-epub: failed to read hidden progress file ${normalized}`, err);
      return null;
    }
  }

  private mergeProgress(
    target: Record<string, BookProgress>,
    source: Record<string, BookProgress>
  ): boolean {
    let changed = false;
    for (const [filePath, entry] of Object.entries(source)) {
      const existing = target[filePath];
      if (!existing || entry.lastRead > existing.lastRead) {
        target[filePath] = entry;
        changed = true;
      }
    }
    return changed;
  }

  async load() {
    const currentPath = this.getProgressFilePath();
    const hiddenPath = this.getHiddenProgressFilePath();

    const current = (await this.readVaultProgressFile(currentPath)) ?? {};
    const hidden = await this.readHiddenProgressFile(hiddenPath);

    this.progress = { ...current };
    let dirty = false;

    if (hidden) {
      dirty = this.mergeProgress(this.progress, hidden);
    }

    for (const entry of Object.values(this.progress)) {
      if (typeof entry.cfi !== "string" || entry.percent > 1) dirty = true;
    }

    if (dirty) {
      try {
        await this.save();
      } catch (err) {
        console.error("ob-epub: failed to migrate/normalize progress file", err);
      }
    }
  }

  async save() {
    const folder = this.getExcerptFolder();
    await this.ensureFolder(folder);

    const path = this.getProgressFilePath();
    const content = JSON.stringify(this.progress, null, 2);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(path, content);
    }
  }

  getProgress(filePath: string): BookProgress | null {
    const progress = this.progress[filePath];
    if (!progress) return null;
    return normalizeProgress(progress);
  }

  async saveProgress(filePath: string, cfi: unknown, chapter: string, percent: number) {
    const cfiStr = normalizeCfi(cfi);
    if (!cfiStr) {
      console.warn("ob-epub: skip progress save, empty CFI for", filePath);
      return;
    }

    const normalizedPercent = normalizePercent(percent);
    const existing = this.progress[filePath];
    if (existing && normalizedPercent + 0.02 < existing.percent) {
      const existingKey = cfiSpineKey(existing.cfi);
      const newKey = cfiSpineKey(cfiStr);
      if (!newKey || !existingKey || newKey <= existingKey) {
        return;
      }
    }

    this.progress[filePath] = {
      cfi: cfiStr,
      chapter,
      percent: normalizedPercent,
      lastRead: new Date().toISOString(),
    };
    try {
      await this.save();
    } catch (err) {
      console.error("ob-epub: failed to save reading progress to", this.getProgressFilePath(), err);
      throw err;
    }
  }

  getAllProgress(): Record<string, BookProgress> {
    return this.progress;
  }

  getPercent(filePath: string): number {
    return normalizePercent(this.progress[filePath]?.percent ?? 0);
  }

  /** 从旧的 data.json progress 迁移数据到 vault 文件 */
  async migrateFrom(oldProgress: Record<string, BookProgress>): Promise<void> {
    let changed = false;
    for (const [filePath, progress] of Object.entries(oldProgress)) {
      if (!this.progress[filePath]) {
        this.progress[filePath] = normalizeProgress(progress);
        changed = true;
      }
    }
    if (changed) {
      await this.save();
    }
  }
}

/** 提取 CFI 中的 spine 章节序号，用于比较阅读深度 */
function cfiSpineKey(cfi: string): number {
  const match = cfi.match(/epubcfi\(\/6\/(\d+)!/);
  return match ? Number(match[1]) : 0;
}
