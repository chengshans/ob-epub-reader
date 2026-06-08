import { Plugin } from "obsidian";
import { BookProgress } from "./types";

export class ProgressStore {
  private progress: Record<string, BookProgress> = {};
  private plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  async load() {
    const saved = await this.plugin.loadData();
    if (saved?.progress) {
      this.progress = saved.progress;
    }
  }

  async save() {
    const existing = (await this.plugin.loadData()) ?? {};
    existing.progress = this.progress;
    await this.plugin.saveData(existing);
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
}
