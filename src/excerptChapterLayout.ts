import { joinTocPath, TOC_PATH_SEP } from "./ChapterResolver";
import { compareCfi } from "./cfi/compare";
import { wikiLinkAliasSuffixPattern } from "./i18n/excerptAliases";
import { isI18nInitialized, t } from "./i18n/i18n";
import type { Annotation } from "./types";

export const UNKNOWN_CHAPTER = "未知章节";

export const CHAPTER_TOC_START = "<!-- ob-epub-chapter-toc-start -->";
export const CHAPTER_TOC_END = "<!-- ob-epub-chapter-toc-end -->";
export const CHAPTER_BODY_START = "<!-- ob-epub-chapter-body-start -->";
export const CHAPTER_BODY_END = "<!-- ob-epub-chapter-body-end -->";

export const OB_EPUB_BLOCK_RE = /^>\s*\[!ob-epub\|/m;

/** Max markdown heading depth used for nested chapter keys (`##` … `######`). */
const MAX_HEADING_PARTS = 5;

const BODY_HEADING_RE = /^(#{2,6})\s+(.+)$/gm;

/** Split a chapter path key into heading segments (`Chapter5 › 1/` → `["Chapter5","1/"]`). */
export function chapterKeyToHeadingParts(key: string): string[] {
  const parts = key
    .split(TOC_PATH_SEP)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= MAX_HEADING_PARTS) return parts;
  return [...parts.slice(0, MAX_HEADING_PARTS - 1), joinTocPath(parts.slice(MAX_HEADING_PARTS - 1))];
}

/**
 * Apply one body heading to the chapter path stack.
 * Legacy flat titles that contain `TOC_PATH_SEP` replace the whole stack.
 */
export function applyChapterHeadingToStack(stack: string[], hashes: number, title: string): void {
  const trimmed = title.trim();
  if (!trimmed) return;

  if (trimmed.includes(TOC_PATH_SEP)) {
    stack.length = 0;
    stack.push(...chapterKeyToHeadingParts(trimmed));
    return;
  }

  const level = Math.min(Math.max(hashes, 2), 6);
  const depth = level - 2;
  stack.length = depth;
  stack.push(trimmed);
}

/** Scan `#{2,6}` headings in text and update the path stack in order. */
export function applyHeadingsFromText(text: string, stack: string[]): void {
  BODY_HEADING_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BODY_HEADING_RE.exec(text)) !== null) {
    const title = match[2].trim();
    if (!title || isChapterTocLabel(title)) continue;
    applyChapterHeadingToStack(stack, match[1].length, title);
  }
}

/** Emit heading lines for the path segments that change vs the previous chapter. */
export function headingLinesForChapterTransition(prevParts: string[], nextParts: string[]): string[] {
  let common = 0;
  while (
    common < prevParts.length &&
    common < nextParts.length &&
    prevParts[common] === nextParts[common]
  ) {
    common++;
  }
  const lines: string[] = [];
  for (let i = common; i < nextParts.length; i++) {
    const level = Math.min(i + 2, 6);
    lines.push(`${"#".repeat(level)} ${nextParts[i]}`);
  }
  return lines;
}

/** Remove leading `##`…`######` chapter headings from an annotation segment. */
export function stripChapterHeadingPrefix(text: string): string {
  let result = text.trim();
  while (/^#{2,6}\s/.test(result)) {
    const next = result.indexOf("\n");
    if (next < 0) return "";
    result = result.slice(next + 1).trimStart();
  }
  return result;
}

