import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { BOOKSHELF_ICON_ID } from "./icons/bookshelfIcon";
import { ProgressStore } from "./ProgressStore";
import { formatReadingTime } from "./types";

export const BOOKSHELF_VIEW_TYPE = "epub-bookshelf";

export class BookshelfView extends ItemView {
  private progressStore: ProgressStore;
  private openCallback: (file: TFile) => void;

  constructor(
    leaf: WorkspaceLeaf,
    progressStore: ProgressStore,
    onOpen: (file: TFile) => void
  ) {
    super(leaf);
    this.progressStore = progressStore;
    this.openCallback = onOpen;
  }

  getViewType(): string {
    return BOOKSHELF_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "EPUB 书架";
  }

  getIcon(): string {
    return BOOKSHELF_ICON_ID;
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    try {
      this.contentEl.empty();
    } catch (err) {
      console.error("ob-epub: bookshelf onClose failed", err);
    }
  }

  refresh(): void {
    this.render();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("ob-epub-bookshelf-view");

    container.createEl("h4", { cls: "bookshelf-heading", text: "📚 EPUB 书架" });

    const epubFiles = this.app.vault.getFiles().filter((f) => f.extension === "epub");

    if (epubFiles.length === 0) {
      container.createEl("p", { cls: "bookshelf-empty", text: "Vault 中没有找到 EPUB 文件。" });
      return;
    }

    const list = container.createDiv({ cls: "bookshelf-list" });

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
        this.openCallback(file);
      });
    }
  }
}
