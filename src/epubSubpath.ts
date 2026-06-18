import { extractEpubCfiLiteral } from "./cfi/cfiString";
import { compactCfiToWire, expandWireToNavigateCfi } from "./cfi/cfiCompact";

/** Split `path/file.epub#fragment|alias` (Obsidian wikilink text) into path + subpath. */
export function splitWikiLinkText(linktext: string): { path: string; subpath: string } {
  let text = linktext.trim();
  const pipe = text.lastIndexOf("|");
  if (pipe > 0) text = text.slice(0, pipe);
  const hash = text.indexOf("#");
  if (hash < 0) return { path: text, subpath: "" };
  return { path: text.slice(0, hash), subpath: text.slice(hash) };
}

/** Input for building EPUB++-style wiki links from annotation CFI. */
export interface EpubWikiLinkInput {
  cfiRange: string;
}

/** Legacy optional fields still parsed from old links; not written to new links. */
export interface EpubSubpathMeta {
  text?: string;
  chapter?: string;
  color?: string;
}

/** Parsed subpath — `cfi` is always a full `epubcfi(...)` for navigation. */
export interface EpubSubpathParams extends EpubSubpathMeta {
  cfi: string;
}

/** Parse `#cfi=/6/14!/4/2/1:0&end=...&text=...` (EPUB++ style) or legacy `#cfi=epubcfi(...)`. */
export function parseEpubSubpath(subpath: string): EpubSubpathParams | null {
  if (!subpath) return null;
  const raw = subpath.startsWith("#") ? subpath.slice(1) : subpath;
  if (!raw.includes("cfi=")) return null;

  const meta = {
    text: decodeOptionalParam(parseParamValue(raw, "text")),
    chapter: decodeOptionalParam(parseParamValue(raw, "chapter")),
    color: parseParamValue(raw, "color") ?? undefined,
  };

  const cfiLiteral = extractEpubCfiLiteral(raw);
  if (cfiLiteral) {
    return { cfi: cfiLiteral, ...meta };
  }

  const bareStart = parseParamValue(raw, "cfi");
  if (!bareStart) return null;

  const bareEnd = parseParamValue(raw, "end") ?? undefined;
  const navigateCfi = expandWireToNavigateCfi({ cfi: bareStart, end: bareEnd });
  return { cfi: navigateCfi, ...meta };
}

/** Build EPUB++ fragment: `#cfi=/6/14!/4/2/1:0&end=...` (no epubcfi wrapper). */
export function buildEpubSubpath(input: EpubWikiLinkInput): string {
  const wire = compactCfiToWire(input.cfiRange);
  const parts: string[] = [`cfi=${wire.cfi}`];
  if (wire.end) parts.push(`end=${wire.end}`);
  return `#${parts.join("&")}`;
}

/** Build `[[path.epub#cfi=/6/14!/4/2/1:0&...|alias]]` (EPUB++ style). */
export function buildEpubWikiLink(
  epubPath: string,
  input: EpubWikiLinkInput,
  alias = "回到原文"
): string {
  const fragment = buildEpubSubpath(input).slice(1);
  return `[[${epubPath}#${fragment}|${escapeWikiAlias(alias)}]]`;
}

/** Escape special characters in Obsidian wiki-link alias. */
export function escapeWikiAlias(alias: string): string {
  return alias.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\]/g, "\\]");
}

/** Unescape Obsidian wiki-link alias. */
export function unescapeWikiAlias(alias: string): string {
  let result = "";
  for (let i = 0; i < alias.length; i++) {
    if (alias[i] === "\\" && i + 1 < alias.length) {
      result += alias[i + 1];
      i += 1;
    } else {
      result += alias[i];
    }
  }
  return result;
}

function findLastUnescapedPipe(text: string): number {
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] !== "|") continue;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && text[j] === "\\"; j--) backslashes++;
    if (backslashes % 2 === 0) return i;
  }
  return -1;
}

/** Parse `[[path.epub#cfi=...|alias]]` markdown (supports `]` inside CFI). */
export function parseEpubWikiLinkMarkdown(
  markdown: string
): { path: string; subpath: string; alias: string } | null {
  const trimmed = markdown.trim();
  const linkStart = trimmed.indexOf("[[");
  const linkEnd = trimmed.lastIndexOf("]]");
  if (linkStart < 0 || linkEnd <= linkStart) return null;

  const inner = trimmed.slice(linkStart + 2, linkEnd);
  const pipe = findLastUnescapedPipe(inner);
  if (pipe <= 0) return null;

  const linkBody = inner.slice(0, pipe);
  const alias = unescapeWikiAlias(inner.slice(pipe + 1));
  const hash = linkBody.indexOf("#");
  if (hash < 0) return null;

  const path = linkBody.slice(0, hash);
  const subpath = linkBody.slice(hash);
  if (!path.toLowerCase().endsWith(".epub") || !subpath.includes("cfi=")) return null;

  return { path, subpath, alias };
}

