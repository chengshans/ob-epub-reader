import { App, normalizePath, TFile } from "obsidian";
import { Annotation, EpubPluginSettings, HighlightColor, HIGHLIGHT_COLORS } from "./types";

// ── Block format written to 《书名》摘录.md ───────────────────────────────
//
// > [!ob-epub|yellow] 第三章 · 2026-05-23 18:15 ^ann-abc123
// > 原文内容第一行
// > 原文内容第二行
//
// 可选的想法文字
//
// [回到原文](obsidian://ob-epub-goto?file=...&cfi=...)
//
// ---
//
// ─────────────────────────────────────────────────────────────────────────────

const CALLOUT_PREFIX = "ob-epub";

// Old annotation shape from plugin data.json (before migration)
interface OldAnnotation {
  id: string;
  cfiRange: string;
  text: string;
  color: HighlightColor;
  note?: string;
  chapter: string;
  created: string;
}

export class AnnotationVaultStore {
  private app: App;
  private settings: EpubPluginSettings;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private watchPausedUntil = 0;

  constructor(app: App, settings: EpubPluginSettings) {
    this.app = app;
    this.settings = settings;
  }

  updateSettings(settings: EpubPluginSettings) {
    this.settings = settings;
  }

  /** Suppress file-watcher callbacks triggered by our own vault writes. */
  private pauseWatch(ms = 900) {
    this.watchPausedUntil = Date.now() + ms;
  }

  private isWatchPaused(): boolean {
    return Date.now() < this.watchPausedUntil;
  }

  /** Extract CFI from a markdown annotation chunk. */
  private extractCfiFromChunk(text: string): string | null {
    const linkMatch = text.match(
      /\[回到原文\]\(\s*<?obsidian:\/\/ob-epub-goto\?([^)>]*)\)?>?/
    );
    if (linkMatch) {
      try {
        const query = linkMatch[1].replace(/>$/, "");
        const params = new URLSearchParams(query);
        const cfi = params.get("cfi");
        if (cfi) return cfi;
      } catch {
        /* fall through */
      }
    }

