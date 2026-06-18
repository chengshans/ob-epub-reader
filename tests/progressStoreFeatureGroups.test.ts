import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { AnnotationVaultStore } from "../src/AnnotationVaultStore";
import { ProgressStore } from "../src/ProgressStore";
import { DEFAULT_SETTINGS } from "../src/types";

const EPUB_PATH = "books/demo.epub";
const CFI = "epubcfi(/6/4!/4/2,/1:0,/1:5)";

function createProgressStore(annotationsEnabled: boolean) {
  let pluginProgress: Record<string, unknown> = {};
  const writeProgress = vi.fn(async () => undefined);

  const annotationVaultStore = {
    updateSettings: vi.fn(),
    scanAllProgress: vi.fn(async () => ({})),
    readProgress: vi.fn(async () => null),
    writeProgress,
    getAnnotationFilePath: (p: string) => `anno/${p}.md`,
  } as unknown as AnnotationVaultStore;

  const app = {
    vault: {
      adapter: {
        exists: async () => false,
        read: async () => "",
      },
      getAbstractFileByPath: () => null,
    },
  } as unknown as App;

  const settings = {
    ...DEFAULT_SETTINGS,
    featureGroups: {
      annotationsAndExcerpts: annotationsEnabled,
      bookshelf: true,
    },
  };

  const store = new ProgressStore(app, settings, annotationVaultStore, {
    loadPluginProgress: async () => pluginProgress as never,
    savePluginProgress: async (progress) => {
      pluginProgress = { ...progress };
    },
  });

  return { store, writeProgress, getPluginProgress: () => pluginProgress };
}

describe("ProgressStore feature groups", () => {
  it("saveProgress writes to plugin data when annotations group is off", async () => {
    const { store, writeProgress, getPluginProgress } = createProgressStore(false);

    await store.saveProgress(EPUB_PATH, CFI, "第一章", 0.25);

    expect(writeProgress).not.toHaveBeenCalled();
    expect(getPluginProgress()[EPUB_PATH]).toMatchObject({
      chapter: "第一章",
      percent: 0.25,
    });
  });

  it("saveProgress writes excerpt frontmatter when annotations group is on", async () => {
    const { store, writeProgress } = createProgressStore(true);

    await store.saveProgress(EPUB_PATH, CFI, "第一章", 0.25);

    expect(writeProgress).toHaveBeenCalledTimes(1);
    expect(writeProgress).toHaveBeenCalledWith(
      EPUB_PATH,
      expect.objectContaining({
        chapter: "第一章",
        percent: 0.25,
        cfi: CFI,
      })
    );
  });

  it("syncProgressToExcerpts writes all in-memory progress", async () => {
    const { store, writeProgress } = createProgressStore(true);

    await store.saveProgress(EPUB_PATH, CFI, "第一章", 0.25);
    writeProgress.mockClear();

    await store.syncProgressToExcerpts();

    expect(writeProgress).toHaveBeenCalledWith(
      EPUB_PATH,
      expect.objectContaining({ chapter: "第一章" })
    );
  });
});

describe("AnnotationVaultStore guards", () => {
  it("skips add when annotations group is off", async () => {
    const createCalled = vi.fn();
    const app = {
      vault: {
        getAbstractFileByPath: () => null,
        getFileByPath: () => null,
        getMarkdownFiles: () => [],
        getFiles: () => [],
        createFolder: async () => undefined,
        create: createCalled,
        read: async () => "",
        modify: async () => undefined,
      },
    } as unknown as App;

    const store = new AnnotationVaultStore(app, {
      ...DEFAULT_SETTINGS,
      featureGroups: { annotationsAndExcerpts: false, bookshelf: true },
    });

    await store.add(EPUB_PATH, {
      id: "ann-1",
      cfiRange: CFI,
      text: "test",
      color: "yellow",
      chapter: "ch",
      created: new Date().toISOString(),
    });

    expect(createCalled).not.toHaveBeenCalled();
  });
});
