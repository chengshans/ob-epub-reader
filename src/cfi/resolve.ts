import { nodeForEpubjsStep, resolveElementStep } from "./nodeIndex";
import type { CfiComponent, CfiStep } from "./parse";

const DOCUMENT_NODE = 9;
const TEXT_NODE = 3;

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Text assertion correction: find offset within text chunk matching assertion prefix. */
export function correctOffsetByTextAssertion(
  textContent: string,
  offset: number,
  assertion: string | null
): number {
  if (!assertion) return offset;
  const parts = assertion.split(",");
  const before = parts[0] ?? "";
  const after = parts[1] ?? "";
  const normalized = collapseWhitespace(textContent);

  if (before) {
    const idx = normalized.indexOf(collapseWhitespace(before));
    if (idx >= 0) return idx + collapseWhitespace(before).length;
  }
  if (after) {
    const idx = normalized.indexOf(collapseWhitespace(after));
    if (idx >= 0) return idx;
  }
  return offset;
}

function walkSteps(
  doc: Document,
  root: Node,
  steps: CfiStep[],
  ignoreClass?: string
): Node | null {
  let container: Node | null = root;
  for (const step of steps) {
    if (!container) return null;
    container = resolveElementStep(doc, container, step, ignoreClass);
  }
  return container;
}

export function resolveComponentToNode(
  doc: Document,
  component: CfiComponent,
  ignoreClass?: string
): { node: Node | null; offset: number } {
  const root = doc.documentElement;
  const steps = component.steps;
  if (steps.length === 0) {
    return { node: root, offset: component.terminal?.offset ?? 0 };
  }

  const parentSteps = steps.slice(0, -1);
  const last = steps[steps.length - 1];
  let container: Node | null = parentSteps.length ? walkSteps(doc, root, parentSteps, ignoreClass) : root;
  if (!container) return { node: null, offset: 0 };

  let node: Node | null = null;
  if (last.id && last.type === "element") {
    node = doc.getElementById(last.id);
  }
  if (!node) {
    node = resolveElementStep(doc, container, last, ignoreClass);
  }

  let offset = component.terminal?.offset ?? 0;
  if (node && component.terminal?.assertion && node.nodeType === TEXT_NODE) {
    offset = correctOffsetByTextAssertion(node.textContent ?? "", offset, component.terminal.assertion);
  }

  return { node, offset };
}

export function componentToRange(
  doc: Document,
  component: CfiComponent,
  ignoreClass?: string
): Range | null {
  const { node, offset } = resolveComponentToNode(doc, component, ignoreClass);
  if (!node) return null;

  const range = doc.createRange();
  if (node.nodeType === TEXT_NODE) {
    const len = (node.textContent ?? "").length;
    const safe = Math.min(Math.max(0, offset), len);
    range.setStart(node, safe);
    range.setEnd(node, safe);
    return range;
  }

  range.setStart(node, 0);
  range.setEnd(node, 0);
  return range;
}

export function rangeFromCfiParts(
  doc: Document,
  path: CfiComponent,
  start: CfiComponent | null,
  end: CfiComponent | null,
  ignoreClass?: string
): Range | null {
  if (!start || !end) {
    return componentToRange(doc, path, ignoreClass);
  }

  const mergedStart: CfiComponent = {
    steps: [...path.steps, ...start.steps],
    terminal: start.terminal,
  };
  const mergedEnd: CfiComponent = {
    steps: [...path.steps, ...end.steps],
    terminal: end.terminal,
  };

  const startResolved = resolveComponentToNode(doc, mergedStart, ignoreClass);
  const endResolved = resolveComponentToNode(doc, mergedEnd, ignoreClass);
  if (!startResolved.node || !endResolved.node) return null;

  const range = doc.createRange();
  const startLen =
    startResolved.node.nodeType === TEXT_NODE ? (startResolved.node.textContent ?? "").length : 0;
  const endLen = endResolved.node.nodeType === TEXT_NODE ? (endResolved.node.textContent ?? "").length : 0;

  range.setStart(
    startResolved.node,
    startResolved.node.nodeType === TEXT_NODE
      ? Math.min(startResolved.offset, startLen)
      : 0
  );
  range.setEnd(
    endResolved.node,
    endResolved.node.nodeType === TEXT_NODE ? Math.min(endResolved.offset, endLen) : 0
  );
  return range;
}

/** Walk up from anchor while parent is not document. */
export function isWithinDocument(node: Node | null): boolean {
  let cur: Node | null = node;
  while (cur && cur.nodeType !== DOCUMENT_NODE) cur = cur.parentNode;
  return cur?.nodeType === DOCUMENT_NODE;
}

export { nodeForEpubjsStep };
