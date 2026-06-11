import { App, Modal, Setting } from "obsidian";
import { HighlightColor, HIGHLIGHT_COLORS, NOTE_TYPES, NoteType } from "./types";

interface NoteResult {
  note: string;
  color: HighlightColor;
  noteType: NoteType;
}

/**
 * Modal for writing a personal note (想法) attached to a selection, with a
 * color picker for the drawn line and a note-type picker.
 */
export class NoteInputModal extends Modal {
  private selectedText: string;
  private note: string;
  private color: HighlightColor;
  private noteType: NoteType;
  private onSubmit: (result: NoteResult) => void;
  private titleText: string;

  constructor(
    app: App,
    selectedText: string,
    initial: { note?: string; color?: HighlightColor; noteType?: NoteType },
    onSubmit: (result: NoteResult) => void,
    titleText = "写下你的想法"
  ) {
    super(app);
    this.selectedText = selectedText;
    this.note = initial.note ?? "";
    this.color = initial.color ?? "yellow";
    this.noteType = initial.noteType ?? "note";
    this.onSubmit = onSubmit;
    this.titleText = titleText;
  }

  private submit(ta: HTMLTextAreaElement) {
    this.note = ta.value.trim();
    this.close();
    this.onSubmit({
      note: this.note,
      color: this.color,
      noteType: this.noteType,
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("epub-note-modal");

    contentEl.createEl("h3", { text: this.titleText });

    const quote = contentEl.createDiv({ cls: "epub-note-quote" });
    quote.setText(
      this.selectedText.length > 240
        ? this.selectedText.slice(0, 240) + "…"
        : this.selectedText
    );

    const colorRow = contentEl.createDiv({ cls: "epub-note-colors" });
    colorRow.createEl("span", { cls: "epub-note-colors-label", text: "画线颜色" });
    const dots = colorRow.createDiv({ cls: "epub-color-dots" });
    const dotEls: Record<string, HTMLElement> = {};
    for (const c of HIGHLIGHT_COLORS) {
      const dot = dots.createDiv({ cls: "epub-color-dot" });
      dot.setAttribute("data-color", c.id);
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

    const typeRow = contentEl.createDiv({ cls: "epub-note-type-row" });
    typeRow.createEl("span", { cls: "epub-note-colors-label", text: "想法类型" });
    const chips = typeRow.createDiv({ cls: "epub-note-type-chips" });
    const chipEls: Record<string, HTMLElement> = {};
    for (const t of NOTE_TYPES) {
      const chip = chips.createDiv({ cls: "epub-note-type-chip" });
      chip.setText(`${t.icon} ${t.label}`);
      chip.title = t.label;
      chip.setAttribute("data-type", t.id);
      if (t.id === this.noteType) chip.addClass("is-active");
      chip.addEventListener("click", () => {
        this.noteType = t.id;
        Object.values(chipEls).forEach((c) => c.removeClass("is-active"));
        chip.addClass("is-active");
      });
      chipEls[t.id] = chip;
    }

    const ta = contentEl.createEl("textarea", { cls: "epub-note-textarea" });
    ta.placeholder = "在这里写下你的想法、疑问或联想…";
    ta.value = this.note;
    ta.rows = 6;
    window.setTimeout(() => ta.focus(), 30);

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("取消").onClick(() => this.close())
      )
      .addButton((btn) =>
        btn
          .setButtonText("保存")
          .setCta()
          .onClick(() => this.submit(ta))
      );

    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        this.submit(ta);
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
