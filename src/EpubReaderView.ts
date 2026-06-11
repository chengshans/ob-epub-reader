import { FileView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import ePub, { Book, Rendition, NavItem } from "epubjs";
import { AnnotationVaultStore } from "./AnnotationVaultStore";
import { ProgressStore, normalizeCfi, normalizePercent } from "./ProgressStore";
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
import {
  buildTocSpineIndex,
  resolveChapterLabel,
  spineIndexFromLocation,
  TocSpineEntry,
} from "./ChapterResolver";

export const EPUB_READER_VIEW_TYPE = "epub-reader";

const ANNOTATION_TYPE = "highlight";
const HIGHLIGHT_CLASS = "epub-user-highlight";

export class EpubReaderView extends FileView {
  private book: Book | null = null;
  private rendition: Rendition | null = null;
  private currentCfi: string = "";
  private currentChapter: string = "";
  private tocSpineEntries: TocSpineEntry[] = [];
  private tocItems: NavItem[] = [];
  private flow: "paginated" | "scrolled";
  private fontSize: number;
  private contextMenu: HTMLElement | null = null;
  private contextMenuDismissHandler: ((e: MouseEvent) => void) | null = null;
  private contextMenuContentDoc: Document | null = null;
  private contextMenuDismissTimer: ReturnType<typeof setTimeout> | null = null;
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
  private highlightSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private progressSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private loadedFilePath: string | null = null;
  private loadingFilePath: string | null = null;
  private blockProgressSave = false;
  private isBookInitializing = false;
  private resumeTargetCfi = "";
  private isRefreshingHighlights = false;
  private isNavigating = false;
  private pendingNavigateCfi: string | null = null;
  private highlightsInitialLoaded = false;
  private isClosing = false;

  // Reading time tracking
  private persistedReadingSeconds = 0;
  private unsavedReadingSeconds = 0;
  private readingSessionStart: number | null = null;
  private readingTimePeriodicTimer: ReturnType<typeof setInterval> | null = null;
  private readingTimeTrackingActive = false;
  private onVisibilityChange: (() => void) | null = null;
  private onWindowBlur: (() => void) | null = null;
  private onWindowFocus: (() => void) | null = null;
  private currentPercent = 0;

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
    // 工作区恢复时 Obsidian 可能只调用 onOpen 而不触发 onLoadFile
    if (this.file) {
      await this.openBookWithSavedProgress(this.file);
    }
  }

  async onClose() {
    this.isClosing = true;
    if (this.progressSaveTimer) {
      clearTimeout(this.progressSaveTimer);
      this.progressSaveTimer = null;
    }
    await this.flushReadingTime(false).catch((err) => {
      console.error("ob-epub: reading time flush on close failed", err);
    });
    try {
      this.destroyBook();
    } catch (err) {
      console.error("ob-epub: onClose cleanup failed", err);
      this.destroyBook();
    }
  }

  // FileView lifecycle: called by Obsidian when a file is opened in this view
  async onLoadFile(file: TFile): Promise<void> {
    await this.openBookWithSavedProgress(file);
  }

  private async openBookWithSavedProgress(file: TFile): Promise<void> {
    if (!this.readerEl) this.buildLayout();
    if (this.loadedFilePath === file.path && this.book) return;
    if (this.loadingFilePath === file.path) return;

    this.loadingFilePath = file.path;
    try {
      const titleEl = this.toolbarEl?.querySelector("#epub-toolbar-title") as HTMLElement | null;
      if (titleEl) titleEl.textContent = file.basename;

      const jumpCfi = this.pendingCfi || this.openBridge.consumePendingCfi(file.path);
      this.pendingCfi = "";
      const savedProgress =
        (await this.annotationVaultStore.readProgress(file.path)) ??
        this.progressStore.getProgress(file.path);
      if (savedProgress) this.updateProgressBar(savedProgress.percent);
      this.currentChapter = savedProgress?.chapter?.trim() ?? "";

      const startCfi = normalizeCfi(jumpCfi || savedProgress?.cfi || "");
      this.resumeTargetCfi = startCfi;
      await this.loadBook(file, startCfi);
      this.loadedFilePath = file.path;
    } finally {
      if (this.loadingFilePath === file.path) this.loadingFilePath = null;
    }
  }

  /** Jump to a CFI position (used by deep-link "回到原文"). */
  async navigateToCfi(cfi: string): Promise<void> {
    cfi = normalizeCfi(cfi);
    if (!cfi) return;
    this.blockProgressSave = false;
    this.isBookInitializing = false;
    if (!this.rendition) {
      this.pendingCfi = cfi;
      return;
    }
    if (this.isNavigating) {
      this.pendingNavigateCfi = cfi;
      return;
    }
    this.isNavigating = true;
    try {
      await this.rendition.display(cfi);
    } catch (err) {
      console.error("CFI navigation failed:", err);
      new Notice("无法跳转到原文位置");
    } finally {
      this.isNavigating = false;
      const next = this.pendingNavigateCfi;
      this.pendingNavigateCfi = null;
      if (next && next !== cfi) {
        await this.navigateToCfi(next);
      }
    }
  }

  // FileView lifecycle: called when switching away from this file
  async onUnloadFile(_file: TFile): Promise<void> {
    this.loadedFilePath = null;
    await this.flushReadingTime(false).catch((err) => {
      console.error("ob-epub: reading time flush on unload failed", err);
    });
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

  private safeCleanup(label: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error(`ob-epub: cleanup failed (${label})`, err);
    }
  }

  private destroyBook() {
    this.safeCleanup("teardownReadingTimeTracking", () => this.teardownReadingTimeTracking());
    this.safeCleanup("dismissContextMenu", () => this.dismissContextMenu());
    this.safeCleanup("annotationWatcher", () => {
      this.annotationWatcherCleanup?.();
      this.annotationWatcherCleanup = null;
    });
    if (this.highlightRedrawTimer) {
      clearTimeout(this.highlightRedrawTimer);
      this.highlightRedrawTimer = null;
    }
    if (this.highlightSyncTimer) {
      clearTimeout(this.highlightSyncTimer);
      this.highlightSyncTimer = null;
    }
    this.cachedHighlights = [];
    this.highlightsInitialLoaded = false;
    this.tocSpineEntries = [];

    this.safeCleanup("resizeObserver", () => {
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
    });
    this.safeCleanup("keydownHandler", () => {
      if (this.keydownHandler && this.containerEl.isConnected) {
        this.containerEl.removeEventListener("keydown", this.keydownHandler);
      }
      this.keydownHandler = null;
    });
    this.safeCleanup("rendition", () => {
      if (this.rendition) {
        this.rendition.destroy();
      }
      this.rendition = null;
    });
    this.safeCleanup("book", () => {
      if (this.book) {
        this.book.destroy();
      }
      this.book = null;
    });
    this.safeCleanup("readerEl", () => {
      this.readerEl?.empty();
    });
  }

  private async loadBook(file: TFile, startCfi: string = "") {
    if (!this.readerEl) return;
    this.readerEl.empty();
    this.destroyBook();

    if (this.progressSaveTimer) {
      clearTimeout(this.progressSaveTimer);
      this.progressSaveTimer = null;
    }

    const resumeCfi = normalizeCfi(startCfi);
    this.blockProgressSave = !!resumeCfi;
    this.isBookInitializing = true;

    const loadingEl = this.readerEl.createEl("div", { cls: "epub-loading", text: "正在加载 EPUB…" });

    try {
      const arrayBuffer = await this.app.vault.adapter.readBinary(file.path);
      this.book = ePub(arrayBuffer as ArrayBuffer);

      await this.book.ready;
      loadingEl.remove();

      await this.loadTocData();

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
        this.currentCfi = normalizeCfi(location?.start?.cfi);
        this.syncChapterFromLocation(location);
        const percentage = this.extractPercentFromLocation(location);
        this.updateProgressBar(percentage);
        this.scheduleProgressSave(percentage);
      });

      // Draw highlights only after epub.js finishes rendering the page iframe.
      this.rendition.on("rendered", () => {
        if (this.highlightRedrawTimer) clearTimeout(this.highlightRedrawTimer);
        this.highlightRedrawTimer = setTimeout(() => {
          this.highlightRedrawTimer = null;
          if (!this.highlightsInitialLoaded) {
            void this.refreshHighlights().then(() => {
              this.highlightsInitialLoaded = true;
              this.scheduleHighlightSync();
            });
          } else {
            // Re-sync after layout changes (resize / re-render) to fix orphan marks.
            this.scheduleHighlightSync();
          }
        }, 150);
      });

      await this.rendition.started;

      // Navigate to saved position or start (highlights load on first "rendered")
      if (resumeCfi) {
        const savedProgress = this.progressStore.getProgress(file.path);
        try {
          await this.rendition.display(resumeCfi);
          const arrived = await this.waitForResumeCfi(resumeCfi, 5000);
          if (arrived) {
            this.blockProgressSave = false;
            this.isBookInitializing = false;
          } else {
            await this.rendition.display(resumeCfi);
            const retry = await this.waitForResumeCfi(resumeCfi, 3000);
            if (retry) {
              this.blockProgressSave = false;
              this.isBookInitializing = false;
            } else {
              console.warn("ob-epub: resume timed out, keeping saved progress", resumeCfi);
              if (savedProgress) this.updateProgressBar(savedProgress.percent);
            }
          }
        } catch (err) {
          console.warn("ob-epub: resume CFI failed", resumeCfi, err);
          try {
            await this.rendition.display();
          } catch (fallbackErr) {
            console.error("ob-epub: fallback display failed", fallbackErr);
          }
          if (savedProgress) this.updateProgressBar(savedProgress.percent);
        }
      } else {
        this.blockProgressSave = false;
        this.isBookInitializing = false;
        await this.rendition.display();
      }

      const loc = await Promise.resolve(this.rendition.currentLocation?.());
      this.syncChapterFromLocation(loc ?? undefined);

      if (!this.isBookInitializing) {
        this.beginReadingTimeTracking(file);
      }

      // epub.js 的 percentage 依赖 locations 索引，需在后台生成
      void this.book.locations.generate(1600).then(async () => {
        if (this.blockProgressSave || this.isBookInitializing) return;
        const loc = await Promise.resolve(this.rendition?.currentLocation?.());
        if (!loc) return;
        const percentage = this.extractPercentFromLocation(loc);
        this.updateProgressBar(percentage);
        this.scheduleProgressSave(percentage);
      }).catch((err) => {
        console.warn("ob-epub: locations generation failed", err);
      });

      // Register vault file watcher for external edits
      this.annotationWatcherCleanup = this.annotationVaultStore.watchFile(
        file.path,
        () => this.refreshHighlights()
      );

      // Keyboard navigation at the host level
      this.registerKeyboardNavigation();

      this.renderToc();

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
    this.blockProgressSave = false;
    this.isBookInitializing = false;
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
      this.blockProgressSave = false;
      this.isBookInitializing = false;
      this.rendition?.next();
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      this.blockProgressSave = false;
      this.isBookInitializing = false;
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

  private async loadTocData() {
    if (!this.book) return;

    const nav = await this.book.loaded.navigation;
    this.tocItems = nav.toc;
    this.tocSpineEntries = buildTocSpineIndex(this.book, this.tocItems);
  }

  private renderToc() {
    if (!this.tocEl) return;

    const tocList = this.tocEl.querySelector(".epub-toc-list") ?? this.tocEl.createEl("ul", { cls: "epub-toc-list" });
    tocList.empty();

    this.renderTocItems(this.tocItems, tocList as HTMLElement, 0);
  }

  private syncChapterFromLocation(location?: any) {
    const spineIndex = spineIndexFromLocation(location, this.currentCfi, this.book);
    if (spineIndex == null || this.tocSpineEntries.length === 0) return;

    const resolved = resolveChapterLabel(this.tocSpineEntries, spineIndex);
    if (resolved) {
      this.currentChapter = resolved;
    }
  }

  private renderTocItems(items: NavItem[], container: HTMLElement, depth: number) {
    for (const item of items) {
      const li = container.createEl("li", { cls: "epub-toc-item" });
      li.style.paddingLeft = `${depth * 12}px`;

      const label = li.createEl("span", { cls: "epub-toc-label", text: item.label.trim() });
      label.addEventListener("click", () => {
        this.blockProgressSave = false;
        this.isBookInitializing = false;
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

  private extractPercentFromLocation(location: any): number {
    const bookPct = location?.start?.percentage;
    if (typeof bookPct === "number" && bookPct > 0) {
      return normalizePercent(bookPct);
    }

    const displayed = location?.start?.displayed;
    const sectionIndex = Number(location?.start?.index);
    const spineLength = this.book?.spine?.length ?? 0;
    if (spineLength > 0 && Number.isFinite(sectionIndex) && displayed?.total > 0) {
      const sectionPct = Math.max(0, (displayed.page - 1) / displayed.total);
      return normalizePercent((sectionIndex + sectionPct) / spineLength);
    }
    return 0;
  }

  private scheduleProgressSave(percent: number) {
    if (this.blockProgressSave || this.isBookInitializing || !this.file || !this.currentCfi) return;
    if (this.progressSaveTimer) clearTimeout(this.progressSaveTimer);
    this.progressSaveTimer = setTimeout(() => {
      this.progressSaveTimer = null;
      if (this.blockProgressSave || this.isBookInitializing || !this.file || !this.currentCfi) return;
      void this.progressStore.saveProgress(
        this.file.path,
        this.currentCfi,
        this.currentChapter,
        percent
      ).catch((err) => {
        const path = this.file
          ? this.progressStore.getProgressFilePath(this.file.path)
          : this.progressStore.getProgressFilePath();
        console.error("ob-epub: progress save failed", path, err);
        new Notice(`阅读进度保存失败（${path}），请确认摘录文件夹存在且可写`);
      });
    }, 800);
  }

  private initReadingTimeFromProgress(file: TFile) {
    const progress = this.progressStore.getProgress(file.path);
    this.persistedReadingSeconds = progress?.readingTimeSeconds ?? 0;
    this.unsavedReadingSeconds = 0;
    this.readingSessionStart = null;
  }

  private canTrackReadingTime(): boolean {
    return (
      !this.isClosing &&
      !this.blockProgressSave &&
      !this.isBookInitializing &&
      !!this.file &&
      document.visibilityState === "visible" &&
      document.hasFocus()
    );
  }

  private startReadingTimer() {
    if (!this.canTrackReadingTime()) return;
    if (this.readingSessionStart != null) return;
    this.readingSessionStart = Date.now();
  }

  private pauseReadingTimer() {
    if (this.readingSessionStart == null) return;
    const elapsed = Math.floor((Date.now() - this.readingSessionStart) / 1000);
    if (elapsed > 0) {
      this.unsavedReadingSeconds += elapsed;
    }
    this.readingSessionStart = null;
  }

  private async flushReadingTime(resumeAfter = false) {
    if (this.isClosing && resumeAfter) return;
    if (!this.file) return;
    const wasTracking = this.readingSessionStart != null;
    this.pauseReadingTimer();
    if (this.unsavedReadingSeconds <= 0) {
      if (resumeAfter && wasTracking && this.canTrackReadingTime()) {
        this.startReadingTimer();
      }
      return;
    }

    const total = this.persistedReadingSeconds + this.unsavedReadingSeconds;
    const unsaved = this.unsavedReadingSeconds;
    this.unsavedReadingSeconds = 0;

    try {
      await this.progressStore.saveReadingTime(
        this.file.path,
        total,
        this.currentCfi
          ? {
              cfi: this.currentCfi,
              chapter: this.currentChapter,
              percent: this.currentPercent,
            }
          : undefined
      );
      this.persistedReadingSeconds = total;
    } catch (err) {
      this.unsavedReadingSeconds = unsaved;
      console.error("ob-epub: reading time flush failed", err);
    }

    if (resumeAfter && this.canTrackReadingTime()) {
      this.startReadingTimer();
    }
  }

  private beginReadingTimeTracking(file: TFile) {
    this.initReadingTimeFromProgress(file);
    this.setupReadingTimeTracking();
    this.startReadingTimer();
  }

  private setupReadingTimeTracking() {
    if (this.readingTimeTrackingActive) return;
    this.readingTimeTrackingActive = true;

    this.onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void this.flushReadingTime(false);
      } else if (this.canTrackReadingTime()) {
        this.startReadingTimer();
      }
    };
    this.onWindowBlur = () => {
      void this.flushReadingTime(false);
    };
    this.onWindowFocus = () => {
      if (this.canTrackReadingTime()) {
        this.startReadingTimer();
      }
    };

    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("blur", this.onWindowBlur);
    window.addEventListener("focus", this.onWindowFocus);

    this.readingTimePeriodicTimer = setInterval(() => {
      void this.flushReadingTime(true);
    }, 60_000);
  }

  private teardownReadingTimeTracking() {
    if (this.readingTimePeriodicTimer) {
      clearInterval(this.readingTimePeriodicTimer);
      this.readingTimePeriodicTimer = null;
    }
    if (this.onVisibilityChange) {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      this.onVisibilityChange = null;
    }
    if (this.onWindowBlur) {
      window.removeEventListener("blur", this.onWindowBlur);
      this.onWindowBlur = null;
    }
    if (this.onWindowFocus) {
      window.removeEventListener("focus", this.onWindowFocus);
      this.onWindowFocus = null;
    }
    this.readingTimeTrackingActive = false;
    this.readingSessionStart = null;
    this.unsavedReadingSeconds = 0;
    this.persistedReadingSeconds = 0;
  }

  private cfiRoughlyMatches(target: string, actual: string): boolean {
    if (!target || !actual) return false;
    if (target === actual) return true;
    const targetSpine = target.match(/epubcfi\(\/6\/(\d+)!/)?.[1];
    const actualSpine = actual.match(/epubcfi\(\/6\/(\d+)!/)?.[1];
    return !!targetSpine && targetSpine === actualSpine;
  }

  private waitForResumeCfi(targetCfi: string, timeoutMs: number): Promise<boolean> {
    const normalized = normalizeCfi(targetCfi);
    if (!normalized || !this.rendition) return Promise.resolve(false);
    if (this.cfiRoughlyMatches(normalized, this.currentCfi)) return Promise.resolve(true);

    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.rendition?.off("relocated", onRelocated);
        resolve(this.cfiRoughlyMatches(normalized, this.currentCfi));
      }, timeoutMs);

      const onRelocated = (location: any) => {
        const current = normalizeCfi(location?.start?.cfi);
        if (this.cfiRoughlyMatches(normalized, current)) {
          clearTimeout(timer);
          this.rendition?.off("relocated", onRelocated);
          resolve(true);
        }
      };

      this.rendition.on("relocated", onRelocated);
    });
  }

  private updateProgressBar(percent: number) {
    this.currentPercent = normalizePercent(percent);
    const fill = this.containerEl.querySelector("#epub-progress-fill") as HTMLElement | null;
    const text = this.containerEl.querySelector("#epub-progress-text") as HTMLElement | null;
    const pct = Math.round(this.currentPercent * 100);
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
    this.bindContextMenuDismiss(true, contents?.document);
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

  private bindContextMenuDismiss(clearSelection: boolean, contentDoc?: Document) {
    this.unbindContextMenuDismiss();

    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (this.contextMenu?.contains(target)) return;
      this.dismissContextMenu(clearSelection);
    };

    this.contextMenuDismissTimer = setTimeout(() => {
      this.contextMenuDismissTimer = null;
      this.contextMenuDismissHandler = handler;
      document.addEventListener("mousedown", handler, { capture: true });
      if (contentDoc) {
        this.contextMenuContentDoc = contentDoc;
        contentDoc.addEventListener("mousedown", handler, { capture: true });
      }
    }, 100);
  }

  private unbindContextMenuDismiss() {
    if (this.contextMenuDismissTimer) {
      clearTimeout(this.contextMenuDismissTimer);
      this.contextMenuDismissTimer = null;
    }
    if (this.contextMenuDismissHandler) {
      document.removeEventListener("mousedown", this.contextMenuDismissHandler, { capture: true });
      this.contextMenuContentDoc?.removeEventListener(
        "mousedown",
        this.contextMenuDismissHandler,
        { capture: true }
      );
      this.contextMenuDismissHandler = null;
      this.contextMenuContentDoc = null;
    }
  }

  private dismissContextMenu(clearSelection = false) {
    this.unbindContextMenuDismiss();
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
    if (clearSelection) {
      this.clearSelection();
    }
  }

  // ---------- Annotations: draw / refresh / manage ----------

  private getViewList(): any[] {
    if (!this.rendition) return [];
    const views = this.rendition.views();
    return Array.isArray(views)
      ? views
      : (views as { all?: () => any[] }).all?.() ?? [];
  }

  private getDisplayedViews(): any[] {
    return this.getViewList().filter((view) => view?.displayed);
  }

  private purgeAllViewHighlights(view: any) {
    if (!view?.highlights) return;
    for (const cfi of Object.keys(view.highlights)) {
      try {
        view.unhighlight(cfi);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Clear orphan SVG marks and re-attach store annotations once per view.
   * epub.js inject re-attaches on every render without removing old marks,
   * which causes misaligned duplicate highlights.
   */
  private syncViewHighlights(view: any) {
    if (!this.rendition?.annotations || !view) return;
    const store = this.rendition.annotations as any;
    const sectionIndex = view.index;
    const hashes: string[] = store._annotationsBySectionIndex?.[sectionIndex] ?? [];
    if (hashes.length === 0) return;

    this.purgeAllViewHighlights(view);

    const seen = new Set<string>();
    for (const hash of hashes) {
      if (seen.has(hash)) continue;
      seen.add(hash);
      const annotation = store._annotations?.[hash];
      if (!annotation) continue;
      annotation.mark = undefined;
      try {
        annotation.attach(view);
      } catch (e) {
        console.warn("syncViewHighlights: attach failed", hash, e);
      }
    }
  }

  private syncAllDisplayedHighlights() {
    for (const view of this.getDisplayedViews()) {
      this.syncViewHighlights(view);
    }
  }

  private scheduleHighlightSync() {
    if (this.highlightSyncTimer) clearTimeout(this.highlightSyncTimer);
    this.highlightSyncTimer = setTimeout(() => {
      this.highlightSyncTimer = null;
      this.syncAllDisplayedHighlights();
    }, 80);
  }

  private drawLine(annotation: Annotation) {
    if (!this.rendition) return;
    this.removeDrawnLine(annotation.cfiRange);
    this.purgeViewHighlight(annotation.cfiRange);
    const hex = colorHex(annotation.color);
    this.rendition.annotations.add(
      ANNOTATION_TYPE,
      annotation.cfiRange,
      { id: annotation.id },
      (err: Error | null) => {
        if (err) console.warn("drawLine failed:", annotation.id, err.message);
      },
      HIGHLIGHT_CLASS,
      {
        fill: hex,
        "fill-opacity": "0.38",
        "mix-blend-mode": "normal",
      }
    );
  }

  private removeDrawnLine(cfiRange: string) {
    if (!this.rendition) return;
    try {
      this.rendition.annotations.remove(cfiRange, ANNOTATION_TYPE);
    } catch {
      /* ignore */
    }
    // Legacy underline annotations from older plugin versions
    try {
      this.rendition.annotations.remove(cfiRange, "underline");
    } catch {
      /* ignore */
    }
  }

  /** Clear orphaned marks-pane SVG layers not tracked in epub.js store. */
  private purgeViewHighlight(cfiRange: string) {
    if (!this.rendition) return;
    for (const view of this.getViewList()) {
      try {
        view.unhighlight?.(cfiRange);
      } catch {
        /* ignore */
      }
    }
  }

  private redrawLine(annotation: Annotation) {
    if (!this.rendition) return;
    this.drawLine(annotation);
    this.scheduleHighlightSync();
  }

  private upsertCachedHighlight(annotation: Annotation) {
    const idx = this.cachedHighlights.findIndex((a) => a.id === annotation.id);
    if (idx >= 0) {
      this.cachedHighlights[idx] = annotation;
    } else {
      this.cachedHighlights.push(annotation);
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
        this.removeDrawnLine(ann.cfiRange);
      }
      for (const ann of list) {
        try { this.drawLine(ann); } catch (e) {
          console.warn("refreshHighlights: drawLine failed for", ann.id, e);
        }
      }
      this.scheduleHighlightSync();

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
      if (updated) {
        this.upsertCachedHighlight(updated);
        this.redrawLine(updated);
      }
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
      this.upsertCachedHighlight(ann);
      this.drawLine(ann);
      this.scheduleHighlightSync();
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
        this.upsertCachedHighlight(ann);
        this.drawLine(ann);
        this.scheduleHighlightSync();
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
        if (updated) {
          this.upsertCachedHighlight(updated);
          this.redrawLine(updated);
        }
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
          if (updated) {
            this.upsertCachedHighlight(updated);
            this.redrawLine(updated);
          }
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
    this.bindContextMenuDismiss(false, contents?.document);
  }

  private async removeAnnotation(id: string, cfiRange: string) {
    if (!this.file) return;
    this.removeDrawnLine(cfiRange);
    this.cachedHighlights = this.cachedHighlights.filter((a) => a.id !== id);
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
            if (updated) {
              this.upsertCachedHighlight(updated);
              this.redrawLine(updated);
            }
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
