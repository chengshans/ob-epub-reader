import { App, Modal, Setting } from "obsidian";
import { HighlightColor, HIGHLIGHT_COLORS } from "./types";

interface NoteResult {
  note: string;
  color: HighlightColor;
}

/**
 * Modal for writing a personal note (想法) attached to a selection, with a
 * color picker for the drawn line.
 */
export class NoteInputModal extends Modal {
  private selectedText: string;
  private note: string;
  private color: HighlightColor;
  private onSubmit: (result: NoteResult) => void;
  private titleText: string;

  constructor(
    app: App,
    selectedText: string,
    initial: { note?: string; color?: HighlightColor },
    onSubmit: (result: NoteResult) => void,
    titleText = "写下你的想法"
  ) {
    super(app);
    this.selectedText = selectedText;
    this.note = initial.note ?? "";
    this.color = initial.color ?? "yellow";
    this.onSubmit = onSubmit;
    this.titleText = titleText;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("epub-note-modal");

    contentEl.createEl("h3", { text: this.titleText });

    // Quoted original text
    const quote = contentEl.createDiv({ cls: "epub-note-quote" });
    quote.setText(
      this.selectedText.length > 240
        ? this.selectedText.slice(0, 240) + "…"
        : this.selectedText
    );

    // Color picker
    const colorRow = contentEl.createDiv({ cls: "epub-note-colors" });
    colorRow.createEl("span", { cls: "epub-note-colors-label", text: "画线颜色" });
    const dots = colorRow.createDiv({ cls: "epub-color-dots" });
    const dotEls: Record<string, HTMLElement> = {};
    for (const c of HIGHLIGHT_COLORS) {
      const dot = dots.createDiv({ cls: "epub-color-dot" });
      dot.style.background = c.hex;
      dot.title = c.label;
      dot.setAttribute("data-color", c.id);
      if (c.id === this.color) dot.addClass("is-active");
      dot.addEventListener("click", () => {
        this.color = c.id;
        Object.values(dotEls).forEach((d) => d.removeClass("is-active"));
        dot.addClass("is-active");
      });
      dotEls[c.id] = dot;
    }

    // Note textarea
    const ta = contentEl.createEl("textarea", { cls: "epub-note-textarea" });
    ta.placeholder = "在这里写下你的想法、疑问或联想…";
    ta.value = this.note;
    ta.rows = 6;
    window.setTimeout(() => ta.focus(), 30);

    // Buttons
    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("取消").onClick(() => this.close())
      )
      .addButton((btn) =>
        btn
          .setButtonText("保存")
          .setCta()
          .onClick(() => {
            this.note = ta.value.trim();
            this.close();
            this.onSubmit({ note: this.note, color: this.color });
          })
      );

    // Ctrl/Cmd+Enter to submit
    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        this.note = ta.value.trim();
        this.close();
        this.onSubmit({ note: this.note, color: this.color });
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
