import { App, ButtonComponent, Modal, Setting, TFile } from "obsidian";
import { t } from "./i18n/i18n";
import {
  collectExcerptExportRows,
  ExcerptExportFilters,
  ExcerptExportFormat,
  formatExcerptExport,
} from "./excerptExport";
import { AnnotationVaultStore } from "./AnnotationVaultStore";
import { EpubPluginSettings } from "./types";

export class ExcerptExportModal extends Modal {
  private settings: EpubPluginSettings;
  private store: AnnotationVaultStore;
  private epubFiles: TFile[];

  constructor(
    app: App,
    settings: EpubPluginSettings,
    store: AnnotationVaultStore,
    epubFiles: TFile[]
  ) {
    super(app);
    this.settings = settings;
    this.store = store;
    this.epubFiles = epubFiles;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("epub-excerpt-export-modal");

    contentEl.createEl("h3", { text: t("modal.excerptExport.title") });

    const filters: ExcerptExportFilters = {
      format: "csv",
    };

    new Setting(contentEl)
      .setName(t("modal.excerptExport.epubFilter"))
      .addDropdown((drop) => {
        drop.addOption("", t("modal.excerptExport.allBooks"));
        for (const file of this.epubFiles) {
          drop.addOption(file.path, file.basename);
        }
        drop.setValue("").onChange((value) => {
          filters.epubPath = value || undefined;
        });
      });

    new Setting(contentEl)
      .setName(t("modal.excerptExport.since"))
      .addText((text) =>
        text.setPlaceholder("YYYY-MM-DD").onChange((value) => {
          filters.since = value.trim() || undefined;
        })
      );

    new Setting(contentEl)
      .setName(t("modal.excerptExport.until"))
      .addText((text) =>
        text.setPlaceholder("YYYY-MM-DD").onChange((value) => {
          filters.until = value.trim() || undefined;
        })
      );

    new Setting(contentEl)
      .setName(t("modal.excerptExport.format"))
      .addDropdown((drop) => {
        drop
          .addOption("csv", t("modal.excerptExport.formatCsv"))
          .addOption("markdown", t("modal.excerptExport.formatMarkdown"))
          .addOption("plain", t("modal.excerptExport.formatPlain"))
          .setValue("csv")
          .onChange((value) => {
            filters.format = value as ExcerptExportFormat;
          });
      });

    new Setting(contentEl).addButton((btn: ButtonComponent) => {
      btn.setCta().setButtonText(t("modal.excerptExport.export")).onClick(async () => {
        btn.setDisabled(true);
        try {
          const rows = await collectExcerptExportRows(
            this.app,
            this.store,
            this.settings,
            filters
          );
          const body = formatExcerptExport(rows, filters.format);
          const ext =
            filters.format === "csv" ? "csv" : filters.format === "plain" ? "txt" : "md";
          const folder = this.settings.excerptFolder.replace(/\/$/, "") || "epub-books/anno";
          const name = `excerpt-export-${Date.now()}.${ext}`;
          const path = `${folder}/${name}`;
          await this.app.vault.create(path, body);
          new Notice(t("notice.exportDone"));
          this.close();
        } finally {
          btn.setDisabled(false);
        }
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
