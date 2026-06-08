import { Notice, Plugin, TFile } from "obsidian";
import { EPUB_READER_VIEW_TYPE, EpubReaderView } from "./EpubReaderView";
import { ExcerptManager } from "./ExcerptManager";
import { ProgressStore } from "./ProgressStore";
import { AIService } from "./AIService";
import { BookshelfModal } from "./BookshelfModal";
import { EpubSettingsTab } from "./SettingsTab";
import { DEFAULT_SETTINGS, EpubPluginSettings } from "./types";

export default class ObEpubPlugin extends Plugin {
  settings: EpubPluginSettings = { ...DEFAULT_SETTINGS };
  progressStore!: ProgressStore;
  excerptManager!: ExcerptManager;
  aiService!: AIService;

  async onload() {
    await this.loadSettings();

    this.progressStore = new ProgressStore(this);
    await this.progressStore.load();

    this.excerptManager = new ExcerptManager(this.app, this.settings);
    this.aiService = new AIService(this.settings);

    // Register the reader view
    this.registerView(EPUB_READER_VIEW_TYPE, (leaf) => {
      return new EpubReaderView(
        leaf,
        this.excerptManager,
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

    console.log("ob-epub-reader loaded");
  }

  async openEpubFile(file: TFile) {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    this.app.workspace.revealLeaf(leaf);
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
