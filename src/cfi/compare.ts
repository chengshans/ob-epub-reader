import { parseCfi, stripAssertions } from "./parse";
import { cfiInnerPayload, unescapeCfiString } from "./cfiString";

function componentKey(component: { steps: { type: string; index: number }[]; terminal: { offset: number } | null }): string {
  const steps = component.steps.map((s) => `${s.type[0]}${s.index}`).join("/");
  const offset = component.terminal?.offset ?? "";
  return `${steps}:${offset}`;
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
  if (spineA < spineB) return -1;
  if (spineA > spineB) return 1;

  const pathA = componentKey(left.range && left.start ? left.start : left.path);
  const pathB = componentKey(right.range && right.start ? right.start : right.path);
  if (pathA < pathB) return -1;
  if (pathA > pathB) return 1;
  return 0;
}

/** True when `next` is strictly ahead of `existing` in document order. */
export function isCfiAhead(existing: string, next: string): boolean {
  return compareCfi(existing, next) < 0;
}
