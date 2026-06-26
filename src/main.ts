import { Notice, Plugin, TFile, addIcon, normalizePath } from "obsidian";
import { initializeI18n, applyPluginLocale, t } from "./i18n/i18n";
import { BOOKSHELF_ICON_ID, BOOKSHELF_ICON_SVG } from "./icons/bookshelfIcon";
import { EPUB_READER_VIEW_TYPE, EpubReaderView } from "./EpubReaderView";
import { AnnotationVaultStore } from "./AnnotationVaultStore";
import { ProgressStore } from "./ProgressStore";
import { BOOKSHELF_VIEW_TYPE, BookshelfView } from "./BookshelfView";
import { EpubSettingsTab } from "./SettingsTab";
import { getDefaultSettings, EpubPluginSettings, FeatureGroupSettings, BookProgress, clampHighlightOpacity, clampReadingSidePadding, normalizeFeatureGroups, normalizeHighlightColor, normalizeReadingTheme, normalizeSourceLinkFormat, normalizeToolbarPlacement, normalizeUiLocale, resolveNoteTypes, isAnnotationsAndExcerptsEnabled, isBookshelfEnabled } from "./types";
import { applyEpubjsCfiPatch } from "./cfi/epubjsPatch";
import { decodeProtocolParam, registerExcerptGotoHandler } from "./ExcerptGotoHandler";
import { registerExcerptPasteTarget, ExcerptPasteTarget } from "./ExcerptPasteTarget";
import { patchEpubWikiLinkNavigation } from "./epubLinkNavigation";
import type { PlainTextAnnMeta } from "./plainTextCfiStore";

applyEpubjsCfiPatch();

export default class ObEpubPlugin extends Plugin {
  settings!: EpubPluginSettings;
  progressStore!: ProgressStore;
  annotationVaultStore!: AnnotationVaultStore;
  excerptPasteTarget!: ExcerptPasteTarget;
  private pendingCfiForNextOpen: { filePath: string; cfi: string } | null = null;
  private lastGotoKey = "";
  private lastGotoAt = 0;
  private unpatchEpubWikiLinks: (() => void) | null = null;
  private bookshelfRibbonEl: HTMLElement | null = null;
  private settingsTab!: EpubSettingsTab;
  private readonly pluginCommandIds = ["open-bookshelf", "open-epub-reader"] as const;
  private statusBarEl: HTMLElement | null = null;
  private statusBarToolbarSlot: HTMLElement | null = null;
  private statusBarProgressSlot: HTMLElement | null = null;
  private statusBarChromeOwner: {
    toolbar: HTMLElement;
    progress: HTMLElement | null;
    container: HTMLElement;
  } | null = null;

