import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
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

    // Handle file open: if .epub is activated, load it in the view
    this.registerEvent(
      this.app.workspace.on("file-open", async (file) => {
        if (file?.extension === "epub") {
          await this.openEpubFile(file);
        }
      })
    );

    console.log("ob-epub-reader loaded");
  }

  async openEpubFile(file: TFile) {
    let leaf: WorkspaceLeaf | null = null;

    // Reuse existing epub reader leaf if open
    const existing = this.app.workspace.getLeavesOfType(EPUB_READER_VIEW_TYPE);
    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      leaf = this.app.workspace.getLeaf(true);
    }

    await leaf.setViewState({
      type: EPUB_READER_VIEW_TYPE,
      active: true,
    });

    this.app.workspace.revealLeaf(leaf);

    const view = leaf.view as EpubReaderView;
    await view.loadFile(file);
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
