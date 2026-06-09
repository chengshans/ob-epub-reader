import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import { EPUB_READER_VIEW_TYPE, EpubReaderView } from "./EpubReaderView";
import { AnnotationVaultStore } from "./AnnotationVaultStore";
import { ProgressStore } from "./ProgressStore";
import { AIService } from "./AIService";
import { BookshelfModal } from "./BookshelfModal";
import { EpubSettingsTab } from "./SettingsTab";
import { DEFAULT_SETTINGS, EpubPluginSettings } from "./types";
import { decodeProtocolParam, registerExcerptGotoHandler } from "./ExcerptGotoHandler";

export default class ObEpubPlugin extends Plugin {
  settings: EpubPluginSettings = { ...DEFAULT_SETTINGS };
  progressStore!: ProgressStore;
  annotationVaultStore!: AnnotationVaultStore;
  aiService!: AIService;
  private pendingCfiForNextOpen: { filePath: string; cfi: string } | null = null;
  private lastGotoKey = "";
  private lastGotoAt = 0;

  async onload() {
    await this.loadSettings();

    this.progressStore = new ProgressStore(this.app, this.settings);
    await this.progressStore.load();

    this.annotationVaultStore = new AnnotationVaultStore(this.app, this.settings);
    this.aiService = new AIService(this.settings);

    // Migrate old annotations from plugin data.json (one-time)
    await this.migrateOldAnnotations();
    await this.migrateProgressFromDataJson();
    // Fix legacy [回到原文](<obsidian://…>) links (once)
    await this.fixLegacyGotoLinksOnce();

    // Click「回到原文」/ callout → jump EPUB (works in split view)
    registerExcerptGotoHandler(this, (file, cfi) => this.openEpubAtCfi(file, cfi));

    // Register the reader view
    this.registerView(EPUB_READER_VIEW_TYPE, (leaf) => {
      return new EpubReaderView(
        leaf,
        this,
        this.annotationVaultStore,
        this.progressStore,
        this.aiService,
        this.settings
      );
    });

    // Register .epub file extension → open with this view
    this.registerExtensions(["epub"], EPUB_READER_VIEW_TYPE);

    // Settings tab
    this.addSettingTab(new EpubSettingsTab(this.app, this));

    // Command: open bookshelf
    this.addCommand({
      id: "open-bookshelf",
      name: "打开 EPUB 书架",
      callback: () => {
        new BookshelfModal(this.app, this.progressStore, (file) => {
          this.openEpubFile(file);
        }).open();
      },
    });

    // Command: open current epub
    this.addCommand({
      id: "open-epub-reader",
      name: "在 EPUB 阅读器中打开",
      callback: () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile?.extension === "epub") {
          this.openEpubFile(activeFile);
        } else {
          new Notice("请先选中一个 .epub 文件");
        }
      },
    });

    // Handle bookshelf open events from the view
    this.registerDomEvent(document, "epub-open-bookshelf" as any, () => {
      new BookshelfModal(this.app, this.progressStore, (file) => {
        this.openEpubFile(file);
      }).open();
    });

    // Deep-link: obsidian://ob-epub-goto?file=...&cfi=...
    // NOTE: Cannot register "open" — Obsidian core already owns that action.
    this.registerObsidianProtocolHandler("ob-epub-goto", async (params) => {
      let filePath = params.file;
      let cfi = params.cfi ?? "";
      if (!filePath || typeof filePath !== "string") return;

      // Recover from residual double-encoding in older links
      filePath = decodeProtocolParam(filePath);
      if (typeof cfi === "string") cfi = decodeProtocolParam(cfi);

      await this.openEpubAtCfi(filePath, typeof cfi === "string" ? cfi : "");
    });

    console.log("ob-epub-reader loaded");
  }

  /** 一次性迁移：将 data.json 中的 progress 移到 vault JSON 文件 */
  private async migrateProgressFromDataJson() {
    try {
      const data = await this.loadData();
      if (!data?.progress || Object.keys(data.progress).length === 0) return;
      await this.progressStore.migrateFrom(data.progress);
      delete data.progress;
      await this.saveData(data);
      console.log("ob-epub: progress migration to vault complete");
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

  /** One-time migration: move old data.json annotations into vault markdown files. */
  private async migrateOldAnnotations() {
    try {
      const data = await this.loadData();
      if (!data?.annotations || Object.keys(data.annotations).length === 0) return;

      await this.annotationVaultStore.migrateFromPluginData(data.annotations);

      // Clear old annotations from data.json after successful migration
      data.annotations = {};
      await this.saveData(data);
      console.log("ob-epub: annotation migration complete");
    } catch (err) {
      console.error("ob-epub: annotation migration failed", err);
    }
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
      new Notice(`找不到 EPUB 文件: ${filePath}`);
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? {});
  }

  async saveSettings() {
    const existing = (await this.loadData()) ?? {};
    existing.settings = this.settings;
    await this.saveData(existing);

    // Propagate settings changes to services
    await this.progressStore?.updateSettings(this.settings);
    this.annotationVaultStore?.updateSettings(this.settings);
    this.aiService?.updateSettings(this.settings);

    // Update open views
    this.app.workspace.getLeavesOfType(EPUB_READER_VIEW_TYPE).forEach((leaf) => {
      (leaf.view as EpubReaderView).updateSettings(this.settings);
    });
  }

  onunload() {
    console.log("ob-epub-reader unloaded");
  }
}
