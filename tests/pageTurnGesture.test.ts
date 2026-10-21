import { describe, expect, it } from "vitest";
import { PAGE_TAP_EDGE_RATIO, resolveTouchPageTurn } from "../src/pageTurnGesture";

const width = 1000;

function tap(x: number, y = 500) {
  return resolveTouchPageTurn({
    startX: x,
    startY: y,
    endX: x,
    endY: y,
    elapsedMs: 80,
    viewportWidth: width,
  });
}

describe("resolveTouchPageTurn tap zones", () => {
  it("turns pages when tapping the left/right edges", () => {
    expect(tap(width * PAGE_TAP_EDGE_RATIO - 1)).toBe("prev");
    expect(tap(width * (1 - PAGE_TAP_EDGE_RATIO) + 1)).toBe("next");
  });

  it("ignores taps in the middle of the page", () => {
    expect(tap(width / 2)).toBeNull();
    expect(tap(width * PAGE_TAP_EDGE_RATIO + 1)).toBeNull();
  });

  it("ignores long presses and drags", () => {
    expect(
      resolveTouchPageTurn({
        startX: 10,
        startY: 500,
        endX: 10,
        endY: 500,
        elapsedMs: 900,
        viewportWidth: width,
      })
    ).toBeNull();
    expect(
      resolveTouchPageTurn({
        startX: 10,
        startY: 500,
        endX: 40,
        endY: 500,
        elapsedMs: 100,
        viewportWidth: width,
      })
    ).toBeNull();
  });
});

describe("resolveTouchPageTurn swipe", () => {
  it("turns page on horizontal swipes", () => {
    expect(
      resolveTouchPageTurn({
        startX: 800,
        startY: 500,
        endX: 600,
        endY: 510,
        elapsedMs: 200,
        viewportWidth: width,
      })
    ).toBe("next");
    expect(
      resolveTouchPageTurn({
        startX: 200,
        startY: 500,
        endX: 400,
        endY: 500,
        elapsedMs: 200,
        viewportWidth: width,
      })
    ).toBe("prev");
  });

  it("ignores short, slow or mostly vertical swipes", () => {
    const base = {
      startX: 800,
      startY: 500,
      viewportWidth: width,
    };
    expect(
      resolveTouchPageTurn({ ...base, endX: 780, endY: 500, elapsedMs: 200 })
    ).toBeNull();
    expect(
      resolveTouchPageTurn({ ...base, endX: 600, endY: 500, elapsedMs: 1200 })
    ).toBeNull();
    expect(
      resolveTouchPageTurn({ ...base, endX: 700, endY: 200, elapsedMs: 200 })
    ).toBeNull();
  });

  it("ignores gestures without a viewport", () => {
    expect(
      resolveTouchPageTurn({
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0,
        elapsedMs: 50,
        viewportWidth: 0,
      })
    ).toBeNull();
  });
});

describe("resolveTouchPageTurn RTL", () => {
  it("reverses tap zones and swipe direction for right-to-left books", () => {
    expect(
      resolveTouchPageTurn({
        startX: 5,
        startY: 100,
        endX: 5,
        endY: 100,
        elapsedMs: 80,
        viewportWidth: width,
        rtl: true,
      })
    ).toBe("next");
    expect(
      resolveTouchPageTurn({
        startX: width - 5,
        startY: 100,
        endX: width - 5,
        endY: 100,
        elapsedMs: 80,
        viewportWidth: width,
        rtl: true,
      })
    ).toBe("prev");
    expect(
      resolveTouchPageTurn({
        startX: 200,
        startY: 500,
        endX: 400,
        endY: 500,
        elapsedMs: 200,
        viewportWidth: width,
        rtl: true,
      })
    ).toBe("next");
  });
});
