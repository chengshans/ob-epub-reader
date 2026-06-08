import { Plugin } from "obsidian";
import { Annotation } from "./types";

/**
 * Persists user annotations (drawn lines + notes) per EPUB file inside the
 * plugin data store. Mirrors the design of ProgressStore.
 */
export class AnnotationStore {
  private annotations: Record<string, Annotation[]> = {};
  private plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  async load() {
    const saved = await this.plugin.loadData();
    if (saved?.annotations) {
      this.annotations = saved.annotations;
    }
  }

  private async save() {
    const existing = (await this.plugin.loadData()) ?? {};
    existing.annotations = this.annotations;
    await this.plugin.saveData(existing);
  }

  getByFile(filePath: string): Annotation[] {
    return this.annotations[filePath] ?? [];
  }

  get(filePath: string, id: string): Annotation | null {
    return this.getByFile(filePath).find((a) => a.id === id) ?? null;
  }

  getByCfi(filePath: string, cfiRange: string): Annotation | null {
    return this.getByFile(filePath).find((a) => a.cfiRange === cfiRange) ?? null;
  }

  async add(filePath: string, annotation: Annotation) {
    if (!this.annotations[filePath]) {
      this.annotations[filePath] = [];
    }
    this.annotations[filePath].push(annotation);
    await this.save();
  }

  async update(filePath: string, id: string, patch: Partial<Annotation>) {
    const list = this.annotations[filePath];
    if (!list) return;
    const idx = list.findIndex((a) => a.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...patch };
      await this.save();
    }
  }

  async remove(filePath: string, id: string) {
    const list = this.annotations[filePath];
    if (!list) return;
    this.annotations[filePath] = list.filter((a) => a.id !== id);
    await this.save();
  }
}
