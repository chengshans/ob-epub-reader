import { App, normalizePath, TFile } from "obsidian";
import { EpubPluginSettings } from "./types";

export class ExcerptManager {
  private app: App;
  private settings: EpubPluginSettings;

  constructor(app: App, settings: EpubPluginSettings) {
    this.app = app;
    this.settings = settings;
  }

  updateSettings(settings: EpubPluginSettings) {
    this.settings = settings;
  }

  private getExcerptFilePath(bookTitle: string): string {
    const folder = this.settings.excerptFolder.replace(/\/$/, "");
    return normalizePath(`${folder}/《${bookTitle}》摘录.md`);
  }

  private formatDate(date: Date): string {
    return date.toISOString().replace("T", " ").slice(0, 16);
  }

  /** Build a markdown link back to the EPUB source position. */
  private buildSourceLink(epubSourcePath: string, cfi: string, vaultName: string): string {
    const params = new URLSearchParams();
    if (vaultName) params.set("vault", vaultName);
    params.set("file", epubSourcePath);
    if (cfi) params.set("cfi", cfi);
    const url = `obsidian://open?${params.toString()}`;
    // Angle brackets prevent ')' inside the CFI from breaking the markdown link.
    return `[回到原文](<${url}>)`;
  }

  async appendExcerpt(
    bookTitle: string,
    epubSourcePath: string,
    chapter: string,
    text: string,
    cfi: string,
    vaultName: string
  ) {
    const filePath = this.getExcerptFilePath(bookTitle);
    const now = new Date();
    const dateStr = this.formatDate(now);
    const excerptId = `excerpt-${Date.now().toString(36)}`;

    const excerptBlock = [
      `> [!quote] ${chapter}`,
      ...text.split("\n").map((line) => `> ${line}`),
      `> ^${excerptId}`,
      ``,
      `${this.buildSourceLink(epubSourcePath, cfi, vaultName)} · ${dateStr}`,
      ``,
      `---`,
      ``,
    ].join("\n");

    const existingFile = this.app.vault.getAbstractFileByPath(filePath);

    if (existingFile instanceof TFile) {
      const current = await this.app.vault.read(existingFile);
      await this.app.vault.modify(existingFile, current + "\n" + excerptBlock);
    } else {
      // Create folder if needed
      const folder = this.settings.excerptFolder;
      if (!this.app.vault.getAbstractFileByPath(folder)) {
        await this.app.vault.createFolder(folder).catch(() => {});
      }
      const frontmatter = [
        `---`,
        `epub-source: ${epubSourcePath}`,
        `created: ${now.toISOString().slice(0, 10)}`,
        `---`,
        ``,
        `# 《${bookTitle}》摘录`,
        ``,
      ].join("\n");
      await this.app.vault.create(filePath, frontmatter + excerptBlock);
    }

    return filePath;
  }

  async appendAIResponse(
    bookTitle: string,
    epubSourcePath: string,
    selectedText: string,
    aiResponse: string,
    cfi: string
  ) {
    const filePath = this.getExcerptFilePath(bookTitle);
    const now = new Date();
    const dateStr = this.formatDate(now);

    const block = [
      `> [!note] AI 解读 · ${dateStr}`,
      `> **原文**：${selectedText.slice(0, 100)}${selectedText.length > 100 ? "…" : ""}`,
      `>`,
      ...aiResponse.split("\n").map((line) => `> ${line}`),
      ``,
      `---`,
      ``,
    ].join("\n");

    const existingFile = this.app.vault.getAbstractFileByPath(filePath);

    if (existingFile instanceof TFile) {
      const current = await this.app.vault.read(existingFile);
      await this.app.vault.modify(existingFile, current + "\n" + block);
    } else {
      const folder = this.settings.excerptFolder;
      if (!this.app.vault.getAbstractFileByPath(folder)) {
        await this.app.vault.createFolder(folder).catch(() => {});
      }
      const frontmatter = [
        `---`,
        `epub-source: ${epubSourcePath}`,
        `created: ${now.toISOString().slice(0, 10)}`,
        `---`,
        ``,
        `# 《${bookTitle}》摘录`,
        ``,
      ].join("\n");
      await this.app.vault.create(filePath, frontmatter + block);
    }

    return filePath;
  }

  async openExcerptFile(bookTitle: string) {
    const filePath = this.getExcerptFilePath(bookTitle);
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.openFile(file);
    }
  }
}
