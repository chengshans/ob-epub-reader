import { parseCfi, stripAssertions, type CfiComponent, type CfiStep } from "./parse";
import { cfiInnerPayload, unescapeCfiString } from "./cfiString";

/** Compare `/6/4` vs `/6/16` by numeric steps (string compare wrongly puts 16 before 4). */
export function compareCfiSpinePath(spineA: string, spineB: string): number {
  const stepsA = stripAssertions(spineA)
    .split("/")
    .filter(Boolean)
    .map((s) => parseInt(s, 10));
  const stepsB = stripAssertions(spineB)
    .split("/")
    .filter(Boolean)
    .map((s) => parseInt(s, 10));
  const len = Math.max(stepsA.length, stepsB.length);
  for (let i = 0; i < len; i++) {
    const na = stepsA[i];
    const nb = stepsB[i];
    if (na == null && nb == null) return 0;
    if (na == null) return -1;
    if (nb == null) return 1;
    if (!Number.isFinite(na) || !Number.isFinite(nb)) {
      const sa = String(stepsA[i] ?? "");
      const sb = String(stepsB[i] ?? "");
      if (sa < sb) return -1;
      if (sa > sb) return 1;
      continue;
    }
    if (na !== nb) return na - nb;
  }
  return 0;
}

function compareCfiSteps(a: CfiStep[], b: CfiStep[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const sa = a[i];
    const sb = b[i];
    if (!sa && !sb) return 0;
    if (!sa) return -1;
    if (!sb) return 1;
    if (sa.type !== sb.type) return sa.type < sb.type ? -1 : 1;
    if (sa.index !== sb.index) return sa.index - sb.index;
  }
  return 0;
}

function compareCfiComponent(a: CfiComponent, b: CfiComponent): number {
  const stepCmp = compareCfiSteps(a.steps, b.steps);
  if (stepCmp !== 0) return stepCmp;
  const offA = a.terminal?.offset ?? -1;
  const offB = b.terminal?.offset ?? -1;
  return offA - offB;
}

/**
 * Compare reading positions: negative if a before b, positive if a after b, 0 if equal.
 * Ignores bracket assertions per EPUB CFI sorting rules.
 */
export function compareCfi(a: string, b: string): number {
  const left = parseCfi(unescapeCfiString(a));
  const right = parseCfi(unescapeCfiString(b));
  if (!left || !right) return 0;

  const spineA = stripAssertions(cfiInnerPayload(a).split("!")[0]);
  const spineB = stripAssertions(cfiInnerPayload(b).split("!")[0]);
  const spineCmp = compareCfiSpinePath(spineA, spineB);
  if (spineCmp !== 0) return spineCmp;

  const pathA = left.range && left.start ? left.start : left.path;
  const pathB = right.range && right.start ? right.start : right.path;
  return compareCfiComponent(pathA, pathB);
}

/** True when `next` is strictly ahead of `existing` in document order. */
export function isCfiAhead(existing: string, next: string): boolean {
  return compareCfi(existing, next) < 0;
}
