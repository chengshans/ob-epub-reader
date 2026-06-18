import { compareCfi } from "./cfi/compare";
import type { Annotation } from "./types";

export const UNKNOWN_CHAPTER = "未知章节";

export const CHAPTER_TOC_START = "<!-- ob-epub-chapter-toc-start -->";
export const CHAPTER_TOC_END = "<!-- ob-epub-chapter-toc-end -->";
export const CHAPTER_BODY_START = "<!-- ob-epub-chapter-body-start -->";
export const CHAPTER_BODY_END = "<!-- ob-epub-chapter-body-end -->";

export const OB_EPUB_BLOCK_RE = /^>\s*\[!ob-epub\|/m;

/** Remove leading `## 章节` headings from an annotation segment. */
export function stripChapterHeadingPrefix(text: string): string {
  let result = text.trim();
  while (result.startsWith("##")) {
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
  if (/\[\[[^\n]+\.epub#cfi=[^\n]+\|原文\]\]/.test(body)) return true;
  return false;
}

/** Extract chapter name from a segment that may include a `## 章节` heading. */
export function extractChapterFromSegment(segment: string): string {
  const match = segment.trim().match(/^##\s+([^\n]+)/m);
  return match?.[1]?.trim() ?? "";
}

/**
 * Split excerpt file content into individual annotation blocks (ignores TOC / YAML).
 * Works for grouped chapter layout and flat `---`-separated files.
 */
export function extractAnnotationBlocksFromExcerpt(content: string): string[] {
  const bodyStart = content.indexOf(CHAPTER_BODY_START);
  let region: string;
  if (bodyStart >= 0) {
    const from = bodyStart + CHAPTER_BODY_START.length;
    const bodyEnd = content.indexOf(CHAPTER_BODY_END);
    region = content.slice(from, bodyEnd >= 0 ? bodyEnd : content.length);
  } else {
    const { preamble, suffix } = splitExcerptRegions(content);
    const preLen = preamble.length;
    const sufLen = suffix.length;
    region = content.slice(preLen, content.length - (sufLen > 0 ? sufLen : 0));
  }

  const blocks: string[] = [];
  for (const segment of region.split(/\n+---\n+/)) {
    const trimmed = segment.trim();
    if (!trimmed || !looksLikeAnnotationBlock(trimmed)) continue;
    blocks.push(trimmed);
  }
  return blocks;
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

export function buildChapterTocMarkdown(chapters: string[], counts: Map<string, number>): string {
  const lines = [CHAPTER_TOC_START, "## 章节目录", ""];
  for (const chapter of chapters) {
    const count = counts.get(chapter) ?? 0;
    lines.push(`- [[#${chapter}|${chapter}]]（${count}）`);
  }
  lines.push(CHAPTER_TOC_END, "");
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

  for (const chapter of chapters) {
    const list = sortAnnotationsByCfi(groups.get(chapter) ?? []);
    parts.push(`## ${chapter}`, "");
    for (const ann of list) {
      if (needSeparator) {
        parts.push(EXCERPT_CHUNK_SEPARATOR);
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
