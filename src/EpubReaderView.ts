import { FileView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import ePub, { Book, Rendition, NavItem } from "epubjs";
import { AnnotationVaultStore } from "./AnnotationVaultStore";
import { cfiProgressMatches } from "./cfi/cfiMatch";
import { parseEpubSubpath } from "./epubSubpath";
import { ProgressStore, normalizeCfi, normalizePercent } from "./ProgressStore";
import { t } from "./i18n/i18n";
import {
  EpubPluginSettings,
  EpubOpenBridge,
  Annotation,
  HighlightColor,
  NoteType,
  getHighlightColors,
  getReadingThemes,
  unknownChapterLabel,
  ReadingThemeId,
  colorHex,
  noteTypeIcon,
  noteTypeLabel,
  clampNoteIconSize,
  clampNoteIconOffsetX,
  clampNoteIconOffsetY,
  clampHighlightOpacity,
  clampReadingSidePadding,
  HIGHLIGHT_OPACITY_MIN,
  HIGHLIGHT_OPACITY_MAX,
  READING_SIDE_PADDING_STEP,
  noteIconGlyphSize,
  normalizeReadingTheme,
  resolveNoteTypes,
  isAnnotationsAndExcerptsEnabled,
} from "./types";
import { buildExcerptBlock } from "./excerptBlockFormat";
import { ExcerptInsertResult, ExcerptPasteTarget, noticeExcerptCopy } from "./ExcerptPasteTarget";
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

/** epub.js manager 最小访问面，用于分页模式同步 gap */
type EpubLayoutManager = {
  settings?: { gap?: number };
  updateLayout?: () => void;
};

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
  private onReadingSidePaddingChange?: (padding: number) => Promise<void>;
  private onFontSizeChange?: (fontSize: number) => Promise<void>;
  private onAutoPasteExcerptChange?: (enabled: boolean) => Promise<void>;
  private contextMenu: HTMLElement | null = null;
  private contextMenuDismissHandler: ((e: MouseEvent) => void) | null = null;
  private contextMenuContentDoc: Document | null = null;
  private contextMenuDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private selectedText: string = "";
  private selectedCfi: string = "";
  private resizeObserver: ResizeObserver | null = null;
  private workspaceLayoutHandlersRegistered = false;
  private resizeRenditionPending = false;
  private accentColor: string = "#7b68ee";

  private openBridge: EpubOpenBridge;
  private annotationVaultStore: AnnotationVaultStore;
  private progressStore: ProgressStore;
  private excerptPasteTarget: ExcerptPasteTarget;
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
  private locationsReady = false;
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
  private sidePaddingDownBtn: HTMLButtonElement | null = null;
  private sidePaddingUpBtn: HTMLButtonElement | null = null;
  private sidebarEl: HTMLElement | null = null;
  private notesTabEl: HTMLElement | null = null;
  private tocTabEl: HTMLElement | null = null;
  private tocEl: HTMLElement | null = null;
  private notesEl: HTMLElement | null = null;
  private readerEl: HTMLElement | null = null;
  private progressEl: HTMLElement | null = null;
  private tocToggleBtn: HTMLElement | null = null;
  private tocVisible: boolean = false;
  private tocHighlightedChapter = "";
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
    excerptPasteTarget: ExcerptPasteTarget,
    settings: EpubPluginSettings,
    onReadingThemeChange?: (themeId: ReadingThemeId) => Promise<void>,
    onEpubHighlightOpacityChange?: (opacity: number) => Promise<void>,
    onReadingSidePaddingChange?: (padding: number) => Promise<void>,
    onFontSizeChange?: (fontSize: number) => Promise<void>,
    onAutoPasteExcerptChange?: (enabled: boolean) => Promise<void>
  ) {
    super(leaf);
    this.openBridge = openBridge;
    this.annotationVaultStore = annotationVaultStore;
    this.progressStore = progressStore;
    this.excerptPasteTarget = excerptPasteTarget;
    this.settings = settings;
    this.onReadingThemeChange = onReadingThemeChange;
    this.onEpubHighlightOpacityChange = onEpubHighlightOpacityChange;
    this.onReadingSidePaddingChange = onReadingSidePaddingChange;
    this.onFontSizeChange = onFontSizeChange;
    this.onAutoPasteExcerptChange = onAutoPasteExcerptChange;
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
    if (this.toolbarEl && this.openBridge.isStatusBarChromeAttached()) {
      this.openBridge.detachStatusBarChrome(
        this.toolbarEl,
        this.progressEl,
        this.contentEl
      );
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
      this.syncStatusBarChrome();

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
      new Notice(t("notice.gotoFailed"));
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

    // Sidebar with tab switcher（默认收起）
    this.sidebarEl = bodyEl.createDiv({ cls: "epub-sidebar" });
    this.sidebarEl.toggleClass("is-collapsed", !this.tocVisible);
    const tabs = this.sidebarEl.createDiv({ cls: "epub-sidebar-tabs" });
    const tocTab = tabs.createEl("button", { cls: "epub-sidebar-tab is-active", text: t("reader.sidebar.toc") });
    this.tocTabEl = tocTab;
    this.notesTabEl = tabs.createEl("button", { cls: "epub-sidebar-tab", text: t("reader.sidebar.annotations") });
    tocTab.addEventListener("click", () => this.setSidebarMode("toc"));
    this.notesTabEl.addEventListener("click", () => this.setSidebarMode("notes"));

    const panelsEl = this.sidebarEl.createDiv({ cls: "epub-sidebar-panels" });

    // TOC panel
    this.tocEl = panelsEl.createDiv({ cls: "epub-toc" });

    // Notes panel (hidden via CSS class — avoid hide()/toggleVisibility mismatch)
    this.notesEl = panelsEl.createDiv({ cls: "epub-notes is-hidden" });

    // Reader area
    this.readerEl = bodyEl.createDiv({ cls: "epub-reader-area" });

    // Bottom progress bar（底部模式时 DOM 迁到 Obsidian 状态栏）
    this.progressEl = container.createDiv({ cls: "epub-progress-bar-wrap" });
    const progressInner = this.progressEl.createDiv({ cls: "epub-progress-inner" });
    progressInner.createDiv({ cls: "epub-progress-fill", attr: { id: "epub-progress-fill" } });
    this.progressEl.createEl("span", { cls: "epub-progress-text", attr: { id: "epub-progress-text" }, text: "0%" });

    // ResizeObserver + 工作区 layout-change：Obsidian 侧栏显隐时同步 epub.js 尺寸
    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleResizeRendition();
    });
    this.resizeObserver.observe(this.contentEl);
    this.resizeObserver.observe(this.readerEl!);
    this.registerWorkspaceLayoutHandlers();
    this.applyAnnotationsFeatureState();
    this.syncFlowLayoutClass();
    this.contentEl.toggleClass("is-toolbar-bottom", this.isToolbarBottom());
    this.syncStatusBarChrome();
  }

  private isToolbarBottom(): boolean {
    return this.settings.toolbarPlacement === "bottom";
  }

  private syncFlowLayoutClass(): void {
    this.contentEl.toggleClass("epub-flow-scrolled", this.flow === "scrolled");
  }

  /** 底部模式：工具栏与进度条移入 Obsidian 底栏 */
  private shouldAttachStatusBarChrome(): boolean {
    if (!this.isToolbarBottom() || !this.containerEl.isShown()) return false;

    const activeEpub = this.app.workspace.getActiveViewOfType(EpubReaderView);
    if (activeEpub === this) return true;

    // 在设置页等场景：无活动 EPUB 时，为仍可见的 EPUB 挂上底栏
    if (!activeEpub) {
      const visibleLeaf = this.app.workspace
        .getLeavesOfType(EPUB_READER_VIEW_TYPE)
        .find((leaf) => (leaf.view as EpubReaderView).containerEl.isShown());
      return visibleLeaf?.view === this;
    }

    return false;
  }

  syncStatusBarChrome(): void {
    if (!this.toolbarEl) return;

    if (this.shouldAttachStatusBarChrome()) {
      if (!this.openBridge.isStatusBarChromeAttached()) {
        this.openBridge.attachStatusBarChrome(
          this.toolbarEl,
          this.progressEl,
          this.contentEl
        );
      }
    } else if (this.openBridge.isStatusBarChromeAttached()) {
      this.openBridge.detachStatusBarChrome(
        this.toolbarEl,
        this.progressEl,
        this.contentEl
      );
    }
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
    this.tocToggleBtn.title = t("reader.toolbar.toggleToc");
    this.tocToggleBtn.addEventListener("click", () => this.toggleToc());

    // Book title
    const titleEl = toolbar.createEl("span", { cls: "epub-toolbar-title", text: this.file?.basename ?? "EPUB Marginalia" });
    titleEl.id = "epub-toolbar-title";

    // Spacer
    toolbar.createEl("span", { cls: "epub-toolbar-spacer" });

    // Font size controls
    const fontSizeDown = toolbar.createEl("button", { cls: "epub-toolbar-btn", text: "A-" });
    fontSizeDown.title = t("reader.toolbar.fontSmaller");
    fontSizeDown.addEventListener("click", () => this.changeFontSize(-2));

    const fontSizeUp = toolbar.createEl("button", { cls: "epub-toolbar-btn", text: "A+" });
    fontSizeUp.title = t("reader.toolbar.fontLarger");
    fontSizeUp.addEventListener("click", () => this.changeFontSize(2));

    this.buildSidePaddingToolbar(toolbar);

    this.buildThemeToolbar(toolbar);
    this.buildAutoPasteToolbar(toolbar);
    if (this.annotationsEnabled()) {
      this.buildHighlightOpacityToolbar(toolbar);
    }

    // Flow toggle
    const flowBtn = toolbar.createEl("button", {
      cls: "epub-toolbar-btn",
      text: this.flowButtonText(),
      attr: { id: "epub-flow-btn" },
    });
    flowBtn.title = t("reader.toolbar.toggleFlow");
    flowBtn.addEventListener("click", () => this.toggleFlow());

    // Prev / Next
    const prevBtn = toolbar.createEl("button", { cls: "epub-toolbar-btn", text: "◀" });
    prevBtn.title = t("reader.toolbar.prevPage");
    prevBtn.addEventListener("click", () => this.rendition?.prev());

    const nextBtn = toolbar.createEl("button", { cls: "epub-toolbar-btn", text: "▶" });
    nextBtn.title = t("reader.toolbar.nextPage");
    nextBtn.addEventListener("click", () => this.rendition?.next());
  }

  private registerWorkspaceLayoutHandlers(): void {
    if (this.workspaceLayoutHandlersRegistered) return;
    this.workspaceLayoutHandlersRegistered = true;

    const onLayoutChange = () => {
      this.scheduleResizeRendition();
    };
    this.registerEvent(this.app.workspace.on("layout-change", onLayoutChange));
    this.registerEvent(this.app.workspace.on("resize", onLayoutChange));
  }

  /** 等布局稳定后再 resize（侧栏动画、分屏拖拽） */
  private scheduleResizeRendition(): void {
    if (this.resizeRenditionPending) return;
    this.resizeRenditionPending = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.resizeRenditionPending = false;
        this.resizeRendition();
      });
    });
  }

  private resizeRendition(): void {
    if (!this.rendition || !this.readerEl) return;
    const r = this.readerEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      this.syncPaginatedLayoutGap();
      this.rendition.resize(r.width, r.height);
      // epub.js resize 会重写 body 内联 padding，需重新注入主题覆盖
      this.applyThemeToAllContents();
    }
  }

  /** 分页/双栏：epub.js 用 gap/2 作为左右留白，与设置项对齐 */
  private getReadingLayoutGap(): number {
    return clampReadingSidePadding(this.settings.readingSidePadding) * 2;
  }

  private getEpubLayoutManager(): EpubLayoutManager | undefined {
    return (this.rendition as { manager?: EpubLayoutManager } | null)?.manager;
  }

  /** 将 settings.readingSidePadding 同步到 epub.js 分页 layout.gap 并重算栏宽 */
  private syncPaginatedLayoutGap(): void {
    if (this.flow !== "paginated" || !this.rendition) return;
    const manager = this.getEpubLayoutManager();
    if (!manager?.settings) return;
    manager.settings.gap = this.getReadingLayoutGap();
    manager.updateLayout?.();
  }

  private applyReadingBodyPaddingInline(body: HTMLElement): void {
    const bodyPadding = this.getReadingBodyPadding();
    const sidePx = `${clampReadingSidePadding(this.settings.readingSidePadding)}px`;
    body.style.removeProperty("padding");
    body.style.removeProperty("padding-left");
    body.style.removeProperty("padding-right");
    body.style.removeProperty("padding-top");
    body.style.removeProperty("padding-bottom");
    body.style.setProperty("padding", bodyPadding, "important");
    body.style.setProperty("padding-left", sidePx, "important");
    body.style.setProperty("padding-right", sidePx, "important");
  }

  private refreshReadingSidePadding(): void {
    this.syncPaginatedLayoutGap();
    this.applyThemeToAllContents();
  }

  private getReadingBodyPadding(): string {
    const side = `${clampReadingSidePadding(this.settings.readingSidePadding)}px`;
    if (this.isToolbarBottom()) {
      return this.flow === "scrolled" ? `0.75em ${side} 0.25em` : `1em ${side} 0.25em`;
    }
    return this.flow === "scrolled" ? `0.75em ${side} 0.25em` : `2em ${side}`;
  }

  private toggleToc() {
    this.tocVisible = !this.tocVisible;
    // 用 CSS 类收起侧边栏，避免 toggleVisibility 在 flex 布局中仍占位
    this.sidebarEl?.toggleClass("is-collapsed", !this.tocVisible);
    this.scheduleResizeRendition();
  }

  private setSidebarMode(mode: "toc" | "notes") {
    this.sidebarMode = mode;
    this.tocEl?.toggleClass("is-hidden", mode !== "toc");
    this.notesEl?.toggleClass("is-hidden", mode !== "notes");
    const tabs = this.sidebarEl?.querySelectorAll(".epub-sidebar-tab");
    tabs?.forEach((tab, i) => {
      const active = (i === 0 && mode === "toc") || (i === 1 && mode === "notes");
      tab.toggleClass("is-active", active);
    });
    if (mode === "notes") void this.renderNotesPanel();
  }

  private changeFontSize(delta: number) {
    const next = Math.max(10, Math.min(32, this.settings.fontSize + delta));
    if (next === this.settings.fontSize) return;
    this.settings.fontSize = next;
    this.fontSize = next;
    if (this.rendition) {
      this.rendition.themes.fontSize(`${this.fontSize}px`);
    }
    if (this.onFontSizeChange) {
      void this.onFontSizeChange(next);
    }
  }

  private buildSidePaddingToolbar(toolbar: HTMLElement) {
    const group = toolbar.createDiv({ cls: "epub-side-padding" });
    this.sidePaddingDownBtn = group.createEl("button", {
      cls: "epub-toolbar-btn epub-side-padding-btn",
      text: "◧-",
    });
    this.sidePaddingDownBtn.title = t("reader.toolbar.sidePaddingSmaller");
    this.sidePaddingDownBtn.addEventListener("click", () =>
      this.changeReadingSidePadding(-READING_SIDE_PADDING_STEP)
    );

    this.sidePaddingUpBtn = group.createEl("button", {
      cls: "epub-toolbar-btn epub-side-padding-btn",
      text: "◧+",
    });
    this.sidePaddingUpBtn.title = t("reader.toolbar.sidePaddingLarger");
    this.sidePaddingUpBtn.addEventListener("click", () =>
      this.changeReadingSidePadding(READING_SIDE_PADDING_STEP)
    );

    this.syncSidePaddingToolbar();
  }

  private changeReadingSidePadding(delta: number) {
    const next = clampReadingSidePadding(this.settings.readingSidePadding + delta);
    if (next === clampReadingSidePadding(this.settings.readingSidePadding)) return;
    this.settings.readingSidePadding = next;
    this.refreshReadingSidePadding();
    this.syncSidePaddingToolbar();
    if (this.onReadingSidePaddingChange) {
      void this.onReadingSidePaddingChange(next);
    }
  }

  private syncSidePaddingToolbar() {
    const px = clampReadingSidePadding(this.settings.readingSidePadding);
    const current = t("reader.toolbar.sidePaddingPx", { px });
    if (this.sidePaddingDownBtn) {
      this.sidePaddingDownBtn.title = `${t("reader.toolbar.sidePaddingSmaller")} (${current})`;
    }
    if (this.sidePaddingUpBtn) {
      this.sidePaddingUpBtn.title = `${t("reader.toolbar.sidePaddingLarger")} (${current})`;
    }
  }

  private flowButtonText(): string {
    return this.flow === "paginated"
      ? `📄 ${t("reader.toolbar.flowPaginated")}`
      : `📜 ${t("reader.toolbar.flowScrolled")}`;
  }

  private toggleFlow() {
    this.flow = this.flow === "paginated" ? "scrolled" : "paginated";
    this.syncFlowLayoutClass();
    const btn = this.toolbarEl?.querySelector("#epub-flow-btn") as HTMLElement | null;
    if (btn) btn.textContent = this.flowButtonText();

    if (this.file) {
      const savedCfi = this.currentCfi;
      this.destroyBook();
      void this.loadBook(this.file, savedCfi, { preserveFlow: true });
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
    this.locationsReady = false;
    this.tocSpineEntries = [];
    this.tocHighlightedChapter = "";
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

  private async loadBook(
    file: TFile,
    startCfi: string = "",
    opts?: { preserveFlow?: boolean }
  ) {
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

    const loadingEl = this.readerEl.createEl("div", { cls: "epub-loading", text: t("reader.loading") });

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

      if (!opts?.preserveFlow) {
        this.applyPublicationReadingHints();
      }

      // 等一帧确保 readerEl 已有真实布局尺寸
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (this.isBookSessionStale(generation)) return;

      const rect = this.readerEl.getBoundingClientRect();
      const w = Math.max(rect.width || 600, 300);
      const h = Math.max(rect.height || 500, 200);

      // Render
      this.rendition = this.book.renderTo(this.readerEl, {
        flow: this.flow === "scrolled" ? "scrolled-doc" : "paginated",
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
        this.applyProgressFromLocation(location);
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
      this.syncPaginatedLayoutGap();

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
        if (this.isBookSessionStale(generation)) return;
        this.locationsReady = true;
        await this.applyProgressFromCurrentLocation();
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
      loadingEl.textContent = t("reader.loadFailed", { error: String(err) });
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

  private buildAutoPasteToolbar(toolbar: HTMLElement) {
    const group = toolbar.createDiv({ cls: "epub-auto-paste" });
    const toggleBtn = group.createEl("button", {
      cls: "epub-toolbar-btn epub-auto-paste-toggle",
      attr: { id: "epub-auto-paste-btn", type: "button" },
    });
    toggleBtn.title = t("reader.toolbar.autoPaste");
    this.syncAutoPasteToggle(toggleBtn);
    toggleBtn.addEventListener("click", () => {
      const next = !this.settings.autoPasteExcerpt;
      this.settings.autoPasteExcerpt = next;
      this.syncAutoPasteToggle(toggleBtn);
      void this.onAutoPasteExcerptChange?.(next);
    });
  }

  private syncAutoPasteToggle(btn?: HTMLElement | null) {
    const toggleBtn =
      btn ?? this.toolbarEl?.querySelector("#epub-auto-paste-btn");
    if (!(toggleBtn instanceof HTMLButtonElement)) return;
    const enabled = this.settings.autoPasteExcerpt !== false;
    toggleBtn.textContent = enabled ? "🌟" : "★";
    toggleBtn.setAttr("aria-label", enabled ? t("reader.toolbar.autoPasteOn") : t("reader.toolbar.autoPasteOff"));
    toggleBtn.title = enabled
      ? t("reader.toolbar.autoPasteOnDesc")
      : t("reader.toolbar.autoPasteOffDesc");
    toggleBtn.toggleClass("is-on", enabled);
  }

  private buildThemeToolbar(toolbar: HTMLElement) {
    const swatches = toolbar.createDiv({ cls: "epub-theme-swatches" });
    this.themeSwatchesEl = swatches;

    for (const theme of getReadingThemes()) {
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
    const label = group.createSpan({ cls: "epub-highlight-opacity-label", text: t("reader.toolbar.highlight") });
    label.title = t("reader.toolbar.highlightOpacity");

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
      range.title = t("reader.toolbar.highlightOpacityPercent", {
        percent: Math.round(opacity * 100),
      });
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
    this.highlightOpacityRangeEl.title = t("reader.toolbar.highlightOpacityPercent", { percent });
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

    const theme = getReadingThemes().find((themeDef) => themeDef.id === this.readingTheme)!;
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
    const bodyPadding = this.getReadingBodyPadding();
    return {
      "html, body": {
        background: `${background} !important`,
        color: `${textColor} !important`,
      },
      body: {
        "font-family": fontFamily,
        "line-height": "1.8",
        padding: bodyPadding,
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

  /** 覆盖 EPUB 内嵌 max-width / margin:auto，使正文尽量占满阅读区 */
  private appendFullWidthContentRules(blocks: string[], root: string): void {
    const wideBlocks =
      "p,div,section,article,main,blockquote,figure,header,footer,nav,aside,table,center";
    blocks.push(
      `${root}{max-width:none !important;margin:0 !important;width:100% !important;box-sizing:border-box !important}`,
      `${root} > *{max-width:none !important;margin-left:0 !important;margin-right:0 !important;width:100% !important;box-sizing:border-box !important}`,
      `${wideBlocks.split(",").map((tag) => `${root} ${tag}`).join(",")}{max-width:none !important;margin-left:0 !important;margin-right:0 !important;width:100% !important;box-sizing:border-box !important}`,
      `${root} [class]{max-width:none !important;margin-left:0 !important;margin-right:0 !important;width:100% !important;box-sizing:border-box !important}`,
      `${root} [style*="max-width"]{max-width:none !important}`,
      `${root} table{max-width:100% !important;width:100% !important}`,
      `${root} img,${root} svg,${root} video{max-width:100% !important;width:auto !important;height:auto !important}`
    );
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
    const bodyPadding = this.getReadingBodyPadding();
    const sidePx = `${clampReadingSidePadding(this.settings.readingSidePadding)}px`;
    const blocks: string[] = [
      `${root}{background:${background} !important;color:${textColor} !important;font-family:${fontFamily};line-height:1.8;padding:${bodyPadding};padding-left:${sidePx} !important;padding-right:${sidePx} !important;box-sizing:border-box}`,
      `${root} *{color:${textColor} !important;-webkit-user-select:text !important;user-select:text !important}`,
      `${root} a,${root} a *{color:${linkColor} !important}`,
      `${root} ::selection{background:${selectionBg};color:${textColor}}`,
      `${root} ::-moz-selection{background:${selectionBg};color:${textColor}}`,
    ];
    this.appendFullWidthContentRules(blocks, root);
    if (this.flow === "scrolled") {
      blocks.push(
        `html[${READING_THEME_ATTR}]{max-width:none !important;margin:0 !important;width:100% !important}`,
        `html[${READING_THEME_ATTR}],html[${READING_THEME_ATTR}] body{min-height:0 !important;height:auto !important}`,
        `${root}{margin-bottom:0 !important}`
      );
    }
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

      // epub.js 分页模式 columns() 会写带 !important 的内联 padding，需用同级 inline 覆盖
      if (doc.body) {
        this.applyReadingBodyPaddingInline(doc.body);
      }

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

    for (const theme of getReadingThemes()) {
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

  /** Honor publication rendition metadata on first open; toolbar toggle preserves user choice. */
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
      flowBtn.textContent = this.flowButtonText();
    }

    if (meta?.layout === "pre-paginated") {
      new Notice(t("notice.fixedLayoutWarning"));
    }

    this.syncFlowLayoutClass();
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

    this.tocHighlightedChapter = "";
    this.renderTocItems(this.tocItems, tocList as HTMLElement, 0);
    this.updateTocActiveState();
  }

  private syncChapterFromLocation(location?: any) {
    const spineIndex = spineIndexFromLocation(location, this.currentCfi, this.book);
    if (spineIndex == null || this.tocSpineEntries.length === 0) return;

    const resolved = resolveChapterLabel(this.tocSpineEntries, spineIndex);
    if (resolved) {
      this.currentChapter = resolved;
      this.notesChapterCollapsed.delete(normalizeChapterName(resolved));
      this.updateTocActiveState();
      this.syncStatusBarChrome();
    }
  }

  private updateTocActiveState() {
    if (!this.tocEl) return;

    const current = normalizeChapterName(this.currentChapter);
    if (current === this.tocHighlightedChapter) return;
    this.tocHighlightedChapter = current;

    const items = this.tocEl.querySelectorAll<HTMLElement>(".epub-toc-item");
    let activeEl: HTMLElement | null = null;

    for (const li of items) {
      const label = li.dataset.tocLabel ?? "";
      const isCurrent = normalizeChapterName(label) === current;
      li.toggleClass("is-current", isCurrent);
      if (isCurrent) activeEl = li;
    }

    if (activeEl) {
      this.expandTocAncestors(activeEl);
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }

  private expandTocAncestors(item: HTMLElement) {
    let parent = item.parentElement;
    while (parent) {
      if (parent.hasClass("epub-toc-sublist") && parent.hasClass("is-collapsed")) {
        parent.removeClass("is-collapsed");
        const parentLi = parent.parentElement;
        const toggle = parentLi?.querySelector(".epub-toc-toggle");
        if (toggle) toggle.textContent = "▼";
      }
      parent = parent.parentElement;
    }
  }

  private renderTocItems(items: NavItem[], container: HTMLElement, depth: number) {
    for (const item of items) {
      const itemLabel = item.label.trim();
      const li = container.createEl("li", { cls: "epub-toc-item" });
      li.setAttr("data-toc-label", itemLabel);
      li.setCssProps({ paddingLeft: `${depth * 12}px` });

      const label = li.createEl("span", { cls: "epub-toc-label", text: itemLabel });
      label.addEventListener("click", () => {
        this.blockProgressSave = false;
        this.isBookInitializing = false;
        this.currentChapter = itemLabel;
        this.updateTocActiveState();
        this.syncStatusBarChrome();
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

  /** locations 未就绪时 epub.js 会返回 0，勿覆盖已恢复的有效进度。 */
  private shouldApplyLocationProgress(percent: number): boolean {
    if (percent > 0) return true;
    if (this.isBookInitializing || this.blockProgressSave) return false;
    if (this.currentPercent > 0 && !this.locationsReady) return false;
    return true;
  }

  private applyProgressFromLocation(location: any): void {
    const percentage = this.extractPercentFromLocation(location);
    if (!this.shouldApplyLocationProgress(percentage)) return;
    this.updateProgressBar(percentage);
    this.scheduleProgressSave(percentage);
  }

  private async applyProgressFromCurrentLocation(): Promise<void> {
    const loc = await Promise.resolve(this.rendition?.currentLocation?.());
    if (!loc) return;
    this.applyProgressFromLocation(loc);
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
        new Notice(t("notice.progressSaveFailed", { path }));
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
    const root = this.progressEl ?? this.containerEl;
    const fill = root.querySelector("#epub-progress-fill") as HTMLElement | null;
    const text = root.querySelector("#epub-progress-text") as HTMLElement | null;
    const pct = Math.round(this.currentPercent * 100);
    if (fill) fill.setCssProps({ width: `${pct}%` });
    if (text) text.textContent = `${pct}%`;
    this.syncStatusBarChrome();
  }

  private showContextMenu(contents: any) {
    this.dismissContextMenu();

    const menu = document.createElement("div");
    menu.className = "epub-context-menu";
    menu.addEventListener("mousedown", (e) => e.stopPropagation());

    const annotationsOn = this.annotationsEnabled();

    const copyBtn = menu.createEl("button", { cls: "epub-ctx-btn", text: `📋 ${t("reader.contextMenu.copy")}` });
    copyBtn.title = t("reader.contextMenu.copyTitle");
    copyBtn.addEventListener("click", () => {
      this.dismissContextMenu();
      void this.copySelectionAsExcerpt();
    });

    menu.createDiv({ cls: "epub-ctx-divider" });

    const colorRow = menu.createDiv({ cls: "epub-ctx-colors" });
    for (const c of getHighlightColors()) {
      const dot = colorRow.createDiv({ cls: "epub-color-dot" });
      dot.setAttribute("data-color", c.id);
      dot.title = annotationsOn
        ? t("reader.contextMenu.highlightDot", { color: c.label })
        : t("reader.contextMenu.copyDot", { color: c.label });
      dot.addEventListener("click", async () => {
        this.dismissContextMenu();
        if (annotationsOn) {
          await this.addUnderline(c.id);
        } else {
          await this.copySelectionAsExcerpt(c.id);
        }
      });
    }

    if (annotationsOn) {
      menu.createDiv({ cls: "epub-ctx-divider" });

      const noteBtn = menu.createEl("button", { cls: "epub-ctx-btn", text: `📝 ${t("reader.contextMenu.annotate")}` });
      noteBtn.title = t("reader.contextMenu.annotateTitle");
      noteBtn.addEventListener("click", () => {
        this.dismissContextMenu();
        this.openNoteModal();
      });
    }

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
    btn.title = t("reader.contextMenu.viewEditThought", {
      type: noteTypeLabel(annotation.noteType, this.resolvedNoteTypes),
    });
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
    title = t("reader.modal.editAnnotation"),
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
        if (noticeOnSave) new Notice(t("notice.updated"));
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

  private async copyAnnotationAsExcerpt(
    ann: Annotation
  ): Promise<{ copied: boolean; insert?: ExcerptInsertResult }> {
    if (!this.file) return { copied: false };

    const markdown = buildExcerptBlock(
      ann,
      this.file.path,
      this.settings.sourceLinkFormat,
      () => ""
    );

    try {
      await navigator.clipboard.writeText(markdown);
      const insert = this.settings.autoPasteExcerpt !== false
        ? await this.excerptPasteTarget.insertExcerptMarkdown(markdown)
        : undefined;
      return { copied: true, insert };
    } catch (err) {
      console.error("ob-epub: copy excerpt failed", err);
      new Notice(t("notice.copyFailed"));
      return { copied: false };
    }
  }

  private async copySelectionAsExcerpt(color: HighlightColor = "yellow") {
    if (!this.selectedCfi || !this.selectedText) return;

    const ann: Annotation = {
      id: "copy-preview",
      cfiRange: this.selectedCfi,
      text: this.selectedText,
      color,
      chapter: this.currentChapter || unknownChapterLabel(),
      created: new Date().toISOString(),
    };

    const result = await this.copyAnnotationAsExcerpt(ann);
    if (result.copied) {
      noticeExcerptCopy(result.insert);
    }

    this.clearSelection();
  }

  private async addUnderline(color: HighlightColor) {
    if (!this.annotationsEnabled()) return;
    if (!this.file || !this.selectedCfi || !this.selectedText) return;
    const existing = await this.annotationVaultStore.getByCfi(this.file.path, this.selectedCfi);
    let annToCopy: Annotation | null = null;
    if (existing) {
      await this.annotationVaultStore.update(this.file.path, existing.id, { color });
      annToCopy = { ...existing, color };
      await this.refreshHighlightsAfterMutation();
    } else {
      const ann: Annotation = {
        id: `ann-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
        cfiRange: this.selectedCfi,
        text: this.selectedText,
        color,
        chapter: this.currentChapter || unknownChapterLabel(),
        created: new Date().toISOString(),
      };
      await this.annotationVaultStore.add(this.file.path, ann);
      annToCopy = ann;
      await this.refreshHighlightsAfterMutation();
    }
    if (annToCopy) {
      const copyResult = await this.copyAnnotationAsExcerpt(annToCopy);
      if (copyResult.insert?.inserted && copyResult.insert.fileDisplayName) {
        new Notice(
          t("notice.highlightedAndInserted", { name: copyResult.insert.fileDisplayName })
        );
      } else {
        new Notice(t("notice.highlighted"));
      }
    } else {
      new Notice(t("notice.highlighted"));
    }
    this.clearSelection();
    if (this.sidebarMode === "notes") this.renderNotesPanel();
  }

  private openNoteModal() {
    if (!this.annotationsEnabled()) return;
    if (!this.file || !this.selectedCfi || !this.selectedText) return;
    const filePath = this.file.path;
    const cfiRange = this.selectedCfi;
    const text = this.selectedText;
    const chapter = this.currentChapter || unknownChapterLabel();

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
        new Notice(note ? t("notice.annotationSaved") : t("notice.highlighted"));
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

    const copyBtn = menu.createEl("button", { cls: "epub-ctx-btn", text: `📋 ${t("reader.contextMenu.copy")}` });
    copyBtn.title = t("reader.contextMenu.copyTitle");
    copyBtn.addEventListener("click", () => {
      this.dismissContextMenu();
      void this.copyAnnotationAsExcerpt(ann).then((result) => {
        if (result.copied) noticeExcerptCopy(result.insert);
      });
    });

    menu.createDiv({ cls: "epub-ctx-divider" });

    // Recolor row
    const colorRow = menu.createDiv({ cls: "epub-ctx-colors" });
    for (const c of getHighlightColors()) {
      const dot = colorRow.createDiv({ cls: "epub-color-dot" });
      dot.setAttribute("data-color", c.id);
      if (c.id === ann.color) dot.addClass("is-active");
      dot.title = t("reader.contextMenu.changeColor", { color: c.label });
      dot.addEventListener("click", async () => {
        this.dismissContextMenu();
        await this.annotationVaultStore.update(filePath, ann.id, { color: c.id });
        const updated = await this.annotationVaultStore.getById(filePath, ann.id);
        if (updated) {
          this.upsertCachedHighlight(updated);
          this.redrawLine(updated);
          await this.copyAnnotationAsExcerpt(updated);
        }
        if (this.sidebarMode === "notes") this.renderNotesPanel();
      });
    }

    menu.createDiv({ cls: "epub-ctx-divider" });

    const editBtn = menu.createEl("button", {
      cls: "epub-ctx-btn",
      text: ann.note
        ? `📝 ${t("reader.contextMenu.editThought")}`
        : `📝 ${t("reader.contextMenu.addThought")}`,
    });
    editBtn.addEventListener("click", () => {
      this.dismissContextMenu();
      this.openNoteEditor(ann);
    });

    const delBtn = menu.createEl("button", { cls: "epub-ctx-btn is-danger", text: `🗑 ${t("reader.contextMenu.delete")}` });
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
    new Notice(t("notice.annotationDeleted"));
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
      t("reader.modal.deleteAnnotation"),
      t("reader.modal.deleteConfirm", { preview }),
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
      this.notesCountEl.setText(t("reader.notes.countFilteredOf", { filtered, total }));
    } else {
      this.notesCountEl.setText(t("reader.notes.countFiltered", { filtered }));
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
    this.notesCollapseAllBtn.setText(
      allCollapsed ? `▶ ${t("reader.notes.expandAll")}` : `▼ ${t("reader.notes.collapseAll")}`
    );
    this.notesCollapseAllBtn.title = allCollapsed
      ? t("reader.notes.expandAllTitle")
      : t("reader.notes.collapseAllTitle");
  }

  private buildNotesToolbar(parent: HTMLElement) {
    const toolbar = parent.createDiv({ cls: "epub-notes-toolbar" });

    const head = toolbar.createDiv({ cls: "epub-notes-toolbar-head" });
    this.notesCollapseAllBtn = head.createEl("button", {
      cls: "epub-notes-collapse-all",
      text: `▼ ${t("reader.notes.collapseAll")}`,
    });
    this.notesCollapseAllBtn.title = t("reader.notes.collapseAllTitle");
    this.notesCollapseAllBtn.addEventListener("click", () => {
      this.toggleAllNotesChaptersCollapse(this.cachedHighlights);
    });

    const search = toolbar.createEl("input", {
      cls: "epub-notes-search",
      type: "search",
      attr: { placeholder: t("reader.notes.searchPlaceholder") },
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
      text: t("reader.notes.filterAll"),
    });
    allColorBtn.title = t("reader.notes.filterAllTitle");
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
    for (const c of getHighlightColors()) {
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
      text: t("reader.notes.filterAll"),
    });
    if (this.notesTypeFilter === null) allTypeChip.addClass("is-active");
    allTypeChip.addEventListener("click", () => {
      this.notesTypeFilter = null;
      this.syncNotesToolbarState(toolbar);
      this.refreshNotesListView(this.cachedHighlights);
    });

    const highlightChip = typeRow.createEl("button", {
      cls: "epub-note-type-chip",
      text: t("reader.notes.filterHighlightOnly"),
    });
    if (this.notesTypeFilter === "highlight-only") highlightChip.addClass("is-active");
    highlightChip.addEventListener("click", () => {
      this.notesTypeFilter =
        this.notesTypeFilter === "highlight-only" ? null : "highlight-only";
      this.syncNotesToolbarState(toolbar);
      this.refreshNotesListView(this.cachedHighlights);
    });

    for (const typeDef of this.resolvedNoteTypes) {
      const chip = typeRow.createEl("button", {
        cls: "epub-note-type-chip",
        text: `${typeDef.icon} ${typeDef.label}`,
      });
      if (this.notesTypeFilter === typeDef.id) chip.addClass("is-active");
      chip.addEventListener("click", () => {
        this.notesTypeFilter = this.notesTypeFilter === typeDef.id ? null : typeDef.id;
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
    const jumpBtn = actions.createEl("button", { cls: "epub-note-action", text: t("reader.notes.jump") });
    jumpBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.navigateToCfi(ann.cfiRange);
    });
    const editBtn = actions.createEl("button", { cls: "epub-note-action", text: t("reader.notes.edit") });
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openNoteEditor(ann, t("reader.modal.editAnnotation"), false);
    });
    const delBtn = actions.createEl("button", {
      cls: "epub-note-action is-danger",
      text: t("reader.notes.delete"),
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
        text: t("reader.notes.empty"),
      });
      return;
    }

    if (filtered.length === 0) {
      this.notesListEl.createDiv({
        cls: "epub-notes-empty",
        text: t("reader.notes.noMatch"),
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
          text: t("reader.notes.loadFailed"),
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
    const prevToolbarPlacement = this.settings.toolbarPlacement;
    const prevSidePadding = this.settings.readingSidePadding;
    this.settings = settings;
    const annotationsChanged = prevAnnotationsOn !== this.annotationsEnabled();
    const toolbarPlacementChanged = prevToolbarPlacement !== settings.toolbarPlacement;
    const sidePaddingChanged =
      clampReadingSidePadding(prevSidePadding) !==
      clampReadingSidePadding(settings.readingSidePadding);
    if (annotationsChanged && this.toolbarEl) {
      this.buildToolbar(this.toolbarEl);
    } else {
      this.updateThemeToolbarActive();
      this.syncHighlightOpacityToolbar();
      this.syncSidePaddingToolbar();
      this.syncAutoPasteToggle();
    }
    this.applyAnnotationsFeatureState();
    this.fontSize = settings.fontSize;
    if (toolbarPlacementChanged) {
      this.contentEl.toggleClass("is-toolbar-bottom", this.isToolbarBottom());
      this.syncStatusBarChrome();
      requestAnimationFrame(() => {
        this.refreshReadingSidePadding();
        this.resizeRendition();
      });
    } else if (sidePaddingChanged) {
      this.refreshReadingSidePadding();
    }
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

  /** Refresh user-visible labels after plugin locale change (no epub.js reload). */
  refreshLocaleUi(): void {
    this.tocTabEl?.setText(t("reader.sidebar.toc"));
    this.notesTabEl?.setText(t("reader.sidebar.annotations"));
    if (this.toolbarEl) {
      this.buildToolbar(this.toolbarEl);
    }
    if (this.sidebarMode === "notes" && this.notesEl) {
      void this.renderNotesPanel();
    }
  }
}
