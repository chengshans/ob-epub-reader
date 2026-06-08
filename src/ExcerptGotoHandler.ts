import { MarkdownPostProcessorContext, Plugin } from "obsidian";

/** Parse obsidian://ob-epub-goto and tolerate legacy malformed hrefs. */
export function parseObEpubGotoUrl(href: string): { file: string; cfi: string } | null {
  let url = href.trim();
  if (!url) return null;

  if (url.startsWith("%3C")) {
    try { url = decodeURIComponent(url); } catch { /* keep */ }
  }
  if (url.startsWith("<")) url = url.slice(1);
  if (url.endsWith(">)")) url = url.slice(0, -2);
  else if (url.endsWith(">")) url = url.slice(0, -1);

  const protoMatch = url.match(/obsidian:\/\/ob-epub-goto\?(.+)/);
  if (protoMatch) {
    const params = new URLSearchParams(protoMatch[1]);
    const file = params.get("file");
    const cfi = params.get("cfi");
    if (file && cfi) {
      return { file: decodeProtocolParam(file), cfi: decodeProtocolParam(cfi) };
    }
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
    return decoded;
  } catch {
    return value;
  }
}

export function registerExcerptGotoHandler(
  plugin: Plugin,
  openAtCfi: (file: string, cfi: string) => Promise<void>
) {
  const goto = openAtCfi;

  // Wire links in reading/preview mode directly — never let Obsidian open obsidian://
  // (malformed URIs or double-handling with the protocol handler can crash the app).
  plugin.registerMarkdownPostProcessor((el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
    // Callouts first — they locate sibling links by href before we strip it.
    wireObEpubCallouts(el, goto);
    el.querySelectorAll('a[href*="ob-epub-goto"]').forEach((node) => {
      wireGotoAnchor(node as HTMLAnchorElement, goto);
    });
  });
}

function wireGotoAnchor(
  anchor: HTMLAnchorElement,
  goto: (file: string, cfi: string) => Promise<void>
) {
  if (anchor.dataset.obEpubGotoWired === "1") return;

  const parsed = parseObEpubGotoUrl(anchor.getAttribute("href") ?? "");
  if (!parsed) return;

  anchor.dataset.obEpubGotoWired = "1";
  anchor.addClass("ob-epub-goto-link");
  anchor.title = "定位到 EPUB 原文";
  anchor.removeAttribute("href");

  anchor.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void goto(parsed.file, parsed.cfi);
  });
}

function wireObEpubCallouts(
  el: HTMLElement,
  goto: (file: string, cfi: string) => Promise<void>
) {
  el.querySelectorAll('[data-callout="ob-epub"]').forEach((node) => {
    const container = (node.closest(".callout") ?? node) as HTMLElement;
    if (container.dataset.obEpubGotoWired === "1") return;

    const gotoLink = findGotoLinkNear(container);
    if (!gotoLink) return;

    const parsed = parseObEpubGotoUrl(gotoLink.getAttribute("href") ?? "");
    if (!parsed) return;

    container.dataset.obEpubGotoWired = "1";
    container.addClass("ob-epub-goto-callout");
    container.setAttr("title", "点击定位到 EPUB 原文");

    container.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("a")) return;
      e.preventDefault();
      e.stopPropagation();
      void goto(parsed.file, parsed.cfi);
    });
  });
}

function findGotoLinkNear(container: HTMLElement): HTMLAnchorElement | null {
  let sibling: Element | null = container;
  while (sibling) {
    sibling = sibling.nextElementSibling;
    if (!sibling) break;
    if (sibling.classList?.contains("callout")) break;
    if (sibling.tagName === "HR") break;
    const direct = sibling.matches('a[href*="ob-epub-goto"]')
      ? (sibling as HTMLAnchorElement)
      : null;
    const nested = sibling.querySelector('a[href*="ob-epub-goto"]') as HTMLAnchorElement | null;
    if (direct || nested) return direct ?? nested;
  }
  return null;
}
