import { extractEpubCfiLiteral } from "./cfi/cfiString";
import {
  CHAPTER_BODY_END,
  CHAPTER_BODY_START,
  CHAPTER_TOC_END,
  CHAPTER_TOC_START,
  stripChapterHeadingPrefix,
} from "./excerptChapterLayout";
import {
  buildCalloutHeaderLine,
  hasLegacyStandaloneGotoLink,
  parseCalloutHeader,
  resolveAnnotationId,
} from "./excerptHeader";
import {
  buildEpubWikiLink,
  extractCfiFromWikiLink,
  isSourceLinkLine,
  parseEpubSubpath,
  parseEpubWikiLinkMarkdown,
} from "./epubSubpath";
import {
  Annotation,
  colorHex,
  HighlightColor,
  HIGHLIGHT_COLORS,
  normalizeNoteType,
  NoteType,
  NoteTypeDef,
  SourceLinkFormat,
} from "./types";

const CALLOUT_PREFIX = "ob-epub";
const INLINE_LINK_ALIAS = "原文";
const NOTE_TYPE_COMMENT_RE = /^<!--\s*ob-epub-note-type:\s*([a-z]+)\s*-->$/;
const CFI_COMMENT_RE = /^<!--\s*ob-epub-cfi:\s*epubcfi\([\s\S]*?\)\s*-->$/;

export const DEFAULT_EXCERPT_HIGHLIGHT_COLOR: HighlightColor = HIGHLIGHT_COLORS[0].id;

