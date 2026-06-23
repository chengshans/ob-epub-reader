import { App, Modal, Setting } from "obsidian";
import { t } from "./i18n/i18n";
import {
  ExcerptCheckIssue,
  ExcerptMetadataCheckReport,
} from "./excerptFolder";

function issueLabel(issue: ExcerptCheckIssue): string {
  return t(`excerptCheck.issues.${issue}`);
}

export class ExcerptCheckModal extends Modal {
  private report: ExcerptMetadataCheckReport;

  constructor(app: App, report: ExcerptMetadataCheckReport) {
    super(app);
    this.report = report;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ob-epub-excerpt-check-modal");

    contentEl.createEl("h3", { text: t("modal.excerptCheck.title") });

    const summary = contentEl.createDiv({ cls: "ob-epub-excerpt-check-summary" });
    if (this.report.withIssues === 0) {
      summary.createEl("p", {
        text: t("modal.excerptCheck.summaryOk", { count: this.report.checked }),
      });
    } else {
      summary.createEl("p", {
        text: t("modal.excerptCheck.summaryIssues", {
          count: this.report.checked,
          issues: this.report.withIssues,
        }),
      });
    }

    if (this.report.items.length > 0) {
      const list = contentEl.createDiv({ cls: "ob-epub-excerpt-check-list" });
      for (const item of this.report.items) {
        const block = list.createDiv({ cls: "ob-epub-excerpt-check-item" });
        block.createEl("div", {
          cls: "ob-epub-excerpt-check-path",
          text: item.excerptPath,
        });
        if (item.epubSource) {
          block.createEl("div", {
            cls: "ob-epub-excerpt-check-meta",
            text: t("modal.excerptCheck.epubSource", { value: item.epubSource }),
          });
        }
        if (item.localEpubPath) {
          block.createEl("div", {
            cls: "ob-epub-excerpt-check-meta",
            text: t("modal.excerptCheck.localEpub", { value: item.localEpubPath }),
          });
        }
        if (item.expectedExcerptPath) {
          block.createEl("div", {
            cls: "ob-epub-excerpt-check-meta",
            text: t("modal.excerptCheck.expectedPath", { value: item.expectedExcerptPath }),
          });
        }
        const issuesEl = block.createEl("ul", { cls: "ob-epub-excerpt-check-issues" });
        for (const issue of item.issues) {
          issuesEl.createEl("li", { text: issueLabel(issue) });
        }
      }
    }

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText(t("modal.common.close")).setCta().onClick(() => this.close())
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
