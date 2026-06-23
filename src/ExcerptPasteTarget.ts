import {
  App,
  EditorPosition,
  MarkdownView,
  Notice,
  Plugin,
  WorkspaceLeaf,
} from "obsidian";
import { t } from "./i18n/i18n";

export type ExcerptInsertReason = "no-target" | "preview-mode";

export interface ExcerptInsertResult {
  inserted: boolean;
  reason?: ExcerptInsertReason;
  fileDisplayName?: string;
}

export interface MarkdownEditorContext {
  getLine(line: number): string;
}

export function formatExcerptInsertSnippet(
  markdown: string,
  pos: EditorPosition,
  editor: MarkdownEditorContext
): string {
  const body = markdown.trimEnd();
  const line = editor.getLine(pos.line);
  const needsLeading =
    pos.line > 0 && (pos.ch > 0 || line.slice(0, pos.ch).trim() !== "");
  return `${needsLeading ? "\n\n" : ""}${body}\n\n`;
}

function offsetCursor(pos: EditorPosition, text: string): EditorPosition {
  const lines = text.split("\n");
  if (lines.length === 1) {
    return { line: pos.line, ch: pos.ch + text.length };
  }
  const lastLine = lines[lines.length - 1] ?? "";
  return { line: pos.line + lines.length - 1, ch: lastLine.length };
}

function clonePosition(pos: EditorPosition): EditorPosition {
  return { line: pos.line, ch: pos.ch };
}

interface TrackedTarget {
  leafId: string;
  filePath: string;
  cursor: EditorPosition;
}

interface ResolvedMarkdownTarget {
  leaf: WorkspaceLeaf;
  view: MarkdownView;
  cursor: EditorPosition;
}

export class ExcerptPasteTarget {
  private tracked: TrackedTarget | null = null;
  private previousLeaf: WorkspaceLeaf | null = null;

  constructor(private readonly app: App) {}

  register(plugin: Plugin): void {
    plugin.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (this.previousLeaf) {
          this.snapshotMarkdownLeaf(this.previousLeaf);
        }
        this.previousLeaf = leaf;
        if (leaf) {
          this.snapshotMarkdownLeaf(leaf);
        }
      })
    );

    plugin.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        if (!(info instanceof MarkdownView)) return;
        const file = info.file;
        if (!file) return;
        this.tracked = {
          leafId: info.leaf.id,
          filePath: file.path,
          cursor: clonePosition(editor.getCursor()),
        };
      })
    );

    plugin.registerDomEvent(
      document,
      "mousedown",
      (evt) => {
        const target = evt.target;
        if (!(target instanceof Node)) return;
        for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
          const view = leaf.view;
          if (!(view instanceof MarkdownView)) continue;
          if (!view.containerEl.contains(target)) continue;
          this.scheduleSnapshot(leaf);
          return;
        }
      },
      { capture: true }
    );

    plugin.registerDomEvent(document, "keyup", (evt) => {
      const target = evt.target;
      if (!(target instanceof Node)) return;
      for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
        const view = leaf.view;
        if (!(view instanceof MarkdownView)) continue;
        if (!view.containerEl.contains(target)) continue;
        this.scheduleSnapshot(leaf);
        return;
      }
    });
  }

  private scheduleSnapshot(leaf: WorkspaceLeaf): void {
    requestAnimationFrame(() => {
      this.snapshotMarkdownLeaf(leaf);
    });
  }

  async insertExcerptMarkdown(markdown: string): Promise<ExcerptInsertResult> {
    const resolved = await this.resolveTarget();
    if (!resolved) {
      return { inserted: false, reason: "no-target" };
    }

    const { leaf, view, cursor } = resolved;
    const file = view.file;
    if (!file) {
      return { inserted: false, reason: "no-target" };
    }

    if (view.getMode() === "preview") {
      return {
        inserted: false,
        reason: "preview-mode",
        fileDisplayName: file.basename,
      };
    }

    const editor = view.editor;
    const insertStart = clonePosition(cursor);
    const text = formatExcerptInsertSnippet(markdown, cursor, editor);
    editor.replaceRange(text, cursor, cursor, "ob-epub-excerpt");

    const insertEnd = offsetCursor(insertStart, text.trimEnd());
    editor.setSelection(insertStart, insertEnd);
    editor.scrollIntoView({ from: insertStart, to: insertEnd }, true);

    this.tracked = {
      leafId: leaf.id,
      filePath: file.path,
      cursor: offsetCursor(insertStart, text),
    };

    return {
      inserted: true,
      fileDisplayName: file.basename,
    };
  }

  private snapshotMarkdownLeaf(leaf: WorkspaceLeaf): void {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    const file = view.file;
    if (!file) return;
    this.tracked = {
      leafId: leaf.id,
      filePath: file.path,
      cursor: clonePosition(view.editor.getCursor()),
    };
  }

  private async resolveTarget(): Promise<ResolvedMarkdownTarget | null> {
    const tracked = this.tracked;
    if (tracked) {
      const leafById = this.app.workspace.getLeafById(tracked.leafId);
      if (leafById) {
        const view = await this.getMarkdownView(leafById);
        if (view?.file?.path === tracked.filePath) {
          return {
            leaf: leafById,
            view,
            cursor: clonePosition(tracked.cursor),
          };
        }
      }

      for (const leaf of this.getVisibleMarkdownLeaves()) {
        const view = await this.getMarkdownView(leaf);
        if (view?.file?.path === tracked.filePath) {
          return {
            leaf,
            view,
            cursor: clonePosition(tracked.cursor),
          };
        }
      }
    }

    const candidates = this.getVisibleMarkdownLeaves();
    if (candidates.length !== 1) return null;

    const leaf = candidates[0];
    const view = await this.getMarkdownView(leaf);
    if (!view?.file) return null;

    if (leaf !== this.app.workspace.activeLeaf) return null;

    return {
      leaf,
      view,
      cursor: view.editor.getCursor(),
    };
  }

  private async getMarkdownView(leaf: WorkspaceLeaf): Promise<MarkdownView | null> {
    if (leaf.isDeferred) {
      await leaf.loadIfDeferred();
    }
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return null;
    return view;
  }

  private getVisibleMarkdownLeaves(): WorkspaceLeaf[] {
    return this.app.workspace
      .getLeavesOfType("markdown")
      .filter((leaf) => leaf.containerEl.isShown());
  }
}

export function registerExcerptPasteTarget(plugin: Plugin): ExcerptPasteTarget {
  const target = new ExcerptPasteTarget(plugin.app);
  target.register(plugin);
  return target;
}

export function noticeExcerptCopy(insert: ExcerptInsertResult | undefined): void {
  if (insert?.inserted && insert.fileDisplayName) {
    new Notice(t("notice.insertedAndCopied", { name: insert.fileDisplayName }));
    return;
  }
  if (insert?.reason === "preview-mode") {
    new Notice(t("notice.readingModeCopied"));
    return;
  }
  new Notice(t("notice.copiedExcerpt"));
}