/** Match EPUB wiki links in markdown; CFI wire form may contain `]` (e.g. `[calibre_pb_0]`). */
export const EPUB_WIKI_LINK_MD_RE = /\[\[[^\]]+\.epub#cfi=.+\|[^\]]+\]\]/g;

/** Legacy standalone goto wiki links with alias「回到原文」. */
export const LEGACY_GOTO_WIKI_LINK_RE = /\[\[[^\]]+\.epub#cfi=.+\|回到原文\]\]/g;

/** @deprecated use LEGACY_GOTO_WIKI_LINK_RE */
export const GOTO_WIKI_LINK_RE = LEGACY_GOTO_WIKI_LINK_RE;

/** Line-anchored variant for stripping standalone legacy wiki goto lines. */
export const LEGACY_GOTO_WIKI_LINK_LINE_RE =
  /^>?\s*\[\[[^\]]+\.epub#cfi=.+\|回到原文\]\]\s*$/gm;

/** @deprecated use LEGACY_GOTO_WIKI_LINK_LINE_RE */
export const GOTO_WIKI_LINK_LINE_RE = LEGACY_GOTO_WIKI_LINK_LINE_RE;

const LEGACY_WIKI_GOTO_PARSE_RE = /\[\[([^\]|]+\.epub)#(.+)\|回到原文\]\]/i;

/** Strip legacy `text` / `chapter` / `color` params from legacy wiki goto links. */
export function slimWikiGotoLink(link: string): string | null {
  const match = link.match(LEGACY_WIKI_GOTO_PARSE_RE);
  if (!match) return null;

  const parsed = parseEpubSubpath(`#${match[2]}`);
  if (!parsed?.cfi) return null;

  const slim = buildEpubWikiLink(match[1], { cfiRange: parsed.cfi }, "回到原文");
  return slim === link ? null : slim;
}

/** Replace verbose legacy wiki goto links in excerpt markdown with cfi/end-only form. */
export function slimWikiGotoLinksInContent(content: string): string {
  return content.replace(LEGACY_GOTO_WIKI_LINK_RE, (link) => slimWikiGotoLink(link) ?? link);
}

/** Extract navigate CFI from any EPUB wiki link markdown in text. */
export function extractCfiFromWikiLink(text: string): string | null {
  const linkMatch = text.match(/\[\[[^\n]+\.epub#cfi=[^\n]+\]\]/i);
  if (!linkMatch) return null;
  const parsed = parseEpubWikiLinkMarkdown(linkMatch[0]);
  if (!parsed) return null;
  const params = parseEpubSubpath(parsed.subpath.startsWith("#") ? parsed.subpath : `#${parsed.subpath}`);
  return params?.cfi ?? null;
}

/** True when line is a goto source link (block-ref, markdown, or wiki). */
export function isSourceLinkLine(line: string): boolean {
  const trimmed = line.trim();
  if (/^\[回到原文\]\(/.test(trimmed)) return true;
  if (/^\[\[[^\]]+\.epub#cfi=/i.test(trimmed)) return true;
  if (/\[\[[^\n]+\.epub#cfi=[^\n]+\|原文\]\]\s*$/.test(trimmed)) return true;
  return false;
}

/** Collect possible link strings from a rendered Obsidian internal-link anchor. */
export function collectEpubLinkCandidates(anchor: HTMLAnchorElement): string[] {
  const out: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  };

  push(anchor.getAttribute("data-href") ?? "");
  const attrHref = anchor.getAttribute("href") ?? "";
  push(attrHref);

  if (attrHref.includes(".epub") && anchor.hash.includes("cfi=")) {
    push(`${attrHref.replace(/#.*$/, "")}${anchor.hash}`);
  } else if (!attrHref.includes("#") && anchor.hash.includes("cfi=")) {
    push(`${attrHref}${anchor.hash}`);
  }

  try {
    push(anchor.href ?? "");
  } catch {
    /* ignore */
  }

  const expanded = [...out];
  for (const candidate of expanded) {
    try {
      push(decodeURIComponent(candidate));
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Parse wiki / internal-link text like `path/book.epub#cfi=...|alias` into file + CFI. */
export function parseWikiEpubLinkText(
  linktext: string,
  resolvePath: (path: string) => string | null
): { file: string; cfi: string } | null {
  let text = linktext.trim();
  if (!text || !text.includes("cfi=")) return null;

  text = text.replace(/^app:\/\/obsidian\.md\//i, "");
  text = text.replace(/^obsidian:\/\/open\?file=/i, "");
  if (text.includes("%23")) {
    try {
      text = decodeURIComponent(text);
    } catch {
      /* keep */
    }
  }

  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
      const url = new URL(text);
      const combined = decodeURIComponent(`${url.pathname}${url.search}${url.hash}`).replace(/^\//, "");
      if (combined.includes("cfi=")) text = combined;
    }
  } catch {
    /* not a URL */
  }

  const { path, subpath } = splitWikiLinkText(text);
  if (!path.toLowerCase().endsWith(".epub")) return null;
  if (!subpath?.includes("cfi=")) return null;

  const params = parseEpubSubpath(subpath.startsWith("#") ? subpath : `#${subpath}`);
  if (!params?.cfi) return null;

  const resolved = resolvePath(path);
  if (!resolved) return null;
  return { file: resolved, cfi: params.cfi };
}

/** True when anchor looks like an EPUB wiki deep link (even before wiring). */
export function isEpubWikiLinkAnchor(anchor: HTMLAnchorElement): boolean {
  for (const candidate of collectEpubLinkCandidates(anchor)) {
    if (/\.epub/i.test(candidate) && candidate.includes("cfi=")) return true;
    if (/cfi=\/\d+/i.test(candidate) || /cfi=epubcfi\(/i.test(candidate)) return true;
  }
  return false;
}

function parseParamValue(raw: string, key: string): string | null {
  const prefix = `${key}=`;
  const start = raw.indexOf(prefix);
  if (start < 0) return null;

  let value = raw.slice(start + prefix.length);
  const nextAmp = value.indexOf("&");
  if (nextAmp >= 0) value = value.slice(0, nextAmp);
  return value || null;
}

function decodeOptionalParam(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
