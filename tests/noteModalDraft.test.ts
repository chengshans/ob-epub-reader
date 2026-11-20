import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { NoteInputModal } from "../src/NoteInputModal";
import {
  clearAllNoteDrafts,
  getNoteDraft,
  resolveDraftAction,
  saveNoteDraft,
} from "../src/noteModalDraft";
import { DEFAULT_NOTE_TYPES } from "../src/types";

const NOTE_TYPES = DEFAULT_NOTE_TYPES;

function dispatchPointer(
  el: HTMLElement,
  type: string,
  opts: { clientX?: number; clientY?: number; pointerId?: number } = {}
) {
  const e = new PointerEvent(type, {
    isPrimary: true,
    pointerId: opts.pointerId ?? 1,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    bubbles: true,
  });
  el.dispatchEvent(e);
}

function openModal(initial: { note?: string; draftKey?: string } = {}) {
  const modal = new NoteInputModal(
    new App() as any,
    "被划线的一段原文",
    NOTE_TYPES,
    initial,
    () => {}
  );
  modal.open();
  return modal;
}

function textareaOf(modal: NoteInputModal): HTMLTextAreaElement {
  return (modal as any).contentEl.querySelector(".epub-note-textarea");
}

describe("minimize to float ball (issue #17 需求1升级版)", () => {
  beforeEach(() => {
    clearAllNoteDrafts();
  });
  afterEach(() => {
    // 测试共用 document，防止上一个用例的浮球泄漏到下一个
    document.querySelectorAll(".epub-note-float-ball").forEach((b) => b.remove());
  });

  it("有未提交内容时 close() 不真关，而是最小化成浮球", () => {
    const modal = openModal({ draftKey: "cfi-ball" });
    textareaOf(modal).value = "写到一半的想法";
    modal.close();
    // 模态未被销毁，浮球已出现
    expect(document.querySelector(".epub-note-float-ball")).toBeTruthy();
    expect((modal as any).minimized).toBe(true);
  });

  it("点浮球恢复批注框，内容还在，可继续编辑后提交", () => {
    const onSubmit = vi.fn();
    const modal = new NoteInputModal(new App() as any, "原文", NOTE_TYPES, { draftKey: "cfi-r" }, onSubmit);
    modal.open();
    const ta = textareaOf(modal);
    ta.value = "继续写的部分";
    modal.close(); // 最小化
    const ball = document.querySelector(".epub-note-float-ball") as HTMLElement;
    ball.dispatchEvent(new PointerEvent("pointerdown", { isPrimary: true, pointerId: 1, clientX: 100, clientY: 100, bubbles: true }));
    ball.dispatchEvent(new PointerEvent("pointerup", { isPrimary: true, pointerId: 1, clientX: 102, clientY: 101, bubbles: true }));
    // 恢复：浮球消失，输入框内容保留
    expect(document.querySelector(".epub-note-float-ball")).toBeNull();
    expect((modal as any).minimized).toBe(false);
    expect(textareaOf(modal).value).toBe("继续写的部分");
    // 继续写完提交
    (modal as any).submit(textareaOf(modal));
    expect(onSubmit).toHaveBeenCalledWith({ note: "继续写的部分", color: "yellow", noteType: "note" });
    expect(document.querySelector(".epub-note-float-ball")).toBeNull();
  });

  it("最小化时草稿同步保存（应用意外退出也能找回）", () => {
    const modal = openModal({ draftKey: "cfi-draft" });
    textareaOf(modal).value = "怕丢的内容";
    modal.close();
    expect(getNoteDraft("cfi-draft")).not.toBeNull();
    expect(getNoteDraft("cfi-draft")?.note).toBe("怕丢的内容");
  });

  it("取消按钮真关闭：不弹浮球、清草稿", () => {
    saveNoteDraft("cfi-cancel", { note: "旧草稿", color: "red", noteType: "note" });
    const modal = openModal({ draftKey: "cfi-cancel" });
    textareaOf(modal).value = "改成别的";
    (modal as any).discardAndClose();
    expect((modal as any).minimized).toBe(false);
    expect(document.querySelector(".epub-note-float-ball")).toBeNull();
    expect(getNoteDraft("cfi-cancel")).toBeNull();
  });

  it("空内容时 Esc/遮罩关闭：直接真关，不出浮球", () => {
    const modal = openModal({ draftKey: "cfi-empty-close" });
    modal.close();
    expect((modal as any).minimized).toBe(false);
    expect(document.querySelector(".epub-note-float-ball")).toBeNull();
  });

  it("浮球拖动换位（位移大不触发恢复）", () => {
    const modal = openModal({ draftKey: "cfi-drag" });
    textareaOf(modal).value = "测试拖动";
    modal.close();
    const ball = document.querySelector(".epub-note-float-ball") as HTMLElement;
    // happy-dom 无真实布局，stub 浮球当前位置
    ball.getBoundingClientRect = () => ({ left: 100, top: 100 } as DOMRect);
    ball.dispatchEvent(new PointerEvent("pointerdown", { isPrimary: true, pointerId: 1, clientX: 100, clientY: 100, bubbles: true }));
    ball.dispatchEvent(new PointerEvent("pointermove", { isPrimary: true, pointerId: 1, clientX: 300, clientY: 200, bubbles: true }));
    ball.dispatchEvent(new PointerEvent("pointerup", { isPrimary: true, pointerId: 1, clientX: 300, clientY: 200, bubbles: true }));
    // 位移大：仍是浮球状态，位置已更新
    expect((modal as any).minimized).toBe(true);
    expect(ball.style.getPropertyValue("left")).toBe("300px");
    modal.close();
  });
});

