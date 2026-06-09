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

/** Read the real target URL from Obsidian-rendered anchors (href / data-href / resolved .href). */
export function getAnchorGotoHref(anchor: HTMLAnchorElement): string {
  if (anchor.dataset.obEpubGotoFile && anchor.dataset.obEpubGotoCfi) {
    const params = new URLSearchParams();
    params.set("file", anchor.dataset.obEpubGotoFile);
    params.set("cfi", anchor.dataset.obEpubGotoCfi);
    return `obsidian://ob-epub-goto?${params.toString()}`;
  }
  const dataHref = anchor.getAttribute("data-href") ?? anchor.dataset?.href ?? "";
  const attrHref = anchor.getAttribute("href") ?? "";
  if (attrHref.includes("ob-epub-goto")) return attrHref;
  if (dataHref.includes("ob-epub-goto")) return dataHref;
  // Obsidian may rewrite href; resolved property often keeps obsidian:// intact.
  try {
    const resolved = anchor.href ?? "";
    if (resolved.includes("ob-epub-goto")) return resolved;
  } catch {
    /* ignore */
  }
  return attrHref || dataHref;
}

function parseAnchorGoto(anchor: HTMLAnchorElement): { file: string; cfi: string } | null {
  if (anchor.dataset.obEpubGotoFile && anchor.dataset.obEpubGotoCfi) {
    return { file: anchor.dataset.obEpubGotoFile, cfi: anchor.dataset.obEpubGotoCfi };
  }
  return parseObEpubGotoUrl(getAnchorGotoHref(anchor));
}

function tryHandleGotoClick(
  target: EventTarget | null,
  goto: (file: string, cfi: string) => Promise<void>
): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const anchor = target.closest("a") as HTMLAnchorElement | null;
  if (anchor) {
    const parsed = parseAnchorGoto(anchor);
    if (parsed) {
      void goto(parsed.file, parsed.cfi);
      return true;
    }
  }

  const callout = target.closest(".ob-epub-goto-callout") as HTMLElement | null;
  if (callout && !target.closest("a")) {
    const link = findGotoLinkNear(callout);
    if (link) {
      const parsed = parseAnchorGoto(link);
      if (parsed) {
        void goto(parsed.file, parsed.cfi);
        return true;
      }
    }
  }

  return false;
}

export function registerExcerptGotoHandler(
  plugin: Plugin,
  openAtCfi: (file: string, cfi: string) => Promise<void>
) {
  const goto = openAtCfi;

  // Capture-phase handler: works even when Obsidian rewrites href or post-processor misses a pass.
  plugin.registerDomEvent(
    document,
    "click",
    (evt: MouseEvent) => {
      if (!tryHandleGotoClick(evt.target, goto)) return;
      evt.preventDefault();
      evt.stopPropagation();
    },
    { capture: true }
  );

  // Wire links in reading/preview mode directly — never let Obsidian open obsidian://
  // (malformed URIs or double-handling with the protocol handler can crash the app).
  plugin.registerMarkdownPostProcessor((el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
    // Callouts first — they locate sibling links by href before we strip it.
    wireObEpubCallouts(el, goto);
    el.querySelectorAll("a").forEach((node) => {
      const anchor = node as HTMLAnchorElement;
      if (!getAnchorGotoHref(anchor).includes("ob-epub-goto")) return;
      wireGotoAnchor(anchor, goto);
    });
  });
}

function wireGotoAnchor(
  anchor: HTMLAnchorElement,
  goto: (file: string, cfi: string) => Promise<void>
) {
  if (anchor.dataset.obEpubGotoWired === "1") return;

  const parsed = parseAnchorGoto(anchor);
  if (!parsed) return;

  anchor.dataset.obEpubGotoWired = "1";
  anchor.dataset.obEpubGotoFile = parsed.file;
  anchor.dataset.obEpubGotoCfi = parsed.cfi;
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

function wireObEpubCallouts(
  el: HTMLElement,
  goto: (file: string, cfi: string) => Promise<void>
) {
  el.querySelectorAll('[data-callout="ob-epub"]').forEach((node) => {
    const container = (node.closest(".callout") ?? node) as HTMLElement;
    if (container.dataset.obEpubGotoWired === "1") return;

    const gotoLink = findGotoLinkNear(container);
    if (!gotoLink) return;

    const parsed = parseAnchorGoto(gotoLink);
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
    const direct =
      sibling.tagName === "A" && getAnchorGotoHref(sibling as HTMLAnchorElement).includes("ob-epub-goto")
        ? (sibling as HTMLAnchorElement)
        : null;
    const nested = Array.from(sibling.querySelectorAll("a")).find((a) =>
      getAnchorGotoHref(a as HTMLAnchorElement).includes("ob-epub-goto")
    ) as HTMLAnchorElement | undefined;
    if (direct || nested) return direct ?? nested;
  }
  return null;
}
