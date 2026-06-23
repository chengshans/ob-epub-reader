import { App, ButtonComponent, Modal, Setting } from "obsidian";
import { t } from "./i18n/i18n";

function styleDestructiveButton(btn: ButtonComponent): ButtonComponent {
  btn.buttonEl.addClass("epub-confirm-delete");
  return btn.setCta();
}

/**
 * Lightweight confirmation dialog with cancel / confirm actions.
 */
export class ConfirmModal extends Modal {
  private titleText: string;
  private message: string;
  private confirmLabel: string;
  private onConfirm: () => void;

  constructor(
    app: App,
    title: string,
    message: string,
    onConfirm: () => void,
    confirmLabel = t("modal.common.delete")
  ) {
    super(app);
    this.titleText = title;
    this.message = message;
    this.confirmLabel = confirmLabel;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("epub-confirm-modal");

    contentEl.createEl("h3", { text: this.titleText });
    contentEl.createDiv({ cls: "epub-confirm-message", text: this.message });

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText(t("modal.common.cancel")).onClick(() => this.close())
      )
      .addButton((btn) =>
        styleDestructiveButton(btn.setButtonText(this.confirmLabel)).onClick(() => {
          this.onConfirm();
          this.close();
        })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}