describe("resolveDraftAction", () => {
  it("新建批注（无预填）→ 自动恢复", () => {
    expect(resolveDraftAction("", { note: "草稿", color: "red", noteType: "note" })).toBe(
      "auto-restore"
    );
  });
  it("编辑批注且草稿不同 → 提供恢复入口", () => {
    expect(
      resolveDraftAction("原文", { note: "草稿", color: "red", noteType: "note" })
    ).toBe("recover");
  });
  it("草稿与预填一致（取消后原样重开）→ 不提示", () => {
    expect(
      resolveDraftAction("草稿", { note: "草稿", color: "red", noteType: "note" })
    ).toBeNull();
  });
  it("无草稿 → 不提示", () => {
    expect(resolveDraftAction("", null)).toBeNull();
  });
});

describe("note draft persistence (issue #17 需求1)", () => {
  beforeEach(() => {
    clearAllNoteDrafts();
  });

  it("Esc 关闭后草稿被保存（含颜色/类型）", () => {
    const modal = openModal({ draftKey: "cfi-abc" });
    const ta = textareaOf(modal);
    ta.value = "  这是一个未保存的想法  ";
    // 点击颜色与类型，验证快照完整性
    (modal as any).contentEl.querySelector('[data-color="red"]').click();
    (modal as any).contentEl.querySelector('[data-type="question"]').click();
    modal.close();

    expect(getNoteDraft("cfi-abc")).toEqual({
      note: "这是一个未保存的想法",
      color: "red",
      noteType: "question",
    });
  });

  it("重开新建批注时草稿自动恢复并显示提示条", () => {
    saveNoteDraft("cfi-xyz", { note: "上次没写完", color: "green", noteType: "note" });
    const modal = openModal({ draftKey: "cfi-xyz" });
    expect(textareaOf(modal).value).toBe("上次没写完");
    expect((modal as any).contentEl.querySelector(".epub-note-draft-banner")).toBeTruthy();
    modal.close();
  });

  it("编辑模式下保留原文，点恢复按钮才覆盖", () => {
    saveNoteDraft("ann-1", { note: "草稿内容", color: "blue", noteType: "note" });
    const modal = openModal({ note: "原始批注", draftKey: "ann-1" });
    const ta = textareaOf(modal);
    expect(ta.value).toBe("原始批注");
    const btn = (modal as any).contentEl.querySelector(".epub-note-draft-recover-btn");
    expect(btn).toBeTruthy();
    btn.click();
    expect(ta.value).toBe("草稿内容");
    modal.close();
  });

  it("提交成功后草稿被清除，不再误恢复", () => {
    const modal = openModal({ draftKey: "cfi-done" });
    textareaOf(modal).value = "正式内容";
    // 直接调 submit 等价于点保存按钮
    (modal as any).submit(textareaOf(modal));
    expect(getNoteDraft("cfi-done")).toBeNull();
  });

  it("打开后未输入就关闭：不产生草稿", () => {
    const modal = openModal({ draftKey: "cfi-empty" });
    modal.close();
    expect(getNoteDraft("cfi-empty")).toBeNull();
  });

  it("草稿跨实例恢复（模拟插件重载）", () => {
    saveNoteDraft("cfi-reload", { note: "重启前的想法", color: "yellow", noteType: "note" });
    const modal = openModal({ draftKey: "cfi-reload" });
    expect(textareaOf(modal).value).toBe("重启前的想法");
    modal.close();
  });
});

