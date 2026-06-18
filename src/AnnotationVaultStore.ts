import { App, normalizePath, TFile } from "obsidian";
import { extractEpubCfiLiteral } from "./cfi/cfiString";
import {
  buildLooseExcerptNameRegex,
  ExcerptMetadataCheckItem,
  ExcerptMetadataCheckReport,
  extractTitleFromExcerptName,
  inferEpubPathFromExcerptLocation,
  inferFilefolderFromExcerptLocation,
  isDynamicExcerptFolder,
  resolveExcerptFilename,
  resolveExcerptFolder,
} from "./excerptFolder";
import {
  buildGroupedAnnotationBody,
  composeExcerptContent,
  extractAnnotationBlocksFromExcerpt,
  extractAnnotationBlocksWithContext,
  extractChapterFromSegment,
  joinExcerptChunks,
  splitExcerptChunks,
  splitExcerptRegions,
  stripChapterHeadingPrefix,
} from "./excerptChapterLayout";
import {
  buildExcerptBlock,
  isChunkInCurrentFormat,
  parseExcerptChunk,
} from "./excerptBlockFormat";
import {
  extractCfiFromWikiLink,
  slimWikiGotoLinksInContent,
} from "./epubSubpath";
import {
  Annotation,
  BookProgress,
  EpubPluginSettings,
  formatReadingTime,
  HighlightColor,
  parseReadingTime,
  resolveNoteTypes,
} from "./types";

