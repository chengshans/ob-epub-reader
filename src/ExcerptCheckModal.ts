import { App, Modal, Setting } from "obsidian";
import {
  EXCERPT_CHECK_ISSUE_LABELS,
  ExcerptMetadataCheckReport,
} from "./excerptFolder";

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

    contentEl.createEl("h3", { text: "摘录元数据检查" });

    const summary = contentEl.createDiv({ cls: "ob-epub-excerpt-check-summary" });
    if (this.report.withIssues === 0) {
      summary.createEl("p", {
        text: `已检查 ${this.report.checked} 个摘录文件，未发现问题。`,
      });
    } else {
      summary.createEl("p", {
        text: `已检查 ${this.report.checked} 个摘录文件，${this.report.withIssues} 个存在问题。`,
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
            text: `epub-source: ${item.epubSource}`,
          });
        }
        if (item.localEpubPath) {
          block.createEl("div", {
            cls: "ob-epub-excerpt-check-meta",
            text: `同级 EPUB: ${item.localEpubPath}`,
          });
        }
        if (item.expectedExcerptPath) {
          block.createEl("div", {
            cls: "ob-epub-excerpt-check-meta",
            text: `当前设置应对应: ${item.expectedExcerptPath}`,
          });
        }
        const issuesEl = block.createEl("ul", { cls: "ob-epub-excerpt-check-issues" });
        for (const issue of item.issues) {
          issuesEl.createEl("li", { text: EXCERPT_CHECK_ISSUE_LABELS[issue] });
        }
      }
    }

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("关闭").setCta().onClick(() => this.close())
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
