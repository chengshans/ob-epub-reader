import { describe, expect, it } from "vitest";
import {
  PAGE_TAP_EDGE_RATIO,
  resolveTouchPageTurn,
} from "../src/pageTurnGesture";

/**
 * 分页模式点击边缘翻页「来回跳动」回归验证（issue #10 / fix 9766459）。
 *
 * epub.js 分页模式几何（见 node_modules/epubjs/lib/managers/views/iframe.js
 * 的 expand() 与 default/index.js 的 scrollTo）：
 * - 章节 iframe 元素宽度 = 页宽 × 章节页数 N；
 * - 翻页靠宿主容器 scrollLeft 平移，第 k 页时 scrollLeft = k × 页宽；
 * - iframe 内 clientX = k × 页宽 + f × 页宽（f 为可视页内位置 0..1）；
 * - iframe 内 win.innerWidth = 页宽 × N。
 *
 * v1.3.42 旧实现把 iframe 内坐标直接喂给 classifyTouchGesture：
 *   ratio = (k + f) / N，随当前页 k 漂移 —— 长章节首页整页被判为左边缘、
 *   末页右半区被判为右边缘；在章节边界反复点击同一物理位置于是出现
 *   「前进一页又退一页」的无限跳动（issue #10 视频）。
 * v1.3.43 新实现先换算到可视页坐标系（getTouchViewport）：
 *   endX = viewport.left + clientX = f × 页宽，viewportWidth = 可视页宽，
 *   ratio = f，与当前页无关。
 */

const PAGE_WIDTH = 1000;

interface ChapterGeometry {
  /** 章节总页数 N */
  pages: number;
  /** 当前页下标 k */
  page: number;
}

/** v1.3.42 旧映射：iframe 内 clientX + win.innerWidth，原样喂给判定函数 */
function classifyOld(geo: ChapterGeometry, visibleFraction: number) {
  const clientX = (geo.page + visibleFraction) * PAGE_WIDTH;
  return resolveTouchPageTurn({
    startX: clientX,
    startY: 500,
    endX: clientX,
    endY: 500,
    elapsedMs: 80,
    viewportWidth: geo.pages * PAGE_WIDTH,
  });
}

/** v1.3.43 新映射：getTouchViewport 换算后的可视页坐标 */
function classifyNew(geo: ChapterGeometry, visibleFraction: number) {
  // viewport.left = frameRect.left - area.left = -(k × 页宽)（iframe 随容器左移）
  const viewportLeft = -geo.page * PAGE_WIDTH;
  const clientX = (geo.page + visibleFraction) * PAGE_WIDTH;
  return resolveTouchPageTurn({
    startX: viewportLeft + clientX,
    startY: 500,
    endX: viewportLeft + clientX,
    endY: 500,
    elapsedMs: 80,
    viewportWidth: PAGE_WIDTH,
  });
}

describe("分页模式边缘轻触坐标映射（issue #10 回归）", () => {
  const longChapter = { pages: 9, page: 0 };
  const prevChapterLastPage = { pages: 3, page: 2 };

  it("旧映射复现 bug：长章节首页点右边缘被判为 prev（回跳）", () => {
    expect(classifyOld(longChapter, 0.95)).toBe("prev");
  });

  it("旧映射复现 bug：上一章末页同一点击被判为 next（又前进）→ 来回跳动", () => {
    expect(classifyOld(prevChapterLastPage, 0.95)).toBe("next");
  });

  it("旧映射复现 bug：判定结果随当前页漂移（同一可视位置各页不一致）", () => {
    const results = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) =>
      classifyOld({ pages: 9, page: k }, 0.95)
    );
    // 有的页 null、有的页 prev、有的页 next —— 即用户看到的忽而翻页忽而反向
    expect(new Set(results).size).toBeGreaterThan(1);
  });

  it("新映射：任意页点击右边缘一律 next，与当前页无关", () => {
    for (let k = 0; k < 9; k++) {
      expect(classifyNew({ pages: 9, page: k }, 0.95)).toBe("next");
    }
  });

  it("新映射：任意页点击左边缘一律 prev，中间一律不翻页", () => {
    for (let k = 0; k < 9; k++) {
      expect(classifyNew({ pages: 9, page: k }, 0.05)).toBe("prev");
      expect(classifyNew({ pages: 9, page: k }, 0.5)).toBeNull();
    }
  });

  it("新映射：边缘阈值仍为 PAGE_TAP_EDGE_RATIO", () => {
    const geo = { pages: 9, page: 4 };
    expect(classifyNew(geo, PAGE_TAP_EDGE_RATIO - 0.01)).toBe("prev");
    expect(classifyNew(geo, 1 - PAGE_TAP_EDGE_RATIO + 0.01)).toBe("next");
    expect(classifyNew(geo, PAGE_TAP_EDGE_RATIO + 0.01)).toBeNull();
  });
});