// ── Block format written to 《书名》摘录.md ───────────────────────────────
//
// callout-title:
// > [!ob-epub|yellow] [[book.epub#cfi=...|章节]]
// > 原文内容…
//
// inline-suffix / inline-colored / wiki-text-alias — see excerptBlockFormat.ts
//
// ---
//
// ─────────────────────────────────────────────────────────────────────────────

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
  /** Serialize excerpt read-modify-write per EPUB to avoid lost annotations. */
  private excerptWriteChains = new Map<string, Promise<void>>();

  constructor(app: App, settings: EpubPluginSettings) {
    this.app = app;
    this.settings = settings;
  }

  /** Queue excerpt mutations for the same EPUB file (parallel add/update would otherwise race). */
  private runSerializedExcerptWrite<T>(epubFilePath: string, task: () => Promise<T>): Promise<T> {
    const prev = this.excerptWriteChains.get(epubFilePath) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(task);
    this.excerptWriteChains.set(
      epubFilePath,
      run.then(
        () => undefined,
        () => undefined
      )
    );
    return run;
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
    const commentMatch = text.match(/<!--\s*ob-epub-cfi:\s*([\s\S]*?)\s*-->/);
    if (commentMatch) {
      const literal = extractEpubCfiLiteral(commentMatch[1]);
      if (literal) return literal;
    }

    const linkMatch = text.match(
      /\[回到原文\]\(\s*(?:obsidian:\/\/ob-epub-goto\?|#ob-epub-goto\?)([^)\n]+)\)/
    );
    if (linkMatch) {
      try {
        const query = linkMatch[1].replace(/>$/, "");
        const params = new URLSearchParams(query);
        const cfi = params.get("cfi");
        if (cfi) {
          const literal = extractEpubCfiLiteral(cfi) ?? extractEpubCfiLiteral(decodeURIComponent(cfi));
          if (literal) return literal;
          return cfi;
        }
      } catch {
        /* fall through */
      }
    }

    const wikiCfi = extractCfiFromWikiLink(text);
    if (wikiCfi) return wikiCfi;

    const cfiIdx = text.indexOf("cfi=");
    if (cfiIdx >= 0) {
      const literal = extractEpubCfiLiteral(text.slice(cfiIdx + 4));
      if (literal) {
        try {
          return decodeURIComponent(literal);
        } catch {
          return literal;
        }
      }
    }
    return null;
  }

  // ── Path helpers ──────────────────────────────────────────────────────────

  private resolveFolder(epubFilePath: string): string {
    return resolveExcerptFolder(this.settings.excerptFolder, epubFilePath);
  }

  private listExcerptMarkdownFiles(): TFile[] {
    const folderTemplate = this.settings.excerptFolder;
    const filenameTemplate = this.settings.excerptFilename;
    const nameRe = buildLooseExcerptNameRegex(filenameTemplate);
    const all = this.app.vault.getMarkdownFiles();
    if (isDynamicExcerptFolder(folderTemplate)) {
      return all.filter((f) => nameRe.test(f.name));
    }
    const folder = folderTemplate.replace(/\/$/, "");
    const prefix = folder ? `${folder}/` : "";
    return all.filter((f) => f.path.startsWith(prefix) && nameRe.test(f.name));
  }

  getAnnotationFilePath(epubFilePath: string): string {
    const folder = this.resolveFolder(epubFilePath);
    const filename = resolveExcerptFilename(this.settings.excerptFilename, epubFilePath);
    return normalizePath(`${folder}/${filename}`);
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

  private buildCfiComment(cfiRange: string): string {
    return `<!-- ob-epub-cfi: ${cfiRange} -->`;
  }

  private isChunkInCurrentFormat(
    chunk: string,
    ann: Annotation,
    epubSource?: string
  ): boolean {
    return isChunkInCurrentFormat(
      chunk,
      ann,
      epubSource ?? "",
      this.settings.sourceLinkFormat,
      (d) => this.formatDate(d)
    );
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
    result = slimWikiGotoLinksInContent(result);
    result = this.rewriteGotoLinksToCurrentFormat(result, epubSource);
    return result;
  }

  /** Replace goto links in all chunks to match the current sourceLinkFormat setting. */
  rewriteGotoLinksToCurrentFormat(
    content: string,
    epubSource?: string,
    options?: { forceRewrite?: boolean }
  ): string {
    if (!epubSource) return content;

    const annotations = this.parseContent(content, epubSource);
    if (annotations.length === 0) return content;

    if (!options?.forceRewrite) {
      const blocks = extractAnnotationBlocksFromExcerpt(content);
      const formatDate = (d: Date) => this.formatDate(d);
      const needsUpdate =
        blocks.length !== annotations.length ||
        blocks.some((block, i) => {
          const ann = annotations[i];
          if (!ann) return true;
          const body = stripChapterHeadingPrefix(block);
          return !isChunkInCurrentFormat(
            body,
            ann,
            epubSource,
            this.settings.sourceLinkFormat,
            formatDate
          );
        });

      if (!needsUpdate) return content;
    }

    return this.recomposeExcerptFromContent(content, epubSource, annotations);
  }

  private parseExcerptChunk(trimmed: string, epubFilePath: string): Annotation | null {
    return parseExcerptChunk(trimmed, epubFilePath, resolveNoteTypes(this.settings.noteTypes));
  }

  private parseSingleChunkAnnotation(
    chunk: string,
    epubFilePath: string,
    annId: string,
    cfiRange: string
  ): Annotation | null {
    const parsed = this.parseExcerptChunk(chunk.trim(), epubFilePath);
    if (parsed) return parsed;
    return { id: annId, cfiRange, text: "", color: "yellow", chapter: "", created: new Date().toISOString() };
  }

  /** Rewrite all excerpt files to use the current sourceLinkFormat. Returns files updated. */
  async convertAllExcerptSourceLinks(): Promise<number> {
    const files = this.listExcerptMarkdownFiles();

    let updated = 0;
    for (const file of files) {
      const content = await this.app.vault.read(file);
      const epubSource = this.resolveEpubSourceForExcerpt(file.path, content);
      if (!epubSource) continue;

      const converted = this.rewriteGotoLinksToCurrentFormat(content, epubSource, {
        forceRewrite: true,
      });
      if (converted !== content) {
        this.pauseWatch();
        await this.app.vault.modify(file, converted);
        updated += 1;
      }
    }
    return updated;
  }

  private epubFileExists(epubPath: string): boolean {
    const normalized = normalizePath(epubPath);
    const file =
      this.app.vault.getFileByPath(normalized) ??
      this.app.vault.getAbstractFileByPath(normalized);
    return file instanceof TFile && file.extension === "epub";
  }

  private findEpubByTitleInFolder(folder: string, title: string): TFile | null {
    const normalizedFolder = normalizePath(folder);
    const normalizedTitle = title.trimEnd();
    for (const file of this.app.vault.getFiles()) {
      if (file.extension !== "epub") continue;
      const slash = file.path.lastIndexOf("/");
      const parent = slash >= 0 ? file.path.slice(0, slash) : "";
      if (normalizePath(parent) !== normalizedFolder) continue;
      if (file.basename.trimEnd() === normalizedTitle) return file;
    }
    return null;
  }

  /** Validate excerpt frontmatter epub-source and local EPUB per folder template. */
  async checkExcerptMetadata(): Promise<ExcerptMetadataCheckReport> {
    const files = this.listExcerptMarkdownFiles();
    const items: ExcerptMetadataCheckItem[] = [];

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const epubSource = this.extractEpubSourceFromFrontmatter(content);
      const filefolder = inferFilefolderFromExcerptLocation(
        file.path,
        this.settings.excerptFolder,
        this.settings.excerptFilename
      );
      const title = extractTitleFromExcerptName(file.name, this.settings.excerptFilename);
      const localEpub =
        filefolder && title ? this.findEpubByTitleInFolder(filefolder, title) : null;
      const issues: ExcerptMetadataCheckItem["issues"] = [];

      const epubSourceValid = Boolean(epubSource && this.epubFileExists(epubSource));

      if (!epubSource) {
        issues.push("missing-epub-source");
      } else if (!epubSourceValid) {
        issues.push("epub-source-not-found");
      }

      // epub-source 有效时视为可正常跳转，不再做路径位置等二次校验
      if (!epubSourceValid && filefolder && title && !localEpub) {
        issues.push("local-epub-not-found");
      }

      if (issues.length > 0) {
        items.push({
          excerptPath: file.path,
          epubSource,
          expectedExcerptPath: epubSourceValid
            ? this.getAnnotationFilePath(epubSource!)
            : undefined,
          localEpubPath: localEpub?.path,
          issues,
        });
      }
    }

    return {
      checked: files.length,
      withIssues: items.length,
      items,
    };
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
    const chunks = splitExcerptChunks(content);
    const repaired = chunks.map((chunk) => {
      const annId = chunk.match(/\^(ann-[a-z0-9-]+)/i)?.[1];
      if (!annId) return chunk;

      let updated = chunk.replace(
        /^(?!.*\[回到原文\]).*\.epub&cfi=(epubcfi\([^)\n]+)>?\s*$/gm,
        (_line, cfi: string) => {
          const clean = cfi.replace(/>$/, "");
          return this.buildCfiComment(clean);
        }
      );

      updated = updated.replace(
        /^(?!.*\[回到原文\])\s*obsidian:\/\/ob-epub-goto\?([^\n]+)>?\s*$/gm,
        (_line, query: string) => {
          const params = new URLSearchParams(query.replace(/>$/, ""));
          const cfi = params.get("cfi");
          if (!cfi) return _line;
          return this.buildCfiComment(cfi);
        }
      );
      return updated;
    });
    return joinExcerptChunks(repaired);
  }

  private extractFrontmatterBody(content: string): string | null {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    return fmMatch?.[1] ?? null;
  }

  private extractEpubSourceFromFrontmatter(content: string): string | undefined {
    const body = this.extractFrontmatterBody(content);
    const raw = body?.match(/^epub-source:\s*(.+)$/m)?.[1];
    return raw ? this.parseYamlScalar(raw) : undefined;
  }

  /** Resolve EPUB path from frontmatter, excerpt location, or wiki links in content. */
  resolveEpubSourceForExcerpt(excerptPath: string, content: string): string | undefined {
    return (
      this.extractEpubSourceFromFrontmatter(content) ??
      inferEpubPathFromExcerptLocation(
        excerptPath,
        this.settings.excerptFolder,
        this.settings.excerptFilename
      ) ??
      this.inferEpubPathFromExcerpt(excerptPath, content)
    );
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
    const result: Record<string, BookProgress> = {};

    const files = this.listExcerptMarkdownFiles();

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
    const files = this.listExcerptMarkdownFiles();

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const epubSource = this.extractEpubSourceFromFrontmatter(content);
      const fixed = this.fixLegacyGotoLinksInContent(content, epubSource);
      if (fixed !== content) {
        await this.app.vault.modify(file, fixed);
      }
    }
  }

  /** One-time: strip verbose text/chapter/color params from wiki goto links. */
  async slimVerboseWikiLinksInVault(): Promise<void> {
    const files = this.listExcerptMarkdownFiles();

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const slimmed = slimWikiGotoLinksInContent(content);
      if (slimmed !== content) {
        this.pauseWatch();
        await this.app.vault.modify(file, slimmed);
      }
    }
  }

  /** Convert any legacy goto links to #^ann-id block refs with CFI comments. */
  async migrateRemainingObsidianGotoLinks(): Promise<void> {
    const files = this.listExcerptMarkdownFiles();

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
    const chunks = splitExcerptChunks(content);

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
    const title = extractTitleFromExcerptName(name, this.settings.excerptFilename);
    if (!title) return undefined;
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

    const folder = this.resolveFolder(epubFilePath);
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
    return buildExcerptBlock(
      ann,
      epubFilePath,
      this.settings.sourceLinkFormat,
      (d) => this.formatDate(d)
    );
  }

  // ── Block parsing ─────────────────────────────────────────────────────────

  /**
   * Parse all ob-epub callout blocks from a file's content and return Annotation[].
   * The regex splits on `---` separators so each "chunk" is one annotation block.
   */
  parseContent(content: string, epubFilePath: string): Annotation[] {
    const annotations: Annotation[] = [];
    const blocks = extractAnnotationBlocksWithContext(content);
    const noteTypes = resolveNoteTypes(this.settings.noteTypes);

    for (const { block, contextChapter } of blocks) {
      const ann = parseExcerptChunk(block, epubFilePath, noteTypes);
      if (!ann) continue;

      const chapterFromHeading = extractChapterFromSegment(block);
      const chapter = ann.chapter || chapterFromHeading || contextChapter;
      if (chapter) {
        ann.chapter = chapter;
      }
      annotations.push(ann);
    }

    return annotations;
  }

  /** Rebuild grouped chapter layout while preserving preamble and trailing suffix. */
  recomposeExcerptFromContent(
    content: string,
    epubFilePath: string,
    annotations: Annotation[]
  ): string {
    const { preamble, suffix } = splitExcerptRegions(content);
    const groupedBody = buildGroupedAnnotationBody(annotations, (ann) =>
      this.buildBlock(ann, epubFilePath)
    );
    return composeExcerptContent(preamble, groupedBody, suffix);
  }

  private async recomposeExcerptFile(
    epubFilePath: string,
    originalContent: string,
    annotations: Annotation[]
  ): Promise<void> {
    const newContent = this.recomposeExcerptFromContent(
      originalContent,
      epubFilePath,
      annotations
    );
    this.pauseWatch();
    await this.writeContent(epubFilePath, newContent);
  }

  // ── Public CRUD ───────────────────────────────────────────────────────────

  async add(epubFilePath: string, ann: Annotation): Promise<void> {
    return this.runSerializedExcerptWrite(epubFilePath, async () => {
      await this.ensureFile(epubFilePath);
      const current = await this.readContent(epubFilePath);
      const annotations = this.parseContent(current, epubFilePath);
      annotations.push(ann);
      await this.recomposeExcerptFile(epubFilePath, current, annotations);
    });
  }

  async update(epubFilePath: string, id: string, patch: Partial<Annotation>): Promise<void> {
    return this.runSerializedExcerptWrite(epubFilePath, async () => {
      const content = await this.readContent(epubFilePath);
      if (!content) return;

      const annotations = this.parseContent(content, epubFilePath);
      const idx = annotations.findIndex((a) => a.id === id);
      if (idx < 0) return;

      const updated: Annotation = { ...annotations[idx], ...patch };
      await this.rebuildFile(epubFilePath, content, annotations, idx, updated);
    });
  }

  async remove(epubFilePath: string, id: string): Promise<void> {
    return this.runSerializedExcerptWrite(epubFilePath, async () => {
      const content = await this.readContent(epubFilePath);
      if (!content) return;

      const annotations = this.parseContent(content, epubFilePath);
      const idx = annotations.findIndex((a) => a.id === id);
      if (idx < 0) return;

      await this.rebuildFile(epubFilePath, content, annotations, idx, null);
    });
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
    const nextAnnotations = annotations
      .map((a, i) => (i === replaceIdx ? replacement : a))
      .filter((a): a is Annotation => a !== null);

    await this.recomposeExcerptFile(epubFilePath, originalContent, nextAnnotations);
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
      const current = await this.app.vault.read(file);
      const merged = [
        ...this.parseContent(content, epubFilePath),
        ...toMigrate.map((a) => a as Annotation),
      ];
      const newContent = this.recomposeExcerptFromContent(current, epubFilePath, merged);
      this.pauseWatch();
      await this.app.vault.modify(file, newContent);
    }
  }
}
