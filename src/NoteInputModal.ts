/* global window: readonly, document: readonly */
import { App, Modal, Setting } from "obsidian";
import { t } from "./i18n/i18n";
import {
  NoteDraftSnapshot,
  clearNoteDraft,
  getNoteDraft,
  resolveDraftAction,
  saveNoteDraft,
} from "./noteModalDraft";
import { HighlightColor, getHighlightColors, NoteType, NoteTypeDef } from "./types";

interface NoteResult {
  note: string;
  color: HighlightColor;
  noteType: NoteType;
}

const FLOAT_BALL_CLASS = "epub-note-float-ball";
const FLOAT_BALL_SIZE = 44;

/**
 * Modal for writing a personal note (想法) attached to a selection, with a
 * color picker for the drawn line and a note-type picker.
 *
 * issue #17:
 * - 未点「保存/取消」时误触旁边或 Esc：不彻底关闭，而是缩成微信式浮球
 *   吸附在划线位置（可拖动），点浮球恢复继续写；
 * - 标题栏可拖动，长划线时能拖开批注框查看被遮住的原文；
 * - 关闭时未提交的内容自动存草稿，重开可恢复（兜底）。
 */
export class NoteInputModal extends Modal {
  private selectedText: string;
  private note: string;
  private color: HighlightColor;
  private noteType: NoteType;
  private noteTypes: NoteTypeDef[];
  private onSubmit: (result: NoteResult) => void;
  private titleText: string;
  /** 草稿存储 key：编辑已有批注时为注释 id，新建批注时为画线 CFI */
  private draftKey: string;
  /** 关闭但未提交时是否要保存草稿（提交/放弃后置 false） */
  private persistDraftOnClose = true;
  /** 取消/提交后的真关闭：跳过「最小化成浮球」逻辑 */
  private forceClose = false;
  /** 当前是否处于最小化（浮球）状态 */
  private minimized = false;
  /** 浮球初始锚点：划线在窗口中的位置；为空时吸附右侧边缘 */
  private anchorPoint: { x: number; y: number } | null = null;
  /** 实时锚点：取划线高亮的当前视口位置（窗口 resize 后仍准确） */
  private getAnchorPoint: (() => { x: number; y: number } | null) | null = null;
  /** 真关闭（提交或取消）后的回调，宿主用于清理临时高亮 */
  private onDismiss: (() => void) | null = null;
  private ballEl: HTMLElement | null = null;
  /** 用户是否手动拖过浮球：拖过后不再自动吸附划线位置 */
  private ballManuallyMoved = false;
  /** 草稿条上的恢复按钮引用，供测试与交互逻辑使用 */
  private recoverBtn: HTMLButtonElement | null = null;

  constructor(
    app: App,
    selectedText: string,
    noteTypes: NoteTypeDef[],
    initial: {
      note?: string;
      color?: HighlightColor;
      noteType?: NoteType;
      /** 编辑已有批注时传入注释 id，用于草稿 key 与「恢复草稿」展示 */
      draftKey?: string;
      /** 浮球初始锚点（视口坐标），新建批注时传划线位置 */
      anchorPoint?: { x: number; y: number } | null;
      /** 实时锚点：每次显示/窗口变化时调用，返回划线当前位置 */
      getAnchorPoint?: () => { x: number; y: number } | null;
      /** 真关闭（提交/取消）后回调 */
      onDismiss?: () => void;
    },
    onSubmit: (result: NoteResult) => void,
    titleText = t("modal.note.title")
  ) {
    super(app);
    this.selectedText = selectedText;
    this.noteTypes = noteTypes;
    this.note = initial.note ?? "";
    this.color = initial.color ?? "yellow";
    this.noteType = initial.noteType ?? "note";
    this.draftKey = initial.draftKey ?? "";
    this.anchorPoint = initial.anchorPoint ?? null;
    this.getAnchorPoint = initial.getAnchorPoint ?? null;
    this.onDismiss = initial.onDismiss ?? null;
    this.onSubmit = onSubmit;
    this.titleText = titleText;
  }

  /**
   * Obsidian 在 Esc / 点击遮罩时会调用 close()。这里拦截：
   * 内容未提交时改为最小化成浮球，不真关；只有「保存/取消」才真关闭。
   */
  close() {
    if (!this.forceClose && !this.minimized && this.isDirty()) {
      this.minimizeToBall();
      return;
    }
    super.close();
  }

  private textareaEl(): HTMLTextAreaElement | null {
    return this.contentEl.querySelector<HTMLTextAreaElement>(".epub-note-textarea");
  }

