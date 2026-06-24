import { t } from "./i18n/i18n";
import {
  EpubPluginSettings,
  ReadingThemeId,
  clampHighlightOpacity,
  clampReadingSidePadding,
  getReadingThemes,
  HIGHLIGHT_OPACITY_MAX,
  HIGHLIGHT_OPACITY_MIN,
  READING_SIDE_PADDING_MIN,
  READING_SIDE_PADDING_MAX,
  READING_SIDE_PADDING_STEP,
} from "./types";

const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 32;

export interface ReadingSettingsHandlers {
  getSettings: () => EpubPluginSettings;
  getReadingTheme: () => ReadingThemeId;
  annotationsEnabled: () => boolean;
  isToolbarBottom: () => boolean;
  onFontSizeDelta: (delta: number) => void;
  onFontSizeInput: (size: number) => void;
  onFontSizeCommit: (size: number) => void;
  onSidePaddingDelta: (delta: number) => void;
  onSidePaddingInput: (padding: number) => void;
  onSidePaddingCommit: (padding: number) => void;
  onThemeSelect: (id: ReadingThemeId) => void;
  onHighlightInput: (opacity: number) => void;
  onHighlightCommit: (opacity: number) => void;
  onAutoPasteToggle: () => void;
}

export class ReadingSettingsPopover {
  private handlers: ReadingSettingsHandlers;
  private el: HTMLElement | null = null;
  private anchorEl: HTMLElement | null = null;
  private dismissHandler: ((e: MouseEvent) => void) | null = null;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;

  private fontSizeRangeEl: HTMLInputElement | null = null;
  private fontSizeValueEl: HTMLElement | null = null;
  private sidePaddingRangeEl: HTMLInputElement | null = null;
  private sidePaddingValueEl: HTMLElement | null = null;
  private themeSwatchesEl: HTMLElement | null = null;
  private highlightRowEl: HTMLElement | null = null;
  private highlightRangeEl: HTMLInputElement | null = null;
  private autoPasteToggleEl: HTMLButtonElement | null = null;

  constructor(handlers: ReadingSettingsHandlers) {
    this.handlers = handlers;
  }

  isOpen(): boolean {
    return this.el !== null;
  }

  toggle(anchorEl: HTMLElement): void {
    if (this.isOpen() && this.anchorEl === anchorEl) {
      this.close();
      return;
    }
    this.open(anchorEl);
  }

  open(anchorEl: HTMLElement): void {
    this.close();
    this.anchorEl = anchorEl;

    const panel = document.createElement("div");
    panel.className = "epub-reading-settings-popover";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", t("reader.readingSettings.title"));

    panel.createEl("h4", {
      cls: "epub-reading-settings-title",
      text: t("reader.readingSettings.title"),
    });

    this.buildFontSizeRow(panel);
    this.buildSidePaddingRow(panel);
    this.buildThemeRow(panel);
    this.buildHighlightRow(panel);
    this.buildAutoPasteRow(panel);

    document.body.appendChild(panel);
    this.el = panel;
    this.position(panel, anchorEl);
    this.sync();
    this.bindDismiss(anchorEl);
  }

  close(): void {
    this.unbindDismiss();
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
    this.anchorEl = null;
    this.fontSizeRangeEl = null;
    this.fontSizeValueEl = null;
    this.sidePaddingRangeEl = null;
    this.sidePaddingValueEl = null;
    this.themeSwatchesEl = null;
    this.highlightRowEl = null;
    this.highlightRangeEl = null;
    this.autoPasteToggleEl = null;
  }

