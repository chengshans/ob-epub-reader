/** Expand EPUB.js / epubcfi range to bare start + end paths (EPUB++ wire format). */
export function parseCfiRangeLiteral(rangeCfi: string): { start: string; end: string } {
  let cfi = rangeCfi.trim();
  if (cfi.startsWith("epubcfi(") && cfi.endsWith(")")) {
    cfi = cfi.slice(8, -1);
  }

  const commaIdx1 = cfi.indexOf(",");
  if (commaIdx1 === -1) {
    return { start: cfi, end: cfi };
  }

  const commaIdx2 = cfi.indexOf(",", commaIdx1 + 1);
  if (commaIdx2 === -1) {
    return { start: cfi, end: cfi };
  }

  const prefix = cfi.slice(0, commaIdx1);
  const startSuffix = cfi.slice(commaIdx1 + 1, commaIdx2);
  const endSuffix = cfi.slice(commaIdx2 + 1);

  return {
    start: prefix + startSuffix,
    end: prefix + endSuffix,
  };
}

/** Build epubcfi(...) range from bare start/end paths (EPUB++ expand). */
export function buildCfiRangeLiteral(start: string, end: string): string {
  if (start === end) return wrapBareCfi(start);

  let i = 0;
  while (i < start.length && i < end.length && start[i] === end[i]) {
    i++;
  }
  while (i > 0 && start[i] !== "/") {
    i--;
  }

  const prefix = start.slice(0, i);
  const startSuffix = start.slice(i);
  const endSuffix = end.slice(i);
  return `epubcfi(${prefix},${startSuffix},${endSuffix})`;
}

export function wrapBareCfi(bare: string): string {
  const trimmed = bare.trim();
  if (trimmed.startsWith("epubcfi(")) return trimmed;
  return `epubcfi(${trimmed})`;
}

/** Compact epubcfi range to EPUB++ subpath fields (`cfi=` + optional `end=`). */
export function compactCfiToWire(cfiRange: string): { cfi: string; end?: string } {
  const { start, end } = parseCfiRangeLiteral(cfiRange);
  if (start === end) return { cfi: start };
  return { cfi: start, end };
}

/** Expand EPUB++ wire fields back to a full epubcfi range for navigation. */
export function expandWireToNavigateCfi(wire: { cfi: string; end?: string }): string {
  if (wire.cfi.startsWith("epubcfi(")) return wire.cfi;
  const start = wire.cfi;
  if (wire.end && wire.end !== wire.cfi) {
    return buildCfiRangeLiteral(start, wire.end);
  }
  return wrapBareCfi(start);
}