const COLORED_INLINE_RE =
  /<span\s+style="color:\s*(#[0-9a-fA-F]{3,8})\s*;?">\s*([\s\S]*?)\s*<\/span>\s*(\[\[[^\n]+\.epub#cfi=[^\n]+\|原文\]\])/;

const LAYOUT_LINE_RE =
  /^<!--\s*ob-epub-chapter-|^- \[\[#|^##\s|^\s*$/;

export function highlightColorFromHex(hex: string): HighlightColor {
  const normalized = hex.trim().toLowerCase();
  const found = HIGHLIGHT_COLORS.find((c) => c.hex.toLowerCase() === normalized);
  return found?.id ?? DEFAULT_EXCERPT_HIGHLIGHT_COLOR;
}

function extractCfiFromExcerptChunk(text: string): string | null {
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

function appendNoteSection(parts: string[], ann: Annotation): void {
  if (!ann.note) return;
  parts.push("", `<!-- ob-epub-note-type: ${ann.noteType ?? "note"} -->`, ann.note);
}

function buildCalloutBlock(
  ann: Annotation,
  epubPath: string,
  formatDate: (date: Date) => string
): string {
  const headerContent = buildCalloutHeaderLine(
    ann,
    epubPath,
    "callout-title",
    formatDate
  );
  const headerLine = `> [!${CALLOUT_PREFIX}|${ann.color}] ${headerContent}`;
  const textLines = ann.text.split("\n").map((l) => `> ${l}`).join("\n");
  const parts: string[] = [headerLine, textLines];
  appendNoteSection(parts, ann);
  return parts.join("\n");
}

function buildInlineSuffixBlock(ann: Annotation, epubPath: string): string {
  const link = buildEpubWikiLink(epubPath, { cfiRange: ann.cfiRange }, INLINE_LINK_ALIAS);
  const lines = ann.text.split("\n");
  if (lines.length === 0) {
    return link;
  }
  lines[lines.length - 1] = `${lines[lines.length - 1]}${link}`;
  const parts: string[] = [lines.join("\n")];
  appendNoteSection(parts, ann);
  return parts.join("\n");
}

function buildInlineColoredBlock(ann: Annotation, epubPath: string): string {
  const hex = colorHex(ann.color);
  const link = buildEpubWikiLink(epubPath, { cfiRange: ann.cfiRange }, INLINE_LINK_ALIAS);
  const span = `<span style="color: ${hex};">${ann.text}</span> ${link}`;
  const parts: string[] = [span];
  appendNoteSection(parts, ann);
  return parts.join("\n");
}

function buildWikiTextAliasBlock(ann: Annotation, epubPath: string): string {
  const alias = ann.text.split("\n").join(" ").trim();
  const link = buildEpubWikiLink(epubPath, { cfiRange: ann.cfiRange }, alias);
  const parts: string[] = [link];
  appendNoteSection(parts, ann);
  return parts.join("\n");
}

export function buildExcerptBlock(
  ann: Annotation,
  epubPath: string,
  format: SourceLinkFormat,
  formatDate: (date: Date) => string
): string {
  switch (format) {
    case "callout-title":
      return buildCalloutBlock(ann, epubPath, formatDate);
    case "inline-suffix":
      return buildInlineSuffixBlock(ann, epubPath);
    case "inline-colored":
      return buildInlineColoredBlock(ann, epubPath);
    case "wiki-text-alias":
      return buildWikiTextAliasBlock(ann, epubPath);
    default:
      return buildCalloutBlock(ann, epubPath, formatDate);
  }
}

interface ParsedNote {
  note?: string;
  noteType?: NoteType;
}

function parseExcerptNote(lines: string[], startIndex: number, noteTypes: NoteTypeDef[]): ParsedNote {
  const noteLines: string[] = [];
  let parsedNoteType: NoteType | undefined;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (isSourceLinkLine(line)) continue;
    if (line.trim() === "") continue;
    const typeMatch = line.trim().match(NOTE_TYPE_COMMENT_RE);
    if (typeMatch) {
      parsedNoteType = normalizeNoteType(typeMatch[1], noteTypes);
      continue;
    }
    if (CFI_COMMENT_RE.test(line.trim())) continue;
    noteLines.push(line);
  }

  const note = noteLines.join("\n").trim() || undefined;
  const noteType = note ? (parsedNoteType ?? "note") : undefined;
  return { note, noteType };
}

/** Strip chapter TOC / heading lines accidentally included in a block. */
function stripLayoutFromBlock(text: string): string {
  return stripChapterHeadingPrefix(
    text
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (trimmed === CHAPTER_TOC_START || trimmed === CHAPTER_TOC_END) return false;
        if (trimmed === CHAPTER_BODY_START || trimmed === CHAPTER_BODY_END) return false;
        if (LAYOUT_LINE_RE.test(trimmed)) return false;
        return true;
      })
      .join("\n")
      .trim()
  );
}

function isCorruptAnnotationText(text: string): boolean {
  return (
    text.includes("<!-- ob-epub-chapter-") ||
    text.includes("## 章节目录") ||
    /(^|\n)##\s/.test(text)
  );
}

/** Recover quote text from a corrupted wiki alias that contains layout HTML. */
function salvageTextFromCorruptAlias(alias: string): string | null {
  const spans = [...alias.matchAll(/<span[^>]*>\s*([\s\S]*?)\s*<\/span>/gi)];
  for (let i = spans.length - 1; i >= 0; i--) {
    const inner = spans[i][1].trim();
    if (inner) return inner;
  }
  return null;
}

function parseCalloutChunk(trimmed: string, noteTypes: NoteTypeDef[]): Annotation | null {
  const headerMatch = trimmed.match(/^>\s*\[!ob-epub\|([a-z]+)\]\s+(.+)$/m);
  if (!headerMatch) return null;

  const color = headerMatch[1] as HighlightColor;
  if (!HIGHLIGHT_COLORS.find((c) => c.id === color)) return null;

  const parsedHeader = parseCalloutHeader(headerMatch[2], trimmed);
  if (!parsedHeader) return null;

  const cfiRange = extractCfiFromExcerptChunk(trimmed);
  if (!cfiRange) return null;

  const id = resolveAnnotationId(parsedHeader.annId, cfiRange);
  const { chapter, createdIso } = parsedHeader;

  const lines = trimmed.split("\n");
  const headerLineIndex = lines.findIndex((line) =>
    /^>\s*\[!ob-epub\|([a-z]+)\]\s+/.test(line)
  );
  const textLines: string[] = [];
  let quoteEndIndex = lines.length;

  if (headerLineIndex >= 0) {
    for (let i = headerLineIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith(">")) {
        quoteEndIndex = i;
        break;
      }
      const stripped = line.replace(/^>\s?/, "");
      if (stripped.startsWith(`[!${CALLOUT_PREFIX}`)) continue;
      if (/^\^ann-/.test(stripped)) continue;
      if (/^\[回到原文\]\(/.test(stripped)) continue;
      textLines.push(stripped);
      quoteEndIndex = i + 1;
    }
  }

  const text = textLines.join("\n").trim();
  const { note, noteType } = parseExcerptNote(lines, quoteEndIndex, noteTypes);

  return { id, cfiRange, text, color, note, noteType, chapter, created: createdIso };
}

function parseWikiTextAliasChunk(trimmed: string, noteTypes: NoteTypeDef[]): Annotation | null {
  const body = stripLayoutFromBlock(trimmed);
  const lines = body.split("\n");
  const firstLine = lines[0]?.trim() ?? "";
  const wikiOnly = /^\[\[[^\n]+\.epub#cfi=[^\n]+\|[^\n]+\]\]\s*$/.test(firstLine);
  if (!wikiOnly) return null;

  const parsedLink = parseEpubWikiLinkMarkdown(firstLine);
  if (!parsedLink || parsedLink.alias === INLINE_LINK_ALIAS) return null;

  const params = parseEpubSubpath(
    parsedLink.subpath.startsWith("#") ? parsedLink.subpath : `#${parsedLink.subpath}`
  );
  if (!params?.cfi) return null;

  const cfiRange = params.cfi;
  const id = resolveAnnotationId(null, cfiRange);
  const { note, noteType } = parseExcerptNote(lines, 1, noteTypes);

  let text = parsedLink.alias;
  if (isCorruptAnnotationText(text)) {
    const salvaged = salvageTextFromCorruptAlias(parsedLink.alias);
    if (!salvaged) return null;
    text = salvaged;
  }

  return {
    id,
    cfiRange,
    text,
    color: DEFAULT_EXCERPT_HIGHLIGHT_COLOR,
    note,
    noteType,
    chapter: "",
    created: new Date(0).toISOString(),
  };
}

function parseInlineColoredChunk(trimmed: string, noteTypes: NoteTypeDef[]): Annotation | null {
  const body = stripLayoutFromBlock(trimmed);
  const match = body.match(COLORED_INLINE_RE);
  if (!match) return null;

  const parsedLink = parseEpubWikiLinkMarkdown(match[3]);
  if (!parsedLink) return null;

  const params = parseEpubSubpath(
    parsedLink.subpath.startsWith("#") ? parsedLink.subpath : `#${parsedLink.subpath}`
  );
  if (!params?.cfi) return null;

  const cfiRange = params.cfi;
  const id = resolveAnnotationId(null, cfiRange);
  const color = highlightColorFromHex(match[1]);
  const text = match[2].trim();
  const lines = trimmed.split("\n");
  const linkIdx = lines.findIndex((l) => l.includes("|原文]]"));
  const { note, noteType } = parseExcerptNote(lines, linkIdx >= 0 ? linkIdx + 1 : lines.length, noteTypes);

  return {
    id,
    cfiRange,
    text,
    color,
    note,
    noteType,
    chapter: "",
    created: new Date(0).toISOString(),
  };
}

function parseInlineSuffixChunk(trimmed: string, noteTypes: NoteTypeDef[]): Annotation | null {
  const body = stripLayoutFromBlock(trimmed);
  const linkMatch = body.match(/\[\[[^\n]+\.epub#cfi=[^\n]+\|原文\]\]/);
  if (!linkMatch) return null;

  const parsedLink = parseEpubWikiLinkMarkdown(linkMatch[0]);
  if (!parsedLink) return null;

  const params = parseEpubSubpath(
    parsedLink.subpath.startsWith("#") ? parsedLink.subpath : `#${parsedLink.subpath}`
  );
  if (!params?.cfi) return null;

  const linkIndex = body.indexOf(linkMatch[0]);
  let text = body.slice(0, linkIndex).trimEnd();
  const spanWrap = text.match(/^<span[^>]*>\s*([\s\S]*?)\s*<\/span>$/i);
  if (spanWrap) {
    text = spanWrap[1].trim();
  }
  text = text.replace(/^<span[^>]*>\s*<\/span>\s*/i, "").trim();

  const cfiRange = params.cfi;
  const id = resolveAnnotationId(null, cfiRange);
  const lines = trimmed.split("\n");
  const linkIdx = lines.findIndex((l) => l.includes("|原文]]"));
  const { note, noteType } = parseExcerptNote(lines, linkIdx >= 0 ? linkIdx + 1 : lines.length, noteTypes);

  return {
    id,
    cfiRange,
    text,
    color: DEFAULT_EXCERPT_HIGHLIGHT_COLOR,
    note,
    noteType,
    chapter: "",
    created: new Date(0).toISOString(),
  };
}

export function parseExcerptChunk(
  chunk: string,
  _epubFilePath: string,
  noteTypes: NoteTypeDef[]
): Annotation | null {
  const trimmed = stripLayoutFromBlock(chunk).trim() || chunk.trim();
  if (!trimmed) return null;

  const callout = parseCalloutChunk(trimmed, noteTypes);
  if (callout) return callout;

  const wikiAlias = parseWikiTextAliasChunk(trimmed, noteTypes);
  if (wikiAlias) return wikiAlias;

  const colored = parseInlineColoredChunk(trimmed, noteTypes);
  if (colored) return colored;

  const inline = parseInlineSuffixChunk(trimmed, noteTypes);
  if (inline) return inline;

  return null;
}

export function isChunkInCurrentFormat(
  chunk: string,
  ann: Annotation,
  epubPath: string,
  format: SourceLinkFormat,
  formatDate: (date: Date) => string
): boolean {
  if (hasLegacyStandaloneGotoLink(chunk)) return false;
  if (chunk.includes("<!-- ob-epub-cfi:")) return false;

  const expected = buildExcerptBlock(ann, epubPath, format, formatDate).trimEnd();
  return chunk.trimEnd() === expected;
}
