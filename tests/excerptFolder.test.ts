import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { AnnotationVaultStore } from "../src/AnnotationVaultStore";
import {
  buildLooseExcerptNameRegex,
  collapseDuplicateTitleMarks,
  inferEpubPathFromExcerptLocation,
  isDynamicExcerptFolder,
  epubTitlesMatch,
  resolveExcerptFilename,
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

describe("buildLooseExcerptNameRegex", () => {
  it("matches default excerpt filenames", () => {
    const re = buildLooseExcerptNameRegex("《{title}》摘录.md");
    expect(re.test("《demo》摘录.md")).toBe(true);
    expect(re.test("notes.md")).toBe(false);
  });

  it("matches custom excerpt filenames", () => {
    const re = buildLooseExcerptNameRegex("{title}-notes.md");
    expect(re.test("demo-notes.md")).toBe(true);
    expect(re.test("《demo》摘录.md")).toBe(false);
  });

  it("matches {filenameNoExt} templates", () => {
    const re = buildLooseExcerptNameRegex("{filenameNoExt}-notes.md");
    expect(re.test("demo-notes.md")).toBe(true);
    expect(re.test("demo.epub-notes.md")).toBe(true);
  });
});

describe("resolveExcerptFilename", () => {
  it("resolves default template", () => {
    expect(resolveExcerptFilename("《{title}》摘录.md", "books/demo.epub")).toBe(
      "《demo》摘录.md"
    );
  });

  it("resolves {filename} placeholder", () => {
    expect(resolveExcerptFilename("{filename}.notes.md", "books/demo.epub")).toBe(
      "demo.epub.notes.md"
    );
  });

  it("resolves {filenameNoExt} placeholder", () => {
    expect(resolveExcerptFilename("{filenameNoExt}.notes.md", "books/demo.epub")).toBe(
      "demo.notes.md"
    );
  });

  it("collapses duplicate title marks when the book title already has them", () => {
    expect(resolveExcerptFilename("《{title}》摘录.md", "books/《国富论》.epub")).toBe(
      "《国富论》摘录.md"
    );
    expect(resolveExcerptFilename("{title}摘录.md", "books/《国富论》.epub")).toBe(
      "《国富论》摘录.md"
    );
  });

  it("can resolve the legacy (pre-dedupe) filename for migration", () => {
    expect(
      resolveExcerptFilename("《{title}》摘录.md", "books/《国富论》.epub", {
        dedupeTitleMarks: false,
      })
    ).toBe("《《国富论》》摘录.md");
  });
});

describe("collapseDuplicateTitleMarks", () => {
  it("collapses 《《…》》 and locale variants to one layer", () => {
    expect(collapseDuplicateTitleMarks("# 《《国富论》》摘录")).toBe("# 《国富论》摘录");
    expect(collapseDuplicateTitleMarks("# 「「吾輩は猫である」」抜粋")).toBe(
      "# 「吾輩は猫である」抜粋"
    );
    expect(collapseDuplicateTitleMarks("# 《国富论》摘录")).toBe("# 《国富论》摘录");
  });
});

describe("epubTitlesMatch", () => {
  it("ignores trailing space before extension in epub basename", () => {
    expect(epubTitlesMatch("苦论 (E.M.齐奥朗)", "苦论 (E.M.齐奥朗) ")).toBe(true);
  });

  it("ignores wrapping title marks", () => {
    expect(epubTitlesMatch("《国富论》", "国富论")).toBe(true);
    expect(epubTitlesMatch("「吾輩は猫である」", "吾輩は猫である")).toBe(true);
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

  it("infers epub from custom filename template", () => {
    expect(
      inferEpubPathFromExcerptLocation(
        "epub-books/小说/anno/demo-notes.md",
        "{filefolder}/anno",
        "{title}-notes.md"
      )
    ).toBe("epub-books/小说/demo.epub");
  });

  it("infers epub from {filenameNoExt} template", () => {
    expect(
      inferEpubPathFromExcerptLocation(
        "epub-books/小说/anno/demo-notes.md",
        "{filefolder}/anno",
        "{filenameNoExt}-notes.md"
      )
    ).toBe("epub-books/小说/demo.epub");
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

  it("uses custom filename template", () => {
    const store = new AnnotationVaultStore({} as App, {
      ...DEFAULT_SETTINGS,
      excerptFolder: "epub-books/anno",
      excerptFilename: "{title}-notes.md",
    });
    expect(store.getAnnotationFilePath("books/demo.epub")).toBe(
      "epub-books/anno/demo-notes.md"
    );
  });
});
