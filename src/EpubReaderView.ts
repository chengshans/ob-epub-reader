import { FileView, Notice, TFile } from "obsidian";
import ePub, { Book, Rendition, NavItem } from "epubjs";
import { ExcerptManager } from "./ExcerptManager";
import { ProgressStore } from "./ProgressStore";
import { AIService } from "./AIService";
import { EpubPluginSettings } from "./types";

export const EPUB_READER_VIEW_TYPE = "epub-reader";

export class EpubReaderView extends FileView {
  private book: Book | null = null;
  private rendition: Rendition | null = null;
  private currentCfi: string = "";
  private currentChapter: string = "";
  private tocItems: NavItem[] = [];
  private flow: "paginated" | "scrolled";
  private fontSize: number;
  private contextMenu: HTMLElement | null = null;
  private selectedText: string = "";
  private selectedCfi: string = "";
  private resizeObserver: ResizeObserver | null = null;

  private excerptManager: ExcerptManager;
  private progressStore: ProgressStore;
  private aiService: AIService;
  private settings: EpubPluginSettings;

  // Layout elements
  private toolbarEl: HTMLElement | null = null;
  private tocEl: HTMLElement | null = null;
  private readerEl: HTMLElement | null = null;
  private progressEl: HTMLElement | null = null;
  private tocToggleBtn: HTMLElement | null = null;
  private tocVisible: boolean = true;

  constructor(
    leaf: WorkspaceLeaf,
    excerptManager: ExcerptManager,
    progressStore: ProgressStore,
    aiService: AIService,
    settings: EpubPluginSettings
  ) {
    super(leaf);
    this.excerptManager = excerptManager;
    this.progressStore = progressStore;
    this.aiService = aiService;
    this.settings = settings;
    this.flow = settings.defaultFlow;
    this.fontSize = settings.fontSize;
  }

  getViewType(): string {
    return EPUB_READER_VIEW_TYPE;
  }

  canAcceptExtension(extension: string): boolean {
    return extension === "epub";
  }

  getDisplayText(): string {
    return this.file?.basename ?? "EPUB Reader";
  }

  getIcon(): string {
    return "book-open";
  }

  async onOpen() {
    this.buildLayout();
  }

  async onClose() {
    this.destroyBook();
  }

  // FileView lifecycle: called by Obsidian when a file is opened in this view
  async onLoadFile(file: TFile): Promise<void> {
    const titleEl = this.toolbarEl?.querySelector("#epub-toolbar-title") as HTMLElement | null;
    if (titleEl) titleEl.textContent = file.basename;
    const savedProgress = this.progressStore.getProgress(file.path);
    await this.loadBook(file, savedProgress?.cfi ?? "");
  }

  // FileView lifecycle: called when switching away from this file
  async onUnloadFile(_file: TFile): Promise<void> {
    this.destroyBook();
  }

