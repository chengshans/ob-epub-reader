/** Unescape EPUB CFI circumflex-encoded delimiters (^[, ^], etc.). */
export function unescapeCfiString(str: string): string {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    if (str[i] === "^" && i + 1 < str.length) {
      out += str[i + 1];
      i++;
    } else {
      out += str[i];
    }
  }
  return out;
}

/** True when outer `epubcfi(...)` parentheses are balanced (respects ^ escapes). */
export function isBalancedEpubCfi(str: string): boolean {
  const trimmed = str.trim();
  if (!trimmed.startsWith("epubcfi(") || !trimmed.endsWith(")")) return false;

  let depth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "^" && i + 1 < trimmed.length) {
      i++;
      continue;
    }
    if (trimmed[i] === "(") depth++;
    if (trimmed[i] === ")") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** Extract a complete `epubcfi(...)` literal from arbitrary text (supports range CFIs). */
export function extractEpubCfiLiteral(text: string): string | null {
  const start = text.indexOf("epubcfi(");
  if (start < 0) return null;

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "^" && i + 1 < text.length) {
      i++;
      continue;
    }
    if (text[i] === "(") depth++;
    if (text[i] === ")") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Strip `epubcfi(` prefix and trailing `)`. */
export function cfiInnerPayload(cfi: string): string {
  const trimmed = cfi.trim();
  if (!trimmed.startsWith("epubcfi(") || !trimmed.endsWith(")")) return trimmed;
  return trimmed.slice(8, -1);
}
