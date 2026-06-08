import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import { EPUB_READER_VIEW_TYPE, EpubReaderView } from "./EpubReaderView";
import { ExcerptManager } from "./ExcerptManager";
import { ProgressStore } from "./ProgressStore";
import { AnnotationStore } from "./AnnotationStore";
import { AIService } from "./AIService";
import { BookshelfModal } from "./BookshelfModal";
import { EpubSettingsTab } from "./SettingsTab";
import { DEFAULT_SETTINGS, EpubPluginSettings } from "./types";

export default class ObEpubPlugin extends Plugin {
  settings: EpubPluginSettings = { ...DEFAULT_SETTINGS };
  progressStore!: ProgressStore;
  annotationStore!: AnnotationStore;
  excerptManager!: ExcerptManager;
  aiService!: AIService;
  private pendingCfiForNextOpen: { filePath: string; cfi: string } | null = null;

  async onload() {
    await this.loadSettings();

    this.progressStore = new ProgressStore(this);
    await this.progressStore.load();

    this.annotationStore = new AnnotationStore(this);
    await this.annotationStore.load();

    this.excerptManager = new ExcerptManager(this.app, this.settings);
    this.aiService = new AIService(this.settings);

    // Register the reader view
    this.registerView(EPUB_READER_VIEW_TYPE, (leaf) => {
      return new EpubReaderView(
        leaf,
        this,
        this.excerptManager,
        this.progressStore,
        this.annotationStore,
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
      const filePath = params.file;
      const cfi = params.cfi ?? "";
      if (!filePath || typeof filePath !== "string") return;
      await this.openEpubAtCfi(filePath, typeof cfi === "string" ? cfi : "");
    });

    console.log("ob-epub-reader loaded");
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

  async openEpubAtCfi(filePath: string, cfi: string) {
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
      await this.app.workspace.revealLeaf(existingLeaf);
      if (cfi) {
        await (existingLeaf.view as EpubReaderView).navigateToCfi(cfi);
      }
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
    this.excerptManager?.updateSettings(this.settings);
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
