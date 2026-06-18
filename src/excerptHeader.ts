import { buildEpubWikiLink } from "./epubSubpath";
import type { Annotation, SourceLinkFormat } from "./types";

const CHAPTER_DATE_RE = /^(.*?)\s·\s(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(?::\d{2})?)$/;

export interface ParsedCalloutHeader {
  chapter: string;
  createdIso: string;
  annId: string | null;
}

export function buildTitleAlias(
  chapter: string,
  createdIso: string,
  formatDate: (date: Date) => string
): string {
  return `${chapter} · ${formatDate(new Date(createdIso))}`;
}

export function buildTitleAliasFromAnn(
  ann: Annotation,
  formatDate: (date: Date) => string
): string {
  return buildTitleAlias(ann.chapter, ann.created, formatDate);
}

/** Stable block id when wiki title format omits ^ann-id in the file. */
export function annIdFromCfi(cfiRange: string): string {
  let hash = 2166136261;
  for (let i = 0; i < cfiRange.length; i++) {
    hash ^= cfiRange.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `ann-${(hash >>> 0).toString(36)}`;
}

export function resolveAnnotationId(annId: string | null | undefined, cfiRange: string): string {
  return annId ?? annIdFromCfi(cfiRange);
}

/** Callout header body (without `> [!ob-epub|color]` prefix). */
export function buildCalloutHeaderLine(
  ann: Annotation,
  epubPath: string,
  format: SourceLinkFormat,
  formatDate: (date: Date) => string
): string {
  const alias = buildTitleAliasFromAnn(ann, formatDate);
  void format;
  return buildEpubWikiLink(epubPath, { cfiRange: ann.cfiRange }, alias);
}

export function parseChapterDateFromTitle(titleText: string): {
  chapter: string;
  createdIso?: string;
} {
  const match = titleText.trim().match(CHAPTER_DATE_RE);
  if (!match) return { chapter: titleText.trim() };
  return {
    chapter: match[1].trim(),
    createdIso: localDateTimeToIso(match[2]),
  };
}

function localDateTimeToIso(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return new Date(value).toISOString();
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0)
  ).toISOString();
}

/** Parse ob-epub callout header (legacy plain text or title-linked formats). */
export function parseCalloutHeader(headerRest: string, chunk: string): ParsedCalloutHeader | null {
  const trimmed = headerRest.trim();

  const wikiMatch = trimmed.match(
    /^\[\[[^\]]+\.epub#cfi=.+\|([^\]]+)\]\](?:\s+\^(ann-[a-z0-9-]+))?$/i
  );
  if (wikiMatch) {
    const { chapter, createdIso } = parseChapterDateFromTitle(wikiMatch[1]);
    const annId = wikiMatch[2] ?? chunk.match(/\^(ann-[a-z0-9-]+)/i)?.[1] ?? null;
    return {
      chapter,
      createdIso: createdIso ?? new Date(0).toISOString(),
      annId,
    };
  }

  const blockMatch = trimmed.match(
    /^\[([^\]]+)\]\(#?\^(ann-[a-z0-9-]+)\)(?:\s+\^(ann-[a-z0-9-]+))?$/i
  );
  if (blockMatch) {
    const annId = blockMatch[2];
    const { chapter, createdIso } = parseChapterDateFromTitle(blockMatch[1]);
    return {
      chapter,
      createdIso: createdIso ?? new Date(0).toISOString(),
      annId,
    };
  }

  const legacyMatch = trimmed.match(/^(.*?)(?:\s+\^(ann-[a-z0-9-]+))?\s*$/i);
  if (!legacyMatch) return null;

  const annId = legacyMatch[2] ?? chunk.match(/\^(ann-[a-z0-9-]+)/i)?.[1] ?? null;
  const { chapter, createdIso } = parseChapterDateFromTitle(legacyMatch[1].trim());
  return {
    chapter,
    createdIso: createdIso ?? new Date(0).toISOString(),
    annId,
  };
}

export function isTitleLinkedHeader(headerRest: string): boolean {
  const trimmed = headerRest.trim();
  if (/^\[\[[^\]]+\.epub#cfi=/i.test(trimmed)) return true;
  if (/^\[[^\]]+\]\(#?\^ann-/i.test(trimmed)) return true;
  return false;
}

export function hasLegacyStandaloneGotoLink(chunk: string): boolean {
  if (/\[回到原文\]\([^)\n]+\)/.test(chunk)) return true;
  return LEGACY_GOTO_WIKI_LINK_LINE_RE.test(chunk);
}

/** Standalone legacy wiki goto lines (`[[...|回到原文]]` on their own line). */
export const LEGACY_GOTO_WIKI_LINK_LINE_RE =
  /^>?\s*\[\[[^\]]+\.epub#cfi=.+\|回到原文\]\]\s*$/gm;
