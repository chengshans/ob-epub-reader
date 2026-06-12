import { App, normalizePath, TFile } from "obsidian";
import { Annotation, BookProgress, EpubPluginSettings, formatReadingTime, HighlightColor, HIGHLIGHT_COLORS, normalizeNoteType, NoteType, parseReadingTime } from "./types";

// ── Block format written to 《书名》摘录.md ───────────────────────────────
//
// > [!ob-epub|yellow] 第三章 · 2026-05-23 18:15:42 ^ann-abc123
// > 原文内容第一行
// > 原文内容第二行
//
// 可选的想法文字
//
// [回到原文](#^ann-xxx)
// <!-- ob-epub-cfi: epubcfi(...) -->
//
// ---
//
// ─────────────────────────────────────────────────────────────────────────────

const CALLOUT_PREFIX = "ob-epub";
const NOTE_TYPE_COMMENT_RE = /^<!--\s*ob-epub-note-type:\s*([a-z]+)\s*-->$/;

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
    const commentMatch = text.match(/<!--\s*ob-epub-cfi:\s*(epubcfi\([\s\S]*?\))\s*-->/);
    if (commentMatch) return commentMatch[1];

    const linkMatch = text.match(
      /\[回到原文\]\(\s*(?:obsidian:\/\/ob-epub-goto\?|#ob-epub-goto\?)([^)\n]+)\)/
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

  getAnnotationFilePath(epubFilePath: string): string {
    const folder = this.settings.excerptFolder.replace(/\/$/, "");
    const basename = epubFilePath.split("/").pop() ?? epubFilePath;
    const title = basename.replace(/\.epub$/i, "");
    return normalizePath(`${folder}/《${title}》摘录.md`);
  }

  /** Format as local `YYYY-MM-DD HH:mm:ss` (not UTC). */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  private parseLocalDateTime(value: string): Date {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return new Date(value);
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] ?? 0)
    );
  }

  /** Vault block-ref link — safe to click; CFI lives in <!-- ob-epub-cfi --> comment. */
  private buildSourceLink(annId: string): string {
    return `[回到原文](#^${annId})`;
  }

  private buildCfiComment(cfiRange: string): string {
    return `<!-- ob-epub-cfi: ${cfiRange} -->`;
  }

  /** Strip legacy angle-bracket wrappers and other broken link syntax. */
  fixLegacyGotoLinksInContent(content: string, epubSource?: string): string {
    let result = content.replace(
      /\[回到原文\]\(<(obsidian:\/\/ob-epub-goto\?[^>]+)>\)/g,
      "[回到原文]($1)"
    );
    result = result.replace(
      /\[回到原文\]\((obsidian:\/\/ob-epub-goto\?[^)\n]+)\)>/g,
      "[回到原文]($1)"
    );

    if (epubSource) {
      result = this.repairBrokenGotoLines(result, epubSource);
    }
    result = this.rewriteGotoLinksToBlockRefs(result);
    return result;
  }

  /** Replace all goto link formats with #^ann-id and ensure CFI HTML comment exists. */
  rewriteGotoLinksToBlockRefs(content: string): string {
    const chunks = content.split(/\n---\n/);
    const rewritten = chunks.map((chunk) => {
      const annId = chunk.match(/\^(ann-[a-z0-9-]+)/i)?.[1];
      if (!annId) return chunk;

      let updated = chunk;
      const legacyCfi = this.extractCfiFromLegacyLink(chunk);
      if (legacyCfi && !updated.includes("<!-- ob-epub-cfi:")) {
        updated = updated.replace(
          /(\n\[回到原文\]\([^)\n]+\))/,
          `\n${this.buildCfiComment(legacyCfi)}$1`
        );
      }

      return updated.replace(/\[回到原文\]\([^)\n]+\)/g, this.buildSourceLink(annId));
    });
    return rewritten.join("\n---\n");
  }

  private extractCfiFromLegacyLink(text: string): string | null {
    const linkMatch = text.match(
      /\[回到原文\]\(\s*(?:obsidian:\/\/ob-epub-goto\?|#ob-epub-goto\?)([^)\n]+)\)/
    );
    if (!linkMatch) return null;
    try {
      const params = new URLSearchParams(linkMatch[1]);
      const cfi = params.get("cfi");
      if (cfi) return decodeURIComponent(cfi);
    } catch {
      /* fall through */
    }
    const cfiMatch = linkMatch[1].match(/(?:^|&)cfi=(.+)$/);
    if (cfiMatch?.[1]) {
      try {
        return decodeURIComponent(cfiMatch[1]);
      } catch {
        return cfiMatch[1];
      }
    }
    return null;
  }

  /** Repair bare ".epub&cfi=…" lines that leaked outside markdown links. */
  private repairBrokenGotoLines(content: string, epubSource: string): string {
    const chunks = content.split(/\n---\n/);
    const repaired = chunks.map((chunk) => {
      const annId = chunk.match(/\^(ann-[a-z0-9-]+)/i)?.[1];
      if (!annId) return chunk;

      let updated = chunk.replace(
        /^(?!.*\[回到原文\]).*\.epub&cfi=(epubcfi\([^)\n]+)>?\s*$/gm,
        (_line, cfi: string) => {
          const clean = cfi.replace(/>$/, "");
          return `${this.buildCfiComment(clean)}\n${this.buildSourceLink(annId)}`;
        }
      );

      updated = updated.replace(
        /^(?!.*\[回到原文\])\s*obsidian:\/\/ob-epub-goto\?([^\n]+)>?\s*$/gm,
        (_line, query: string) => {
          const params = new URLSearchParams(query.replace(/>$/, ""));
          const cfi = params.get("cfi");
          if (!cfi) return _line;
          return `${this.buildCfiComment(cfi)}\n${this.buildSourceLink(annId)}`;
        }
      );
      return updated;
    });
    return repaired.join("\n---\n");
  }

  private extractFrontmatterBody(content: string): string | null {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    return fmMatch?.[1] ?? null;
  }

  private extractEpubSourceFromFrontmatter(content: string): string | undefined {
    const body = this.extractFrontmatterBody(content);
    return body?.match(/^epub-source:\s*(.+)$/m)?.[1]?.trim();
  }

  private parseYamlScalar(raw: string): string {
    const trimmed = raw.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  parseProgressFromContent(content: string): BookProgress | null {
    const body = this.extractFrontmatterBody(content);
    if (!body) return null;

    const percentMatch = body.match(/^progress-percent:\s*([\d.]+)/m);
    const cfiMatch = body.match(/^progress-cfi:\s*(.+)$/m);
    const chapterMatch = body.match(/^progress-chapter:\s*(.+)$/m);
    const lastReadMatch = body.match(/^last-read:\s*(.+)$/m);
    const readingTimeMatch = body.match(/^reading-time:\s*(.+)$/m);
    const readingTimeSecondsMatch = body.match(/^reading-time-seconds:\s*(\d+)/m);

    if (!cfiMatch) return null;

    const cfi = this.parseYamlScalar(cfiMatch[1]);
    if (!cfi.startsWith("epubcfi(")) return null;

    let percent = percentMatch ? Number(percentMatch[1]) : 0;
    if (!Number.isFinite(percent) || percent < 0) percent = 0;
    if (percent > 1) percent = Math.min(percent / 100, 1);

    let readingTimeSeconds = 0;
    if (readingTimeMatch) {
      readingTimeSeconds = parseReadingTime(this.parseYamlScalar(readingTimeMatch[1]));
    } else if (readingTimeSecondsMatch) {
      readingTimeSeconds = Number(readingTimeSecondsMatch[1]);
    }
    if (!Number.isFinite(readingTimeSeconds) || readingTimeSeconds < 0) readingTimeSeconds = 0;

    return {
      cfi,
      chapter: chapterMatch ? this.parseYamlScalar(chapterMatch[1]) : "",
      percent,
      lastRead: lastReadMatch ? this.parseYamlScalar(lastReadMatch[1]) : "",
      readingTimeSeconds: Math.floor(readingTimeSeconds),
    };
  }

  private yamlQuote(value: string): string {
    if (!value) return '""';
    if (/[:#\[\]{}|>&*!%@`,]/.test(value) || value.includes('"')) {
      return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    return value;
  }

  buildProgressFrontmatterFields(progress: BookProgress): string {
    return [
      `progress-percent: ${progress.percent}`,
      `progress-cfi: ${this.yamlQuote(progress.cfi)}`,
      `progress-chapter: ${this.yamlQuote(progress.chapter)}`,
      `last-read: ${progress.lastRead}`,
      `reading-time: ${this.yamlQuote(formatReadingTime(progress.readingTimeSeconds ?? 0))}`,
    ].join("\n");
  }

  upsertProgressInContent(content: string, progress: BookProgress): string {
    const progressFields = this.buildProgressFrontmatterFields(progress);
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);

    if (!fmMatch) {
      return `---\n${progressFields}\n---\n\n${content}`;
    }

    let body = fmMatch[1];
    body = body
      .replace(/^progress-percent:.*$/m, "")
      .replace(/^progress-cfi:.*$/m, "")
      .replace(/^progress-chapter:.*$/m, "")
      .replace(/^last-read:.*$/m, "")
      .replace(/^reading-time:.*$/m, "")
      .replace(/^reading-time-seconds:.*$/m, "")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd();

    const newBody = body ? `${body}\n${progressFields}` : progressFields;
    const rest = content.slice(fmMatch[0].length);
    return `---\n${newBody}\n---${rest}`;
  }

  async readProgress(epubFilePath: string): Promise<BookProgress | null> {
    const content = await this.readContent(epubFilePath);
    if (!content) return null;
    return this.parseProgressFromContent(content);
  }

  async writeProgress(epubFilePath: string, progress: BookProgress): Promise<void> {
    const file = await this.ensureFile(epubFilePath);
    const content = await this.app.vault.read(file);
    const updated = this.upsertProgressInContent(content, progress);
    if (updated === content) return;
    this.pauseWatch();
    await this.app.vault.modify(file, updated);
  }

  async scanAllProgress(): Promise<Record<string, BookProgress>> {
    const folder = this.settings.excerptFolder.replace(/\/$/, "");
    const prefix = folder ? `${folder}/` : "";
    const result: Record<string, BookProgress> = {};

    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(prefix) && f.name.endsWith("摘录.md"));

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const epubSource = this.extractEpubSourceFromFrontmatter(content);
      if (!epubSource) continue;
      const progress = this.parseProgressFromContent(content);
      if (progress) {
        result[epubSource] = progress;
      }
    }

    return result;
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

  /** Convert any legacy goto links to #^ann-id block refs with CFI comments. */
  async migrateRemainingObsidianGotoLinks(): Promise<void> {
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

  /** Resolve #^ann-id from an excerpt markdown file to EPUB path + CFI. */
  async resolveGotoFromExcerpt(
    excerptPath: string,
    annId: string
  ): Promise<{ file: string; cfi: string } | null> {
    const mdFile = this.app.vault.getAbstractFileByPath(excerptPath);
    if (!(mdFile instanceof TFile)) return null;

    const content = await this.app.vault.read(mdFile);
    const chunks = content.split(/\n---\n/);

    for (const chunk of chunks) {
      if (!chunk.includes(`^${annId}`)) continue;

      const cfi = this.extractCfiFromChunk(chunk);
      if (!cfi) continue;

      let epubPath = this.extractEpubSourceFromFrontmatter(content);
      if (!epubPath) {
        epubPath = this.inferEpubPathFromExcerpt(excerptPath, chunk);
      }
      if (!epubPath) return null;

      return { file: epubPath, cfi };
    }

    const epubPath = this.extractEpubSourceFromFrontmatter(content)
      ?? this.inferEpubPathFromExcerpt(excerptPath, content);
    if (!epubPath) return null;

    const ann = await this.getById(epubPath, annId);
    if (!ann?.cfiRange) return null;
    return { file: epubPath, cfi: ann.cfiRange };
  }

  private inferEpubPathFromExcerpt(excerptPath: string, chunkOrContent: string): string | undefined {
    const legacyFile = chunkOrContent.match(/(?:^|&)file=([^&\s]+)/);
    if (legacyFile?.[1]) {
      try {
        return decodeURIComponent(legacyFile[1]);
      } catch {
        return legacyFile[1];
      }
    }

    const name = excerptPath.split("/").pop() ?? "";
    const titleMatch = name.match(/^《([\s\S]+?)》摘录\.md$/);
    if (!titleMatch) return undefined;

    const title = titleMatch[1].trimEnd();
    const epubFiles = this.app.vault.getFiles().filter((f) => f.extension === "epub");
    const match =
      epubFiles.find((f) => f.basename === title) ??
      epubFiles.find((f) => f.basename.trimEnd() === title);
    return match?.path;
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
      `created: ${this.formatDate(now).slice(0, 10)}`,
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
    const sourceLink = this.buildSourceLink(ann.id);
    const cfiComment = this.buildCfiComment(ann.cfiRange);

    const parts: string[] = [headerLine, textLines, ``];
    if (ann.note) {
      parts.push(`<!-- ob-epub-note-type: ${ann.noteType ?? "note"} -->`);
      parts.push(ann.note, ``);
    }
    parts.push(cfiComment, sourceLink, ``, `---`, ``);
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

      // Chapter and date from headerRest "Chapter · YYYY-MM-DD HH:mm:ss"
      const chapterDateMatch = headerRest.match(/^(.*?)\s·\s(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(?::\d{2})?)$/);
      const chapter = chapterDateMatch ? chapterDateMatch[1].trim() : headerRest.trim();
      const created = chapterDateMatch
        ? this.parseLocalDateTime(chapterDateMatch[2]).toISOString()
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
      let parsedNoteType: NoteType | undefined;
      let pastQuote = false;
      for (const line of lines) {
        if (line.startsWith(">")) {
          pastQuote = true;
          continue;
        }
        if (!pastQuote) continue;
        if (/^\[回到原文\]/.test(line.trim())) continue;
        if (line.trim() === "") continue;
        const typeMatch = line.trim().match(NOTE_TYPE_COMMENT_RE);
        if (typeMatch) {
          parsedNoteType = normalizeNoteType(typeMatch[1]);
          continue;
        }
        noteLines.push(line);
      }
      const note = noteLines.join("\n").trim() || undefined;
      const noteType = note ? (parsedNoteType ?? "note") : undefined;

      annotations.push({ id, cfiRange, text, color, note, noteType, chapter, created });
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
