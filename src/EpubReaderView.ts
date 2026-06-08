import { FileView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import ePub, { Book, Rendition, NavItem } from "epubjs";
import { AnnotationVaultStore } from "./AnnotationVaultStore";
import { ProgressStore } from "./ProgressStore";
import { AIService } from "./AIService";
import {
  EpubPluginSettings,
  EpubOpenBridge,
  Annotation,
  HighlightColor,
  HIGHLIGHT_COLORS,
  colorHex,
} from "./types";
import { NoteInputModal } from "./NoteInputModal";

export const EPUB_READER_VIEW_TYPE = "epub-reader";

const UNDERLINE_CLASS = "epub-user-underline";

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
  private accentColor: string = "#7b68ee";

  private openBridge: EpubOpenBridge;
  private annotationVaultStore: AnnotationVaultStore;
  private progressStore: ProgressStore;
  private aiService: AIService;
  private settings: EpubPluginSettings;
  private pendingCfi: string = "";
  private annotationWatcherCleanup: (() => void) | null = null;
  private cachedHighlights: Annotation[] = [];
  private highlightRedrawTimer: ReturnType<typeof setTimeout> | null = null;
  private isRefreshingHighlights = false;
  private isNavigating = false;

  // Layout elements
  private toolbarEl: HTMLElement | null = null;
  private sidebarEl: HTMLElement | null = null;
  private tocEl: HTMLElement | null = null;
  private notesEl: HTMLElement | null = null;
  private readerEl: HTMLElement | null = null;
  private progressEl: HTMLElement | null = null;
  private tocToggleBtn: HTMLElement | null = null;
  private tocVisible: boolean = true;
  private sidebarMode: "toc" | "notes" = "toc";
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private wheelAccum: number = 0;
  private wheelCooldown: boolean = false;

  constructor(
    leaf: WorkspaceLeaf,
    openBridge: EpubOpenBridge,
    annotationVaultStore: AnnotationVaultStore,
    progressStore: ProgressStore,
    aiService: AIService,
    settings: EpubPluginSettings
  ) {
    super(leaf);
    this.openBridge = openBridge;
    this.annotationVaultStore = annotationVaultStore;
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
    const jumpCfi = this.pendingCfi || this.openBridge.consumePendingCfi(file.path);
    this.pendingCfi = "";
    const savedProgress = this.progressStore.getProgress(file.path);
    await this.loadBook(file, jumpCfi || savedProgress?.cfi || "");
  }

  /** Jump to a CFI position (used by deep-link "回到原文"). */
  async navigateToCfi(cfi: string): Promise<void> {
    if (!cfi) return;
    if (!this.rendition) {
      this.pendingCfi = cfi;
      return;
    }
    if (this.isNavigating) return;
    this.isNavigating = true;
    try {
      await this.rendition.display(cfi);
    } catch (err) {
      console.error("CFI navigation failed:", err);
      new Notice("无法跳转到原文位置");
    } finally {
      this.isNavigating = false;
    }
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

    // Body: Sidebar (TOC / Notes) + Reader
    const bodyEl = container.createDiv({ cls: "epub-body" });

    // Sidebar with tab switcher
    this.sidebarEl = bodyEl.createDiv({ cls: "epub-sidebar" });
    const tabs = this.sidebarEl.createDiv({ cls: "epub-sidebar-tabs" });
    const tocTab = tabs.createEl("button", { cls: "epub-sidebar-tab is-active", text: "目录" });
    const notesTab = tabs.createEl("button", { cls: "epub-sidebar-tab", text: "标注" });
    tocTab.addEventListener("click", () => this.setSidebarMode("toc"));
    notesTab.addEventListener("click", () => this.setSidebarMode("notes"));

    // TOC panel
    this.tocEl = this.sidebarEl.createDiv({ cls: "epub-toc" });

    // Notes panel
    this.notesEl = this.sidebarEl.createDiv({ cls: "epub-notes" });
    this.notesEl.style.display = "none";

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
      this.containerEl.dispatchEvent(new CustomEvent("epub-open-bookshelf"));
    });
  }

  private toggleToc() {
    this.tocVisible = !this.tocVisible;
    if (this.sidebarEl) {
      this.sidebarEl.style.display = this.tocVisible ? "" : "none";
    }
  }

  private setSidebarMode(mode: "toc" | "notes") {
    this.sidebarMode = mode;
    if (this.tocEl) this.tocEl.style.display = mode === "toc" ? "" : "none";
    if (this.notesEl) this.notesEl.style.display = mode === "notes" ? "" : "none";
    const tabs = this.sidebarEl?.querySelectorAll(".epub-sidebar-tab");
    tabs?.forEach((t, i) => {
      const active = (i === 0 && mode === "toc") || (i === 1 && mode === "notes");
      t.toggleClass("is-active", active);
    });
    if (mode === "notes") this.renderNotesPanel();
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
    // Clean up vault file watcher
    this.annotationWatcherCleanup?.();
    this.annotationWatcherCleanup = null;
    if (this.highlightRedrawTimer) {
      clearTimeout(this.highlightRedrawTimer);
      this.highlightRedrawTimer = null;
    }
    this.cachedHighlights = [];

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.keydownHandler) {
      this.containerEl.removeEventListener("keydown", this.keydownHandler);
      this.keydownHandler = null;
    }
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

      // Click on an existing drawn line / note → edit menu
      this.rendition.on("markClicked", async (cfiRange: string) => {
        if (!this.file) return;
        const ann = await this.annotationVaultStore.getByCfi(this.file.path, cfiRange);
        if (ann) this.showAnnotationMenu(ann);
      });

      // Mouse wheel + keyboard navigation (bound inside each iframe document)
      this.rendition.hooks.content.register((contents: any) => {
        this.attachContentNavigation(contents);
      });

      // Track location changes
      this.rendition.on("relocated", (location: any) => {
        this.currentCfi = location?.start?.cfi ?? "";
        const percentage = location?.start?.percentage ?? 0;
        this.updateProgressBar(percentage);

        if (this.file) {
          this.progressStore.saveProgress(
            this.file.path,
            this.currentCfi,
            this.currentChapter,
            percentage
          );
        }
      });

      // Re-draw highlights after page render (debounced; uses cache only)
      this.rendition.on("rendered", () => {
        if (this.highlightRedrawTimer) clearTimeout(this.highlightRedrawTimer);
        this.highlightRedrawTimer = setTimeout(() => {
          this.highlightRedrawTimer = null;
          this.redrawHighlightsForPage();
        }, 80);
      });

      // Navigate to saved position or start
      if (startCfi) {
        await this.rendition.display(startCfi);
      } else {
        await this.rendition.display();
      }

      // Load annotations from vault file and draw them
      await this.refreshHighlights();

      // Register vault file watcher for external edits
      this.annotationWatcherCleanup = this.annotationVaultStore.watchFile(
        file.path,
        () => this.refreshHighlights()
      );

      // Keyboard navigation at the host level
      this.registerKeyboardNavigation();

      // Load TOC
      await this.loadToc();

      // Refresh notes panel if currently shown
      if (this.sidebarMode === "notes") this.renderNotesPanel();
    } catch (err) {
      loadingEl.textContent = `加载失败: ${err}`;
      console.error("EPUB load error:", err);
    }
  }

  // ---------- Navigation: wheel + keyboard ----------

  private attachContentNavigation(contents: any) {
    const doc: Document | undefined = contents?.document;
    if (!doc) return;

    doc.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        if (this.flow !== "paginated" || !this.rendition) return;
        e.preventDefault();
        if (this.wheelCooldown) return;
        this.wheelAccum += e.deltaY;
        const threshold = 30;
        if (this.wheelAccum > threshold) {
          this.wheelAccum = 0;
          this.turnPage("next");
        } else if (this.wheelAccum < -threshold) {
          this.wheelAccum = 0;
          this.turnPage("prev");
        }
      },
      { passive: false }
    );

    doc.addEventListener("keydown", (e: KeyboardEvent) => this.handleNavKey(e));
  }

  private turnPage(dir: "next" | "prev") {
    if (!this.rendition) return;
    this.wheelCooldown = true;
    const p = dir === "next" ? this.rendition.next() : this.rendition.prev();
    Promise.resolve(p).finally(() => {
      window.setTimeout(() => {
        this.wheelCooldown = false;
      }, 180);
    });
  }

  private handleNavKey(e: KeyboardEvent) {
    if (e.key === "ArrowRight" || e.key === "PageDown") {
      e.preventDefault();
      this.rendition?.next();
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      this.rendition?.prev();
    }
  }

  private registerKeyboardNavigation() {
    if (this.keydownHandler) return;
    this.keydownHandler = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const tag = active?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (!this.containerEl.isShown()) return;
      this.handleNavKey(e);
    };
    this.containerEl.addEventListener("keydown", this.keydownHandler);
  }

  private cssVar(name: string, fallback: string): string {
    const v = getComputedStyle(document.body).getPropertyValue(name).trim();
    return v || fallback;
  }

  private applyTheme() {
    if (!this.rendition) return;
    const isDark = document.body.hasClass("theme-dark");

    const background = this.cssVar("--background-primary", isDark ? "#1e1e1e" : "#ffffff");
    const textColor = this.cssVar("--text-normal", isDark ? "#dcddde" : "#1a1a1a");
    const linkColor = this.cssVar("--link-color", "#5b8def");
    const fontFamily = this.cssVar(
      "--font-text",
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif'
    );
    const accent = this.cssVar("--interactive-accent", "#7b68ee");
    const selectionBg = this.cssVar("--text-selection", isDark ? "rgba(123,104,238,0.4)" : "rgba(123,104,238,0.25)");

    this.rendition.themes.register("custom", {
      "html, body": {
        background: `${background} !important`,
        color: `${textColor} !important`,
      },
      body: {
        "font-family": fontFamily,
        "line-height": "1.8",
        padding: "2em 3em",
      },
      "*": {
        "-webkit-user-select": "text !important",
        "user-select": "text !important",
      },
      "a": { color: `${linkColor} !important` },
      "::selection": { background: `${selectionBg}`, color: `${textColor}` },
      "::-moz-selection": { background: `${selectionBg}`, color: `${textColor}` },
    });
    this.rendition.themes.select("custom");
    this.rendition.themes.fontSize(`${this.fontSize}px`);
    this.accentColor = accent;
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
    menu.addEventListener("mousedown", (e) => e.stopPropagation());

    // Color row: five drawing-line colors
    const colorRow = menu.createDiv({ cls: "epub-ctx-colors" });
    for (const c of HIGHLIGHT_COLORS) {
      const dot = colorRow.createDiv({ cls: "epub-color-dot" });
      dot.style.background = c.hex;
      dot.title = `画线 · ${c.label}`;
      dot.addEventListener("click", async () => {
        this.dismissContextMenu();
        await this.addUnderline(c.id);
      });
    }

    const divider = menu.createDiv({ cls: "epub-ctx-divider" });
    void divider;

    // 标注 (画线 + 可选想法)
    const noteBtn = menu.createEl("button", { cls: "epub-ctx-btn", text: "📝 标注" });
    noteBtn.title = "写下自己的想法";
    noteBtn.addEventListener("click", () => {
      this.dismissContextMenu();
      this.openNoteModal();
    });

    const aiBtn = menu.createEl("button", { cls: "epub-ctx-btn", text: "🤖 AI" });
    aiBtn.addEventListener("click", async () => {
      this.dismissContextMenu();
      await this.runAI();
    });

    document.body.appendChild(menu);
    this.contextMenu = menu;
    this.positionMenu(menu, contents);

    setTimeout(() => {
      document.addEventListener("mousedown", this.dismissContextMenuBound, { once: true });
    }, 100);
  }

  private positionMenu(menu: HTMLElement, contents: any) {
    const iframe = this.readerEl?.querySelector("iframe") as HTMLIFrameElement | null;
    const sel = contents?.window?.getSelection?.();
    menu.style.position = "fixed";
    if (sel && sel.rangeCount > 0 && iframe) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const iframeRect = iframe.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      let top = iframeRect.top + rect.bottom + 6;
      let left = iframeRect.left + rect.left;
      const maxLeft = window.innerWidth - menuRect.width - 8;
      if (left > maxLeft) left = Math.max(8, maxLeft);
      const maxTop = window.innerHeight - menuRect.height - 8;
      if (top > maxTop) top = iframeRect.top + rect.top - menuRect.height - 6;
      menu.style.top = `${Math.max(8, top)}px`;
      menu.style.left = `${Math.max(8, left)}px`;
    } else {
      menu.style.top = "50%";
      menu.style.left = "50%";
      menu.style.transform = "translate(-50%, -50%)";
    }
  }

  private dismissContextMenuBound = () => this.dismissContextMenu();

  private dismissContextMenu() {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
    document.removeEventListener("mousedown", this.dismissContextMenuBound);
  }

  // ---------- Annotations: draw / refresh / manage ----------

  private drawLine(annotation: Annotation) {
    if (!this.rendition) return;
    const hex = colorHex(annotation.color);
    const className = annotation.note
      ? `${UNDERLINE_CLASS} has-note`
      : UNDERLINE_CLASS;
    this.rendition.annotations.add(
      "underline",
      annotation.cfiRange,
      { id: annotation.id },
      undefined,
      className,
      {
        stroke: hex,
        "stroke-opacity": "0.9",
        "stroke-width": "2",
      }
    );
  }

  private redrawLine(annotation: Annotation) {
    if (!this.rendition) return;
    try {
      this.rendition.annotations.remove(annotation.cfiRange, "underline");
    } catch (e) {
      /* ignore */
    }
    this.drawLine(annotation);
  }

  /** Re-draw cached highlights after epub.js re-renders a page iframe. */
  private redrawHighlightsForPage() {
    if (!this.rendition || this.cachedHighlights.length === 0) return;
    for (const ann of this.cachedHighlights) {
      try { this.drawLine(ann); } catch { /* ignore */ }
    }
  }

  /**
   * Full refresh: parse the vault md file → clear existing annotations →
   * re-draw every highlight. Called on book open and on file-watcher trigger.
   */
  private async refreshHighlights() {
    if (!this.file || !this.rendition || this.isRefreshingHighlights) return;
    this.isRefreshingHighlights = true;
    try {
      const list = await this.annotationVaultStore.getByFile(this.file.path);
      this.cachedHighlights = list;

      for (const ann of list) {
        try { this.rendition.annotations.remove(ann.cfiRange, "underline"); } catch { /* ignore */ }
      }
      for (const ann of list) {
        try { this.drawLine(ann); } catch (e) {
          console.warn("refreshHighlights: drawLine failed for", ann.id, e);
        }
      }

      if (this.sidebarMode === "notes") this.renderNotesPanel();
    } finally {
      this.isRefreshingHighlights = false;
    }
  }

  private async addUnderline(color: HighlightColor) {
    if (!this.file || !this.selectedCfi || !this.selectedText) return;
    const existing = await this.annotationVaultStore.getByCfi(this.file.path, this.selectedCfi);
    if (existing) {
      await this.annotationVaultStore.update(this.file.path, existing.id, { color });
      const updated = await this.annotationVaultStore.getById(this.file.path, existing.id);
      if (updated) this.redrawLine(updated);
    } else {
      const ann: Annotation = {
        id: `ann-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
        cfiRange: this.selectedCfi,
        text: this.selectedText,
        color,
        chapter: this.currentChapter || "未知章节",
        created: new Date().toISOString(),
      };
      await this.annotationVaultStore.add(this.file.path, ann);
      this.drawLine(ann);
    }
    this.clearSelection();
    if (this.sidebarMode === "notes") this.renderNotesPanel();
    new Notice("✅ 已画线");
  }

  private openNoteModal() {
    if (!this.file || !this.selectedCfi || !this.selectedText) return;
    const filePath = this.file.path;
    const cfiRange = this.selectedCfi;
    const text = this.selectedText;
    const chapter = this.currentChapter || "未知章节";

    new NoteInputModal(
      this.app,
      text,
      { color: "yellow" },
      async ({ note, color }) => {
        const ann: Annotation = {
          id: `ann-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
          cfiRange,
          text,
          color,
          note: note || undefined,
          chapter,
          created: new Date().toISOString(),
        };
        await this.annotationVaultStore.add(filePath, ann);
        this.drawLine(ann);
        this.clearSelection();
        if (this.sidebarMode === "notes") this.renderNotesPanel();
        new Notice(note ? "✅ 标注已保存" : "✅ 已画线");
      }
    ).open();
    this.clearSelection();
  }

  private clearSelection() {
    try {
      const iframe = this.readerEl?.querySelector("iframe") as HTMLIFrameElement | null;
      iframe?.contentWindow?.getSelection?.()?.removeAllRanges();
    } catch (e) {
      /* ignore */
    }
    this.selectedText = "";
    this.selectedCfi = "";
  }

  private showAnnotationMenu(ann: Annotation) {
    this.dismissContextMenu();
    if (!this.file) return;
    const filePath = this.file.path;

    const menu = document.createElement("div");
    menu.className = "epub-context-menu epub-ann-menu";
    menu.addEventListener("mousedown", (e) => e.stopPropagation());

    // Recolor row
    const colorRow = menu.createDiv({ cls: "epub-ctx-colors" });
    for (const c of HIGHLIGHT_COLORS) {
      const dot = colorRow.createDiv({ cls: "epub-color-dot" });
      dot.style.background = c.hex;
      if (c.id === ann.color) dot.addClass("is-active");
      dot.title = `改为${c.label}`;
      dot.addEventListener("click", async () => {
        this.dismissContextMenu();
        await this.annotationVaultStore.update(filePath, ann.id, { color: c.id });
        const updated = await this.annotationVaultStore.getById(filePath, ann.id);
        if (updated) this.redrawLine(updated);
        if (this.sidebarMode === "notes") this.renderNotesPanel();
      });
    }

    menu.createDiv({ cls: "epub-ctx-divider" });

    const editBtn = menu.createEl("button", { cls: "epub-ctx-btn", text: ann.note ? "📝 编辑想法" : "📝 添加想法" });
    editBtn.addEventListener("click", () => {
      this.dismissContextMenu();
      new NoteInputModal(
        this.app,
        ann.text,
        { note: ann.note, color: ann.color },
        async ({ note, color }) => {
          await this.annotationVaultStore.update(filePath, ann.id, { note: note || undefined, color });
          const updated = await this.annotationVaultStore.getById(filePath, ann.id);
          if (updated) this.redrawLine(updated);
          if (this.sidebarMode === "notes") this.renderNotesPanel();
          new Notice("✅ 已更新");
        },
        "编辑标注"
      ).open();
    });

    const delBtn = menu.createEl("button", { cls: "epub-ctx-btn is-danger", text: "🗑 删除" });
    delBtn.addEventListener("click", async () => {
      this.dismissContextMenu();
      await this.removeAnnotation(ann.id, ann.cfiRange);
    });

    document.body.appendChild(menu);
    this.contextMenu = menu;

    const contents = (this.rendition as any)?.getContents?.()?.[0];
    this.positionMenu(menu, contents);

    setTimeout(() => {
      document.addEventListener("mousedown", this.dismissContextMenuBound, { once: true });
    }, 100);
  }

  private async removeAnnotation(id: string, cfiRange: string) {
    if (!this.file) return;
    if (this.rendition) {
      try {
        this.rendition.annotations.remove(cfiRange, "underline");
      } catch (e) {
        /* ignore */
      }
    }
    await this.annotationVaultStore.remove(this.file.path, id);
    if (this.sidebarMode === "notes") this.renderNotesPanel();
    new Notice("🗑 标注已删除");
  }

  private async renderNotesPanel() {
    if (!this.notesEl) return;
    this.notesEl.empty();

    const list = this.file
      ? await this.annotationVaultStore.getByFile(this.file.path)
      : [];

    if (list.length === 0) {
      this.notesEl.createDiv({ cls: "epub-notes-empty", text: "暂无标注。选中文字后点击颜色画线或写想法。" });
      return;
    }

    const ul = this.notesEl.createEl("ul", { cls: "epub-notes-list" });
    const sorted = [...list].sort((a, b) => b.created.localeCompare(a.created));
    for (const ann of sorted) {
      const li = ul.createEl("li", { cls: "epub-note-item" });

      const head = li.createDiv({ cls: "epub-note-item-head" });
      const dot = head.createDiv({ cls: "epub-color-dot is-static" });
      dot.style.background = colorHex(ann.color);
      head.createSpan({ cls: "epub-note-item-chapter", text: ann.chapter });

      const quote = li.createDiv({ cls: "epub-note-item-text" });
      quote.setText(ann.text.length > 90 ? ann.text.slice(0, 90) + "…" : ann.text);

      if (ann.note) {
        const note = li.createDiv({ cls: "epub-note-item-note" });
        note.setText(ann.note);
      }

      const actions = li.createDiv({ cls: "epub-note-item-actions" });
      const jump = actions.createEl("button", { cls: "epub-note-action", text: "跳转" });
      jump.addEventListener("click", () => this.rendition?.display(ann.cfiRange));
      const edit = actions.createEl("button", { cls: "epub-note-action", text: "编辑" });
      edit.addEventListener("click", () => {
        if (!this.file) return;
        const filePath = this.file.path;
        new NoteInputModal(
          this.app,
          ann.text,
          { note: ann.note, color: ann.color },
          async ({ note, color }) => {
            await this.annotationVaultStore.update(filePath, ann.id, { note: note || undefined, color });
            const updated = await this.annotationVaultStore.getById(filePath, ann.id);
            if (updated) this.redrawLine(updated);
            this.renderNotesPanel();
          },
          "编辑标注"
        ).open();
      });
      const del = actions.createEl("button", { cls: "epub-note-action is-danger", text: "删除" });
      del.addEventListener("click", () => this.removeAnnotation(ann.id, ann.cfiRange));
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
      const filePath = await this.annotationVaultStore.appendAIResponse(
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
