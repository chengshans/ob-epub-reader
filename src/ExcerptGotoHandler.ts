import { App, MarkdownPostProcessorContext, MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { unescapeCfiString } from "./cfi/cfiString";
import {
  collectEpubLinkCandidates,
  isEpubWikiLinkAnchor,
  parseWikiEpubLinkText,
} from "./epubSubpath";

function parseGotoQuery(query: string): { file: string; cfi: string } | null {
  try {
    const params = new URLSearchParams(query);
    const file = params.get("file");
    const cfi = params.get("cfi");
    if (file && cfi) {
      return { file: decodeProtocolParam(file), cfi: decodeProtocolParam(cfi) };
    }
  } catch {
    /* fall through to manual parse */
  }

  const fileMatch = query.match(/(?:^|&)file=([^&]*)/);
  const cfiMatch = query.match(/&cfi=(.+)$/);
  if (fileMatch?.[1] && cfiMatch?.[1]) {
    try {
      return {
        file: decodeProtocolParam(decodeURIComponent(fileMatch[1])),
        cfi: decodeProtocolParam(decodeURIComponent(cfiMatch[1])),
      };
    } catch {
      return {
        file: decodeProtocolParam(fileMatch[1]),
        cfi: decodeProtocolParam(cfiMatch[1]),
      };
    }
  }
  return null;
}

/** Parse obsidian:// / #ob-epub-goto legacy hrefs (kept for migration reads only). */
export function parseObEpubGotoUrl(href: string): { file: string; cfi: string } | null {
  let url = href.trim();
  if (!url) return null;

  if (url.startsWith("%3C")) {
    try { url = decodeURIComponent(url); } catch { /* keep */ }
  }
  if (url.startsWith("<")) url = url.slice(1);
  if (url.endsWith(">)")) url = url.slice(0, -2);
  else if (url.endsWith(">")) url = url.slice(0, -1);

  const queryMatch = url.match(/ob-epub-goto\?([^#\s]+)/);
  if (queryMatch) {
    const parsed = parseGotoQuery(queryMatch[1]);
    if (parsed) return parsed;
  }

  const bareMatch = url.match(/(?:^|\.epub&cfi=|file=)([^&\s]+\.epub)&cfi=(.+)$/i)
    ?? url.match(/\.epub&cfi=(epubcfi\(.+?\)>?)$/i);
  if (bareMatch) {
    const file = bareMatch[1]?.includes(".epub") ? bareMatch[1] : null;
    const cfi = (bareMatch[2] ?? bareMatch[1]).replace(/>$/, "");
    if (file && cfi.startsWith("epubcfi(")) {
      return { file: decodeProtocolParam(file), cfi: decodeProtocolParam(cfi) };
    }
  }

  return null;
}

export function decodeProtocolParam(value: string): string {
  if (!value) return value;
  try {
    let decoded = decodeURIComponent(value);
    if (decoded.includes("%2F") || decoded.includes("%28")) {
      try { decoded = decodeURIComponent(decoded); } catch { /* keep */ }
    }
    return unescapeCfiString(decoded);
  } catch {
    return unescapeCfiString(value);
  }
}

/** Extract annotation block id from `#^ann-xxx` goto links. */
export function extractAnnBlockRefId(href: string): string | null {
  if (!href) return null;
  const match = href.match(/#?\^(ann-[a-z0-9-]+)/i);
  return match?.[1] ?? null;
}

export type GotoResolver = (
  annId: string,
  excerptPath: string
) => Promise<{ file: string; cfi: string } | null>;

function findExcerptPathForElement(app: App, el: HTMLElement): string | null {
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const view = leaf.view as MarkdownView;
    if (view.containerEl.contains(el)) {
      const path = view.file?.path;
      if (path?.endsWith("摘录.md")) return path;
    }
  }
  const active = app.workspace.getActiveFile();
  if (active?.path.endsWith("摘录.md")) return active.path;
  return null;
}

function getAnchorRawHref(anchor: HTMLAnchorElement): string {
  const dataHref = anchor.getAttribute("data-href") ?? anchor.dataset?.href ?? "";
  const attrHref = anchor.getAttribute("href") ?? "";
  return dataHref || attrHref;
}

/** Read goto target from wired dataset or legacy URL forms. */
export function getAnchorGotoHref(anchor: HTMLAnchorElement): string {
  if (anchor.dataset.obEpubGotoFile && anchor.dataset.obEpubGotoCfi) {
    return `#^${anchor.dataset.obEpubGotoAnnId ?? "wired"}`;
  }
  const candidates = collectEpubLinkCandidates(anchor);
  if (candidates.length > 0) return candidates[0];
  try {
    const resolved = anchor.href ?? "";
    if (resolved.includes("ob-epub-goto") || extractAnnBlockRefId(resolved)) return resolved;
  } catch {
    /* ignore */
  }
  return "";
}

function resolveEpubPath(app: App, path: string, sourcePath?: string): string | null {
  const resolved = app.metadataCache.getFirstLinkpathDest(path, sourcePath ?? "");
  if (resolved instanceof TFile && resolved.extension === "epub") return resolved.path;

  const direct = app.vault.getAbstractFileByPath(path);
  if (direct instanceof TFile && direct.extension === "epub") return direct.path;

  return null;
}

function parseAnchorGoto(
  anchor: HTMLAnchorElement,
  app?: App,
  sourcePath?: string
): { file: string; cfi: string } | null {
  if (anchor.dataset.obEpubGotoFile && anchor.dataset.obEpubGotoCfi) {
    return { file: anchor.dataset.obEpubGotoFile, cfi: anchor.dataset.obEpubGotoCfi };
  }

  if (app) {
    for (const candidate of collectEpubLinkCandidates(anchor)) {
      const wiki = parseWikiEpubLinkText(candidate, (path) => resolveEpubPath(app, path, sourcePath));
      if (wiki) return wiki;
    }
  }

  return parseObEpubGotoUrl(getAnchorGotoHref(anchor));
}

function isObEpubCalloutTitleAnchor(anchor: HTMLAnchorElement): boolean {
  const title = anchor.closest(".callout-title, .callout-title-inner");
  if (!title) return false;
  const callout = anchor.closest('[data-callout="ob-epub"]');
  return Boolean(callout);
}

function isObEpubGotoAnchor(anchor: HTMLAnchorElement): boolean {
  if (anchor.dataset.obEpubGotoWired === "1") return true;
  if (isObEpubCalloutTitleAnchor(anchor)) {
    if (isEpubWikiLinkAnchor(anchor)) return true;
    if (extractAnnBlockRefId(getAnchorRawHref(anchor))) return true;
  }
  if (isEpubWikiLinkAnchor(anchor)) return true;
  const raw = getAnchorRawHref(anchor);
  if (extractAnnBlockRefId(raw)) return true;
  if (raw.includes("ob-epub-goto") || raw.includes("obsidian://ob-epub-goto")) return true;
  try {
    const resolved = anchor.href ?? "";
    if (extractAnnBlockRefId(resolved)) return true;
    if (resolved.includes("ob-epub-goto")) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function isGotoLinkElement(el: HTMLAnchorElement): boolean {
  if (isObEpubGotoAnchor(el)) return true;
  const text = el.textContent?.trim();
  return text === "回到原文" || text === "原文";
}

/** @returns true when navigation was handled (or async handler started). */
function dispatchGoto(
  anchor: HTMLAnchorElement,
  goto: (file: string, cfi: string) => Promise<void>,
  resolveAnn: GotoResolver | undefined,
  app: App
): boolean {
  const excerptPath = findExcerptPathForElement(app, anchor) ?? undefined;
  const parsed = parseAnchorGoto(anchor, app, excerptPath);
  if (parsed) {
    void goto(parsed.file, parsed.cfi);
    return true;
  }

  const annId = extractAnnBlockRefId(getAnchorRawHref(anchor));
  if (annId && excerptPath && resolveAnn) {
    void resolveAnn(annId, excerptPath).then((resolved) => {
      if (resolved) {
        void goto(resolved.file, resolved.cfi);
      } else {
        console.error("ob-epub: ann goto resolve failed", annId, excerptPath);
        new Notice("无法解析摘录跳转链接，请重新标注");
      }
    });
    return true;
  }

  // Wiki EPUB link outside wired excerpt handler: defer to workspace.openLinkText (patched in main.ts).
  if (isEpubWikiLinkAnchor(anchor) && !isObEpubCalloutTitleAnchor(anchor)) {
    return false;
  }

  console.error("ob-epub: failed to parse goto link", getAnchorGotoHref(anchor));
  new Notice("无法解析摘录跳转链接，请重新标注或检查摘录格式");
  return true;
}

function findCalloutTitleAnchor(container: HTMLElement): HTMLAnchorElement | null {
  const title = container.querySelector(".callout-title a, .callout-title-inner a");
  return title instanceof HTMLAnchorElement ? title : null;
}

function tryHandleGotoClick(
  target: EventTarget | null,
  goto: (file: string, cfi: string) => Promise<void>,
  resolveAnn: GotoResolver | undefined,
  app: App
): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const anchor = target.closest("a") as HTMLAnchorElement | null;
  if (anchor && isGotoLinkElement(anchor)) {
    const handled = dispatchGoto(anchor, goto, resolveAnn, app);
    if (!handled) return false;
    return true;
  }

  const callout = target.closest(".ob-epub-goto-callout") as HTMLElement | null;
  if (callout && !target.closest("a")) {
    const titleLink = findCalloutTitleAnchor(callout);
    if (titleLink) {
      const handled = dispatchGoto(titleLink, goto, resolveAnn, app);
      if (!handled) return false;
      return true;
    }
    const legacyLink = findLegacyGotoLinkNear(callout);
    if (legacyLink) {
      const handled = dispatchGoto(legacyLink, goto, resolveAnn, app);
      if (!handled) return false;
      return true;
    }
  }

  return false;
}

export function registerExcerptGotoHandler(
  plugin: Plugin,
  openAtCfi: (file: string, cfi: string) => Promise<void>,
  resolveAnn?: GotoResolver
) {
  const goto = openAtCfi;

  const interceptGotoNavigation = (evt: MouseEvent) => {
    if (!tryHandleGotoClick(evt.target, goto, resolveAnn, plugin.app)) return;
    evt.preventDefault();
    evt.stopPropagation();
    evt.stopImmediatePropagation();
  };

  // Block Obsidian default navigation for #^ann / obsidian:// / #ob-epub-goto links.
  plugin.registerDomEvent(document, "mousedown", interceptGotoNavigation, { capture: true });
  plugin.registerDomEvent(document, "click", interceptGotoNavigation, { capture: true });

  plugin.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    if (ctx.sourcePath.endsWith("摘录.md")) {
      hideObEpubCfiComments(el);
    }
    wireObEpubCallouts(el, goto, resolveAnn, ctx.sourcePath, plugin.app);
    el.querySelectorAll("a").forEach((node) => {
      const anchor = node as HTMLAnchorElement;
      if (!isGotoLinkElement(anchor)) return;
      void wireGotoAnchor(anchor, goto, resolveAnn, ctx.sourcePath, plugin.app);
    });
  });
}

const CFI_COMMENT_TEXT_RE = /^<!--\s*ob-epub-cfi:\s*epubcfi\([\s\S]*?\)\s*-->$/;

/** Hide CFI metadata lines in excerpt Live Preview (reading mode already omits HTML comments). */
function hideObEpubCfiComments(container: HTMLElement): void {
  container.querySelectorAll("p, pre, code").forEach((node) => {
    const el = node as HTMLElement;
    if (CFI_COMMENT_TEXT_RE.test(el.textContent?.trim() ?? "")) {
      el.addClass("ob-epub-cfi-hidden");
    }
  });
}

function applyGotoWire(
  anchor: HTMLAnchorElement,
  parsed: { file: string; cfi: string; annId?: string },
  goto: (file: string, cfi: string) => Promise<void>
): void {
  if (anchor.dataset.obEpubGotoWired === "1") return;

  anchor.dataset.obEpubGotoWired = "1";
  anchor.dataset.obEpubGotoFile = parsed.file;
  anchor.dataset.obEpubGotoCfi = parsed.cfi;
  if (parsed.annId) anchor.dataset.obEpubGotoAnnId = parsed.annId;
  anchor.addClass("ob-epub-goto-link");
  anchor.title = "定位到 EPUB 原文";
  anchor.removeAttribute("href");
  anchor.removeAttribute("data-href");

  anchor.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void goto(parsed.file, parsed.cfi);
  });
}

async function wireGotoAnchor(
  anchor: HTMLAnchorElement,
  goto: (file: string, cfi: string) => Promise<void>,
  resolveAnn: GotoResolver | undefined,
  excerptPath: string,
  app: App
): Promise<void> {
  if (anchor.dataset.obEpubGotoWired === "1") return;

  const wired = parseAnchorGoto(anchor, app, excerptPath);
  if (wired) {
    const annId = extractAnnBlockRefId(getAnchorRawHref(anchor)) ?? undefined;
    applyGotoWire(anchor, { ...wired, annId }, goto);
    return;
  }

  const annId = extractAnnBlockRefId(getAnchorRawHref(anchor));
  if (annId && resolveAnn) {
    const resolved = await resolveAnn(annId, excerptPath);
    if (resolved) {
      applyGotoWire(anchor, { ...resolved, annId }, goto);
    }
  }
}

async function wireObEpubCallouts(
  el: HTMLElement,
  goto: (file: string, cfi: string) => Promise<void>,
  resolveAnn: GotoResolver | undefined,
  excerptPath: string,
  app: App
): Promise<void> {
  for (const node of el.querySelectorAll('[data-callout="ob-epub"]')) {
    const container = (node.closest(".callout") ?? node) as HTMLElement;
    if (container.dataset.obEpubGotoWired === "1") continue;

    const titleLink = findCalloutTitleAnchor(container);
    const legacyLink = findLegacyGotoLinkNear(container);
    const gotoLink = titleLink ?? legacyLink;
    if (!gotoLink) continue;

    await wireGotoAnchor(gotoLink, goto, resolveAnn, excerptPath, app);
    const parsed = parseAnchorGoto(gotoLink, app, excerptPath);
    const annId = extractAnnBlockRefId(getAnchorRawHref(gotoLink));
    const resolved =
      parsed ??
      (annId && resolveAnn ? await resolveAnn(annId, excerptPath) : null);
    if (!resolved) continue;

    container.dataset.obEpubGotoWired = "1";
    container.addClass("ob-epub-goto-callout");
    container.setAttr("title", "点击定位到 EPUB 原文");

    container.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("a")) return;
      e.preventDefault();
      e.stopPropagation();
      void goto(resolved.file, resolved.cfi);
    });
  }
}

/** Legacy excerpts: standalone「回到原文」link below the callout. */
function findLegacyGotoLinkNear(container: HTMLElement): HTMLAnchorElement | null {
  let sibling: Element | null = container;
  while (sibling) {
    sibling = sibling.nextElementSibling;
    if (!sibling) break;
    if (sibling.classList?.contains("callout")) break;
    if (sibling.tagName === "HR") break;
    const direct =
      sibling.tagName === "A" && isGotoLinkElement(sibling as HTMLAnchorElement)
        ? (sibling as HTMLAnchorElement)
        : null;
    const nested = Array.from(sibling.querySelectorAll("a")).find((a) =>
      isGotoLinkElement(a as HTMLAnchorElement)
    ) as HTMLAnchorElement | undefined;
    if (direct || nested) return direct ?? nested ?? null;
  }
  return null;
}