  private buildLayout() {
    const container = this.contentEl;
    container.empty();
    container.addClass("ob-epub-container");

    // Toolbar
    this.toolbarEl = container.createDiv({ cls: "epub-toolbar" });
    this.buildToolbar(this.toolbarEl);

    // Body: TOC + Reader
    const bodyEl = container.createDiv({ cls: "epub-body" });

    // TOC sidebar
    this.tocEl = bodyEl.createDiv({ cls: "epub-toc" });
    this.tocEl.createEl("div", { cls: "epub-toc-header", text: "目录" });

    // Reader area
    this.readerEl = bodyEl.createDiv({ cls: "epub-reader-area" });

    // Bottom progress bar
    this.progressEl = container.createDiv({ cls: "epub-progress-bar-wrap" });
    const progressInner = this.progressEl.createDiv({ cls: "epub-progress-inner" });
    progressInner.createDiv({ cls: "epub-progress-fill", attr: { id: "epub-progress-fill" } });
    this.progressEl.createEl("span", { cls: "epub-progress-text", attr: { id: "epub-progress-text" }, text: "0%" });

    // ResizeObserver: 通知 epub.js 重绘
    this.resizeObserver = new ResizeObserver(() => {
      if (this.rendition && this.readerEl) {
        const r = this.readerEl.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          this.rendition.resize(r.width, r.height);
        }
      }
    });
    this.resizeObserver.observe(this.readerEl!);
  }

  private buildToolbar(toolbar: HTMLElement) {
    toolbar.empty();

    // TOC toggle
    this.tocToggleBtn = toolbar.createEl("button", { cls: "epub-toolbar-btn", text: "☰" });
    this.tocToggleBtn.title = "切换目录";
    this.tocToggleBtn.addEventListener("click", () => this.toggleToc());

    // Book title
    const titleEl = toolbar.createEl("span", { cls: "epub-toolbar-title", text: this.file?.basename ?? "EPUB Reader" });
    titleEl.id = "epub-toolbar-title";

    // Spacer
    toolbar.createEl("span", { cls: "epub-toolbar-spacer" });

    // Font size controls
    const fontSizeDown = toolbar.createEl("button", { cls: "epub-toolbar-btn", text: "A-" });
    fontSizeDown.title = "减小字体";
    fontSizeDown.addEventListener("click", () => this.changeFontSize(-2));

    const fontSizeUp = toolbar.createEl("button", { cls: "epub-toolbar-btn", text: "A+" });
    fontSizeUp.title = "增大字体";
    fontSizeUp.addEventListener("click", () => this.changeFontSize(2));

    // Flow toggle
    const flowBtn = toolbar.createEl("button", {
      cls: "epub-toolbar-btn",
      text: this.flow === "paginated" ? "📄 分页" : "📜 滚动",
      attr: { id: "epub-flow-btn" },
    });
    flowBtn.title = "切换阅读模式";
    flowBtn.addEventListener("click", () => this.toggleFlow());

    // Prev / Next
    const prevBtn = toolbar.createEl("button", { cls: "epub-toolbar-btn", text: "◀" });
    prevBtn.title = "上一页";
    prevBtn.addEventListener("click", () => this.rendition?.prev());

    const nextBtn = toolbar.createEl("button", { cls: "epub-toolbar-btn", text: "▶" });
    nextBtn.title = "下一页";
    nextBtn.addEventListener("click", () => this.rendition?.next());

    // Bookshelf button
    const shelfBtn = toolbar.createEl("button", { cls: "epub-toolbar-btn", text: "📚" });
    shelfBtn.title = "书架";
    shelfBtn.addEventListener("click", () => {
      // Trigger bookshelf via custom event
      this.containerEl.dispatchEvent(new CustomEvent("epub-open-bookshelf"));
    });
  }

  private toggleToc() {
    this.tocVisible = !this.tocVisible;
    if (this.tocEl) {
      this.tocEl.style.display = this.tocVisible ? "" : "none";
    }
  }

  private changeFontSize(delta: number) {
    this.fontSize = Math.max(10, Math.min(32, this.fontSize + delta));
    if (this.rendition) {
      this.rendition.themes.fontSize(`${this.fontSize}px`);
    }
  }

  private toggleFlow() {
    this.flow = this.flow === "paginated" ? "scrolled" : "paginated";
    const btn = this.toolbarEl?.querySelector("#epub-flow-btn") as HTMLElement | null;
    if (btn) btn.textContent = this.flow === "paginated" ? "📄 分页" : "📜 滚动";

    if (this.file) {
      const savedCfi = this.currentCfi;
      this.destroyBook();
      this.loadBook(this.file, savedCfi);
    }
  }

  private destroyBook() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.rendition) {
      this.rendition.destroy();
      this.rendition = null;
    }
    if (this.book) {
      this.book.destroy();
      this.book = null;
    }
    if (this.readerEl) {
      this.readerEl.empty();
    }
  }

  private async loadBook(file: TFile, startCfi: string = "") {
    if (!this.readerEl) return;
    this.readerEl.empty();
    this.destroyBook();

    const loadingEl = this.readerEl.createEl("div", { cls: "epub-loading", text: "正在加载 EPUB…" });

    try {
      const arrayBuffer = await this.app.vault.adapter.readBinary(file.path);
      this.book = ePub(arrayBuffer as ArrayBuffer);

      await this.book.ready;
      loadingEl.remove();

      // 等一帧确保 readerEl 已有真实布局尺寸
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

      const rect = this.readerEl.getBoundingClientRect();
      const w = Math.max(rect.width || 600, 300);
      const h = Math.max(rect.height || 500, 200);

      // Render
      this.rendition = this.book.renderTo(this.readerEl, {
        flow: this.flow,
        width: w,
        height: h,
        allowScriptedContent: false,
      });

      // Apply font size
      this.rendition.themes.fontSize(`${this.fontSize}px`);

      // Apply theme CSS variables
      this.applyTheme();

      // Register selection listener
      this.rendition.on("selected", (cfiRange: string, contents: any) => {
        const selection = contents?.window?.getSelection();
        const text = selection?.toString() ?? "";
        if (text.trim()) {
          this.selectedText = text.trim();
          this.selectedCfi = cfiRange;
          this.showContextMenu(contents);
        }
      });

      // Track location changes
      this.rendition.on("relocated", (location: any) => {
        this.currentCfi = location?.start?.cfi ?? "";
        const percentage = location?.start?.percentage ?? 0;
        this.updateProgressBar(percentage);

        // Save progress
        if (this.file) {
          this.progressStore.saveProgress(
            this.file.path,
            this.currentCfi,
            this.currentChapter,
            percentage
          );
        }
      });

      // Navigate to saved position or start
      if (startCfi) {
        await this.rendition.display(startCfi);
      } else {
        await this.rendition.display();
      }

      // Load TOC
      await this.loadToc();
    } catch (err) {
      loadingEl.textContent = `加载失败: ${err}`;
      console.error("EPUB load error:", err);
    }
  }

  private applyTheme() {
    if (!this.rendition) return;
    const isDark = document.body.hasClass("theme-dark");

    this.rendition.themes.register("custom", {
      body: {
        background: isDark ? "var(--background-primary)" : "var(--background-primary)",
        color: isDark ? "var(--text-normal)" : "var(--text-normal)",
        "font-family": "var(--font-text)",
        "line-height": "1.8",
        padding: "2em 3em",
      },
      "a": { color: "var(--link-color)" },
      "::selection": { background: "var(--text-selection)" },
    });
    this.rendition.themes.select("custom");
    this.rendition.themes.fontSize(`${this.fontSize}px`);
  }

  private async loadToc() {
    if (!this.book || !this.tocEl) return;

    const nav = await this.book.loaded.navigation;
    this.tocItems = nav.toc;

    const tocList = this.tocEl.querySelector(".epub-toc-list") ?? this.tocEl.createEl("ul", { cls: "epub-toc-list" });
    tocList.empty();

    this.renderTocItems(this.tocItems, tocList as HTMLElement, 0);
  }

  private renderTocItems(items: NavItem[], container: HTMLElement, depth: number) {
    for (const item of items) {
      const li = container.createEl("li", { cls: "epub-toc-item" });
      li.style.paddingLeft = `${depth * 12}px`;

      const label = li.createEl("span", { cls: "epub-toc-label", text: item.label.trim() });
      label.addEventListener("click", () => {
        this.currentChapter = item.label.trim();
        this.rendition?.display(item.href);
      });

      if (item.subitems && item.subitems.length > 0) {
        const toggle = li.createEl("span", { cls: "epub-toc-toggle", text: "▶" });
        const subList = li.createEl("ul", { cls: "epub-toc-sublist" });
        subList.style.display = "none";

        toggle.addEventListener("click", (e) => {
          e.stopPropagation();
          const expanded = subList.style.display !== "none";
          subList.style.display = expanded ? "none" : "";
          toggle.textContent = expanded ? "▶" : "▼";
        });

        this.renderTocItems(item.subitems, subList, depth + 1);
      }
    }
  }

  private updateProgressBar(percent: number) {
    const fill = this.containerEl.querySelector("#epub-progress-fill") as HTMLElement | null;
    const text = this.containerEl.querySelector("#epub-progress-text") as HTMLElement | null;
    const pct = Math.round(percent * 100);
    if (fill) fill.style.width = `${pct}%`;
    if (text) text.textContent = `${pct}%`;
  }

  private showContextMenu(contents: any) {
    this.dismissContextMenu();

    const menu = document.createElement("div");
    menu.className = "epub-context-menu";

    const highlightBtn = menu.createEl("button", { cls: "epub-ctx-btn", text: "🖊 高亮" });
    highlightBtn.addEventListener("click", () => {
      if (this.rendition && this.selectedCfi) {
        this.rendition.annotations.highlight(this.selectedCfi, {}, (e: Event) => {});
      }
      this.dismissContextMenu();
    });

    const excerptBtn = menu.createEl("button", { cls: "epub-ctx-btn", text: "📋 摘录" });
    excerptBtn.addEventListener("click", async () => {
      this.dismissContextMenu();
      await this.saveExcerpt();
    });

    const aiBtn = menu.createEl("button", { cls: "epub-ctx-btn", text: "🤖 AI" });
    aiBtn.addEventListener("click", async () => {
      this.dismissContextMenu();
      await this.runAI();
    });

    // Position near selection
    const iframe = this.readerEl?.querySelector("iframe") as HTMLIFrameElement | null;
    const sel = contents?.window?.getSelection();
    if (sel && sel.rangeCount > 0 && iframe) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const iframeRect = iframe.getBoundingClientRect();
      menu.style.position = "fixed";
      menu.style.top = `${iframeRect.top + rect.bottom + 5}px`;
      menu.style.left = `${iframeRect.left + rect.left}px`;
    } else {
      menu.style.position = "fixed";
      menu.style.top = "50%";
      menu.style.left = "50%";
    }

    document.body.appendChild(menu);
    this.contextMenu = menu;

    // Dismiss on click outside
    setTimeout(() => {
      document.addEventListener("mousedown", this.dismissContextMenuBound, { once: true });
    }, 100);
  }

  private dismissContextMenuBound = () => this.dismissContextMenu();

  private dismissContextMenu() {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
    document.removeEventListener("mousedown", this.dismissContextMenuBound);
  }

  private async saveExcerpt() {
    if (!this.file || !this.selectedText) return;
    const vaultName = (this.app.vault as any).getName?.() ?? "";
    try {
      const filePath = await this.excerptManager.appendExcerpt(
        this.file.basename,
        this.file.path,
        this.currentChapter || "未知章节",
        this.selectedText,
        this.selectedCfi,
        vaultName
      );
      new Notice(`✅ 摘录已保存到 ${filePath}`);
    } catch (err) {
      new Notice(`❌ 摘录保存失败: ${err}`);
    }
  }

  private async runAI() {
    if (!this.file || !this.selectedText) return;
    if (!this.aiService.isConfigured()) {
      new Notice("请先在设置中配置 AI API Key");
      return;
    }

    const notice = new Notice("🤖 AI 正在思考…", 0);
    try {
      const result = await this.aiService.query(this.selectedText);
      notice.hide();
      const vaultName = (this.app.vault as any).getName?.() ?? "";
      const filePath = await this.excerptManager.appendAIResponse(
        this.file.basename,
        this.file.path,
        this.selectedText,
        result,
        this.selectedCfi
      );
      new Notice(`✅ AI 回复已写入 ${filePath}`);
    } catch (err) {
      notice.hide();
      new Notice(`❌ AI 请求失败: ${err}`);
    }
  }

  // Called when settings change
  updateSettings(settings: EpubPluginSettings) {
    this.settings = settings;
    this.fontSize = settings.fontSize;
    if (this.rendition) {
      this.rendition.themes.fontSize(`${this.fontSize}px`);
    }
  }
}