  /** 输入框内容相对初始预填是否发生了变化（即有未提交的编辑） */
  private isDirty(): boolean {
    if (this.minimized) return true;
    const text = (this.textareaEl()?.value ?? "").trim();
    return text !== this.note;
  }

  private submit(ta: HTMLTextAreaElement) {
    this.note = ta.value.trim();
    if (this.draftKey) clearNoteDraft(this.draftKey);
    this.persistDraftOnClose = false;
    this.forceClose = true;
    this.close();
    this.onSubmit({
      note: this.note,
      color: this.color,
      noteType: this.noteType,
    });
  }

  /**
   * 外部请求提交（如翻页前自动保存）：有未提交内容则按「保存」处理，
   * 内容为空则静默真关闭。浮球（最小化）态同样适用。
   */
  submitIfPending() {
    if (this.forceClose) return;
    const ta = this.textareaEl();
    if (ta) {
      this.submit(ta);
      return;
    }
    // 取不到输入框（异常态）：直接真关闭，交给 onClose 的草稿兜底
    this.persistDraftOnClose = false;
    this.forceClose = true;
    this.close();
  }

  /** 取消按钮：明确放弃本次编辑，真关闭且不保留草稿 */
  private discardAndClose() {
    if (this.draftKey) clearNoteDraft(this.draftKey);
    this.persistDraftOnClose = false;
    this.forceClose = true;
    this.close();
  }

  /**
   * 把草稿应用回输入框与选色/类型。编辑模式下调用前文本框里是原文，
   * 会覆盖，因此只有用户点了「恢复草稿」按钮才会走到这里。
   */
  private applyDraft(ta: HTMLTextAreaElement, draft: NoteDraftSnapshot) {
    ta.value = draft.note;
    if (isHighlightColor(draft.color)) {
      this.color = draft.color;
      const dot = this.colorDotEls[draft.color];
      if (dot) {
        Object.values(this.colorDotEls).forEach((d) => d.removeClass("is-active"));
        dot.addClass("is-active");
      }
    }
    const chip = this.noteTypeChipEls[draft.noteType];
    if (chip) {
      this.noteType = draft.noteType as NoteType;
      Object.values(this.noteTypeChipEls).forEach((c) => c.removeClass("is-active"));
      chip.addClass("is-active");
    }
  }

  private colorDotEls: Record<string, HTMLElement> = {};
  private noteTypeChipEls: Record<string, HTMLElement> = {};

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("epub-note-modal");

    const draft = this.draftKey ? getNoteDraft(this.draftKey) : null;
    const draftAction = resolveDraftAction(this.note, draft);

    contentEl.createEl("h3", { text: this.titleText });

    const quote = contentEl.createDiv({ cls: "epub-note-quote" });
    quote.setText(
      this.selectedText.length > 240
        ? this.selectedText.slice(0, 240) + "…"
        : this.selectedText
    );

    // 草稿提示条：新建批注自动恢复；编辑批注保留原文，提供一键恢复
    if (draftAction === "recover" && draft) {
      const banner = contentEl.createDiv({ cls: "epub-note-draft-banner" });
      banner.createSpan({
        cls: "epub-note-draft-text",
        text: t("modal.note.draftFound"),
      });
      this.recoverBtn = banner.createEl("button", {
        cls: "epub-note-draft-recover-btn mod-warning",
        text: t("modal.note.draftRecover"),
      });
      this.recoverBtn.addEventListener("click", () => {
        const ta = this.textareaEl();
        if (!ta || !draft) return;
        this.applyDraft(ta, draft);
        banner.remove();
        this.recoverBtn = null;
      });
    }

    const colorRow = contentEl.createDiv({ cls: "epub-note-colors" });
    colorRow.createEl("span", { cls: "epub-note-colors-label", text: t("modal.note.highlightColor") });
    const dots = colorRow.createDiv({ cls: "epub-color-dots" });
    for (const c of getHighlightColors()) {
      const dot = dots.createDiv({ cls: "epub-color-dot" });
      dot.setAttribute("data-color", c.id);
      dot.title = c.label;
      if (c.id === this.color) dot.addClass("is-active");
      dot.addEventListener("click", () => {
        this.color = c.id;
        Object.values(this.colorDotEls).forEach((d) => d.removeClass("is-active"));
        dot.addClass("is-active");
      });
      this.colorDotEls[c.id] = dot;
    }

