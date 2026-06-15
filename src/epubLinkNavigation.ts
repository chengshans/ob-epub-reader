import { App, parseLinktext, TFile } from "obsidian";
import { parseWikiEpubLinkText } from "./epubSubpath";
import { EPUB_READER_VIEW_TYPE, EpubReaderView } from "./EpubReaderView";

type OpenLinkTextFn = (
  linktext: string,
  sourcePath: string,
  newLeaf?: boolean | string,
  openViewState?: Record<string, unknown>
) => Promise<void>;

/** Intercept `[[book.epub#cfi=...]]` wiki links and open the EPUB reader at CFI. */
export function patchEpubWikiLinkNavigation(
  app: App,
  openAtCfi: (filePath: string, cfi: string) => Promise<void>
): () => void {
  const original = app.workspace.openLinkText.bind(app.workspace) as OpenLinkTextFn;

  app.workspace.openLinkText = async (
    linktext: string,
    sourcePath: string,
    newLeaf?: boolean | string,
    openViewState?: Record<string, unknown>
  ): Promise<void> => {
    const resolveEpub = (path: string): string | null => {
      const file = app.metadataCache.getFirstLinkpathDest(path, sourcePath);
      return file instanceof TFile && file.extension === "epub" ? file.path : null;
    };

    let wiki = parseWikiEpubLinkText(linktext, resolveEpub);

    if (!wiki) {
      const { path, subpath } = parseLinktext(linktext);
      if (path && subpath?.includes("cfi=")) {
        const combined = `${path}${subpath.startsWith("#") ? subpath : `#${subpath}`}`;
        wiki = parseWikiEpubLinkText(combined, resolveEpub);
      }
    }

    if (wiki?.cfi) {
      const existingLeaf = app.workspace
        .getLeavesOfType(EPUB_READER_VIEW_TYPE)
        .find((leaf) => (leaf.view as EpubReaderView).file?.path === wiki.file);

      if (existingLeaf) {
        await app.workspace.revealLeaf(existingLeaf);
        await (existingLeaf.view as EpubReaderView).navigateToCfi(wiki.cfi);
        return;
      }

      await openAtCfi(wiki.file, wiki.cfi);
      return;
    }

    await original(linktext, sourcePath, newLeaf, openViewState);
  };

  return () => {
    app.workspace.openLinkText = original;
  };
}
