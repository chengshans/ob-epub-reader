import { App, TFile, normalizePath } from "obsidian";
import { AnnotationVaultStore } from "./AnnotationVaultStore";
import { isCfiAhead } from "./cfi/compare";
import { cfiSpineKey } from "./cfi/cfiMatch";
import { isBalancedEpubCfi, unescapeCfiString } from "./cfi/cfiString";
import { BookProgress, EpubPluginSettings } from "./types";

export { cfiSpineKey } from "./cfi/cfiMatch";

/** 旧版集中进度文件（仅用于一次性迁移读取） */
const PROGRESS_FILENAME = "reading-progress.json";
const HIDDEN_PROGRESS_FILENAME = ".reading-progress.json";

/** 将 epub.js 的 EpubCFI 对象或历史 JSON 对象统一为 CFI 字符串 */
export function normalizeCfi(cfi: unknown): string {
  if (!cfi) return "";
  let raw = "";
  if (typeof cfi === "string") {
    raw = cfi;
  } else if (typeof cfi === "object" && cfi !== null) {
    const obj = cfi as { str?: unknown; toString?: () => string };
    if (typeof obj.str === "string" && obj.str.startsWith("epubcfi(")) raw = obj.str;
    else if (typeof obj.toString === "function") {
      const s = obj.toString();
      if (s.startsWith("epubcfi(")) raw = s;
    }
  }
  if (!raw) return "";
  const trimmed = unescapeCfiString(raw.trim());
  if (!trimmed.startsWith("epubcfi(") || !isBalancedEpubCfi(trimmed)) return "";
  return trimmed;
}

/** epub.js 使用 0–1；兼容历史误存为 0–100 的数据 */
export function normalizePercent(percent: number): number {
  if (!Number.isFinite(percent) || percent < 0) return 0;
  if (percent > 1) return Math.min(percent / 100, 1);
  return percent;
}

function normalizeReadingTimeSeconds(seconds: number | undefined): number {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.floor(seconds);
}

function normalizeProgress(progress: BookProgress): BookProgress {
  return {
    ...progress,
    cfi: normalizeCfi(progress.cfi),
    percent: normalizePercent(progress.percent),
    readingTimeSeconds: normalizeReadingTimeSeconds(progress.readingTimeSeconds),
  };
}

export class ProgressStore {
  private progress: Record<string, BookProgress> = {};
  private app: App;
  private settings: EpubPluginSettings;
  private annotationVaultStore: AnnotationVaultStore;

  constructor(
    app: App,
    settings: EpubPluginSettings,
    annotationVaultStore: AnnotationVaultStore
  ) {
    this.app = app;
    this.settings = settings;
    this.annotationVaultStore = annotationVaultStore;
  }

  async updateSettings(settings: EpubPluginSettings) {
    this.settings = settings;
    this.annotationVaultStore.updateSettings(settings);
    await this.load();
  }

  private getExcerptFolder(): string {
    const folder = (this.settings.excerptFolder || "epub-books/anno").trim().replace(/\/$/, "");
    if (!folder) {
      throw new Error("摘录文件夹未设置");
    }
    return normalizePath(folder);
  }

  private getLegacyProgressFilePath(): string {
    return normalizePath(`${this.getExcerptFolder()}/${PROGRESS_FILENAME}`);
  }

  private getHiddenProgressFilePath(): string {
    return normalizePath(`${this.getExcerptFolder()}/${HIDDEN_PROGRESS_FILENAME}`);
  }

