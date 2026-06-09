import { App, TFile, normalizePath } from "obsidian";
import { BookProgress, EpubPluginSettings } from "./types";

export class ProgressStore {
  private progress: Record<string, BookProgress> = {};
  private app: App;
  private settings: EpubPluginSettings;

  constructor(app: App, settings: EpubPluginSettings) {
    this.app = app;
    this.settings = settings;
  }

  updateSettings(settings: EpubPluginSettings) {
    this.settings = settings;
  }

  private getProgressFilePath(): string {
    const folder = this.settings.excerptFolder.replace(/\/$/, "");
    return normalizePath(`${folder}/.reading-progress.json`);
  }

  async load() {
    const path = this.getProgressFilePath();
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      try {
        const content = await this.app.vault.read(file);
        this.progress = JSON.parse(content) || {};
      } catch {
        this.progress = {};
      }
    }
  }

  async save() {
    const folder = this.settings.excerptFolder.replace(/\/$/, "");
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => {});
    }
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
    return this.progress[filePath] ?? null;
  }

  async saveProgress(filePath: string, cfi: string, chapter: string, percent: number) {
    this.progress[filePath] = {
      cfi,
      chapter,
      percent,
      lastRead: new Date().toISOString(),
    };
    await this.save();
  }

  getAllProgress(): Record<string, BookProgress> {
    return this.progress;
  }

  getPercent(filePath: string): number {
    return this.progress[filePath]?.percent ?? 0;
  }

  /** 从旧的 data.json progress 迁移数据到 vault 文件 */
  async migrateFrom(oldProgress: Record<string, BookProgress>): Promise<void> {
    let changed = false;
    for (const [filePath, progress] of Object.entries(oldProgress)) {
      if (!this.progress[filePath]) {
        this.progress[filePath] = progress;
        changed = true;
      }
    }
    if (changed) {
      await this.save();
    }
  }
}