describe("modal dragging (issue #17 需求2)", () => {
  beforeEach(() => {
    clearAllNoteDrafts();
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  });

  it("拖动手柄挂在标题上并标记样式", () => {
    const modal = openModal();
    const h3 = (modal as any).contentEl.querySelector("h3");
    expect(h3.classList.contains("epub-note-modal-drag-handle")).toBe(true);
    modal.close();
  });

  it("拖动改变 modalEl 位置且写入 fixed 定位", () => {
    const modal = openModal();
    const h3 = (modal as any).contentEl.querySelector("h3");
    const modalEl = (modal as any).modalEl as HTMLElement;
    // 模拟 modal 初始居中
    modalEl.getBoundingClientRect = () =>
      ({ left: 400, top: 300, width: 200, height: 200 } as DOMRect);

    dispatchPointer(h3, "pointerdown", { clientX: 420, clientY: 320 });
    dispatchPointer(h3, "pointermove", { clientX: 520, clientY: 380 });
    dispatchPointer(h3, "pointerup", { clientX: 520, clientY: 380 });

    expect(modalEl.classList.contains("epub-note-modal-dragged")).toBe(true);
    // dx=100, dy=60 → 400+100, 300+60（transform 通过 setCssProps 注入）
    expect(modalEl.style.getPropertyValue("transform")).toContain("translate(500px, 360px)");
    modal.close();
  });

  it("拖动被钳制在视口内（不允许拖出屏幕）", () => {
    const modal = openModal();
    const h3 = (modal as any).contentEl.querySelector("h3");
    const modalEl = (modal as any).modalEl as HTMLElement;
    modalEl.getBoundingClientRect = () =>
      ({ left: 400, top: 300, width: 200, height: 200 } as DOMRect);

    dispatchPointer(h3, "pointerdown", { clientX: 420, clientY: 320 });
    // 向右下狂拖 5000px
    dispatchPointer(h3, "pointermove", { clientX: 5420, clientY: 5320 });
    dispatchPointer(h3, "pointerup", { clientX: 5420, clientY: 5320 });

    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(modalEl.style.transform);
    expect(m).toBeTruthy();
    const left = parseFloat(m![1]);
    const top = parseFloat(m![2]);
    // 视口 1000x800，modal 200x200，最小可见 48px
    expect(left).toBeLessThanOrEqual(1000 - 48);
    expect(top).toBeLessThanOrEqual(800 - 48);
    modal.close();
  });

  it("未按下时 pointermove 不产生位移", () => {
    const modal = openModal();
    const h3 = (modal as any).contentEl.querySelector("h3");
    const modalEl = (modal as any).modalEl as HTMLElement;
    dispatchPointer(h3, "pointermove", { clientX: 999, clientY: 999 });
    expect(modalEl.style.getPropertyValue("transform")).toBe("");
    expect(modalEl.classList.contains("epub-note-modal-dragged")).toBe(false);
    modal.close();
  });
});