  sync(): void {
    if (!this.el) return;

    const settings = this.handlers.getSettings();
    const theme = this.handlers.getReadingTheme();

    if (this.fontSizeRangeEl) {
      const size = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(settings.fontSize)));
      this.fontSizeRangeEl.value = String(size);
      this.fontSizeRangeEl.title = t("reader.readingSettings.fontSizePx", { px: size });
    }
    if (this.fontSizeValueEl) {
      const size = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(settings.fontSize)));
      this.fontSizeValueEl.setText(String(size));
    }
    if (this.sidePaddingRangeEl) {
      const px = clampReadingSidePadding(settings.readingSidePadding);
      this.sidePaddingRangeEl.value = String(px);
      this.sidePaddingRangeEl.title = t("reader.readingSettings.sidePaddingPx", { px });
    }
    if (this.sidePaddingValueEl) {
      const px = clampReadingSidePadding(settings.readingSidePadding);
      this.sidePaddingValueEl.setText(String(px));
    }
    if (this.themeSwatchesEl) {
      this.themeSwatchesEl.querySelectorAll(".epub-theme-swatch").forEach((node) => {
        const id = (node as HTMLElement).dataset.theme;
        node.toggleClass("is-active", id === theme);
      });
    }
    if (this.highlightRowEl) {
      const showHighlight = this.handlers.annotationsEnabled();
      this.highlightRowEl.toggleVisibility(showHighlight);
    }
    if (this.highlightRangeEl) {
      const opacity = clampHighlightOpacity(settings.epubHighlightOpacity);
      const percent = Math.round(opacity * 100);
      this.highlightRangeEl.value = String(percent);
      this.highlightRangeEl.title = t("reader.toolbar.highlightOpacityPercent", { percent });
    }
    if (this.autoPasteToggleEl) {
      const enabled = settings.autoPasteExcerpt !== false;
      this.autoPasteToggleEl.textContent = enabled ? "🌟" : "★";
      this.autoPasteToggleEl.setAttr(
        "aria-label",
        enabled ? t("reader.toolbar.autoPasteOn") : t("reader.toolbar.autoPasteOff")
      );
      this.autoPasteToggleEl.title = enabled
        ? t("reader.toolbar.autoPasteOnDesc")
        : t("reader.toolbar.autoPasteOffDesc");
      this.autoPasteToggleEl.toggleClass("is-on", enabled);
    }
  }

  private buildFontSizeRow(panel: HTMLElement): void {
    const row = panel.createDiv({ cls: "epub-reading-settings-row" });
    row.createSpan({ cls: "epub-reading-settings-label", text: t("reader.readingSettings.fontSize") });

    const controls = row.createDiv({ cls: "epub-reading-settings-controls" });
    const downBtn = controls.createEl("button", {
      cls: "epub-toolbar-btn",
      text: "A-",
      attr: { type: "button" },
    });
    downBtn.title = t("reader.toolbar.fontSmaller");
    downBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.handlers.onFontSizeDelta(-2);
      this.sync();
    });

    const range = controls.createEl("input", {
      cls: "epub-reading-settings-range",
      type: "range",
      attr: {
        min: String(FONT_SIZE_MIN),
        max: String(FONT_SIZE_MAX),
        step: "1",
      },
    });
    this.fontSizeRangeEl = range;
    range.addEventListener("input", () => {
      const size = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(Number(range.value))));
      range.title = t("reader.readingSettings.fontSizePx", { px: size });
      if (this.fontSizeValueEl) this.fontSizeValueEl.setText(String(size));
      this.handlers.onFontSizeInput(size);
    });
    range.addEventListener("change", () => {
      const size = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(Number(range.value))));
      this.handlers.onFontSizeCommit(size);
    });

    const upBtn = controls.createEl("button", {
      cls: "epub-toolbar-btn",
      text: "A+",
      attr: { type: "button" },
    });
    upBtn.title = t("reader.toolbar.fontLarger");
    upBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.handlers.onFontSizeDelta(2);
      this.sync();
    });

    this.fontSizeValueEl = controls.createSpan({ cls: "epub-reading-settings-value" });
  }

  private buildSidePaddingRow(panel: HTMLElement): void {
    const row = panel.createDiv({ cls: "epub-reading-settings-row" });
    row.createSpan({ cls: "epub-reading-settings-label", text: t("reader.readingSettings.sidePadding") });

    const controls = row.createDiv({ cls: "epub-reading-settings-controls" });
    const downBtn = controls.createEl("button", {
      cls: "epub-toolbar-btn epub-side-padding-btn",
      text: "◧-",
      attr: { type: "button" },
    });
    downBtn.title = t("reader.toolbar.sidePaddingSmaller");
    downBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.handlers.onSidePaddingDelta(-READING_SIDE_PADDING_STEP);
      this.sync();
    });

    const range = controls.createEl("input", {
      cls: "epub-reading-settings-range",
      type: "range",
      attr: {
        min: String(READING_SIDE_PADDING_MIN),
        max: String(READING_SIDE_PADDING_MAX),
        step: String(READING_SIDE_PADDING_STEP),
      },
    });
    this.sidePaddingRangeEl = range;
    range.addEventListener("input", () => {
      const px = clampReadingSidePadding(Number(range.value));
      range.value = String(px);
      range.title = t("reader.readingSettings.sidePaddingPx", { px });
      if (this.sidePaddingValueEl) this.sidePaddingValueEl.setText(String(px));
      this.handlers.onSidePaddingInput(px);
    });
    range.addEventListener("change", () => {
      const px = clampReadingSidePadding(Number(range.value));
      this.handlers.onSidePaddingCommit(px);
    });

    const upBtn = controls.createEl("button", {
      cls: "epub-toolbar-btn epub-side-padding-btn",
      text: "◧+",
      attr: { type: "button" },
    });
    upBtn.title = t("reader.toolbar.sidePaddingLarger");
    upBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.handlers.onSidePaddingDelta(READING_SIDE_PADDING_STEP);
      this.sync();
    });

    this.sidePaddingValueEl = controls.createSpan({ cls: "epub-reading-settings-value" });
  }

  private buildThemeRow(panel: HTMLElement): void {
    const row = panel.createDiv({ cls: "epub-reading-settings-row epub-reading-settings-row-theme" });
    row.createSpan({ cls: "epub-reading-settings-label", text: t("reader.readingSettings.readingTheme") });

    const swatches = row.createDiv({ cls: "epub-theme-swatches" });
    this.themeSwatchesEl = swatches;

    for (const theme of getReadingThemes()) {
      const swatch = swatches.createEl("button", {
        cls: "epub-theme-swatch",
        type: "button",
        attr: { "data-theme": theme.id },
      });
      swatch.title = theme.label;
      if (theme.id === "obsidian") {
        swatch.style.background = theme.swatch;
      } else {
        swatch.style.backgroundColor = theme.swatch;
      }
      swatch.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void this.handlers.onThemeSelect(theme.id);
        this.sync();
      });
    }
  }

  private buildHighlightRow(panel: HTMLElement): void {
    const row = panel.createDiv({ cls: "epub-reading-settings-row epub-reading-settings-row-highlight" });
    this.highlightRowEl = row;
    row.createSpan({ cls: "epub-reading-settings-label", text: t("settings.highlightOpacity.name") });

    const group = row.createDiv({ cls: "epub-highlight-opacity" });
    const range = group.createEl("input", {
      cls: "epub-highlight-opacity-range",
      type: "range",
      attr: {
        min: String(Math.round(HIGHLIGHT_OPACITY_MIN * 100)),
        max: String(Math.round(HIGHLIGHT_OPACITY_MAX * 100)),
        step: "1",
      },
    });
    this.highlightRangeEl = range;

    range.addEventListener("input", () => {
      const opacity = clampHighlightOpacity(Number(range.value) / 100);
      range.title = t("reader.toolbar.highlightOpacityPercent", {
        percent: Math.round(opacity * 100),
      });
      this.handlers.onHighlightInput(opacity);
    });
    range.addEventListener("change", () => {
      const opacity = clampHighlightOpacity(Number(range.value) / 100);
      this.handlers.onHighlightCommit(opacity);
    });
  }

  private buildAutoPasteRow(panel: HTMLElement): void {
    const row = panel.createDiv({ cls: "epub-reading-settings-row" });
    row.createSpan({ cls: "epub-reading-settings-label", text: t("reader.toolbar.autoPaste") });

    const group = row.createDiv({ cls: "epub-auto-paste" });
    const toggleBtn = group.createEl("button", {
      cls: "epub-toolbar-btn epub-auto-paste-toggle",
      attr: { type: "button" },
    });
    toggleBtn.title = t("reader.toolbar.autoPaste");
    this.autoPasteToggleEl = toggleBtn;
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.handlers.onAutoPasteToggle();
      this.sync();
    });
  }

  private position(panel: HTMLElement, anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const popRect = panel.getBoundingClientRect();
    const gap = 8;
    let top: number;
    if (this.handlers.isToolbarBottom()) {
      top = rect.top - popRect.height - gap;
    } else {
      top = rect.bottom + gap;
    }
    let left = rect.left + rect.width / 2 - popRect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - popRect.height - 8));
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
  }

  private bindDismiss(anchorEl: HTMLElement): void {
    this.unbindDismiss();

    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (this.el?.contains(target)) return;
      if (anchorEl.contains(target)) return;
      this.close();
    };

    this.dismissTimer = setTimeout(() => {
      this.dismissTimer = null;
      this.dismissHandler = handler;
      document.addEventListener("mousedown", handler, { capture: true });
    }, 0);
  }

  private unbindDismiss(): void {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
    if (this.dismissHandler) {
      document.removeEventListener("mousedown", this.dismissHandler, { capture: true });
      this.dismissHandler = null;
    }
  }
}
