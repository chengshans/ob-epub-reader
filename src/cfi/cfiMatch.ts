import { cfiInnerPayload, unescapeCfiString } from "./cfiString";

const STEP_RE = /\/(\d+)(?:\[[^\]]*\])?/g;

/** Last numeric step index in the package base path (spine itemref), before `!`. */
export function parseSpineItemRefIndex(cfi: string): number {
  const inner = cfiInnerPayload(unescapeCfiString(cfi));
  const bang = inner.indexOf("!");
  if (bang < 0) return 0;

  const basePart = inner.slice(0, bang);
  const steps = [...basePart.matchAll(STEP_RE)];
  if (steps.length === 0) return 0;
  return Number(steps[steps.length - 1][1]) || 0;
}

export interface ContentCfiParts {
  /** Path steps after `!`, before terminal offset (no assertions). */
  stepPath: string;
  offset: number | null;
}

/** Parse content-document path from a point or range CFI (uses parent path for ranges). */
export function parseContentCfiParts(cfi: string): ContentCfiParts | null {
  const inner = cfiInnerPayload(unescapeCfiString(cfi));
  const bang = inner.indexOf("!");
  if (bang < 0) return null;

  let rest = inner.slice(bang + 1);
  const comma = rest.indexOf(",");
  if (comma >= 0) rest = rest.slice(0, comma);

  const offsetMatch = rest.match(/:(\d+)(?:\[|;|$)/);
  const offset = offsetMatch ? Number(offsetMatch[1]) : null;
  const stepPath = rest.replace(/:(\d+).*$/, "").replace(/\[.*$/, "");
  return { stepPath, offset };
}

export interface CfiProgressMatchOptions {
  /** Minimum matching content steps after `!` (each `/N` segment). */
  minContentSteps?: number;
  /** Max character offset delta when both CFIs have `:offset`. */
  offsetTolerance?: number;
}

/**
 * Stricter than legacy spine-only match: same itemref + similar in-chapter position.
 */
export function cfiProgressMatches(
  target: string,
  actual: string,
  options: CfiProgressMatchOptions = {}
): boolean {
  const minContentSteps = options.minContentSteps ?? 2;
  const offsetTolerance = options.offsetTolerance ?? 80;

  if (!target || !actual) return false;
  const t = unescapeCfiString(target.trim());
  const a = unescapeCfiString(actual.trim());
  if (t === a) return true;

  if (parseSpineItemRefIndex(t) !== parseSpineItemRefIndex(a)) return false;

  const tParts = parseContentCfiParts(t);
  const aParts = parseContentCfiParts(a);
  if (!tParts || !aParts) return false;

  const tSteps = [...tParts.stepPath.matchAll(STEP_RE)].map((m) => m[1]);
  const aSteps = [...aParts.stepPath.matchAll(STEP_RE)].map((m) => m[1]);
  const compareLen = Math.min(minContentSteps, tSteps.length, aSteps.length);
  if (compareLen === 0) return true;

  for (let i = 0; i < compareLen; i++) {
    if (tSteps[i] !== aSteps[i]) return false;
  }

  if (tParts.offset != null && aParts.offset != null) {
    return Math.abs(tParts.offset - aParts.offset) <= offsetTolerance;
  }

  return true;
}

/** Spine itemref step index for comparing reading depth (replaces hardcoded `/6/`). */
export function cfiSpineKey(cfi: string): number {
  return parseSpineItemRefIndex(cfi);
}
