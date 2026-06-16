import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { AnnotationVaultStore } from "../src/AnnotationVaultStore";
import {
  EXCERPT_MD_NAME_RE,
  inferEpubPathFromExcerptLocation,
  isDynamicExcerptFolder,
  epubTitlesMatch,
  resolveExcerptFolder,
} from "../src/excerptFolder";
import { DEFAULT_SETTINGS } from "../src/types";

describe("isDynamicExcerptFolder", () => {
  it("detects {filefolder} placeholder", () => {
    expect(isDynamicExcerptFolder("{filefolder}/anno")).toBe(true);
    expect(isDynamicExcerptFolder("epub-books/anno")).toBe(false);
  });
});

describe("resolveExcerptFolder", () => {
  it("resolves {filefolder}/anno from nested epub path", () => {
    expect(resolveExcerptFolder("{filefolder}/anno", "epub-books/小说/demo.epub")).toBe(
      "epub-books/小说/anno"
    );
  });

  it("leaves static path unchanged without epub context", () => {
    expect(resolveExcerptFolder("epub-books/anno", "books/demo.epub")).toBe("epub-books/anno");
  });

  it("resolves root-level epub to anno subfolder", () => {
    expect(resolveExcerptFolder("{filefolder}/anno", "demo.epub")).toBe("anno");
  });

  it("strips trailing slash", () => {
    expect(resolveExcerptFolder("{filefolder}/anno/", "books/demo.epub")).toBe("books/anno");
  });
});

describe("EXCERPT_MD_NAME_RE", () => {
  it("matches plugin excerpt filenames", () => {
    expect(EXCERPT_MD_NAME_RE.test("《demo》摘录.md")).toBe(true);
    expect(EXCERPT_MD_NAME_RE.test("notes.md")).toBe(false);
  });
});

describe("epubTitlesMatch", () => {
  it("ignores trailing space before extension in epub basename", () => {
    expect(epubTitlesMatch("苦论 (E.M.齐奥朗)", "苦论 (E.M.齐奥朗) ")).toBe(true);
  });
});

describe("inferEpubPathFromExcerptLocation", () => {
  it("infers epub from dynamic excerpt path", () => {
    expect(
      inferEpubPathFromExcerptLocation(
        "epub-books/小说/anno/《demo》摘录.md",
        "{filefolder}/anno"
      )
    ).toBe("epub-books/小说/demo.epub");
  });

  it("returns null for static excerpt folder template", () => {
    expect(
      inferEpubPathFromExcerptLocation("epub-books/anno/《demo》摘录.md", "epub-books/anno")
    ).toBeNull();
  });

  it("returns null when excerpt path does not match template suffix", () => {
    expect(
      inferEpubPathFromExcerptLocation("epub-books/notes/《demo》摘录.md", "{filefolder}/anno")
    ).toBeNull();
  });
});

describe("AnnotationVaultStore.getAnnotationFilePath", () => {
  it("builds dynamic excerpt path", () => {
    const store = new AnnotationVaultStore({} as App, {
      ...DEFAULT_SETTINGS,
      excerptFolder: "{filefolder}/anno",
    });
    expect(store.getAnnotationFilePath("epub-books/小说/demo.epub")).toBe(
      "epub-books/小说/anno/《demo》摘录.md"
    );
  });

  it("builds static excerpt path", () => {
    const store = new AnnotationVaultStore({} as App, {
      ...DEFAULT_SETTINGS,
      excerptFolder: "epub-books/anno",
    });
    expect(store.getAnnotationFilePath("books/demo.epub")).toBe(
      "epub-books/anno/《demo》摘录.md"
    );
  });
});
