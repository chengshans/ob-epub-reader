const STYLESHEET_LINK_RE =
  /<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>/gi;

function readStylesheetHref(href: string): Promise<string> {
  if (href.startsWith("data:")) {
    const comma = href.indexOf(",");
    if (comma < 0) return Promise.resolve("");
    const meta = href.slice(0, comma);
    const payload = href.slice(comma + 1);
    const css = meta.includes("base64") ? atob(payload) : decodeURIComponent(payload);
    return Promise.resolve(css);
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", href);
    xhr.responseType = "text";
    xhr.onload = () => resolve(xhr.responseText ?? "");
    xhr.onerror = () => reject(new Error("stylesheet read failed"));
    xhr.send();
  });
}

function extractHref(tag: string): string | null {
  const match = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
  return match?.[1] ?? null;
}

function isBlockedStylesheetHref(href: string): boolean {
  return href.startsWith("blob:") || href.startsWith("data:");
}

function escapeStyleText(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style");
}

const EXECUTABLE_TAGS = new Set(["script"]);
const IFRAME_UNSAFE_TAGS = new Set(["script", "iframe", "object", "embed"]);
const URL_ATTRS = new Set(["src", "href", "xlink:href", "formaction", "action"]);

function elementLocalName(el: Element): string {
  return (el.localName || el.tagName.split(":").pop() || "").toLowerCase();
}

function attrLocalName(attrName: string): string {
  return attrName.toLowerCase();
}

function isUnsafeUrl(value: string): boolean {
  const normalized = value.trim().replace(/[\u0000-\u001F\u007F\s]+/g, "").toLowerCase();
  return (
    normalized.startsWith("javascript:") ||
    normalized.startsWith("vbscript:") ||
    normalized.startsWith("data:text/html") ||
    normalized.startsWith("data:application/xhtml+xml") ||
    normalized.startsWith("data:image/svg+xml")
  );
}

function stripUnsafeAttributes(el: Element, removeSrcdoc: boolean): void {
  for (const attr of Array.from(el.attributes)) {
    const name = attrLocalName(attr.name);
    const localName = name.includes(":") ? name.split(":").pop() ?? name : name;
    if (localName.startsWith("on") || (removeSrcdoc && localName === "srcdoc")) {
      el.removeAttribute(attr.name);
      continue;
    }
    if ((URL_ATTRS.has(name) || URL_ATTRS.has(localName)) && isUnsafeUrl(attr.value)) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (localName === "style" && /(javascript:|vbscript:|expression\s*\()/i.test(attr.value)) {
      el.removeAttribute(attr.name);
    }
  }
}

function stripTagsFromDocument(doc: Document, tags: Set<string>, removeSrcdoc: boolean): void {
  const all = Array.from(doc.getElementsByTagName("*"));
  for (let i = all.length - 1; i >= 0; i--) {
    const el = all[i];
    if (tags.has(elementLocalName(el))) {
      el.parentNode?.removeChild(el);
      continue;
    }
    stripUnsafeAttributes(el, removeSrcdoc);
  }
}

function stripTagsFromHtml(html: string, tags: RegExp, removeEmbedded: boolean): string {
  let result = html;
  if (removeEmbedded) {
    result = result.replace(/<[\w.-]*:?(script|iframe|object)\b[\s\S]*?<\/[\w.-]*:?\1>/gi, "");
    result = result.replace(/<[\w.-]*:?(script|iframe|object|embed)\b[^>]*\/?>/gi, "");
  } else {
    result = result.replace(/<[\w.-]*:?(script)\b[\s\S]*?<\/[\w.-]*:?\1>/gi, "");
    result = result.replace(/<[\w.-]*:?(script)\b[^>]*\/?>/gi, "");
  }
  void tags;
  result = result.replace(/\s[\w:.-]*on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  if (removeEmbedded) {
    result = result.replace(/\ssrcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  }
  result = result.replace(
    /\s([\w:.-]*(?:src|href)|formaction|action)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
    (match, _attrName: string, rawValue: string) => {
      const unquoted = rawValue.replace(/^["']|["']$/g, "");
      return isUnsafeUrl(unquoted) ? "" : match;
    }
  );
  result = result.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (match, rawValue: string) => {
    const unquoted = rawValue.replace(/^["']|["']$/g, "");
    return /(javascript:|vbscript:|expression\s*\()/i.test(unquoted) ? "" : match;
  });
  return result;
}

/** Unwrap noscript fallback bodies when scripting is disabled (EPUB RS fallback). */
export function unwrapNoscriptFallbacks(doc: Document): void {
  for (const ns of Array.from(doc.querySelectorAll("noscript"))) {
    const html = ns.textContent?.trim() ?? "";
    if (!html) {
      ns.remove();
      continue;
    }
    const tpl = doc.createElement("div");
    tpl.innerHTML = html;
    const parent = ns.parentNode;
    if (!parent) continue;
    while (tpl.firstChild) {
      parent.insertBefore(tpl.firstChild, ns);
    }
    parent.removeChild(ns);
  }
}

/** Spine content hook: remove scripts and event handlers only (preserve structure for CFI). */
export function stripExecutableFromDocument(doc: Document): void {
  stripTagsFromDocument(doc, EXECUTABLE_TAGS, false);
  unwrapNoscriptFallbacks(doc);
}

/** Spine serialize: string-level script strip without removing iframe/embed/object. */
export function stripExecutableFromHtml(html: string): string {
  return stripTagsFromHtml(html, /script/i, false);
}

/**
 * Iframe boundary: full sanitization before srcdoc / document.write.
 * Keep in sync with `sanitizeSrcdocHtml` in patches/epubjs+0.3.93.patch.
 */
export function sanitizeIframeHtml(html: string): string {
  return stripTagsFromHtml(html, /script|iframe|object|embed/i, true);
}

/** Spine serialize hook: minimal strip + inline blob/data stylesheets (no XMLSerializer). */
export async function prepareSectionHtmlForSpine(html: string): Promise<string> {
  return inlineStylesheetLinksInHtml(stripExecutableFromHtml(html));
}

/** @deprecated Use prepareSectionHtmlForSpine */
export async function sanitizeSectionHtml(html: string): Promise<string> {
  return prepareSectionHtmlForSpine(html);
}

/** @deprecated Use stripExecutableFromDocument */
export function stripScriptsFromDocument(doc: Document): void {
  stripExecutableFromDocument(doc);
}

/** @deprecated Use sanitizeIframeHtml */
export function stripScriptsFromHtml(html: string): string {
  return sanitizeIframeHtml(html);
}

/** Replace blob:/data: stylesheet links with inline style tags before iframe load. */
export async function inlineStylesheetLinksInHtml(html: string): Promise<string> {
  const tags = html.match(STYLESHEET_LINK_RE);
  if (!tags?.length) return html;

  let result = html;
  for (const tag of tags) {
    const href = extractHref(tag);
    if (!href || !isBlockedStylesheetHref(href)) continue;

    try {
      const css = await readStylesheetHref(href);
      if (!css) {
        result = result.replace(tag, "");
        continue;
      }
      const styleTag = `<style data-ob-epub-inlined="1">${escapeStyleText(css)}</style>`;
      result = result.replace(tag, styleTag);
    } catch (err) {
      console.warn("ob-epub: inline stylesheet in serialize failed", href, err);
      result = result.replace(tag, "");
    }
  }
  return result;
}

export { readStylesheetHref, isBlockedStylesheetHref };
