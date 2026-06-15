import { App, Modal, Setting } from "obsidian";

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
    confirmLabel = "删除"
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
        btn.setButtonText("取消").onClick(() => this.close())
      )
      .addButton((btn) =>
        btn
          .setButtonText(this.confirmLabel)
          .setDestructive()
          .onClick(() => {
            this.close();
            this.onConfirm();
          })
      );
  }
}
