import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  normalizeFeatureGroups,
  isAnnotationsAndExcerptsEnabled,
  isBookshelfEnabled,
} from "../src/types";

describe("normalizeFeatureGroups", () => {
  it("defaults both groups to enabled", () => {
    expect(normalizeFeatureGroups()).toEqual({
      annotationsAndExcerpts: true,
      bookshelf: true,
      readerCollapsed: false,
      annotationsCollapsed: false,
      bookshelfCollapsed: false,
    });
    expect(normalizeFeatureGroups({})).toEqual({
      annotationsAndExcerpts: true,
      bookshelf: true,
      readerCollapsed: false,
      annotationsCollapsed: false,
      bookshelfCollapsed: false,
    });
  });

  it("respects explicit false", () => {
    expect(
      normalizeFeatureGroups({
        annotationsAndExcerpts: false,
        bookshelf: false,
      })
    ).toEqual({
      annotationsAndExcerpts: false,
      bookshelf: false,
      readerCollapsed: false,
      annotationsCollapsed: false,
      bookshelfCollapsed: false,
    });
  });
});

describe("feature group helpers", () => {
  it("isAnnotationsAndExcerptsEnabled reflects settings", () => {
    const on = {
      ...DEFAULT_SETTINGS,
      featureGroups: { annotationsAndExcerpts: true, bookshelf: true },
    };
    const off = {
      ...DEFAULT_SETTINGS,
      featureGroups: { annotationsAndExcerpts: false, bookshelf: true },
    };
    expect(isAnnotationsAndExcerptsEnabled(on)).toBe(true);
    expect(isAnnotationsAndExcerptsEnabled(off)).toBe(false);
  });

  it("isBookshelfEnabled reflects settings", () => {
    const on = {
      ...DEFAULT_SETTINGS,
      featureGroups: { annotationsAndExcerpts: true, bookshelf: true },
    };
    const off = {
      ...DEFAULT_SETTINGS,
      featureGroups: { annotationsAndExcerpts: true, bookshelf: false },
    };
    expect(isBookshelfEnabled(on)).toBe(true);
    expect(isBookshelfEnabled(off)).toBe(false);
  });
});