    const raw = text.match(/cfi=(epubcfi\([^)\s\n]+(?:,[^)\s\n]+)*\))/);
    if (raw) {
      try {
        return decodeURIComponent(raw[1]);
      } catch {
        return raw[1];
      }
    }
    return null;
  }

  // ── Path helpers ──────────────────────────────────────────────────────────

  private getAnnotationFilePath(epubFilePath: string): string {
    const folder = this.settings.excerptFolder.replace(/\/$/, "");
    const basename = epubFilePath.split("/").pop() ?? epubFilePath;
    const title = basename.replace(/\.epub$/i, "");
    return normalizePath(`${folder}/《${title}》摘录.md`);
  }

  private formatDate(date: Date): string {
    return date.toISOString().replace("T", " ").slice(0, 16);
  }

  /** Build obsidian:// deep-link; URLSearchParams handles encoding, no angle brackets. */
  private buildSourceLink(epubFilePath: string, cfiRange: string): string {
    const params = new URLSearchParams();
    params.set("file", epubFilePath);
    if (cfiRange) params.set("cfi", cfiRange);
    const url = `obsidian://ob-epub-goto?${params.toString()}`;
    // Do NOT wrap in <…>: Obsidian treats the leading '<' as part of the URI (%3C) and fails to open.
    return `[回到原文](${url})`;
  }

  /** Strip legacy angle-bracket wrappers and other broken link syntax. */
  fixLegacyGotoLinksInContent(content: string, epubSource?: string): string {
    let result = content.replace(
      /\[回到原文\]\(<(obsidian:\/\/ob-epub-goto\?[^>]+)>\)/g,
      "[回到原文]($1)"
    );
    // Trailing ">" left from old <…> links: [回到原文](obsidian://...>)
    result = result.replace(
      /\[回到原文\]\((obsidian:\/\/ob-epub-goto\?[^)\n]+)\)>/g,
      "[回到原文]($1)"
    );

    if (epubSource) {
      result = this.repairBrokenGotoLines(result, epubSource);
    }
    return result;
  }

  /** Repair bare ".epub&cfi=…" lines that leaked outside markdown links. */
  private repairBrokenGotoLines(content: string, epubSource: string): string {
    let result = content.replace(
      /^(?!.*\[回到原文\]).*\.epub&cfi=(epubcfi\([^)\n]+)>?\s*$/gm,
      (_line, cfi: string) => this.buildSourceLink(epubSource, cfi.replace(/>$/, ""))
    );
    result = result.replace(
      /^(?!.*\[回到原文\])\s*obsidian:\/\/ob-epub-goto\?([^\n]+)>?\s*$/gm,
      (_line, query: string) => {
        const params = new URLSearchParams(query.replace(/>$/, ""));
        const file = params.get("file") ?? epubSource;
        const cfi = params.get("cfi");
        if (!file || !cfi) return _line;
        return this.buildSourceLink(file, cfi);
      }
    );
    return result;
  }

  private extractEpubSourceFromFrontmatter(content: string): string | undefined {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    return fmMatch?.[1]?.match(/^epub-source:\s*(.+)$/m)?.[1]?.trim();
  }

  /** One-time fix for excerpt md files written with the old `<…>` link format. */
  async fixLegacyGotoLinksInVault(): Promise<void> {
    const folder = this.settings.excerptFolder.replace(/\/$/, "");
    const prefix = folder ? `${folder}/` : "";
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(prefix) && f.name.endsWith("摘录.md"));

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const epubSource = this.extractEpubSourceFromFrontmatter(content);
      const fixed = this.fixLegacyGotoLinksInContent(content, epubSource);
      if (fixed !== content) {
        await this.app.vault.modify(file, fixed);
      }
    }
  }

  // ── Vault file read/write helpers ─────────────────────────────────────────

  private async ensureFile(epubFilePath: string): Promise<TFile> {
    const mdPath = this.getAnnotationFilePath(epubFilePath);
    const existing = this.app.vault.getAbstractFileByPath(mdPath);
    if (existing instanceof TFile) return existing;

    const folder = this.settings.excerptFolder;
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => {});
    }

    const basename = epubFilePath.split("/").pop() ?? epubFilePath;
    const title = basename.replace(/\.epub$/i, "");
    const now = new Date();
    const frontmatter = [
      `---`,
      `epub-source: ${epubFilePath}`,
      `created: ${now.toISOString().slice(0, 10)}`,
      `---`,
      ``,
      `# 《${title}》摘录`,
      ``,
    ].join("\n");
    return await this.app.vault.create(mdPath, frontmatter);
  }

  private async readContent(epubFilePath: string): Promise<string> {
    const mdPath = this.getAnnotationFilePath(epubFilePath);
    const file = this.app.vault.getAbstractFileByPath(mdPath);
    if (!(file instanceof TFile)) return "";
    return await this.app.vault.read(file);
  }

  private async writeContent(epubFilePath: string, content: string): Promise<void> {
    const file = await this.ensureFile(epubFilePath);
    await this.app.vault.modify(file, content);
  }

  // ── Block serialisation ───────────────────────────────────────────────────

  private buildBlock(ann: Annotation, epubFilePath: string): string {
    const dateStr = this.formatDate(new Date(ann.created));
    const headerLine = `> [!${CALLOUT_PREFIX}|${ann.color}] ${ann.chapter} · ${dateStr} ^${ann.id}`;
    const textLines = ann.text.split("\n").map((l) => `> ${l}`).join("\n");
    const sourceLink = this.buildSourceLink(epubFilePath, ann.cfiRange);

    const parts: string[] = [headerLine, textLines, ``];
    if (ann.note) {
      parts.push(ann.note, ``);
    }
    parts.push(sourceLink, ``, `---`, ``);
    return parts.join("\n");
  }

  // ── Block parsing ─────────────────────────────────────────────────────────

  /**
   * Parse all ob-epub callout blocks from a file's content and return Annotation[].
   * The regex splits on `---` separators so each "chunk" is one annotation block.
   */
  parseContent(content: string, epubFilePath: string): Annotation[] {
    const annotations: Annotation[] = [];

    // Split by the `---` separator (with optional surrounding newlines)
    const chunks = content.split(/\n---\n/);

    for (const chunk of chunks) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;

      // Header line: > [!ob-epub|COLOR] CHAPTER · DATE ^ID
      const headerMatch = trimmed.match(
        /^>\s*\[!ob-epub\|([a-z]+)\]\s+(.*?)(?:\s+\^(ann-[^\s\n]+))?\s*$/m
      );
      if (!headerMatch) continue;

      const color = headerMatch[1] as HighlightColor;
      if (!HIGHLIGHT_COLORS.find((c) => c.id === color)) continue;

      const headerRest = headerMatch[2]; // "CHAPTER · DATE"
      const id = headerMatch[3] ?? trimmed.match(/>\s*\^(ann-[a-z0-9-]+)/i)?.[1];
      if (!id) continue;

      // Chapter and date from headerRest "Chapter · YYYY-MM-DD HH:MM"
      const chapterDateMatch = headerRest.match(/^(.*?)\s·\s(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2})$/);
      const chapter = chapterDateMatch ? chapterDateMatch[1].trim() : headerRest.trim();
      const created = chapterDateMatch
        ? new Date(chapterDateMatch[2]).toISOString()
        : new Date(0).toISOString();

      // Quoted text lines (lines starting with ">", skip header line, skip ^ID line)
      const lines = trimmed.split("\n");
      const textLines: string[] = [];
      for (const line of lines) {
        if (!line.startsWith(">")) continue;
        const stripped = line.replace(/^>\s?/, "");
        // Skip the header line itself and ^ID-only lines
        if (stripped.startsWith(`[!${CALLOUT_PREFIX}`)) continue;
        if (/^\^ann-/.test(stripped)) continue;
        textLines.push(stripped);
      }
      const text = textLines.join("\n").trim();

      const cfiRange = this.extractCfiFromChunk(trimmed);
      if (!cfiRange) continue;

      // Note: non-blockquote, non-sourcelink lines between the blockquote and ---
      const noteLines: string[] = [];
      let pastQuote = false;
      for (const line of lines) {
        if (line.startsWith(">")) {
          pastQuote = true;
          continue;
        }
        if (!pastQuote) continue;
        if (/^\[回到原文\]/.test(line.trim())) continue;
        if (line.trim() === "") continue;
        noteLines.push(line);
      }
      const note = noteLines.join("\n").trim() || undefined;

      annotations.push({ id, cfiRange, text, color, note, chapter, created });
    }

    return annotations;
  }

  // ── Public CRUD ───────────────────────────────────────────────────────────

  async add(epubFilePath: string, ann: Annotation): Promise<void> {
    const file = await this.ensureFile(epubFilePath);
    const current = await this.app.vault.read(file);
    const block = this.buildBlock(ann, epubFilePath);
    this.pauseWatch();
    await this.app.vault.modify(file, current + "\n" + block);
  }

  async update(epubFilePath: string, id: string, patch: Partial<Annotation>): Promise<void> {
    const content = await this.readContent(epubFilePath);
    if (!content) return;

    const annotations = this.parseContent(content, epubFilePath);
    const idx = annotations.findIndex((a) => a.id === id);
    if (idx < 0) return;

    const updated: Annotation = { ...annotations[idx], ...patch };
    // Rebuild the entire file from scratch to avoid regex-replace pitfalls
    await this.rebuildFile(epubFilePath, content, annotations, idx, updated);
  }

  async remove(epubFilePath: string, id: string): Promise<void> {
    const content = await this.readContent(epubFilePath);
    if (!content) return;

    const annotations = this.parseContent(content, epubFilePath);
    const idx = annotations.findIndex((a) => a.id === id);
    if (idx < 0) return;

    await this.rebuildFile(epubFilePath, content, annotations, idx, null);
  }

  /**
   * Rebuild the vault md file preserving the frontmatter + title header,
   * replacing / removing the annotation at `idx`.
   */
  private async rebuildFile(
    epubFilePath: string,
    originalContent: string,
    annotations: Annotation[],
    replaceIdx: number,
    replacement: Annotation | null
  ): Promise<void> {
    // Keep everything before the first ob-epub block (frontmatter + heading)
    const firstBlockMatch = originalContent.match(/^>\s*\[!ob-epub\|/m);
    const preamble = firstBlockMatch
      ? originalContent.slice(0, firstBlockMatch.index)
      : originalContent;

    const nextAnnotations = annotations
      .map((a, i) => (i === replaceIdx ? replacement : a))
      .filter((a): a is Annotation => a !== null);

    const blocks = nextAnnotations.map((a) => this.buildBlock(a, epubFilePath)).join("\n");
    const newContent = preamble.trimEnd() + "\n\n" + blocks;
    this.pauseWatch();
    await this.writeContent(epubFilePath, newContent);
  }

  async getByFile(epubFilePath: string): Promise<Annotation[]> {
    const content = await this.readContent(epubFilePath);
    return this.parseContent(content, epubFilePath);
  }

  async getByCfi(epubFilePath: string, cfiRange: string): Promise<Annotation | null> {
    const list = await this.getByFile(epubFilePath);
    return list.find((a) => a.cfiRange === cfiRange) ?? null;
  }

  async getById(epubFilePath: string, id: string): Promise<Annotation | null> {
    const list = await this.getByFile(epubFilePath);
    return list.find((a) => a.id === id) ?? null;
  }

  // ── File watcher ──────────────────────────────────────────────────────────

  /**
   * Watch the annotation md file for external changes.
   * Returns a cleanup function that unregisters the listener.
   */
  watchFile(epubFilePath: string, onChange: () => void): () => void {
    const mdPath = this.getAnnotationFilePath(epubFilePath);
    const ref = this.app.vault.on("modify", (file: TFile) => {
      if (file.path !== mdPath) return;
      if (this.isWatchPaused()) return;
      const existing = this.debounceTimers.get(mdPath);
      if (existing) clearTimeout(existing);
      this.debounceTimers.set(
        mdPath,
        setTimeout(() => {
          this.debounceTimers.delete(mdPath);
          onChange();
        }, 500)
      );
    });
    return () => {
      const t = this.debounceTimers.get(mdPath);
      if (t) { clearTimeout(t); this.debounceTimers.delete(mdPath); }
      this.app.vault.offref(ref);
    };
  }

  // ── Open annotation file ──────────────────────────────────────────────────

  async openAnnotationFile(epubFilePath: string): Promise<void> {
    const mdPath = this.getAnnotationFilePath(epubFilePath);
    let file = this.app.vault.getAbstractFileByPath(mdPath);
    if (!(file instanceof TFile)) {
      file = await this.ensureFile(epubFilePath);
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(file as TFile);
  }

  // ── AI response append ────────────────────────────────────────────────────

  async appendAIResponse(
    epubFilePath: string,
    selectedText: string,
    aiResponse: string,
    cfi: string
  ): Promise<string> {
    const file = await this.ensureFile(epubFilePath);
    const current = await this.app.vault.read(file);
    const dateStr = this.formatDate(new Date());
    const block = [
      `> [!note] AI 解读 · ${dateStr}`,
      `> **原文**：${selectedText.slice(0, 100)}${selectedText.length > 100 ? "…" : ""}`,
      `>`,
      ...aiResponse.split("\n").map((line) => `> ${line}`),
      ``,
      `---`,
      ``,
    ].join("\n");
    this.pauseWatch();
    await this.app.vault.modify(file, current + "\n" + block);
    return file.path;
  }

  // ── Migration from old AnnotationStore (plugin data.json) ────────────────

  async migrateFromPluginData(
    oldAnnotations: Record<string, OldAnnotation[]>
  ): Promise<void> {
    if (!oldAnnotations || Object.keys(oldAnnotations).length === 0) return;

    for (const [epubFilePath, anns] of Object.entries(oldAnnotations)) {
      if (!anns || anns.length === 0) continue;

      const content = await this.readContent(epubFilePath);
      const existingIds = new Set(
        this.parseContent(content, epubFilePath).map((a) => a.id)
      );

      // Only append annotations not already in the file
      const toMigrate = anns.filter((a) => !existingIds.has(a.id));
      if (toMigrate.length === 0) continue;

      const file = await this.ensureFile(epubFilePath);
      let current = await this.app.vault.read(file);
      for (const ann of toMigrate) {
        current += "\n" + this.buildBlock(ann as Annotation, epubFilePath);
      }
      await this.app.vault.modify(file, current);
    }
  }
}