  /** 返回该书摘录 Markdown 路径（进度写入 frontmatter） */
  getProgressFilePath(epubFilePath?: string): string {
    if (epubFilePath) {
      return this.annotationVaultStore.getAnnotationFilePath(epubFilePath);
    }
    return this.getExcerptFolder();
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

  private parseProgressFile(content: string): Record<string, BookProgress> {
    const raw = JSON.parse(content) || {};
    const progress: Record<string, BookProgress> = {};
    for (const [filePath, entry] of Object.entries(raw)) {
      progress[filePath] = normalizeProgress(entry as BookProgress);
    }
    return progress;
  }

  private async readLegacyProgressFile(path: string): Promise<Record<string, BookProgress> | null> {
    const normalized = normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (!(file instanceof TFile)) return null;
    try {
      const content = await this.app.vault.read(file);
      return this.parseProgressFile(content);
    } catch (err) {
      console.warn(`ob-epub: failed to read legacy progress file ${normalized}`, err);
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
  ): Array<{ epubPath: string; progress: BookProgress }> {
    const toMigrate: Array<{ epubPath: string; progress: BookProgress }> = [];
    for (const [filePath, entry] of Object.entries(source)) {
      const normalized = normalizeProgress(entry);
      const existing = target[filePath];
      if (!existing || normalized.lastRead > existing.lastRead) {
        target[filePath] = normalized;
        toMigrate.push({ epubPath: filePath, progress: normalized });
      }
    }
    return toMigrate;
  }

  /** 内存未命中时从摘录 frontmatter 补读，避免启动竞态导致覆盖 */
  private async resolveExistingProgress(filePath: string): Promise<BookProgress | null> {
    const cached = this.progress[filePath];
    if (cached) return normalizeProgress(cached);
    const fromDisk = await this.annotationVaultStore.readProgress(filePath);
    if (!fromDisk) return null;
    const normalized = normalizeProgress(fromDisk);
    this.progress[filePath] = normalized;
    return normalized;
  }

  private shouldRejectProgressSave(
    existing: BookProgress | null,
    cfiStr: string,
    normalizedPercent: number
  ): boolean {
    if (!existing) return false;

    const existingKey = cfiSpineKey(existing.cfi);
    const newKey = cfiSpineKey(cfiStr);

    if (normalizedPercent + 0.02 < existing.percent) {
      if (!isCfiAhead(existing.cfi, cfiStr) && (!newKey || !existingKey || newKey <= existingKey)) {
        return true;
      }
    }

    // 禁止用开头的 0% 覆盖已有有效进度（重启恢复失败时的典型场景）
    if (existing.percent > 0.01 && normalizedPercent < 0.01) {
      if (!isCfiAhead(existing.cfi, cfiStr) && (!newKey || !existingKey || newKey <= existingKey)) {
        return true;
      }
    }

    return false;
  }

  async load() {
    const fromFrontmatter = await this.annotationVaultStore.scanAllProgress();
    this.progress = { ...fromFrontmatter };

    const legacy =
      (await this.readLegacyProgressFile(this.getLegacyProgressFilePath())) ?? {};
    const hidden = (await this.readHiddenProgressFile(this.getHiddenProgressFilePath())) ?? {};

    const legacyMerged = { ...legacy };
    this.mergeProgress(legacyMerged, hidden);

    // 仅将尚无 frontmatter 进度的书从旧 JSON 迁入，避免每次启动用旧 JSON 覆盖
    const toMigrate: Array<{ epubPath: string; progress: BookProgress }> = [];
    for (const [filePath, entry] of Object.entries(legacyMerged)) {
      if (fromFrontmatter[filePath]) continue;
      const normalized = normalizeProgress(entry);
      this.progress[filePath] = normalized;
      toMigrate.push({ epubPath: filePath, progress: normalized });
    }

    for (const { epubPath, progress } of toMigrate) {
      try {
        await this.annotationVaultStore.writeProgress(epubPath, progress);
      } catch (err) {
        console.error("ob-epub: failed to migrate progress to frontmatter for", epubPath, err);
      }
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
    const existing = await this.resolveExistingProgress(filePath);
    if (this.shouldRejectProgressSave(existing, cfiStr, normalizedPercent)) {
      return;
    }

    const entry: BookProgress = {
      cfi: cfiStr,
      chapter,
      percent: normalizedPercent,
      lastRead: new Date().toISOString(),
      readingTimeSeconds: existing?.readingTimeSeconds ?? 0,
    };

    this.progress[filePath] = entry;
    try {
      await this.annotationVaultStore.writeProgress(filePath, entry);
    } catch (err) {
      console.error(
        "ob-epub: failed to save reading progress to",
        this.getProgressFilePath(filePath),
        err
      );
      throw err;
    }
  }

  async saveReadingTime(
    filePath: string,
    totalSeconds: number,
    context?: { cfi: string; chapter: string; percent: number }
  ) {
    const normalizedTotal = normalizeReadingTimeSeconds(totalSeconds);
    const existing = await this.resolveExistingProgress(filePath);
    const existingSeconds = existing?.readingTimeSeconds ?? 0;
    if (normalizedTotal <= existingSeconds) return;

    const cfiStr = normalizeCfi(existing?.cfi || context?.cfi);
    if (!cfiStr) {
      console.warn("ob-epub: skip reading time save, empty CFI for", filePath);
      return;
    }

    const entry: BookProgress = {
      cfi: cfiStr,
      chapter: existing?.chapter || context?.chapter || "",
      percent: existing?.percent ?? normalizePercent(context?.percent ?? 0),
      lastRead: existing?.lastRead || new Date().toISOString(),
      readingTimeSeconds: normalizedTotal,
    };

    this.progress[filePath] = normalizeProgress(entry);
    try {
      await this.annotationVaultStore.writeProgress(filePath, this.progress[filePath]);
    } catch (err) {
      console.error(
        "ob-epub: failed to save reading time to",
        this.getProgressFilePath(filePath),
        err
      );
      throw err;
    }
  }

  getAllProgress(): Record<string, BookProgress> {
    return this.progress;
  }

  getPercent(filePath: string): number {
    return normalizePercent(this.progress[filePath]?.percent ?? 0);
  }

  /** 从旧的 data.json progress 迁移数据到摘录 frontmatter */
  async migrateFrom(oldProgress: Record<string, BookProgress>): Promise<void> {
    const toMigrate = this.mergeProgress(this.progress, oldProgress);
    for (const { epubPath, progress } of toMigrate) {
      try {
        await this.annotationVaultStore.writeProgress(epubPath, progress);
      } catch (err) {
        console.error("ob-epub: failed to migrate progress from data.json for", epubPath, err);
      }
    }
  }
}
