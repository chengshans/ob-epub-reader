import { describe, expect, it } from "vitest";
import { TFile, type App } from "obsidian";
import { AnnotationVaultStore } from "../src/AnnotationVaultStore";
import { DEFAULT_SETTINGS, type Annotation } from "../src/types";

const EPUB_SOURCE = "epub-books/demo.epub";
const MD_PATH = "epub-books/anno/《demo》摘录.md";

function mockTFile(path: string): TFile {
  return Object.assign(Object.create(TFile.prototype), { path }) as TFile;
}

function createMockVaultStore(sourceLinkFormat = DEFAULT_SETTINGS.sourceLinkFormat) {
  const files = new Map<string, string>();

  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => (files.has(path) ? mockTFile(path) : null),
      getFileByPath: (path: string) => (files.has(path) ? mockTFile(path) : null),
      getMarkdownFiles: () => [],
      getFiles: () => [],
      createFolder: async () => undefined,
      create: async (path: string, content: string) => {
        files.set(path, content);
        return mockTFile(path);
      },
      read: async (file: TFile) => files.get(file.path) ?? "",
      modify: async (file: TFile, content: string) => {
        files.set(file.path, content);
      },
    },
  } as unknown as App;

  const store = new AnnotationVaultStore(app, {
    ...DEFAULT_SETTINGS,
    sourceLinkFormat,
  });

  return { store, files };
}

function makeAnn(text: string, cfi: string, color: Annotation["color"] = "blue"): Annotation {
  return {
    id: `ann-${text}`,
    cfiRange: cfi,
    text,
    color,
    chapter: "语言的萎缩",
    created: new Date().toISOString(),
  };
}

describe("AnnotationVaultStore.add", () => {
  it("keeps all annotations when adds run concurrently", async () => {
    const { store, files } = createMockVaultStore("wiki-text-alias");
    const cfis = [
      "epubcfi(/6/14!/4/2,/1:0,/1:10)",
      "epubcfi(/6/20!/4/2,/1:0,/1:20)",
      "epubcfi(/6/24!/4/2,/1:0,/1:30)",
    ];

    await Promise.all([
      store.add(EPUB_SOURCE, makeAnn("第一条", cfis[0], "blue")),
      store.add(EPUB_SOURCE, makeAnn("第二条", cfis[1], "blue")),
      store.add(EPUB_SOURCE, makeAnn("第三条", cfis[2], "purple")),
    ]);

    const content = files.get(MD_PATH) ?? "";
    const parsed = store.parseContent(content, EPUB_SOURCE);
    expect(parsed).toHaveLength(3);
    expect(parsed.map((a) => a.text).sort()).toEqual(["第一条", "第三条", "第二条"].sort());
    expect(content.match(/<!-- ob-epub-chapter-body-end -->/g)?.length ?? 0).toBe(1);
    expect(content).toContain("第一条");
    expect(content).toContain("第二条");
    expect(content).toContain("第三条");
  });

  it("accumulates sequential adds", async () => {
    const { store, files } = createMockVaultStore("inline-colored");
    await store.add(
      EPUB_SOURCE,
      makeAnn("句子一", "epubcfi(/6/14!/4/2,/1:0,/1:5)", "blue")
    );
    const afterFirst = files.get(MD_PATH) ?? "";
    const parsedFirst = store.parseContent(afterFirst, EPUB_SOURCE);
    expect(parsedFirst).toHaveLength(1);

    await store.add(
      EPUB_SOURCE,
      makeAnn("句子二", "epubcfi(/6/20!/4/2,/1:0,/1:8)", "purple")
    );

    const parsed = store.parseContent(files.get(MD_PATH) ?? "", EPUB_SOURCE);
    const content = files.get(MD_PATH) ?? "";
    expect(content).toContain("句子一");
    expect(content).toContain("句子二");
    expect(parsed).toHaveLength(2);
  });
});
