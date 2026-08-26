import { ItemView, Menu, TFile, WorkspaceLeaf } from "obsidian";
import { EpubBookMeta, EpubMetaCache } from "./EpubMetaCache";
import { t } from "./i18n/i18n";
import { BOOKSHELF_ICON_ID } from "./icons/bookshelfIcon";
import { ProgressStore } from "./ProgressStore";
import { BookProgress } from "./types";

export const BOOKSHELF_VIEW_TYPE = "epub-bookshelf";

interface BookshelfCardRef {
  file: TFile;
  itemEl: HTMLElement;
  coverWrap: HTMLElement;
  titleEl: HTMLElement;
  authorEl: HTMLElement;
  progressBarEl: HTMLElement;
  percentEl: HTMLElement;
  metaRowEl: HTMLElement;
  dateEl: HTMLElement | null;
  imgEl: HTMLImageElement | null;
}

export class BookshelfView extends ItemView {
  private progressStore: ProgressStore;
  private metaCache: EpubMetaCache;
  private openCallback: (file: TFile) => void;
  private renderGeneration = 0;

  constructor(
    leaf: WorkspaceLeaf,
    progressStore: ProgressStore,
    metaCache: EpubMetaCache,
    onOpen: (file: TFile) => void
  ) {
    super(leaf);
    this.progressStore = progressStore;
    this.metaCache = metaCache;
    this.openCallback = onOpen;
  }

  getViewType(): string {
    return BOOKSHELF_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t("bookshelf.title");
  }

