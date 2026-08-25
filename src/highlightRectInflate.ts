/**
 * marks-pane 用 Range.getClientRects() 画高亮，高度贴近字形/em 盒；
 * 浏览器 ::selection 也会偏紧。按行高/字号把矩形纵向撑开，并略扩横向。
 */
import { Highlight } from "marks-pane";

declare module "marks-pane" {
  export class Highlight {
    range: Range;
    element: SVGGElement;
    container: HTMLElement;
    render(): void;
  }
}

/** 目标高度占行高比例（留出行间缝，避免相邻高亮糊成一块） */
const LINE_FILL = 0.92;
/** 读不到行高时，相对字形盒的兜底上下余量 */
const FALLBACK_PAD_Y_RATIO = 0.14;
const FALLBACK_PAD_Y_PX = 2;
export const HIGHLIGHT_PAD_X_PX = 1;

let patched = false;

type HighlightLike = {
  range: Range;
  element: SVGGElement;
  render: () => void;
};

export type RectPadOptions = {
  /** 占行高比例，默认 0.92 */
  lineFill?: number;
  /** 相对 font-size 的最低目标高度倍数（选中覆盖层可设 1.5 更饱满） */
  minFontFill?: number;
};

/** 解析失败返回 0 */
function resolveLineHeight(range: Range): number {
  try {
    const node = range.commonAncestorContainer;
    const el =
      node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement;
    const win = el?.ownerDocument?.defaultView;
    if (!el || !win) return 0;
    const cs = win.getComputedStyle(el);
    const lh = cs.lineHeight;
    if (lh === "normal") {
      const fs = parseFloat(cs.fontSize);
      return Number.isFinite(fs) && fs > 0 ? fs * 1.2 : 0;
    }
    const parsed = parseFloat(lh);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function resolveFontSize(range: Range): number {
  try {
    const node = range.commonAncestorContainer;
    const el =
      node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement;
    const win = el?.ownerDocument?.defaultView;
    if (!el || !win) return 0;
    const fs = parseFloat(win.getComputedStyle(el).fontSize);
    return Number.isFinite(fs) && fs > 0 ? fs : 0;
  } catch {
    return 0;
  }
}

function inflatePadY(
  rectHeight: number,
  range: Range,
  opts?: RectPadOptions
): number {
  if (rectHeight <= 0) return 0;
  const lineFill = opts?.lineFill ?? LINE_FILL;
  const minFontFill = opts?.minFontFill ?? 0;
  const lineHeight = resolveLineHeight(range);
  const fontSize = minFontFill > 0 ? resolveFontSize(range) : 0;
  const targetFromLine =
    lineHeight > rectHeight * 1.05 ? lineHeight * lineFill : 0;
  const targetFromFont = fontSize > 0 ? fontSize * minFontFill : 0;
  const targetH = Math.max(rectHeight, targetFromLine, targetFromFont);
  if (targetH > rectHeight) {
    return (targetH - rectHeight) / 2;
  }
  // 读不到行高且无字号兜底时略扩；已接近行高则不再硬撑
  if (lineHeight <= 0 && targetFromFont <= 0) {
    return Math.max(FALLBACK_PAD_Y_PX, rectHeight * FALLBACK_PAD_Y_RATIO);
  }
  return 0;
}

/** 计算高亮/选中矩形的内外边距 */
export function computeRectPad(
  rectHeight: number,
  range: Range,
  opts?: RectPadOptions
): { padX: number; padY: number } {
  return {
    padX: HIGHLIGHT_PAD_X_PX,
    padY: inflatePadY(rectHeight, range, opts),
  };
}

/**
 * 将 client rect 收成与标注高亮一致的盒子。
 * 选中态 getClientRects 常已是整行高，需压到 lineHeight * LINE_FILL，避免行间重叠。
 */
export function fitHighlightRect(
  rect: { left: number; top: number; width: number; height: number },
  range: Range,
  opts?: RectPadOptions
): { left: number; top: number; width: number; height: number } {
  const lineFill = opts?.lineFill ?? LINE_FILL;
  const lineHeight = resolveLineHeight(range);
  const { padX, padY } = computeRectPad(rect.height, range, opts);
  let left = rect.left - padX;
  let top = rect.top - padY;
  let width = rect.width + padX * 2;
  let height = rect.height + padY * 2;

  if (lineHeight > 0) {
    const maxH = lineHeight * lineFill;
    if (height > maxH + 0.5) {
      const inset = (height - maxH) / 2;
      top += inset;
      height = maxH;
    }
  }
  return { left, top, width, height };
}

function inflateRenderedRects(mark: HighlightLike): void {
  const g = mark.element;
  if (!g) return;
  let child = g.firstElementChild;
  while (child) {
    if (child.tagName.toLowerCase() === "rect") {
      const x = parseFloat(child.getAttribute("x") || "0");
      const y = parseFloat(child.getAttribute("y") || "0");
      const w = parseFloat(child.getAttribute("width") || "0");
      const h = parseFloat(child.getAttribute("height") || "0");
      if (w > 0 && h > 0) {
        const { padX, padY } = computeRectPad(h, mark.range);
        child.setAttribute("x", String(x - padX));
        child.setAttribute("y", String(y - padY));
        child.setAttribute("width", String(w + padX * 2));
        child.setAttribute("height", String(h + padY * 2));
      }
    }
    child = child.nextElementSibling;
  }
}

export function applyHighlightRectInflatePatch(): void {
  if (patched) return;
  patched = true;

  const proto = (Highlight as unknown as { prototype: HighlightLike }).prototype;
  const original = proto.render;
  proto.render = function renderWithInflate(this: HighlightLike) {
    original.call(this);
    inflateRenderedRects(this);
  };
}
