import { App, ButtonComponent, Modal, Setting } from "obsidian";
import { t } from "./i18n/i18n";

function styleDestructiveButton(btn: ButtonComponent): ButtonComponent {
  btn.buttonEl.addClass("epub-confirm-delete");
  return btn.setCta();
}

export interface ConfirmModalOptions {
  confirmLabel?: string;
  /** 若提供，显示「不再显示」勾选；确认时回传是否勾选 */
  dontAskAgainLabel?: string;
}

/**
 * Lightweight confirmation dialog with cancel / confirm actions.
 */
export class ConfirmModal extends Modal {
  private titleText: string;
  private message: string;
  private confirmLabel: string;
  private dontAskAgainLabel: string | null;
  private onConfirm: (dontAskAgain: boolean) => void;
  private dontAskAgain = false;

  constructor(
    app: App,
    title: string,
    message: string,
    onConfirm: (dontAskAgain: boolean) => void,
    options?: ConfirmModalOptions | string
  ) {
    super(app);
    this.titleText = title;
    this.message = message;
    this.onConfirm = onConfirm;
    if (typeof options === "string") {
      this.confirmLabel = options;
      this.dontAskAgainLabel = null;
    } else {
      this.confirmLabel = options?.confirmLabel ?? t("modal.common.delete");
      this.dontAskAgainLabel = options?.dontAskAgainLabel ?? null;
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("epub-confirm-modal");

    contentEl.createEl("h3", { text: this.titleText });
    contentEl.createDiv({ cls: "epub-confirm-message", text: this.message });

    if (this.dontAskAgainLabel) {
      new Setting(contentEl)
        .setClass("epub-confirm-dont-ask")
        .setName(this.dontAskAgainLabel)
        .addToggle((toggle) =>
          toggle.setValue(false).onChange((value) => {
            this.dontAskAgain = value;
          })
        );
    }

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText(t("modal.common.cancel")).onClick(() => this.close())
      )
      .addButton((btn) =>
        styleDestructiveButton(btn.setButtonText(this.confirmLabel)).onClick(() => {
          this.onConfirm(this.dontAskAgain);
          this.close();
        })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}