  getIcon(): string {
    return BOOKSHELF_ICON_ID;
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.renderGeneration += 1;
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
    const generation = ++this.renderGeneration;
    const container = this.contentEl;
    container.empty();
    container.addClass("ob-epub-bookshelf-view");

    container.createEl("h4", { cls: "bookshelf-heading", text: t("bookshelf.heading") });

    const epubFiles = this.app.vault
      .getFiles()
      .filter((f) => f.extension === "epub")
      .sort((a, b) => {
        const pa = this.progressStore.getProgress(a.path);
        const pb = this.progressStore.getProgress(b.path);
        const ta = pa?.lastRead ? Date.parse(pa.lastRead) : 0;
        const tb = pb?.lastRead ? Date.parse(pb.lastRead) : 0;
        if (tb !== ta) return tb - ta;
        return a.basename.localeCompare(b.basename);
      });

    if (epubFiles.length === 0) {
      container.createEl("p", { cls: "bookshelf-empty", text: t("bookshelf.empty") });
      return;
    }

    const grid = container.createDiv({ cls: "bookshelf-grid" });
    const cardRefs: BookshelfCardRef[] = [];

    for (const file of epubFiles) {
      const progress = this.progressStore.getProgress(file.path);
      const peeked = this.metaCache.peek(file.path);

      const item = grid.createDiv({ cls: "bookshelf-item" });
      item.setAttr("role", "button");
      item.setAttr("tabindex", "0");

      const coverWrap = item.createDiv({ cls: "bookshelf-cover-wrap" });
      let imgEl: HTMLImageElement | null = null;
      if (peeked?.coverUrl) {
        imgEl = coverWrap.createEl("img", {
          cls: "bookshelf-cover",
          attr: { alt: peeked.title || file.basename },
        });
        imgEl.src = peeked.coverUrl;
      } else {
        const placeholder = coverWrap.createDiv({
          cls: "bookshelf-cover-placeholder",
          attr: { "aria-label": t("bookshelf.noCover") },
        });
        placeholder.createSpan({ text: "EPUB" });
      }

      const metaRow = item.createDiv({ cls: "bookshelf-card-meta" });
      const progressWrap = metaRow.createDiv({ cls: "bookshelf-progress-wrap" });
      const progressBarEl = progressWrap.createDiv({ cls: "bookshelf-progress-bar" });
      const percentEl = metaRow.createEl("span", { cls: "bookshelf-percent", text: "0%" });

      const titleEl = item.createDiv({
        cls: "bookshelf-title",
        text: peeked?.title || file.basename,
      });
      const authorEl = item.createDiv({
        cls: "bookshelf-author",
        text: peeked?.author || t("bookshelf.unknownAuthor"),
      });

      const card: BookshelfCardRef = {
        file,
        itemEl: item,
        coverWrap,
        titleEl,
        authorEl,
        progressBarEl,
        percentEl,
        metaRowEl: metaRow,
        dateEl: null,
        imgEl,
      };
      this.applyProgressToCard(card, progress);

      item.addEventListener("click", () => {
        this.openCallback(file);
      });
      item.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          this.openCallback(file);
        }
      });
      item.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        const menu = new Menu();
        const isFinished = this.progressStore.getProgress(file.path)?.finished === true;
        if (isFinished) {
          menu.addItem((menuItem) => {
            menuItem.setTitle(t("bookshelf.unmarkFinished")).onClick(() => {
              void this.progressStore.setFinished(file.path, false).then(() => this.refresh());
            });
          });
        } else {
          menu.addItem((menuItem) => {
            menuItem.setTitle(t("bookshelf.markFinished")).onClick(() => {
              void this.progressStore.setFinished(file.path, true).then(() => this.refresh());
            });
          });
        }
        menu.showAtMouseEvent(evt);
      });

      cardRefs.push(card);
    }

    void this.fillProgressAndMetaAsync(generation, cardRefs);
  }

  private applyProgressToCard(card: BookshelfCardRef, progress: BookProgress | null): void {
    const percent = progress ? Math.round(progress.percent * 100) : 0;
    const finished = progress?.finished === true;
    const date = progress?.lastRead ? progress.lastRead.slice(0, 10) : "";

    card.progressBarEl.setCssProps({ width: `${Math.max(percent, 0)}%` });
    card.percentEl.setText(`${percent}%`);

    if (date) {
      if (!card.dateEl) {
        card.dateEl = card.metaRowEl.createEl("span", { cls: "bookshelf-date", text: date });
      } else {
        card.dateEl.setText(date);
      }
    } else if (card.dateEl) {
      card.dateEl.remove();
      card.dateEl = null;
    }

    const existingBadge = card.coverWrap.querySelector(".bookshelf-badge-finished");
    if (finished && !existingBadge) {
      card.coverWrap.createEl("span", {
        cls: "bookshelf-badge-finished",
        text: t("bookshelf.finished"),
      });
    } else if (!finished && existingBadge) {
      existingBadge.remove();
    }
  }

  private async fillProgressAndMetaAsync(
    generation: number,
    cards: BookshelfCardRef[]
  ): Promise<void> {
    for (const card of cards) {
      if (generation !== this.renderGeneration) return;
      try {
        const progress = await this.progressStore.resolveProgress(card.file.path);
        if (generation !== this.renderGeneration) return;
        this.applyProgressToCard(card, progress);
      } catch (err) {
        console.warn("ob-epub: bookshelf progress resolve failed", card.file.path, err);
      }

      if (generation !== this.renderGeneration) return;
      try {
        const meta = await this.metaCache.getMeta(card.file);
        if (generation !== this.renderGeneration) return;
        this.applyMetaToCard(card, meta);
      } catch (err) {
        console.warn("ob-epub: bookshelf meta fill failed", card.file.path, err);
      }
    }
  }

  private applyMetaToCard(card: BookshelfCardRef, meta: EpubBookMeta): void {
    const title = meta.title || card.file.basename;
    const author = meta.author || t("bookshelf.unknownAuthor");
    card.titleEl.setText(title);
    card.authorEl.setText(author);

    if (!meta.coverUrl) return;

    if (card.imgEl) {
      card.imgEl.src = meta.coverUrl;
      card.imgEl.alt = title;
      return;
    }

    card.coverWrap.querySelector(".bookshelf-cover-placeholder")?.remove();
    const img = card.coverWrap.createEl("img", {
      cls: "bookshelf-cover",
      attr: { alt: title },
    });
    img.src = meta.coverUrl;
    const badge = card.coverWrap.querySelector(".bookshelf-badge-finished");
    if (badge) {
      card.coverWrap.insertBefore(img, badge);
    }
    card.imgEl = img;
  }
}