function looksLikeAnnotationBlock(text: string): boolean {
  const body = stripChapterHeadingPrefix(text);
  if (!body) return false;
  if (OB_EPUB_BLOCK_RE.test(body)) return true;
  if (/^\[\[[^\n]+\.epub#cfi=[^\n]+\|[^\n]+\]\]\s*$/m.test(body)) return true;
  if (/<span\s+style="color:\s*#/i.test(body)) return true;
  if (new RegExp(wikiLinkAliasSuffixPattern()).test(body)) return true;
  return false;
}

/** Legacy chapter TOC title labels (zh / en). */
const LEGACY_CHAPTER_TOC_LABELS = ["章节目录", "Table of contents"] as const;

function isChapterTocLabel(name: string): boolean {
  if (isI18nInitialized()) {
    const current = t("excerpt.chapterToc").replace(/^##\s+/, "").trim();
    if (name === current) return true;
  }
  return (LEGACY_CHAPTER_TOC_LABELS as readonly string[]).includes(name);
}

/**
 * Extract chapter path from a segment that may include nested `##`/`###` headings
 * (or a legacy flat `## Chapter › leaf` title).
 */
export function extractChapterFromSegment(segment: string): string {
  const stack: string[] = [];
  applyHeadingsFromText(segment, stack);
  return joinTocPath(stack);
}

function excerptAnnotationRegion(content: string): string {
  const bodyStart = content.indexOf(CHAPTER_BODY_START);
  if (bodyStart >= 0) {
    const from = bodyStart + CHAPTER_BODY_START.length;
    const bodyEnd = content.indexOf(CHAPTER_BODY_END);
    return content.slice(from, bodyEnd >= 0 ? bodyEnd : content.length);
  }
  const { preamble, suffix } = splitExcerptRegions(content);
  const preLen = preamble.length;
  const sufLen = suffix.length;
  return content.slice(preLen, content.length - (sufLen > 0 ? sufLen : 0));
}

export interface AnnotationBlockContext {
  block: string;
  /** Chapter from the heading stack preceding this block in grouped layout. */
  contextChapter: string;
}

/**
 * Split excerpt file content into annotation blocks with chapter context.
 * Nested `##`/`###` headings maintain a path stack; blocks after `---` inherit it.
 */
export function extractAnnotationBlocksWithContext(content: string): AnnotationBlockContext[] {
  const region = excerptAnnotationRegion(content);
  const result: AnnotationBlockContext[] = [];
  const stack: string[] = [];

  for (const segment of region.split(/\n+---\n+/)) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    applyHeadingsFromText(trimmed, stack);

    if (!looksLikeAnnotationBlock(trimmed)) continue;

    result.push({ block: trimmed, contextChapter: joinTocPath(stack) });
  }

  return result;
}

/**
 * Split excerpt file content into individual annotation blocks (ignores TOC / YAML).
 * Works for grouped chapter layout and flat `---`-separated files.
 */
export function extractAnnotationBlocksFromExcerpt(content: string): string[] {
  return extractAnnotationBlocksWithContext(content).map((item) => item.block);
}

/** Annotation block separator: blank line above and below `---`. */
export const EXCERPT_CHUNK_SEPARATOR = "\n\n---\n\n";

/** Split excerpt content on `---` (tolerates legacy single-newline separators). */
export function splitExcerptChunks(content: string): string[] {
  return content.split(/\n+---\n+/);
}

export function joinExcerptChunks(chunks: string[]): string {
  if (chunks.length === 0) return "";
  return chunks.map((c) => c.trim()).join(EXCERPT_CHUNK_SEPARATOR);
}

export function normalizeChapterName(chapter: string): string {
  const trimmed = chapter.trim();
  return trimmed || UNKNOWN_CHAPTER;
}

export function groupAnnotationsByChapter(annotations: Annotation[]): Map<string, Annotation[]> {
  const groups = new Map<string, Annotation[]>();
  for (const ann of annotations) {
    const key = normalizeChapterName(ann.chapter);
    const list = groups.get(key);
    if (list) {
      list.push(ann);
    } else {
      groups.set(key, [ann]);
    }
  }
  return groups;
}

/** Minimum CFI in a chapter group (reading-order sort key). */
export function chapterSortKey(annotations: Annotation[]): string {
  if (annotations.length === 0) return "";
  let best = annotations[0].cfiRange;
  for (let i = 1; i < annotations.length; i++) {
    if (compareCfi(annotations[i].cfiRange, best) < 0) {
      best = annotations[i].cfiRange;
    }
  }
  return best;
}

export function sortAnnotationsByCfi(annotations: Annotation[]): Annotation[] {
  return [...annotations].sort((a, b) => compareCfi(a.cfiRange, b.cfiRange));
}

export function sortChapterNames(
  chapterNames: string[],
  groups: Map<string, Annotation[]>,
  tocLabels?: string[]
): string[] {
  const tocOrder = new Map<string, number>();
  if (tocLabels) {
    for (let i = 0; i < tocLabels.length; i++) {
      const label = tocLabels[i].trim();
      if (label && !tocOrder.has(label)) {
        tocOrder.set(label, i);
      }
    }
  }

  return [...chapterNames].sort((a, b) => {
    if (a === UNKNOWN_CHAPTER && b !== UNKNOWN_CHAPTER) return 1;
    if (b === UNKNOWN_CHAPTER && a !== UNKNOWN_CHAPTER) return -1;

    const oa = tocOrder.get(a);
    const ob = tocOrder.get(b);
    if (oa != null && ob != null) return oa - ob;
    if (oa != null) return -1;
    if (ob != null) return 1;

    const groupA = groups.get(a) ?? [];
    const groupB = groups.get(b) ?? [];
    return compareCfi(chapterSortKey(groupA), chapterSortKey(groupB));
  });
}

interface TocTreeNode {
  label: string;
  key: string;
  /** Direct annotation count for this exact path key. */
  leafCount: number;
  children: TocTreeNode[];
}

function insertTocPath(roots: TocTreeNode[], parts: string[], leafCount: number): void {
  let siblings = roots;
  let pathSoFar: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const label = parts[i];
    pathSoFar = [...pathSoFar, label];
    const key = joinTocPath(pathSoFar);
    let node = siblings.find((n) => n.label === label);
    if (!node) {
      node = { label, key, leafCount: 0, children: [] };
      siblings.push(node);
    }
    if (i === parts.length - 1) {
      node.leafCount += leafCount;
    }
    siblings = node.children;
  }
}

function tocNodeTotal(node: TocTreeNode): number {
  return node.leafCount + node.children.reduce((sum, c) => sum + tocNodeTotal(c), 0);
}

function collectTocLabelFreq(nodes: TocTreeNode[], freq: Map<string, number>): void {
  for (const node of nodes) {
    freq.set(node.label, (freq.get(node.label) ?? 0) + 1);
    collectTocLabelFreq(node.children, freq);
  }
}

function renderTocTreeLines(
  nodes: TocTreeNode[],
  indent: number,
  labelFreq: Map<string, number>
): string[] {
  const lines: string[] = [];
  const pad = "  ".repeat(indent);
  for (const node of nodes) {
    const count = tocNodeTotal(node);
    const unique = (labelFreq.get(node.label) ?? 0) === 1;
    const labelText = unique ? `[[#${node.label}|${node.label}]]` : node.label;
    lines.push(`${pad}- ${labelText}（${count}）`);
    lines.push(...renderTocTreeLines(node.children, indent + 1, labelFreq));
  }
  return lines;
}

export function buildChapterTocMarkdown(chapters: string[], counts: Map<string, number>): string {
  const roots: TocTreeNode[] = [];
  for (const chapter of chapters) {
    insertTocPath(roots, chapterKeyToHeadingParts(chapter), counts.get(chapter) ?? 0);
  }
  const labelFreq = new Map<string, number>();
  collectTocLabelFreq(roots, labelFreq);

  const lines = [
    CHAPTER_TOC_START,
    isI18nInitialized() ? t("excerpt.chapterToc") : "## 章节目录",
    "",
    ...renderTocTreeLines(roots, 0, labelFreq),
    CHAPTER_TOC_END,
    "",
  ];
  return lines.join("\n");
}

export function buildGroupedAnnotationBody(
  annotations: Annotation[],
  renderBlock: (ann: Annotation) => string,
  tocLabels?: string[]
): string {
  if (annotations.length === 0) return "";

  const groups = groupAnnotationsByChapter(annotations);
  const chapters = sortChapterNames([...groups.keys()], groups, tocLabels);
  const counts = new Map<string, number>();
  for (const [chapter, list] of groups) {
    counts.set(chapter, list.length);
  }

  const parts: string[] = [buildChapterTocMarkdown(chapters, counts), CHAPTER_BODY_START];
  let needSeparator = false;
  let prevParts: string[] = [];

  for (const chapter of chapters) {
    const list = sortAnnotationsByCfi(groups.get(chapter) ?? []);
    const nextParts = chapterKeyToHeadingParts(chapter);
    let emittedHeadings = false;

    for (const ann of list) {
      if (needSeparator) {
        parts.push(EXCERPT_CHUNK_SEPARATOR);
      }
      if (!emittedHeadings) {
        const headingLines = headingLinesForChapterTransition(prevParts, nextParts);
        if (headingLines.length > 0) {
          parts.push(headingLines.join("\n"), "");
        }
        prevParts = nextParts;
        emittedHeadings = true;
      }
      parts.push(renderBlock(ann).trimEnd());
      needSeparator = true;
    }
  }

  parts.push(CHAPTER_BODY_END);
  return parts.join("\n");
}

/** Preamble: content before plugin-managed chapter region. */
export function extractExcerptPreamble(content: string): string {
  const tocStart = content.indexOf(CHAPTER_TOC_START);
  if (tocStart >= 0) {
    return content.slice(0, tocStart);
  }
  const blockMatch = content.match(OB_EPUB_BLOCK_RE);
  if (blockMatch?.index != null) {
    return content.slice(0, blockMatch.index);
  }
  return content;
}

/** Suffix: content after the last ob-epub annotation block (or after body-end marker). */
export function extractExcerptSuffix(content: string): string {
  const bodyEndIdx = content.indexOf(CHAPTER_BODY_END);
  if (bodyEndIdx >= 0) {
    return content.slice(bodyEndIdx + CHAPTER_BODY_END.length);
  }

  const chunks = splitExcerptChunks(content);
  let lastEnd = 0;
  let searchFrom = 0;

  for (let i = 0; i < chunks.length; i++) {
    const trimmed = chunks[i].trim();
    if (!OB_EPUB_BLOCK_RE.test(trimmed)) continue;

    const chunkStart = content.indexOf(chunks[i], searchFrom);
    if (chunkStart < 0) continue;

    let chunkEnd = chunkStart + chunks[i].length;
    if (i < chunks.length - 1) {
      const sep = content.indexOf(EXCERPT_CHUNK_SEPARATOR, chunkEnd);
      if (sep >= 0) chunkEnd = sep + EXCERPT_CHUNK_SEPARATOR.length;
      else {
        const legacySep = content.indexOf("\n---\n", chunkEnd);
        if (legacySep >= 0) chunkEnd = legacySep + "\n---\n".length;
      }
    }
    lastEnd = Math.max(lastEnd, chunkEnd);
    searchFrom = chunkStart + 1;
  }

  if (lastEnd === 0) return "";
  return content.slice(lastEnd);
}

/** Split excerpt file into preamble, annotations region markers, and trailing suffix. */
export function splitExcerptRegions(content: string): {
  preamble: string;
  suffix: string;
} {
  return {
    preamble: extractExcerptPreamble(content),
    suffix: extractExcerptSuffix(content),
  };
}

export function composeExcerptContent(
  preamble: string,
  groupedBody: string,
  suffix: string
): string {
  const parts: string[] = [];
  const pre = preamble.trimEnd();
  if (pre) parts.push(pre);
  if (groupedBody.trim()) parts.push(groupedBody.trimEnd());
  const suf = suffix.trimStart();
  if (suf) {
    if (parts.length > 0) parts.push("");
    parts.push(suf);
  }
  return parts.join("\n\n") + (parts.length > 0 ? "\n" : "");
}
