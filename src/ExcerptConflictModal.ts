import { App, ButtonComponent, Modal, Setting } from "obsidian";
import { t } from "./i18n/i18n";

export type ExcerptConflictChoice = "keepExternal" | "overwrite" | "merge";

export class ExcerptConflictModal extends Modal {
  private filePath: string;
  private onChoose: (choice: ExcerptConflictChoice) => void;

  constructor(app: App, filePath: string, onChoose: (choice: ExcerptConflictChoice) => void) {
    super(app);
    this.filePath = filePath;
    this.onChoose = onChoose;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("epub-excerpt-conflict-modal");

    contentEl.createEl("h3", { text: t("modal.excerptConflict.title") });
    contentEl.createDiv({
      cls: "epub-confirm-message",
      text: t("modal.excerptConflict.message", { path: this.filePath }),
    });

    const addChoice = (label: string, choice: ExcerptConflictChoice, cta = false) => {
      new Setting(contentEl).addButton((btn: ButtonComponent) => {
        btn.setButtonText(label).onClick(() => {
          this.onChoose(choice);
          this.close();
        });
        if (cta) btn.setCta();
      });
    };

    addChoice(t("modal.excerptConflict.merge"), "merge", true);
    addChoice(t("modal.excerptConflict.overwrite"), "overwrite");
    addChoice(t("modal.excerptConflict.keepExternal"), "keepExternal");
    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText(t("modal.common.cancel")).onClick(() => this.close())
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