    const typeRow = contentEl.createDiv({ cls: "epub-note-type-row" });
    typeRow.createEl("span", { cls: "epub-note-colors-label", text: t("modal.note.noteType") });
    const chips = typeRow.createDiv({ cls: "epub-note-type-chips" });
    for (const entry of this.noteTypes) {
      const chip = chips.createDiv({ cls: "epub-note-type-chip" });
      chip.setText(`${entry.icon} ${entry.label}`);
      chip.title = entry.label;
      chip.setAttribute("data-type", entry.id);
      if (entry.id === this.noteType) chip.addClass("is-active");
      chip.addEventListener("click", () => {
        this.noteType = entry.id;
        Object.values(this.noteTypeChipEls).forEach((c) => c.removeClass("is-active"));
        chip.addClass("is-active");
      });
      this.noteTypeChipEls[entry.id] = chip;
    }

    const ta = contentEl.createEl("textarea", { cls: "epub-note-textarea" });
    ta.placeholder = t("modal.note.placeholder");
    ta.value = this.note;
    ta.rows = 6;

    // 新建批注：草稿直接填入输入框（textarea 已建好），并显示提示
    if (draftAction === "auto-restore" && draft) {
      this.applyDraft(ta, draft);
      const banner = contentEl.createDiv({ cls: "epub-note-draft-banner" });
      banner.createSpan({
        cls: "epub-note-draft-text",
        text: t("modal.note.draftRestored"),
      });
    }

