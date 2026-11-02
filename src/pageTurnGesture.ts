export type PageTurnGesture = "prev" | "next" | null;
export type TouchGestureKind = "swipe" | "tap" | null;

export interface TouchGestureResult {
  direction: PageTurnGesture;
  kind: TouchGestureKind;
}

export interface TouchGestureInput {
  /**
   * 坐标必须是「可视页坐标系」：原点在可视区域左上角，viewportWidth = 可视页宽。
   * 分页模式下 epub.js 的章节 iframe 比可视页宽得多（宽 = 页宽 × 页数）并用容器
   * scrollLeft 平移，若直接传 iframe 内的 clientX / win.innerWidth，左右边缘判定
   * 会随滚动位置漂移，导致点击忽而翻页、忽而反向。
   */
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  elapsedMs: number;
  viewportWidth: number;
  /** 从右往左排版的书籍（page-progression-direction=rtl） */
  rtl?: boolean;
}

/** 点击左右边缘翻页的判定宽度占比 */
export const PAGE_TAP_EDGE_RATIO = 0.12;
const TAP_MAX_MOVE = 12;
const TAP_MAX_MS = 500;
const SWIPE_MIN_DISTANCE = 48;
const SWIPE_MAX_MS = 800;
const SWIPE_AXIS_RATIO = 1.2;

/**
 * 触屏手势 → 翻页方向。
 * 横向滑动优先；其次判定轻触左右边缘。垂直滑动、拖选、长按均返回 null。
 */
export function resolveTouchPageTurn(input: TouchGestureInput): PageTurnGesture {
  return classifyTouchGesture(input).direction;
}

export function classifyTouchGesture(input: TouchGestureInput): TouchGestureResult {
  const dx = input.endX - input.startX;
  const dy = input.endY - input.startY;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (
    input.elapsedMs <= SWIPE_MAX_MS &&
    absX >= SWIPE_MIN_DISTANCE &&
    absX > absY * SWIPE_AXIS_RATIO
  ) {
    const forward = dx < 0 ? "next" : "prev";
    return { direction: input.rtl ? flip(forward) : forward, kind: "swipe" };
  }

  if (input.elapsedMs > TAP_MAX_MS || absX > TAP_MAX_MOVE || absY > TAP_MAX_MOVE) {
    return { direction: null, kind: null };
  }
  if (input.viewportWidth <= 0) return { direction: null, kind: null };

  const ratio = input.endX / input.viewportWidth;
  if (ratio <= PAGE_TAP_EDGE_RATIO) {
    return { direction: input.rtl ? "next" : "prev", kind: "tap" };
  }
  if (ratio >= 1 - PAGE_TAP_EDGE_RATIO) {
    return { direction: input.rtl ? "prev" : "next", kind: "tap" };
  }
  return { direction: null, kind: null };
}

function flip(dir: Exclude<PageTurnGesture, null>): Exclude<PageTurnGesture, null> {
  return dir === "next" ? "prev" : "next";
}
