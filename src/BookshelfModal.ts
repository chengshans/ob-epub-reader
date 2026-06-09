import { App, Modal, TFile } from "obsidian";
import { ProgressStore } from "./ProgressStore";
import { formatReadingTime } from "./types";

export class BookshelfModal extends Modal {
  private progressStore: ProgressStore;
  private openCallback: (file: TFile) => void;

  constructor(app: App, progressStore: ProgressStore, onOpen: (file: TFile) => void) {
    super(app);
    this.progressStore = progressStore;
    this.openCallback = onOpen;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ob-epub-bookshelf");

    contentEl.createEl("h2", { text: "📚 EPUB 书架" });

    const epubFiles = this.app.vault.getFiles().filter((f) => f.extension === "epub");

    if (epubFiles.length === 0) {
      contentEl.createEl("p", { text: "Vault 中没有找到 EPUB 文件。" });
      return;
    }

    const list = contentEl.createDiv({ cls: "bookshelf-list" });

    for (const file of epubFiles) {
      const progress = this.progressStore.getProgress(file.path);
      const percent = progress ? Math.round(progress.percent * 100) : 0;

      const item = list.createDiv({ cls: "bookshelf-item" });

      const info = item.createDiv({ cls: "bookshelf-info" });
      info.createEl("div", { cls: "bookshelf-title", text: file.basename });
      info.createEl("div", { cls: "bookshelf-path", text: file.path });

      const meta = item.createDiv({ cls: "bookshelf-meta" });

      const progressBar = meta.createDiv({ cls: "bookshelf-progress-wrap" });
      const bar = progressBar.createDiv({ cls: "bookshelf-progress-bar" });
      bar.style.width = `${percent}%`;
      progressBar.createEl("span", { cls: "bookshelf-percent", text: `${percent}%` });

      if (progress) {
        meta.createEl("div", {
          cls: "bookshelf-last-read",
          text: `上次阅读：${progress.chapter || "未知章节"} · ${progress.lastRead.slice(0, 10)}`,
        });
        const readingSeconds = progress.readingTimeSeconds ?? 0;
        if (readingSeconds > 0) {
          meta.createEl("div", {
            cls: "bookshelf-reading-time",
            text: `已读 ${formatReadingTime(readingSeconds)}`,
          });
        }
      }

      item.addEventListener("click", () => {
        this.close();
        this.openCallback(file);
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