    window.setTimeout(() => ta.focus(), 30);

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText(t("modal.common.cancel")).onClick(() => this.discardAndClose())
      )
      .addButton((btn) =>
        btn
          .setButtonText(t("modal.common.save"))
          .setCta()
          .onClick(() => this.submit(ta))
      );

    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        this.submit(ta);
      }
    });

    this.enableDragging();
    // 窗口尺寸/半屏切换后浮球重新吸附划线位置
    window.addEventListener("resize", this.repositionBallHandler);
  }

  onClose() {
    // 真关闭才会走到这里（提交/取消，或无未提交内容时 Esc/遮罩点击）
    this.removeBall();
    this.teardownDragging();
    window.removeEventListener("resize", this.repositionBallHandler);
    if (this.persistDraftOnClose && this.draftKey) {
      const text = (this.textareaEl()?.value ?? "").trim();
      if (text && text !== this.note) {
        saveNoteDraft(this.draftKey, {
          note: text,
          color: this.color,
          noteType: this.noteType,
        });
      }
    }
    this.contentEl.empty();
    this.onDismiss?.();
  }

  // ---- 最小化成浮球（issue #17：误触不丢内容）----

  private minimizeToBall() {
    if (this.minimized) return;
    // 最小化时同步一份草稿，应用意外退出也能找回
    if (this.draftKey) {
      const text = (this.textareaEl()?.value ?? "").trim();
      if (text && text !== this.note) {
        saveNoteDraft(this.draftKey, {
          note: text,
          color: this.color,
          noteType: this.noteType,
        });
      }
    }
    const container = (this as { containerEl?: HTMLElement }).containerEl ?? this.modalEl;
    container.addClass("epub-note-modal-minimized");
    this.minimized = true;
    this.showFloatBall();
  }

  private showFloatBall() {
    if (this.ballEl) return;
    const pos = this.resolveBallPosition();
    const ball = document.body.createDiv(FLOAT_BALL_CLASS);
    ball.setText("✎");
    ball.title = t("modal.note.floatTip");
    ball.setAttribute("aria-label", t("modal.note.floatTip"));
    ball.setCssProps({
      left: `${pos.x}px`,
      top: `${pos.y}px`,
      width: `${FLOAT_BALL_SIZE}px`,
      height: `${FLOAT_BALL_SIZE}px`,
    });
    this.ballEl = ball;
    this.enableBallDrag(ball);
  }

  /**
   * 计算浮球位置：优先用实时锚点（划线高亮的当前视口位置，窗口尺寸
   * 变化后依然准确），取不到再退回一次性锚点/右侧边缘。
   */
  private resolveBallPosition(): { x: number; y: number } {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
    const anchor =
      this.getAnchorPoint?.() ??
      this.anchorPoint ?? { x: vw - FLOAT_BALL_SIZE / 2 - 12, y: Math.round(vh * 0.4) };
    return {
      x: clamp(anchor.x - FLOAT_BALL_SIZE / 2, 8, vw - FLOAT_BALL_SIZE - 8),
      y: clamp(anchor.y - FLOAT_BALL_SIZE / 2, 8, vh - FLOAT_BALL_SIZE - 8),
    };
  }

  /** 窗口尺寸变化时重新吸附到划线位置（用户手动拖过则尊重手动位置） */
  private repositionBall() {
    if (!this.ballEl || this.ballManuallyMoved) return;
    const pos = this.resolveBallPosition();
    this.ballEl.setCssProps({
      left: `${pos.x}px`,
      top: `${pos.y}px`,
      transform: "none",
    });
  }

  private repositionBallHandler = () => this.repositionBall();

  private removeBall() {
    this.ballEl?.remove();
    this.ballEl = null;
  }

  /** 点浮球恢复批注框继续编辑 */
  private restoreFromBall() {
    if (!this.minimized) return;
    this.removeBall();
    const container = (this as { containerEl?: HTMLElement }).containerEl ?? this.modalEl;
    container.removeClass("epub-note-modal-minimized");
    this.minimized = false;
    window.setTimeout(() => this.textareaEl()?.focus(), 30);
  }

  /** 浮球：拖动换位；位移极小视为点击 → 恢复批注框 */
  private enableBallDrag(ball: HTMLElement) {
    let startX = 0;
    let startY = 0;
    let baseLeft = 0;
    let baseTop = 0;
    let moved = 0;
    let dragging = false;
    let pointerId = -1;

    const onPointerDown = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      const rect = ball.getBoundingClientRect();
      baseLeft = rect.left;
      baseTop = rect.top;
      startX = e.clientX;
      startY = e.clientY;
      moved = 0;
      dragging = true;
      pointerId = e.pointerId;
      try {
        ball.setPointerCapture(e.pointerId);
      } catch {
        /* 部分环境不支持 capture，忽略 */
      }
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 6) this.ballManuallyMoved = true;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const nextLeft = Math.min(Math.max(baseLeft + dx, 0), vw - FLOAT_BALL_SIZE);
      const nextTop = Math.min(Math.max(baseTop + dy, 0), vh - FLOAT_BALL_SIZE);
      ball.setCssProps({
        left: `${nextLeft}px`,
        top: `${nextTop}px`,
        transform: "none",
      });
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      dragging = false;
      try {
        ball.releasePointerCapture(e.pointerId);
      } catch {
        /* 已释放时忽略 */
      }
      // 位移很小视为点击：恢复批注框
      if (moved < 6) this.restoreFromBall();
    };

    ball.addEventListener("pointerdown", onPointerDown);
    ball.addEventListener("pointermove", onPointerMove);
    ball.addEventListener("pointerup", onPointerUp);
    ball.addEventListener("pointercancel", onPointerUp);
  }

  // ---- 批注框拖动（issue #17 需求 2）----

  private dragCleanupFns: Array<() => void> = [];

  private enableDragging() {
    const modalEl = this.modalEl;
    if (!modalEl) return;
    // 手柄用模态内 h3 标题：桌面/移动端都可见可点，且不与按钮区冲突
    const handle = this.contentEl.querySelector<HTMLElement>("h3");
    if (!handle) return;
    handle.addClass("epub-note-modal-drag-handle");

    let startX = 0;
    let startY = 0;
    let baseLeft = 0;
    let baseTop = 0;
    let dragging = false;
    let pointerId = -1;

    const onPointerDown = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      // handle 内的按钮/输入控件照常工作，不触发拖动
      if ((e.target as HTMLElement).closest("button, input, textarea, .epub-color-dot")) {
        return;
      }
      const rect = modalEl.getBoundingClientRect();
      // 锁定当前宽度：切到 fixed 定位后宽度不再随布局变化，避免第一次拖动跳动
      modalEl.setCssProps({ width: `${rect.width}px` });
      baseLeft = rect.left;
      baseTop = rect.top;
      startX = e.clientX;
      startY = e.clientY;
      dragging = true;
      pointerId = e.pointerId;
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        /* 部分环境（happy-dom）不支持 capture，拖动仍可用 */
      }
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const rect = modalEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // 钳制在视口内：至少留 48px 可抓回来，不允许拖出屏幕
      const minVisible = 48;
      const nextLeft = Math.min(
        Math.max(baseLeft + dx, minVisible - rect.width),
        vw - minVisible
      );
      const nextTop = Math.min(
        Math.max(baseTop + dy, 0),
        Math.max(0, vh - minVisible)
      );
      // 定位基准：fixed + translate。通过 CSS 变量注入，避免静态样式赋值
      modalEl.setCssProps({
        transform: `translate(${nextLeft}px, ${nextTop}px)`,
      });
      modalEl.addClass("epub-note-modal-dragged");
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      dragging = false;
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        /* 已释放时忽略 */
      }
    };

    handle.addEventListener("pointerdown", onPointerDown);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerUp);
    this.dragCleanupFns.push(() => {
      handle.removeEventListener("pointerdown", onPointerDown);
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", onPointerUp);
    });
  }

  private teardownDragging() {
    for (const fn of this.dragCleanupFns) fn();
    this.dragCleanupFns = [];
  }
}

function isHighlightColor(value: string): value is HighlightColor {
  return getHighlightColors().some((c) => c.id === value);
}