  async onload() {
    const data = await this.loadData();
    const uiLocale = normalizeUiLocale(
      (data?.settings as EpubPluginSettings | undefined)?.uiLocale
    );
    await initializeI18n(uiLocale);
    await this.loadSettings();

    this.annotationVaultStore = new AnnotationVaultStore(this.app, this.settings, {
      plainTextCfi: {
        load: async (epubPath) => {
          const data = (await this.loadData()) ?? {};
          const map = data.plainTextCfis as Record<string, PlainTextAnnMeta[]> | undefined;
          return map?.[epubPath] ?? [];
        },
        save: async (epubPath, meta) => {
          const data = (await this.loadData()) ?? {};
          const map =
            (data.plainTextCfis as Record<string, PlainTextAnnMeta[]> | undefined) ?? {};
          map[epubPath] = meta;
          data.plainTextCfis = map;
          await this.saveData(data);
        },
      },
    });
    this.progressStore = new ProgressStore(this.app, this.settings, this.annotationVaultStore, {
      loadPluginProgress: async () => {
        const data = (await this.loadData()) ?? {};
        const raw = data.progress as Record<string, BookProgress> | undefined;
        if (!raw || typeof raw !== "object") return {};
        return { ...raw };
      },
      savePluginProgress: async (progress) => {
        const data = (await this.loadData()) ?? {};
        data.progress = progress;
        await this.saveData(data);
      },
    });
    await this.progressStore.load();

    // Migrate old annotations from plugin data.json (one-time)
    await this.migrateOldAnnotations();
    await this.migrateProgressFromDataJson();
    // Fix legacy [回到原文](<obsidian://…>) links (once)
    await this.fixLegacyGotoLinksOnce();
    // Convert remaining obsidian:// excerpt links to hash links (once, prevents click crash)
    await this.migrateHashGotoLinksOnce();
    // Strip legacy text/chapter/color from wiki goto links (once)
    await this.migrateVerboseWikiLinksOnce();
    // Move goto links into callout titles (once)
    await this.migrateTitleGotoLinksOnce();

    // Click excerpt title / legacy「回到原文」/ callout → jump EPUB (works in split view)
    registerExcerptGotoHandler(
      this,
      (file, cfi) => this.openEpubAtCfi(file, cfi),
      (annId, excerptPath) => this.annotationVaultStore.resolveGotoFromExcerpt(excerptPath, annId),
      () => this.settings.excerptFilename
    );

    this.unpatchEpubWikiLinks = patchEpubWikiLinkNavigation(this.app, (file, cfi) =>
      this.openEpubAtCfi(file, cfi)
    );

    this.excerptPasteTarget = registerExcerptPasteTarget(this);

    // Register the reader view
    this.registerView(EPUB_READER_VIEW_TYPE, (leaf) => {
      return new EpubReaderView(
        leaf,
        this,
        this.annotationVaultStore,
        this.progressStore,
        this.excerptPasteTarget,
        this.settings,
        async (themeId) => {
          this.settings.readingTheme = themeId;
          await this.saveSettings({ skipViewUpdate: true });
        },
        async (opacity) => {
          this.settings.epubHighlightOpacity = clampHighlightOpacity(opacity);
          await this.saveSettings();
        },
        async (padding) => {
          this.settings.readingSidePadding = clampReadingSidePadding(padding);
          await this.saveSettings({ skipViewUpdate: true });
        },
        async (fontSize) => {
          this.settings.fontSize = Math.min(32, Math.max(10, Math.round(fontSize)));
          await this.saveSettings({ skipViewUpdate: true });
          if (this.app.setting.activeTab === this.settingsTab) {
            this.settingsTab.display();
          }
        },
        async (enabled) => {
          this.settings.autoPasteExcerpt = enabled;
          await this.saveSettings({ skipViewUpdate: true });
        }
      );
    });

    this.initEpubStatusBar();

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const activeView = this.app.workspace.getActiveViewOfType(EpubReaderView);
        for (const leaf of this.app.workspace.getLeavesOfType(EPUB_READER_VIEW_TYPE)) {
          const view = leaf.view as EpubReaderView;
          if (view !== activeView) view.syncStatusBarChrome();
        }
        activeView?.syncStatusBarChrome();
        if (!activeView) {
          this.forceDetachStatusBarChrome();
        }
      })
    );

    addIcon(BOOKSHELF_ICON_ID, BOOKSHELF_ICON_SVG);

    // Bookshelf sidebar view
    this.registerView(BOOKSHELF_VIEW_TYPE, (leaf) => {
      return new BookshelfView(leaf, this.progressStore, (file) => {
        void this.openEpubFile(file);
      });
    });

    this.bookshelfRibbonEl = this.registerPluginRibbon();

    // Register .epub file extension → open with this view
    this.registerExtensions(["epub"], EPUB_READER_VIEW_TYPE);

    // Settings tab
    this.settingsTab = new EpubSettingsTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    this.registerPluginCommands();

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && file.extension === "epub") {
          this.refreshBookshelfViews();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "epub") {
          this.refreshBookshelfViews();
        }
      })
    );

    // Deep-link: obsidian://ob-epub-goto?file=...&cfi=...
    // NOTE: Cannot register "open" — Obsidian core already owns that action.
    this.registerObsidianProtocolHandler("ob-epub-goto", async (params) => {
      try {
        let filePath = params.file;
        let cfi = params.cfi ?? "";
        if (!filePath || typeof filePath !== "string") return;

        filePath = decodeProtocolParam(filePath);
        if (typeof cfi === "string") cfi = decodeProtocolParam(cfi);

        await this.openEpubAtCfi(filePath, typeof cfi === "string" ? cfi : "");
      } catch (err) {
        console.error("ob-epub: protocol goto failed", err);
        new Notice(t("notice.gotoEpubFailed"));
      }
    });

    this.applyExcerptCalloutOpacity(this.settings.excerptCalloutOpacity);
    this.applyFeatureGroups();
  }

  private registerPluginRibbon(): HTMLElement {
    const el = this.addRibbonIcon(BOOKSHELF_ICON_ID, t("ribbon.bookshelf"), () => {
      void this.openBookshelf();
    });
    return el;
  }

  private registerPluginCommands(): void {
    for (const id of this.pluginCommandIds) {
      this.app.commands.removeCommand(`${this.manifest.id}:${id}`);
    }

    this.addCommand({
      id: "open-bookshelf",
      name: t("commands.openBookshelf"),
      callback: () => {
        void this.openBookshelf();
      },
    });

    this.addCommand({
      id: "open-epub-reader",
      name: t("commands.openReader"),
      callback: () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile?.extension === "epub") {
          this.openEpubFile(activeFile);
        } else {
          new Notice(t("notice.selectEpubFirst"));
        }
      },
    });
  }

  async applyUiLocale(): Promise<void> {
    await applyPluginLocale(this.settings.uiLocale);
    this.registerPluginCommands();
    if (this.bookshelfRibbonEl) {
      this.bookshelfRibbonEl.setAttr("aria-label", t("ribbon.bookshelf"));
    }
    this.refreshBookshelfViews();
    for (const leaf of this.app.workspace.getLeavesOfType(EPUB_READER_VIEW_TYPE)) {
      (leaf.view as EpubReaderView).refreshLocaleUi();
    }
    if (this.app.setting.activeTab === this.settingsTab) {
      this.settingsTab.display();
    }
  }

  private applyExcerptCalloutOpacity(opacity: number): void {
    document.documentElement.style.setProperty(
      "--ob-epub-excerpt-callout-opacity",
      String(clampHighlightOpacity(opacity))
    );
  }

  /** 一次性迁移：将 data.json 中的 progress 移到 vault JSON 文件 */
  private async migrateProgressFromDataJson() {
    if (!isAnnotationsAndExcerptsEnabled(this.settings)) return;
    try {
      const data = await this.loadData();
      if (!data?.progress || Object.keys(data.progress).length === 0) return;
      await this.progressStore.migrateFrom(data.progress);
      delete data.progress;
      await this.saveData(data);
    } catch (err) {
      console.error("ob-epub: progress migration failed", err);
    }
  }

  /** One-time fix for broken「回到原文」links in excerpt files. */
  private async fixLegacyGotoLinksOnce() {
    try {
      const data = (await this.loadData()) ?? {};
      if (data.legacyGotoLinksFixed) return;
      await this.annotationVaultStore.fixLegacyGotoLinksInVault();
      data.legacyGotoLinksFixed = true;
      await this.saveData(data);
    } catch (err) {
      console.error("ob-epub: legacy goto link fix failed", err);
    }
  }

  /** One-time: rewrite excerpt goto links to #^ann-id block refs. */
  private async migrateHashGotoLinksOnce() {
    try {
      const data = (await this.loadData()) ?? {};
      if (data.blockRefGotoLinksMigrated) return;
      await this.annotationVaultStore.migrateRemainingObsidianGotoLinks();
      data.blockRefGotoLinksMigrated = true;
      data.hashGotoLinksMigrated = true;
      await this.saveData(data);
    } catch (err) {
      console.error("ob-epub: block-ref goto link migration failed", err);
    }
  }

  /** One-time: strip text/chapter/color params from verbose wiki goto links. */
  private async migrateVerboseWikiLinksOnce() {
    try {
      const data = (await this.loadData()) ?? {};
      if (data.wikiLinkParamsSlimmed) return;
      await this.annotationVaultStore.slimVerboseWikiLinksInVault();
      data.wikiLinkParamsSlimmed = true;
      await this.saveData(data);
    } catch (err) {
      console.error("ob-epub: wiki link slim migration failed", err);
    }
  }

  /** One-time: rewrite excerpt goto links into callout title links. */
  private async migrateTitleGotoLinksOnce() {
    try {
      const data = (await this.loadData()) ?? {};
      if (data.titleGotoLinksMigrated) return;
      await this.annotationVaultStore.convertAllExcerptSourceLinks();
      data.titleGotoLinksMigrated = true;
      await this.saveData(data);
    } catch (err) {
      console.error("ob-epub: title goto link migration failed", err);
    }
  }

  /** One-time migration: move old data.json annotations into vault markdown files. */
  private async migrateOldAnnotations() {
    if (!isAnnotationsAndExcerptsEnabled(this.settings)) return;
    try {
      const data = await this.loadData();
      if (!data?.annotations || Object.keys(data.annotations).length === 0) return;

      await this.annotationVaultStore.migrateFromPluginData(data.annotations);

      // Clear old annotations from data.json after successful migration
      data.annotations = {};
      await this.saveData(data);
    } catch (err) {
      console.error("ob-epub: annotation migration failed", err);
    }
  }

  async openBookshelf(): Promise<void> {
    if (!isBookshelfEnabled(this.settings)) {
      new Notice(t("notice.bookshelfDisabled"));
      return;
    }
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(BOOKSHELF_VIEW_TYPE)[0];

    if (!leaf) {
      const leftLeaf = workspace.getLeftLeaf(false);
      if (!leftLeaf) {
        new Notice(t("notice.bookshelfOpenFailed"));
        return;
      }
      await leftLeaf.setViewState({ type: BOOKSHELF_VIEW_TYPE, active: true });
      leaf = leftLeaf;
    }

    await workspace.revealLeaf(leaf);
    (leaf.view as BookshelfView).refresh();
  }

  private refreshBookshelfViews(): void {
    if (!isBookshelfEnabled(this.settings)) return;
    if (!this.app?.workspace) return;
    this.app.workspace.getLeavesOfType(BOOKSHELF_VIEW_TYPE).forEach((leaf) => {
      try {
        (leaf.view as BookshelfView).refresh();
      } catch (err) {
        console.error("ob-epub: bookshelf refresh failed", err);
      }
    });
  }

  /** Consumed by EpubReaderView.onLoadFile to honour a pending deep-link jump. */
  consumePendingCfi(filePath: string): string {
    if (this.pendingCfiForNextOpen?.filePath === filePath) {
      const cfi = this.pendingCfiForNextOpen.cfi;
      this.pendingCfiForNextOpen = null;
      return cfi;
    }
    return "";
  }

  private initEpubStatusBar(): void {
    const el = this.addStatusBarItem();
    el.addClass("ob-epub-status-wrap");
    this.statusBarToolbarSlot = el.createDiv({ cls: "ob-epub-status-toolbar" });
    this.statusBarProgressSlot = el.createDiv({ cls: "ob-epub-status-progress" });
    this.statusBarEl = el;
    this.pinStatusBarItemToLeft();
    el.hide();
  }

  /** addStatusBarItem 默认追加在右侧，手动移到状态栏最左 */
  private pinStatusBarItemToLeft(): void {
    const el = this.statusBarEl;
    if (!el) return;

    const statusBar =
      el.closest(".status-bar") ?? document.querySelector(".status-bar");
    if (!statusBar) return;

    const leftRegion = statusBar.querySelector(
      ".status-bar-left, .left-region"
    );
    if (leftRegion instanceof HTMLElement && leftRegion !== el.parentElement) {
      leftRegion.appendChild(el);
      return;
    }

    if (statusBar.firstElementChild !== el) {
      statusBar.prepend(el);
    }
  }

  isStatusBarChromeAttached(): boolean {
    return this.statusBarChromeOwner !== null;
  }

  attachStatusBarChrome(
    toolbar: HTMLElement,
    progress: HTMLElement | null,
    container: HTMLElement
  ): void {
    if (
      this.statusBarChromeOwner &&
      this.statusBarChromeOwner.toolbar !== toolbar
    ) {
      this.detachStatusBarChrome(
        this.statusBarChromeOwner.toolbar,
        this.statusBarChromeOwner.progress,
        this.statusBarChromeOwner.container
      );
    }
    if (!this.statusBarToolbarSlot || !this.statusBarEl) return;

    toolbar.addClass("is-in-statusbar");
    this.statusBarToolbarSlot.appendChild(toolbar);

    if (progress && this.statusBarProgressSlot) {
      progress.addClass("is-in-statusbar");
      this.statusBarProgressSlot.appendChild(progress);
    }

    this.statusBarChromeOwner = { toolbar, progress, container };
    this.pinStatusBarItemToLeft();
    this.statusBarEl.show();
  }

  detachStatusBarChrome(
    toolbar: HTMLElement,
    progress: HTMLElement | null,
    container: HTMLElement
  ): void {
    if (!this.statusBarChromeOwner || this.statusBarChromeOwner.toolbar !== toolbar) {
      return;
    }

    toolbar.removeClass("is-in-statusbar");
    if (container.firstChild) {
      container.insertBefore(toolbar, container.firstChild);
    } else {
      container.appendChild(toolbar);
    }

    if (progress) {
      progress.removeClass("is-in-statusbar");
      container.appendChild(progress);
    }

    this.statusBarChromeOwner = null;
    this.statusBarEl?.hide();
  }

  forceDetachStatusBarChrome(): void {
    if (!this.statusBarChromeOwner) return;
    const { toolbar, progress, container } = this.statusBarChromeOwner;
    this.detachStatusBarChrome(toolbar, progress, container);
  }

  async openEpubFile(file: TFile) {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    this.app.workspace.revealLeaf(leaf);
  }

  async openEpubAtCfi(filePath: string, cfi: string): Promise<void> {
    const gotoKey = `${filePath}\0${cfi}`;
    const now = Date.now();
    if (gotoKey === this.lastGotoKey && now - this.lastGotoAt < 1000) return;
    this.lastGotoKey = gotoKey;
    this.lastGotoAt = now;

    const normalized = normalizePath(filePath);
    const file =
      this.app.vault.getFileByPath(normalized) ??
      this.app.vault.getAbstractFileByPath(normalized);

    if (!(file instanceof TFile) || file.extension !== "epub") {
      new Notice(t("notice.epubNotFound", { path: filePath }));
      return;
    }

    const existingLeaf = this.app.workspace
      .getLeavesOfType(EPUB_READER_VIEW_TYPE)
      .find((leaf) => (leaf.view as EpubReaderView).file?.path === file.path);

    if (existingLeaf) {
      if (cfi) {
        await (existingLeaf.view as EpubReaderView).navigateToCfi(cfi);
      }
      await this.app.workspace.revealLeaf(existingLeaf);
      return;
    }

    if (cfi) {
      this.pendingCfiForNextOpen = { filePath: file.path, cfi };
    }

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    await this.app.workspace.revealLeaf(leaf);

    if (leaf.view.getViewType() === EPUB_READER_VIEW_TYPE && cfi) {
      await (leaf.view as EpubReaderView).navigateToCfi(cfi);
    }
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, getDefaultSettings(), data?.settings ?? {});
    this.settings.featureGroups = normalizeFeatureGroups(this.settings.featureGroups);
    this.settings.readingTheme = normalizeReadingTheme(this.settings.readingTheme);
    this.settings.noteTypes = resolveNoteTypes(this.settings.noteTypes);
    this.settings.sourceLinkFormat = normalizeSourceLinkFormat(this.settings.sourceLinkFormat);
    this.settings.defaultExcerptHighlightColor = normalizeHighlightColor(
      this.settings.defaultExcerptHighlightColor
    );
    this.settings.epubHighlightOpacity = clampHighlightOpacity(this.settings.epubHighlightOpacity);
    this.settings.excerptCalloutOpacity = clampHighlightOpacity(this.settings.excerptCalloutOpacity);
    this.settings.readingSidePadding = clampReadingSidePadding(this.settings.readingSidePadding);
    this.settings.autoPasteExcerpt = this.settings.autoPasteExcerpt !== false;
    const legacyImmersive = (data?.settings as { immersiveReadingDefault?: boolean } | undefined)
      ?.immersiveReadingDefault;
    this.settings.toolbarPlacement = normalizeToolbarPlacement(
      (data?.settings as { toolbarPlacement?: unknown } | undefined)?.toolbarPlacement ??
        this.settings.toolbarPlacement,
      legacyImmersive
    );
    this.settings.uiLocale = normalizeUiLocale(
      (data?.settings as { uiLocale?: unknown } | undefined)?.uiLocale ??
        this.settings.uiLocale
    );
    this.applyExcerptCalloutOpacity(this.settings.excerptCalloutOpacity);
  }

  async saveSettings(options?: { skipViewUpdate?: boolean }) {
    const existing = (await this.loadData()) ?? {};
    const prevGroups = normalizeFeatureGroups(
      (existing.settings as EpubPluginSettings | undefined)?.featureGroups
    );
    this.settings.featureGroups = normalizeFeatureGroups(this.settings.featureGroups);
    this.settings.epubHighlightOpacity = clampHighlightOpacity(this.settings.epubHighlightOpacity);
    this.settings.excerptCalloutOpacity = clampHighlightOpacity(this.settings.excerptCalloutOpacity);
    this.settings.readingSidePadding = clampReadingSidePadding(this.settings.readingSidePadding);
    this.settings.autoPasteExcerpt = this.settings.autoPasteExcerpt !== false;
    existing.settings = this.settings;
    await this.saveData(existing);

    // Propagate settings changes to services
    await this.progressStore?.updateSettings(this.settings);
    this.annotationVaultStore?.updateSettings(this.settings);

    this.applyExcerptCalloutOpacity(this.settings.excerptCalloutOpacity);

    await this.applyFeatureGroups(prevGroups);

    if (!options?.skipViewUpdate) {
      this.app.workspace.getLeavesOfType(EPUB_READER_VIEW_TYPE).forEach((leaf) => {
        (leaf.view as EpubReaderView).updateSettings(this.settings);
      });
    }
  }

  private async applyFeatureGroups(prev?: FeatureGroupSettings): Promise<void> {
    const bookshelfOn = isBookshelfEnabled(this.settings);
    this.bookshelfRibbonEl?.toggleVisibility(bookshelfOn);
    if (!bookshelfOn) {
      try {
        this.app.workspace.detachLeavesOfType(BOOKSHELF_VIEW_TYPE);
      } catch (err) {
        console.error("ob-epub: detach bookshelf leaves failed", err);
      }
    }

    const annotationsOn = isAnnotationsAndExcerptsEnabled(this.settings);
    const wasAnnotationsOn = prev ? prev.annotationsAndExcerpts : annotationsOn;
    if (annotationsOn && !wasAnnotationsOn) {
      try {
        await this.progressStore.syncProgressToExcerpts();
      } catch (err) {
        console.error("ob-epub: sync progress to excerpts failed", err);
      }
    }
  }

  onunload() {
    this.unpatchEpubWikiLinks?.();
    this.unpatchEpubWikiLinks = null;
    document.documentElement.style.removeProperty("--ob-epub-excerpt-callout-opacity");
    try {
      this.app.workspace.detachLeavesOfType(BOOKSHELF_VIEW_TYPE);
      this.app.workspace.detachLeavesOfType(EPUB_READER_VIEW_TYPE);
    } catch (err) {
      console.error("ob-epub: detach views failed", err);
    }
  }
}
