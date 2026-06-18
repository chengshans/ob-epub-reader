import { FileView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import ePub, { Book, Rendition, NavItem } from "epubjs";
import { AnnotationVaultStore } from "./AnnotationVaultStore";
import { cfiProgressMatches } from "./cfi/cfiMatch";
import { parseEpubSubpath } from "./epubSubpath";
import { ProgressStore, normalizeCfi, normalizePercent } from "./ProgressStore";
import {
  EpubPluginSettings,
  EpubOpenBridge,
  Annotation,
  HighlightColor,
  NoteType,
  HIGHLIGHT_COLORS,
  READING_THEMES,
  ReadingThemeId,
  colorHex,
  noteTypeIcon,
  noteTypeLabel,
  clampNoteIconSize,
  clampNoteIconOffsetX,
  clampNoteIconOffsetY,
  clampHighlightOpacity,
  HIGHLIGHT_OPACITY_MIN,
  HIGHLIGHT_OPACITY_MAX,
  noteIconGlyphSize,
  normalizeReadingTheme,
  resolveNoteTypes,
  isAnnotationsAndExcerptsEnabled,
} from "./types";
import { buildExcerptBlock } from "./excerptBlockFormat";
import { NoteInputModal } from "./NoteInputModal";
import { ConfirmModal } from "./ConfirmModal";
import {
  buildTocSpineIndex,
  resolveChapterLabel,
  spineIndexFromLocation,
  TocSpineEntry,
} from "./ChapterResolver";
import {
  groupAnnotationsByChapter,
  normalizeChapterName,
  sortChapterNames,
} from "./excerptChapterLayout";
import {
  isBlockedStylesheetHref,
  prepareSectionHtmlForSpine,
  readStylesheetHref,
  stripExecutableFromDocument,
} from "./epubStylesheetInliner";

export const EPUB_READER_VIEW_TYPE = "epub-reader";

const ANNOTATION_TYPE = "highlight";
const HIGHLIGHT_CLASS = "epub-user-highlight";
const NOTE_ICON_CLASS = "epub-note-icon";
const CFI_IGNORE_CLASSES = "epub-user-highlight epubjs-hl epubjs-ul epub-note-icon";
const READING_THEME_STYLE_ID = "ob-epub-reading-theme";
const READING_THEME_ATTR = "data-ob-epub-theme";

export class EpubReaderView extends FileView {
  private book: Book | null = null;
  private rendition: Rendition | null = null;
  private currentCfi: string = "";
  private currentChapter: string = "";
  private tocSpineEntries: TocSpineEntry[] = [];
  private tocItems: NavItem[] = [];
  private flow: "paginated" | "scrolled";
  private fontSize: number;
  private readingTheme: ReadingThemeId;
  private themesRegistered = false;
  private onReadingThemeChange?: (themeId: ReadingThemeId) => Promise<void>;
  private onEpubHighlightOpacityChange?: (opacity: number) => Promise<void>;
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
  private notesPanelRenderGen = 0;
  private notesSearchQuery = "";
  private notesColorFilter = new Set<HighlightColor>();
  private notesTypeFilter: NoteType | "highlight-only" | null = null;
  private notesListEl: HTMLElement | null = null;
  private notesCountEl: HTMLElement | null = null;
  private notesSearchInputEl: HTMLInputElement | null = null;
  private notesCollapseAllBtn: HTMLElement | null = null;
  private notesChapterCollapsed = new Set<string>();
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
  private themeSwatchesEl: HTMLElement | null = null;
  private highlightOpacityRangeEl: HTMLInputElement | null = null;
  private sidebarEl: HTMLElement | null = null;
  private notesTabEl: HTMLElement | null = null;
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
  private bookGeneration = 0;

  constructor(
    leaf: WorkspaceLeaf,
    openBridge: EpubOpenBridge,
    annotationVaultStore: AnnotationVaultStore,
    progressStore: ProgressStore,
    settings: EpubPluginSettings,
    onReadingThemeChange?: (themeId: ReadingThemeId) => Promise<void>,
    onEpubHighlightOpacityChange?: (opacity: number) => Promise<void>
  ) {
    super(leaf);
    this.openBridge = openBridge;
    this.annotationVaultStore = annotationVaultStore;
    this.progressStore = progressStore;
    this.settings = settings;
    this.onReadingThemeChange = onReadingThemeChange;
    this.onEpubHighlightOpacityChange = onEpubHighlightOpacityChange;
    this.flow = settings.defaultFlow;
    this.fontSize = settings.fontSize;
    this.readingTheme = normalizeReadingTheme(settings.readingTheme);
  }

  private get resolvedNoteTypes() {
    return resolveNoteTypes(this.settings.noteTypes);
  }

  getViewType(): string {
    return EPUB_READER_VIEW_TYPE;
  }

  canAcceptExtension(extension: string): boolean {
    return extension === "epub";
  }

  getDisplayText(): string {
    return this.file?.basename ?? "EPUB Marginalia";
  }

  getIcon(): string {
    return "book-open";
  }

  setEphemeralState(state: Record<string, unknown>): void {
    super.setEphemeralState(state);
    const subpath = state?.subpath as string | undefined;
    if (!subpath?.includes("cfi=")) return;

    const params = parseEpubSubpath(subpath.startsWith("#") ? subpath : `#${subpath}`);
    if (!params?.cfi) return;

    if (this.rendition) {
      void this.navigateToCfi(params.cfi);
    } else {
      this.pendingCfi = params.cfi;
    }
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

  private beginBookSession(): number {
    this.bookGeneration += 1;
    return this.bookGeneration;
  }

  private isBookSessionStale(generation: number): boolean {
    return this.isClosing || generation !== this.bookGeneration;
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
      this.scheduleHighlightSync();
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
    this.notesTabEl = tabs.createEl("button", { cls: "epub-sidebar-tab", text: "标注" });
    tocTab.addEventListener("click", () => this.setSidebarMode("toc"));
    this.notesTabEl.addEventListener("click", () => this.setSidebarMode("notes"));

    const panelsEl = this.sidebarEl.createDiv({ cls: "epub-sidebar-panels" });

    // TOC panel
    this.tocEl = panelsEl.createDiv({ cls: "epub-toc" });

    // Notes panel (hidden via CSS class — avoid hide()/toggleVisibility mismatch)
    this.notesEl = panelsEl.createDiv({ cls: "epub-notes is-hidden" });

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
    this.applyAnnotationsFeatureState();
  }

  private annotationsEnabled(): boolean {
    return isAnnotationsAndExcerptsEnabled(this.settings);
  }

  private applyAnnotationsFeatureState(): void {
    const enabled = this.annotationsEnabled();
    this.notesTabEl?.toggleVisibility(enabled);
    if (!enabled && this.sidebarMode === "notes") {
      this.setSidebarMode("toc");
    }
  }

  private buildToolbar(toolbar: HTMLElement) {
    toolbar.empty();

    // TOC toggle
    this.tocToggleBtn = toolbar.createEl("button", { cls: "epub-toolbar-btn", text: "☰" });
    this.tocToggleBtn.title = "切换目录";
    this.tocToggleBtn.addEventListener("click", () => this.toggleToc());

    // Book title
    const titleEl = toolbar.createEl("span", { cls: "epub-toolbar-title", text: this.file?.basename ?? "EPUB Marginalia" });
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

    this.buildThemeToolbar(toolbar);
    if (this.annotationsEnabled()) {
      this.buildHighlightOpacityToolbar(toolbar);
    }

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
      this.sidebarEl.toggleVisibility(this.tocVisible);
    }
  }

  private setSidebarMode(mode: "toc" | "notes") {
    this.sidebarMode = mode;
    this.tocEl?.toggleClass("is-hidden", mode !== "toc");
    this.notesEl?.toggleClass("is-hidden", mode !== "notes");
    const tabs = this.sidebarEl?.querySelectorAll(".epub-sidebar-tab");
    tabs?.forEach((t, i) => {
      const active = (i === 0 && mode === "toc") || (i === 1 && mode === "notes");
      t.toggleClass("is-active", active);
    });
    if (mode === "notes") void this.renderNotesPanel();
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

  private destroyBook(invalidateSession = true) {
    if (invalidateSession) this.bookGeneration += 1;
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
    if (invalidateSession) this.resetNotesFilters();

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
      this.themesRegistered = false;
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
    const generation = this.beginBookSession();
    this.destroyBook(false);

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
      if (this.isBookSessionStale(generation)) return;
      this.book = ePub(arrayBuffer as ArrayBuffer);

      await this.book.ready;
      if (this.isBookSessionStale(generation)) return;

      // Strip scripts at parse time; inline blob stylesheets before iframe srcdoc load.
      this.book.spine.hooks.content.register((doc: Document) => {
        if (this.isBookSessionStale(generation)) return;
        stripExecutableFromDocument(doc);
      });
      await this.book.replacements();
      if (this.isBookSessionStale(generation)) return;
      this.book.spine.hooks.serialize.register(async (_output: string, section: { output?: string }) => {
        if (this.isBookSessionStale(generation)) return;
        const html = section.output ?? _output;
        try {
          const prepared = await prepareSectionHtmlForSpine(html);
          if (!this.isBookSessionStale(generation)) section.output = prepared;
        } catch (err) {
          console.warn("ob-epub: section sanitize failed", err);
        }
      });

      loadingEl.remove();

      await this.loadTocData();
      if (this.isBookSessionStale(generation)) return;

      this.applyPublicationReadingHints();

      // 等一帧确保 readerEl 已有真实布局尺寸
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (this.isBookSessionStale(generation)) return;

      const rect = this.readerEl.getBoundingClientRect();
      const w = Math.max(rect.width || 600, 300);
      const h = Math.max(rect.height || 500, 200);

      // Render
      this.rendition = this.book.renderTo(this.readerEl, {
        flow: this.flow,
        width: w,
        height: h,
        allowScriptedContent: false,
        ignoreClass: CFI_IGNORE_CLASSES,
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
      this.rendition.on("markClicked", (cfiRange: string, data?: { id?: string }) => {
        void this.handleHighlightMarkClick(data?.id ?? "", cfiRange);
      });

      // Mouse wheel + keyboard navigation (bound inside each iframe document)
      this.rendition.hooks.content.register(async (contents: { document?: Document }) => {
        if (this.isBookSessionStale(generation)) return;
        try {
          this.attachContentNavigation(contents);
          await this.inlineBlockedStylesheets(contents);
          this.injectReadingThemeIntoDocument(contents?.document);
        } catch (err) {
          console.warn("ob-epub: content hook failed", err);
        }
      });

      // Track location changes
      this.rendition.on("relocated", (location: any) => {
        this.currentCfi = normalizeCfi(location?.start?.cfi);
        this.syncChapterFromLocation(location);
        const percentage = this.extractPercentFromLocation(location);
        this.updateProgressBar(percentage);
        this.scheduleProgressSave(percentage);
        if (!this.isNavigating) {
          this.scheduleHighlightSync();
        }
      });

      // Draw highlights only after epub.js finishes rendering the page iframe.
      this.rendition.on("rendered", () => {
        if (this.isNavigating) return;
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
              this.isBookInitializing = false;
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
          this.isBookInitializing = false;
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
      if (this.annotationsEnabled()) {
        this.annotationWatcherCleanup = this.annotationVaultStore.watchFile(
          file.path,
          () => this.refreshHighlights()
        );
      }

      // Keyboard navigation at the host level
      this.registerKeyboardNavigation();

      this.renderToc();

      // Refresh notes panel if currently shown
      if (this.sidebarMode === "notes") this.renderNotesPanel();
    } catch (err) {
      loadingEl.textContent = `加载失败: ${err}`;
      console.error("EPUB load error:", err);
    } finally {
      if (this.isBookSessionStale(generation)) {
        loadingEl.remove();
      }
    }
  }

  // ---------- Navigation: wheel + keyboard ----------

  /** Obsidian CSP blocks blob:/data: stylesheet links in EPUB iframes. */
  private async inlineBlockedStylesheets(contents: any): Promise<void> {
    if (!contents?.document || !contents?.content || !contents?.window) return;
    const doc: Document = contents.document;
    stripExecutableFromDocument(doc);

    const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
    for (const node of links) {
      const link = node as HTMLLinkElement;
      const href = link.getAttribute("href");
      if (!href || !isBlockedStylesheetHref(href)) continue;
      try {
        const css = await readStylesheetHref(href);
        if (!css) {
          link.remove();
          continue;
        }
        const style = doc.createElement("style");
        style.setAttribute("data-ob-epub-inlined", "1");
        style.textContent = css;
        link.parentNode?.insertBefore(style, link);
        link.remove();
      } catch (err) {
        console.warn("ob-epub: inline stylesheet failed", href, err);
        link.remove();
      }
    }
  }

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

  private buildThemeToolbar(toolbar: HTMLElement) {
    const swatches = toolbar.createDiv({ cls: "epub-theme-swatches" });
    this.themeSwatchesEl = swatches;

    for (const theme of READING_THEMES) {
      const swatch = swatches.createEl("button", {
        cls: "epub-theme-swatch",
        type: "button",
        attr: { "data-theme": theme.id },
      });
      swatch.title = theme.label;
      if (theme.id === "obsidian") {
        swatch.style.background = theme.swatch;
      } else {
        swatch.style.backgroundColor = theme.swatch;
      }
      swatch.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void this.setReadingTheme(theme.id);
      });
    }

    this.updateThemeToolbarActive();
  }

  private updateThemeToolbarActive() {
    if (!this.themeSwatchesEl || !this.themeSwatchesEl.isConnected) {
      this.themeSwatchesEl =
        this.toolbarEl?.querySelector<HTMLElement>(".epub-theme-swatches") ?? null;
    }
    if (!this.themeSwatchesEl) return;
    this.themeSwatchesEl.querySelectorAll(".epub-theme-swatch").forEach((el) => {
      const id = (el as HTMLElement).dataset.theme;
      el.toggleClass("is-active", id === this.readingTheme);
    });
  }

  private buildHighlightOpacityToolbar(toolbar: HTMLElement) {
    const group = toolbar.createDiv({ cls: "epub-highlight-opacity" });
    const label = group.createSpan({ cls: "epub-highlight-opacity-label", text: "高亮" });
    label.title = "高亮透明度";

    const range = group.createEl("input", {
      cls: "epub-highlight-opacity-range",
      type: "range",
      attr: {
        min: String(Math.round(HIGHLIGHT_OPACITY_MIN * 100)),
        max: String(Math.round(HIGHLIGHT_OPACITY_MAX * 100)),
        step: "1",
      },
    });
    this.highlightOpacityRangeEl = range;
    this.syncHighlightOpacityToolbar();

    range.addEventListener("input", () => {
      const opacity = clampHighlightOpacity(Number(range.value) / 100);
      this.settings.epubHighlightOpacity = opacity;
      range.title = `高亮透明度 ${Math.round(opacity * 100)}%`;
      void this.refreshHighlights();
    });
    range.addEventListener("change", () => {
      const opacity = clampHighlightOpacity(Number(range.value) / 100);
      if (this.onEpubHighlightOpacityChange) {
        void this.onEpubHighlightOpacityChange(opacity);
      }
    });
  }

  private syncHighlightOpacityToolbar() {
    if (!this.highlightOpacityRangeEl) return;
    const opacity = clampHighlightOpacity(this.settings.epubHighlightOpacity);
    const percent = Math.round(opacity * 100);
    this.highlightOpacityRangeEl.value = String(percent);
    this.highlightOpacityRangeEl.title = `高亮透明度 ${percent}%`;
  }

  private async setReadingTheme(id: ReadingThemeId) {
    this.readingTheme = id;
    this.updateThemeToolbarActive();
    this.applyThemeSafe();
    if (this.onReadingThemeChange) {
      try {
        await this.onReadingThemeChange(id);
      } catch (err) {
        console.warn("ob-epub: save reading theme failed", err);
      }
    }
  }

  private resolveThemeColors(): {
    background: string;
    textColor: string;
    linkColor: string;
    selectionBg: string;
    accent: string;
  } {
    const isDark = document.body.hasClass("theme-dark");
    if (this.readingTheme === "obsidian") {
      return {
        background: this.cssVar("--background-primary", isDark ? "#1e1e1e" : "#ffffff"),
        textColor: this.cssVar("--text-normal", isDark ? "#dcddde" : "#1a1a1a"),
        linkColor: this.cssVar("--link-color", "#5b8def"),
        selectionBg: this.cssVar(
          "--text-selection",
          isDark ? "rgba(123,104,238,0.4)" : "rgba(123,104,238,0.25)"
        ),
        accent: this.cssVar("--interactive-accent", "#7b68ee"),
      };
    }

    const theme = READING_THEMES.find((t) => t.id === this.readingTheme)!;
    return {
      background: theme.background,
      textColor: theme.text,
      linkColor: theme.link,
      selectionBg: theme.selection,
      accent: this.cssVar("--interactive-accent", "#7b68ee"),
    };
  }

  private buildThemeRules(
    background: string,
    textColor: string,
    linkColor: string,
    selectionBg: string,
    fontFamily: string
  ): Record<string, Record<string, string>> {
    return {
      "html, body": {
        background: `${background} !important`,
        color: `${textColor} !important`,
      },
      body: {
        "font-family": fontFamily,
        "line-height": "1.8",
        padding: "2em 3em",
      },
      // EPUB 内嵌样式常在子元素上写死 color，仅设置 body 无法覆盖
      "body *": {
        color: `${textColor} !important`,
      },
      "body a, body a *": {
        color: `${linkColor} !important`,
      },
      "*": {
        "-webkit-user-select": "text !important",
        "user-select": "text !important",
      },
      "::selection": { background: `${selectionBg}`, color: `${textColor}` },
      "::-moz-selection": { background: `${selectionBg}`, color: `${textColor}` },
    };
  }

  /** 高优先级选择器，覆盖 EPUB 内嵌 stylesheet 中的 color/background 规则 */
  private buildInjectedThemeCss(
    background: string,
    textColor: string,
    linkColor: string,
    selectionBg: string,
    fontFamily: string
  ): string {
    const root = `html[${READING_THEME_ATTR}] body`;
    const blocks: string[] = [
      `${root}{background:${background} !important;color:${textColor} !important;font-family:${fontFamily};line-height:1.8;padding:2em 3em}`,
      `${root} *{color:${textColor} !important;-webkit-user-select:text !important;user-select:text !important}`,
      `${root} a,${root} a *{color:${linkColor} !important}`,
      `${root} ::selection{background:${selectionBg};color:${textColor}}`,
      `${root} ::-moz-selection{background:${selectionBg};color:${textColor}}`,
    ];
    return blocks.join("\n");
  }

  private injectReadingThemeIntoDocument(doc: Document | null | undefined): void {
    if (!doc?.documentElement || !doc.head) return;

    try {
      const fontFamily = this.cssVar(
        "--font-text",
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif'
      );
      const { background, textColor, linkColor, selectionBg } = this.resolveThemeColors();

      doc.documentElement.setAttribute(READING_THEME_ATTR, this.readingTheme);

      let styleEl = doc.getElementById(READING_THEME_STYLE_ID) as HTMLStyleElement | null;
      if (!styleEl) {
        styleEl = doc.createElement("style");
        styleEl.id = READING_THEME_STYLE_ID;
      } else {
        styleEl.remove();
      }
      styleEl.textContent = this.buildInjectedThemeCss(
        background,
        textColor,
        linkColor,
        selectionBg,
        fontFamily
      );
      doc.head.appendChild(styleEl);
    } catch (err) {
      console.warn("ob-epub: inject reading theme failed", err);
    }
  }

  private applyThemeToAllContents(): void {
    if (!this.rendition) return;
    try {
      const contents = this.rendition.getContents() as Array<{ document?: Document }>;
      if (!Array.isArray(contents)) return;
      for (const content of contents) {
        this.injectReadingThemeIntoDocument(content?.document);
      }
    } catch (err) {
      console.warn("ob-epub: apply theme to contents failed", err);
    }
  }

  private applyThemeSafe(): void {
    try {
      this.applyTheme();
    } catch (err) {
      console.warn("ob-epub: applyTheme failed", err);
      if (this.readerEl) {
        const { background } = this.resolveThemeColors();
        this.readerEl.style.background = background;
      }
      this.applyThemeToAllContents();
    }
  }

  private registerAllThemes(fontFamily: string) {
    if (!this.rendition || this.themesRegistered) return;

    const isDark = document.body.hasClass("theme-dark");
    const obsidianColors = {
      background: this.cssVar("--background-primary", isDark ? "#1e1e1e" : "#ffffff"),
      textColor: this.cssVar("--text-normal", isDark ? "#dcddde" : "#1a1a1a"),
      linkColor: this.cssVar("--link-color", "#5b8def"),
      selectionBg: this.cssVar(
        "--text-selection",
        isDark ? "rgba(123,104,238,0.4)" : "rgba(123,104,238,0.25)"
      ),
    };

    this.rendition.themes.register(
      "obsidian",
      this.buildThemeRules(
        obsidianColors.background,
        obsidianColors.textColor,
        obsidianColors.linkColor,
        obsidianColors.selectionBg,
        fontFamily
      )
    );

    for (const theme of READING_THEMES) {
      if (theme.id === "obsidian") continue;
      this.rendition.themes.register(
        theme.id,
        this.buildThemeRules(theme.background, theme.text, theme.link, theme.selection, fontFamily)
      );
    }

    this.themesRegistered = true;
  }

  private applyTheme() {
    if (!this.rendition) return;

    const fontFamily = this.cssVar(
      "--font-text",
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif'
    );

    this.registerAllThemes(fontFamily);

    const { background, textColor, linkColor, selectionBg, accent } = this.resolveThemeColors();

    if (this.readingTheme === "obsidian") {
      this.rendition.themes.register(
        "obsidian",
        this.buildThemeRules(background, textColor, linkColor, selectionBg, fontFamily)
      );
    }

    try {
      this.rendition.themes.select(this.readingTheme);
      this.rendition.themes.fontSize(`${this.fontSize}px`);
    } catch (err) {
      console.warn("ob-epub: epub.js theme select failed", err);
    }
    this.accentColor = accent;

    this.applyThemeToAllContents();

    if (this.readerEl) {
      this.readerEl.style.background = background;
    }
  }

  /** Honor publication rendition metadata; user toolbar toggle still overrides later. */
  private applyPublicationReadingHints(): void {
    if (!this.book) return;

    const meta = this.book.package?.metadata;
    const pubFlow = meta?.flow;
    if (pubFlow === "scrolled-doc" || pubFlow === "scrolled-continuous") {
      this.flow = "scrolled";
    } else if (pubFlow === "paginated") {
      this.flow = "paginated";
    } else {
      this.flow = this.settings.defaultFlow;
    }

    const flowBtn = this.toolbarEl?.querySelector("#epub-flow-btn") as HTMLElement | null;
    if (flowBtn) {
      flowBtn.textContent = this.flow === "paginated" ? "📄 分页" : "📜 滚动";
    }

    if (meta?.layout === "pre-paginated") {
      new Notice("此书为固定版式 EPUB，排版可能与专用阅读器有差异。");
    }
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
      this.notesChapterCollapsed.delete(normalizeChapterName(resolved));
    }
  }

  private renderTocItems(items: NavItem[], container: HTMLElement, depth: number) {
    for (const item of items) {
      const li = container.createEl("li", { cls: "epub-toc-item" });
      li.setCssProps({ paddingLeft: `${depth * 12}px` });

      const label = li.createEl("span", { cls: "epub-toc-label", text: item.label.trim() });
      label.addEventListener("click", () => {
        this.blockProgressSave = false;
        this.isBookInitializing = false;
        this.currentChapter = item.label.trim();
        this.rendition?.display(item.href);
      });

      if (item.subitems && item.subitems.length > 0) {
        const toggle = li.createEl("span", { cls: "epub-toc-toggle", text: "▶" });
        const subList = li.createEl("ul", { cls: "epub-toc-sublist is-collapsed" });

        toggle.addEventListener("click", (e) => {
          e.stopPropagation();
          const expanded = !subList.hasClass("is-collapsed");
          subList.toggleClass("is-collapsed", expanded);
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
    return cfiProgressMatches(target, actual);
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
    if (fill) fill.setCssProps({ width: `${pct}%` });
    if (text) text.textContent = `${pct}%`;
  }

  private showContextMenu(contents: any) {
    this.dismissContextMenu();

    const menu = document.createElement("div");
    menu.className = "epub-context-menu";
    menu.addEventListener("mousedown", (e) => e.stopPropagation());

    const copyBtn = menu.createEl("button", { cls: "epub-ctx-btn", text: "📋 复制" });
    copyBtn.title = "按当前摘录格式复制到剪贴板";
    copyBtn.addEventListener("click", () => {
      this.dismissContextMenu();
      void this.copySelectionAsExcerpt();
    });

    if (!this.annotationsEnabled()) {
      document.body.appendChild(menu);
      this.contextMenu = menu;
      this.positionMenu(menu, contents);
      this.bindContextMenuDismiss(true, contents?.document);
      return;
    }

    const copyDivider = menu.createDiv({ cls: "epub-ctx-divider" });
    void copyDivider;

    // Color row: five drawing-line colors
    const colorRow = menu.createDiv({ cls: "epub-ctx-colors" });
    for (const c of HIGHLIGHT_COLORS) {
      const dot = colorRow.createDiv({ cls: "epub-color-dot" });
      dot.setAttribute("data-color", c.id);
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

    document.body.appendChild(menu);
    this.contextMenu = menu;
    this.positionMenu(menu, contents);
    this.bindContextMenuDismiss(true, contents?.document);
  }

  private positionMenu(menu: HTMLElement, contents: any) {
    const iframe = this.readerEl?.querySelector("iframe") as HTMLIFrameElement | null;
    const sel = contents?.window?.getSelection?.();
    if (sel && sel.rangeCount > 0 && iframe) {
      menu.removeClass("is-centered");
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
      menu.setCssProps({
        top: `${Math.max(8, top)}px`,
        left: `${Math.max(8, left)}px`,
        transform: "",
      });
    } else {
      menu.addClass("is-centered");
      menu.setCssProps({ top: "", left: "", transform: "" });
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

    if (hashes.length > 0) {
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
  }

  private syncAllDisplayedHighlights() {
    for (const view of this.getDisplayedViews()) {
      this.syncViewHighlights(view);
    }
    requestAnimationFrame(() => {
      this.syncAllNoteIcons();
    });
  }

  private scheduleHighlightSync() {
    if (this.highlightSyncTimer) clearTimeout(this.highlightSyncTimer);
    this.highlightSyncTimer = setTimeout(() => {
      this.highlightSyncTimer = null;
      this.syncAllDisplayedHighlights();
    }, 80);
  }

  private purgeAllNoteIcons() {
    this.readerEl?.querySelectorAll(`.${NOTE_ICON_CLASS}`).forEach((el) => el.remove());
  }

  private removeNoteIcon(cfiRange: string) {
    this.readerEl?.querySelectorAll(`.${NOTE_ICON_CLASS}`).forEach((el) => {
      if (el.getAttribute("data-cfi") === cfiRange) el.remove();
    });
  }

  private placeNoteIconAtClientRect(annotation: Annotation, rect: DOMRect) {
    if (!this.readerEl) return;

    const readerRect = this.readerEl.getBoundingClientRect();
    const iconSize = clampNoteIconSize(this.settings.noteIconSize);
    const offsetX = clampNoteIconOffsetX(this.settings.noteIconOffsetX);
    const offsetY = clampNoteIconOffsetY(this.settings.noteIconOffsetY);
    const left = rect.right - readerRect.left - iconSize + offsetX;
    const top =
      rect.top -
      readerRect.top +
      Math.max(0, (rect.height - iconSize) / 2) +
      offsetY;

    const btn = document.createElement("button");
    btn.className = NOTE_ICON_CLASS;
    btn.type = "button";
    btn.title = `${noteTypeLabel(annotation.noteType, this.resolvedNoteTypes)} · 查看/编辑想法`;
    btn.setAttribute("data-cfi", annotation.cfiRange);
    btn.setAttribute("data-id", annotation.id);
    btn.setAttribute("data-color", annotation.color);
    const glyph = btn.createSpan({ cls: "epub-note-icon-glyph" });
    glyph.textContent = noteTypeIcon(annotation.noteType, this.resolvedNoteTypes);
    btn.setCssProps({
      width: `${iconSize}px`,
      height: `${iconSize}px`,
      "--epub-note-glyph-size": `${noteIconGlyphSize(iconSize)}px`,
      top: `${top}px`,
      left: `${left}px`,
    });

    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ann =
        this.cachedHighlights.find((a) => a.id === annotation.id) ?? annotation;
      this.openNoteEditor(ann);
    });

    this.readerEl.appendChild(btn);
  }

  private getHighlightClientRect(cfiRange: string): DOMRect | null {
    for (const view of this.getViewList()) {
      const hl = view.highlights?.[cfiRange];
      const el = hl?.element as Element | undefined;
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) return rect;
    }

    if (!this.readerEl) return null;
    for (const el of this.readerEl.querySelectorAll(`[ref="${HIGHLIGHT_CLASS}"]`)) {
      const mark = el as HTMLElement;
      if (mark.dataset.epubcfi === cfiRange) {
        const rect = mark.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) return rect;
      }
    }
    return null;
  }

  private placeNoteIconAtRange(annotation: Annotation, range: Range) {
    const rects = range.getClientRects();
    if (rects.length === 0) return;
    this.placeNoteIconAtClientRect(annotation, rects[rects.length - 1]);
  }

  private resolveAnnotationRange(cfiRange: string): Range | null {
    if (!this.rendition) return null;
    try {
      const range = (this.rendition as any).getRange?.(cfiRange);
      if (range) return range;
    } catch {
      /* fall through */
    }
    for (const view of this.getDisplayedViews()) {
      try {
        const range = view.contents?.range?.(cfiRange);
        if (range) return range;
      } catch {
        /* try next view */
      }
    }
    return null;
  }

  private syncAllNoteIcons() {
    if (!this.readerEl || !this.rendition) return;
    this.purgeAllNoteIcons();

    for (const ann of this.cachedHighlights) {
      if (!ann.note) continue;
      const hlRect = this.getHighlightClientRect(ann.cfiRange);
      if (hlRect) {
        this.placeNoteIconAtClientRect(ann, hlRect);
        continue;
      }
      const range = this.resolveAnnotationRange(ann.cfiRange);
      if (range) this.placeNoteIconAtRange(ann, range);
    }
  }

  private openNoteEditor(
    ann: Annotation,
    title = "编辑标注",
    noticeOnSave = true
  ) {
    if (!this.file) return;
    const filePath = this.file.path;
    new NoteInputModal(
      this.app,
      ann.text,
      this.resolvedNoteTypes,
      { note: ann.note, color: ann.color, noteType: ann.noteType },
      async ({ note, color, noteType }) => {
        await this.annotationVaultStore.update(filePath, ann.id, {
          note: note || undefined,
          noteType: note ? noteType : undefined,
          color,
        });
        const updated = await this.annotationVaultStore.getById(filePath, ann.id);
        if (updated) {
          this.upsertCachedHighlight(updated);
          this.redrawLine(updated);
          if (!updated.note) {
            this.removeNoteIcon(updated.cfiRange);
          }
        }
        if (this.sidebarMode === "notes") this.renderNotesPanel();
        if (noticeOnSave) new Notice("✅ 已更新");
      },
      title
    ).open();
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
      undefined,
      HIGHLIGHT_CLASS,
      {
        fill: hex,
        "fill-opacity": String(clampHighlightOpacity(this.settings.epubHighlightOpacity)),
        "mix-blend-mode": "normal",
      }
    );
    if (!annotation.note) {
      this.removeNoteIcon(annotation.cfiRange);
    } else {
      this.scheduleHighlightSync();
    }
  }

  private async handleHighlightMarkClick(annId: string, cfiRange: string) {
    if (!this.annotationsEnabled()) return;
    if (!this.file) return;
    const ann = await this.resolveAnnotationForMark(annId, cfiRange);
    if (ann) this.showAnnotationMenu(ann);
  }

  private async resolveAnnotationForMark(
    annId: string,
    cfiRange: string
  ): Promise<Annotation | null> {
    if (!this.file) return null;

    if (annId) {
      const cached = this.cachedHighlights.find((a) => a.id === annId);
      if (cached) return cached;
      const byId = await this.annotationVaultStore.getById(this.file.path, annId);
      if (byId) return byId;
    }

    return this.annotationVaultStore.getByCfi(this.file.path, cfiRange);
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
  private async refreshHighlightsAfterMutation(): Promise<void> {
    await this.refreshHighlights();
  }

  private async refreshHighlights() {
    if (!this.file || !this.rendition || this.isRefreshingHighlights) return;
    if (!this.annotationsEnabled()) {
      for (const ann of this.cachedHighlights) {
        this.removeDrawnLine(ann.cfiRange);
      }
      this.cachedHighlights = [];
      return;
    }
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

  private async copySelectionAsExcerpt() {
    if (!this.file || !this.selectedCfi || !this.selectedText) return;

    const ann: Annotation = {
      id: "copy-preview",
      cfiRange: this.selectedCfi,
      text: this.selectedText,
      color: "yellow",
      chapter: this.currentChapter || "未知章节",
      created: new Date().toISOString(),
    };

    const markdown = buildExcerptBlock(
      ann,
      this.file.path,
      this.settings.sourceLinkFormat,
      () => ""
    );

    try {
      await navigator.clipboard.writeText(markdown);
      new Notice("已复制摘录");
    } catch (err) {
      console.error("ob-epub: copy excerpt failed", err);
      new Notice("复制失败");
    }

    this.clearSelection();
  }

  private async addUnderline(color: HighlightColor) {
    if (!this.annotationsEnabled()) return;
    if (!this.file || !this.selectedCfi || !this.selectedText) return;
    const existing = await this.annotationVaultStore.getByCfi(this.file.path, this.selectedCfi);
    if (existing) {
      await this.annotationVaultStore.update(this.file.path, existing.id, { color });
      await this.refreshHighlightsAfterMutation();
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
      await this.refreshHighlightsAfterMutation();
    }
    this.clearSelection();
    if (this.sidebarMode === "notes") this.renderNotesPanel();
    new Notice("✅ 已画线");
  }

  private openNoteModal() {
    if (!this.annotationsEnabled()) return;
    if (!this.file || !this.selectedCfi || !this.selectedText) return;
    const filePath = this.file.path;
    const cfiRange = this.selectedCfi;
    const text = this.selectedText;
    const chapter = this.currentChapter || "未知章节";

    new NoteInputModal(
      this.app,
      text,
      this.resolvedNoteTypes,
      { color: "yellow" },
      async ({ note, color, noteType }) => {
        const ann: Annotation = {
          id: `ann-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
          cfiRange,
          text,
          color,
          note: note || undefined,
          noteType: note ? noteType : undefined,
          chapter,
          created: new Date().toISOString(),
        };
        await this.annotationVaultStore.add(filePath, ann);
        await this.refreshHighlightsAfterMutation();
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
    if (!this.annotationsEnabled()) return;
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
      dot.setAttribute("data-color", c.id);
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
      this.openNoteEditor(ann);
    });

    const delBtn = menu.createEl("button", { cls: "epub-ctx-btn is-danger", text: "🗑 删除" });
    delBtn.addEventListener("click", () => {
      this.dismissContextMenu();
      this.confirmDeleteAnnotation(ann);
    });

    document.body.appendChild(menu);
    this.contextMenu = menu;

    const contents = (this.rendition as any)?.getContents?.()?.[0];
    this.positionMenu(menu, contents);
    this.bindContextMenuDismiss(false, contents?.document);
  }

  private async removeAnnotation(id: string, cfiRange: string) {
    if (!this.file) return;
    this.removeNoteIcon(cfiRange);
    this.removeDrawnLine(cfiRange);
    this.cachedHighlights = this.cachedHighlights.filter((a) => a.id !== id);
    await this.annotationVaultStore.remove(this.file.path, id);
    if (this.sidebarMode === "notes") this.renderNotesPanel();
    new Notice("🗑 标注已删除");
  }

  private resetNotesFilters() {
    this.notesSearchQuery = "";
    this.notesColorFilter = new Set();
    this.notesTypeFilter = null;
    this.notesChapterCollapsed.clear();
    this.notesListEl = null;
    this.notesCountEl = null;
    this.notesSearchInputEl = null;
    this.notesCollapseAllBtn = null;
  }

  private confirmDeleteAnnotation(ann: Annotation) {
    const preview =
      ann.text.length > 60 ? ann.text.slice(0, 60) + "…" : ann.text;
    new ConfirmModal(
      this.app,
      "删除标注",
      `确定删除这条标注？\n「${preview}」`,
      () => void this.removeAnnotation(ann.id, ann.cfiRange)
    ).open();
  }

  private appendHighlightedQuery(
    el: HTMLElement,
    text: string,
    query: string
  ): void {
    const trimmed = query.trim();
    if (!trimmed) {
      el.appendText(text);
      return;
    }

    const lower = text.toLowerCase();
    const qLower = trimmed.toLowerCase();
    let lastIndex = 0;
    let idx = lower.indexOf(qLower);
    while (idx !== -1) {
      if (idx > lastIndex) {
        el.appendText(text.slice(lastIndex, idx));
      }
      el.createEl("mark", {
        cls: "epub-notes-highlight",
        text: text.slice(idx, idx + qLower.length),
      });
      lastIndex = idx + qLower.length;
      idx = lower.indexOf(qLower, lastIndex);
    }
    if (lastIndex < text.length) {
      el.appendText(text.slice(lastIndex));
    }
  }

  private isNotesFilterActive(): boolean {
    return (
      this.notesSearchQuery.trim().length > 0 ||
      this.notesColorFilter.size > 0 ||
      this.notesTypeFilter !== null
    );
  }

  private filterNotesList(list: Annotation[]): Annotation[] {
    const query = this.notesSearchQuery.trim().toLowerCase();
    return list.filter((ann) => {
      if (this.notesColorFilter.size > 0 && !this.notesColorFilter.has(ann.color)) {
        return false;
      }
      if (this.notesTypeFilter === "highlight-only" && ann.note) return false;
      if (
        this.notesTypeFilter &&
        this.notesTypeFilter !== "highlight-only"
      ) {
        if (!ann.note || ann.noteType !== this.notesTypeFilter) return false;
      }
      if (query) {
        const hay = `${ann.text} ${ann.note ?? ""} ${ann.chapter}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }

  private updateNotesCount(total: number, filtered: number) {
    if (!this.notesCountEl) return;
    if (this.isNotesFilterActive() && filtered !== total) {
      this.notesCountEl.setText(`共 ${filtered} / ${total} 条`);
    } else {
      this.notesCountEl.setText(`共 ${filtered} 条`);
    }
  }

  private refreshNotesListView(allList: Annotation[]) {
    const filtered = this.filterNotesList(allList);
    this.updateNotesCount(allList.length, filtered.length);
    this.syncNotesCollapseAllButton(allList);
    this.renderNotesList(allList, filtered);
  }

  private getVisibleNoteChapters(list: Annotation[]): string[] {
    const filtered = this.filterNotesList(list);
    const groups = groupAnnotationsByChapter(filtered);
    const tocLabels = this.tocSpineEntries.map((e) => e.label);
    return sortChapterNames([...groups.keys()], groups, tocLabels);
  }

  private areAllNoteChaptersCollapsed(list: Annotation[]): boolean {
    const chapters = this.getVisibleNoteChapters(list);
    if (chapters.length === 0) return false;
    return chapters.every((chapter) => this.notesChapterCollapsed.has(chapter));
  }

  private toggleAllNotesChaptersCollapse(list: Annotation[]) {
    const chapters = this.getVisibleNoteChapters(list);
    const collapse = !this.areAllNoteChaptersCollapsed(list);
    for (const chapter of chapters) {
      if (collapse) {
        this.notesChapterCollapsed.add(chapter);
      } else {
        this.notesChapterCollapsed.delete(chapter);
      }
    }
    this.refreshNotesListView(list);
  }

  private syncNotesCollapseAllButton(list: Annotation[]) {
    if (!this.notesCollapseAllBtn) return;
    const chapters = this.getVisibleNoteChapters(list);
    const show = chapters.length > 1;
    this.notesCollapseAllBtn.toggleVisibility(show);
    if (!show) return;
    const allCollapsed = this.areAllNoteChaptersCollapsed(list);
    this.notesCollapseAllBtn.setText(allCollapsed ? "▶ 展开全部" : "▼ 折叠全部");
    this.notesCollapseAllBtn.title = allCollapsed ? "展开全部章节" : "折叠全部章节";
  }

  private buildNotesToolbar(parent: HTMLElement) {
    const toolbar = parent.createDiv({ cls: "epub-notes-toolbar" });

    const head = toolbar.createDiv({ cls: "epub-notes-toolbar-head" });
    this.notesCollapseAllBtn = head.createEl("button", {
      cls: "epub-notes-collapse-all",
      text: "▼ 折叠全部",
    });
    this.notesCollapseAllBtn.title = "折叠全部章节";
    this.notesCollapseAllBtn.addEventListener("click", () => {
      this.toggleAllNotesChaptersCollapse(this.cachedHighlights);
    });

    const search = toolbar.createEl("input", {
      cls: "epub-notes-search",
      type: "search",
      attr: { placeholder: "搜索标注…" },
    });
    search.value = this.notesSearchQuery;
    this.notesSearchInputEl = search;
    search.addEventListener("input", () => {
      const caret = search.selectionStart ?? search.value.length;
      this.notesSearchQuery = search.value;
      this.refreshNotesListView(this.cachedHighlights);
      search.focus();
      search.setSelectionRange(caret, caret);
    });

    const colorRow = toolbar.createDiv({ cls: "epub-notes-filter-row" });
    const allColorBtn = colorRow.createEl("button", {
      cls: "epub-notes-filter-all",
      text: "全部",
    });
    allColorBtn.title = "清除颜色与类型筛选";
    allColorBtn.toggleClass(
      "is-active",
      this.notesColorFilter.size === 0 && this.notesTypeFilter === null
    );
    allColorBtn.addEventListener("click", () => {
      this.notesColorFilter.clear();
      this.notesTypeFilter = null;
      this.syncNotesToolbarState(toolbar);
      this.refreshNotesListView(this.cachedHighlights);
    });

    const dots = colorRow.createDiv({ cls: "epub-color-dots" });
    for (const c of HIGHLIGHT_COLORS) {
      const dot = dots.createDiv({ cls: "epub-color-dot" });
      dot.setAttribute("data-color", c.id);
      dot.title = c.label;
      if (this.notesColorFilter.has(c.id)) dot.addClass("is-active");
      dot.addEventListener("click", () => {
        if (this.notesColorFilter.has(c.id)) {
          this.notesColorFilter.delete(c.id);
        } else {
          this.notesColorFilter.add(c.id);
        }
        this.syncNotesToolbarState(toolbar);
        this.refreshNotesListView(this.cachedHighlights);
      });
    }

    const typeRow = toolbar.createDiv({ cls: "epub-notes-type-row" });
    const allTypeChip = typeRow.createEl("button", {
      cls: "epub-note-type-chip",
      text: "全部",
    });
    if (this.notesTypeFilter === null) allTypeChip.addClass("is-active");
    allTypeChip.addEventListener("click", () => {
      this.notesTypeFilter = null;
      this.syncNotesToolbarState(toolbar);
      this.refreshNotesListView(this.cachedHighlights);
    });

    const highlightChip = typeRow.createEl("button", {
      cls: "epub-note-type-chip",
      text: "仅画线",
    });
    if (this.notesTypeFilter === "highlight-only") highlightChip.addClass("is-active");
    highlightChip.addEventListener("click", () => {
      this.notesTypeFilter =
        this.notesTypeFilter === "highlight-only" ? null : "highlight-only";
      this.syncNotesToolbarState(toolbar);
      this.refreshNotesListView(this.cachedHighlights);
    });

    for (const t of this.resolvedNoteTypes) {
      const chip = typeRow.createEl("button", {
        cls: "epub-note-type-chip",
        text: `${t.icon} ${t.label}`,
      });
      if (this.notesTypeFilter === t.id) chip.addClass("is-active");
      chip.addEventListener("click", () => {
        this.notesTypeFilter = this.notesTypeFilter === t.id ? null : t.id;
        this.syncNotesToolbarState(toolbar);
        this.refreshNotesListView(this.cachedHighlights);
      });
    }

    this.notesCountEl = head.createDiv({ cls: "epub-notes-count" });
    this.syncNotesCollapseAllButton(this.cachedHighlights);
    this.notesListEl = parent.createDiv({ cls: "epub-notes-list-wrap" });
  }

  private syncNotesToolbarState(toolbar: HTMLElement) {
    const allColorBtn = toolbar.querySelector(".epub-notes-filter-all");
    allColorBtn?.toggleClass(
      "is-active",
      this.notesColorFilter.size === 0 && this.notesTypeFilter === null
    );

    toolbar.querySelectorAll(".epub-color-dots .epub-color-dot").forEach((dot) => {
      const color = dot.getAttribute("data-color") as HighlightColor;
      dot.toggleClass("is-active", this.notesColorFilter.has(color));
    });

    const chips = toolbar.querySelectorAll(".epub-notes-type-row .epub-note-type-chip");
    chips.forEach((chip, i) => {
      if (i === 0) {
        chip.toggleClass("is-active", this.notesTypeFilter === null);
      } else if (i === 1) {
        chip.toggleClass("is-active", this.notesTypeFilter === "highlight-only");
      } else {
        const typeDef = this.resolvedNoteTypes[i - 2];
        chip.toggleClass("is-active", this.notesTypeFilter === typeDef?.id);
      }
    });
  }

  private renderNoteItem(parent: HTMLElement, ann: Annotation, query: string) {
    const li = parent.createEl("li", { cls: "epub-note-item is-clickable" });
    const jump = () => void this.navigateToCfi(ann.cfiRange);

    const head = li.createDiv({ cls: "epub-note-item-head" });
    head.addEventListener("click", jump);
    const dot = head.createDiv({ cls: "epub-color-dot is-static" });
    dot.setAttribute("data-color", ann.color);
    head.createSpan({ cls: "epub-note-item-chapter", text: ann.chapter });
    if (ann.note) {
      head.createSpan({
        cls: "epub-note-item-type",
        text: noteTypeLabel(ann.noteType, this.resolvedNoteTypes),
      });
    }

    const quoteText =
      ann.text.length > 90 ? ann.text.slice(0, 90) + "…" : ann.text;
    const quote = li.createDiv({ cls: "epub-note-item-text" });
    quote.addEventListener("click", jump);
    this.appendHighlightedQuery(quote, quoteText, query);

    if (ann.note) {
      const note = li.createDiv({ cls: "epub-note-item-note" });
      note.addEventListener("click", jump);
      this.appendHighlightedQuery(note, ann.note, query);
    }

    const actions = li.createDiv({ cls: "epub-note-item-actions" });
    const jumpBtn = actions.createEl("button", { cls: "epub-note-action", text: "跳转" });
    jumpBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.navigateToCfi(ann.cfiRange);
    });
    const editBtn = actions.createEl("button", { cls: "epub-note-action", text: "编辑" });
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openNoteEditor(ann, "编辑标注", false);
    });
    const delBtn = actions.createEl("button", {
      cls: "epub-note-action is-danger",
      text: "删除",
    });
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.confirmDeleteAnnotation(ann);
    });
  }

  private renderNotesList(allList: Annotation[], filtered: Annotation[]) {
    if (!this.notesListEl) return;
    this.notesListEl.empty();

    if (allList.length === 0) {
      this.notesListEl.createDiv({
        cls: "epub-notes-empty",
        text: "暂无标注。选中文字后点击颜色画线或写想法。",
      });
      return;
    }

    if (filtered.length === 0) {
      this.notesListEl.createDiv({
        cls: "epub-notes-empty",
        text: "没有匹配的标注。",
      });
      return;
    }

    const ul = this.notesListEl.createEl("ul", { cls: "epub-notes-list" });
    const groups = groupAnnotationsByChapter(filtered);
    const tocLabels = this.tocSpineEntries.map((e) => e.label);
    const chapters = sortChapterNames([...groups.keys()], groups, tocLabels);
    const query = this.notesSearchQuery;
    const currentChapter = normalizeChapterName(this.currentChapter);

    for (const chapter of chapters) {
      const chapterAnns = [...(groups.get(chapter) ?? [])].sort((a, b) =>
        b.created.localeCompare(a.created)
      );
      if (chapterAnns.length === 0) continue;

      const collapsed = this.notesChapterCollapsed.has(chapter);
      const chapterLi = ul.createEl("li", { cls: "epub-notes-chapter" });
      if (chapter === currentChapter) chapterLi.addClass("is-current");

      const chapterHead = chapterLi.createDiv({ cls: "epub-notes-chapter-head" });
      chapterHead.createSpan({
        cls: "epub-notes-chapter-toggle",
        text: collapsed ? "▶" : "▼",
      });
      chapterHead.createSpan({ cls: "epub-notes-chapter-label", text: chapter });
      chapterHead.createSpan({
        cls: "epub-notes-chapter-count",
        text: String(chapterAnns.length),
      });

      const itemsUl = chapterLi.createEl("ul", { cls: "epub-notes-chapter-items" });
      if (collapsed) itemsUl.addClass("is-collapsed");

      chapterHead.addEventListener("click", () => {
        if (this.notesChapterCollapsed.has(chapter)) {
          this.notesChapterCollapsed.delete(chapter);
        } else {
          this.notesChapterCollapsed.add(chapter);
        }
        this.refreshNotesListView(this.cachedHighlights);
      });

      for (const ann of chapterAnns) {
        this.renderNoteItem(itemsUl, ann, query);
      }
    }
  }

  private async renderNotesPanel() {
    if (!this.notesEl) return;
    const gen = ++this.notesPanelRenderGen;
    this.notesEl.empty();
    this.notesListEl = null;
    this.notesCountEl = null;
    this.notesSearchInputEl = null;
    this.notesCollapseAllBtn = null;

    let list = this.cachedHighlights;
    if (list.length === 0 && this.file) {
      try {
        list = await this.annotationVaultStore.getByFile(this.file.path);
        this.cachedHighlights = list;
      } catch (err) {
        console.warn("ob-epub: renderNotesPanel failed", err);
        if (gen !== this.notesPanelRenderGen) return;
        this.notesEl.createDiv({
          cls: "epub-notes-empty",
          text: "标注加载失败，请稍后重试。",
        });
        return;
      }
    }
    if (gen !== this.notesPanelRenderGen) return;

    this.buildNotesToolbar(this.notesEl);
    this.refreshNotesListView(list);
  }

  // Called when settings change
  updateSettings(settings: EpubPluginSettings) {
    const prevAnnotationsOn = this.annotationsEnabled();
    this.settings = settings;
    const annotationsChanged = prevAnnotationsOn !== this.annotationsEnabled();
    if (annotationsChanged && this.toolbarEl) {
      this.buildToolbar(this.toolbarEl);
    } else {
      this.updateThemeToolbarActive();
      this.syncHighlightOpacityToolbar();
    }
    this.applyAnnotationsFeatureState();
    this.fontSize = settings.fontSize;
    const nextTheme = normalizeReadingTheme(settings.readingTheme);
    const themeChanged = nextTheme !== this.readingTheme;
    if (themeChanged) {
      this.readingTheme = nextTheme;
    }
    if (this.rendition) {
      if (themeChanged) {
        this.applyThemeSafe();
        this.updateThemeToolbarActive();
      } else {
        this.rendition.themes.fontSize(`${this.fontSize}px`);
      }
      void this.refreshHighlights();
    }
    if (this.sidebarMode === "notes") void this.renderNotesPanel();
  }
}
