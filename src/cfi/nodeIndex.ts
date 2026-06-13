const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

export type CfiNodePosition = { type: "element" | "text"; index: number };

function parseIgnoreClasses(ignoreClass?: string): string[] {
  if (!ignoreClass) return [];
  return ignoreClass.trim().split(/\s+/).filter(Boolean);
}

function shouldIgnoreNode(node: Node, ignoreClasses: string[]): boolean {
  if (node.nodeType !== ELEMENT_NODE) return false;
  const el = node as Element;
  return ignoreClasses.some((cls) => el.classList?.contains(cls));
}

/** EPUB CFI mixed-content child index (epub.js 0-based index within element or text stream). */
export function positionForEpubjs(anchor: Node, ignoreClass?: string): CfiNodePosition | null {
  const parent = anchor.parentNode;
  if (!parent) return null;

  const ignoreClasses = parseIgnoreClasses(ignoreClass);
  let elementIndex = 0;
  let textChunkIndex = 0;
  const children = parent.childNodes;
  let i = 0;

  while (i < children.length) {
    const node = children[i];
    if (shouldIgnoreNode(node, ignoreClasses)) {
      i++;
      continue;
    }

    if (node.nodeType === TEXT_NODE) {
      const chunkStart = i;
      let chunkEnd = i;
      while (
        chunkEnd < children.length &&
        children[chunkEnd].nodeType === TEXT_NODE &&
        !shouldIgnoreNode(children[chunkEnd], ignoreClasses)
      ) {
        chunkEnd++;
      }

      if (anchor.nodeType === TEXT_NODE) {
        for (let j = chunkStart; j < chunkEnd; j++) {
          if (children[j] === anchor) {
            return { type: "text", index: textChunkIndex };
          }
        }
      }

      textChunkIndex++;
      i = chunkEnd;
      continue;
    }

    if (node.nodeType === ELEMENT_NODE) {
      if (node === anchor) return { type: "element", index: elementIndex };
      elementIndex++;
      i++;
      continue;
    }

    i++;
  }

  return null;
}

/** Resolve epub.js step to a DOM node (text steps resolve to first text node in chunk). */
export function nodeForEpubjsStep(
  parent: Node,
  type: "element" | "text",
  index: number,
  ignoreClass?: string
): Node | null {
  const ignoreClasses = parseIgnoreClasses(ignoreClass);
  let elementIndex = 0;
  let textChunkIndex = 0;
  const children = parent.childNodes;
  let i = 0;

  while (i < children.length) {
    const node = children[i];
    if (shouldIgnoreNode(node, ignoreClasses)) {
      i++;
      continue;
    }

    if (node.nodeType === TEXT_NODE) {
      const chunkStart = i;
      let chunkEnd = i;
      while (
        chunkEnd < children.length &&
        children[chunkEnd].nodeType === TEXT_NODE &&
        !shouldIgnoreNode(children[chunkEnd], ignoreClasses)
      ) {
        chunkEnd++;
      }

      if (type === "text" && textChunkIndex === index) {
        return children[chunkStart];
      }

      textChunkIndex++;
      i = chunkEnd;
      continue;
    }

    if (node.nodeType === ELEMENT_NODE) {
      if (type === "element" && elementIndex === index) return node;
      elementIndex++;
      i++;
      continue;
    }

    i++;
  }

  return null;
}

/** When step has XML id assertion, prefer getElementById over numeric index. */
export function resolveElementStep(
  doc: Document,
  parent: Node,
  step: { type: string; index: number; id?: string | null },
  ignoreClass?: string
): Node | null {
  if (step.type === "element" && step.id) {
    const byId = doc.getElementById(step.id);
    if (byId) return byId;
  }
  if (step.type === "element") {
    return nodeForEpubjsStep(parent, "element", step.index, ignoreClass);
  }
  if (step.type === "text") {
    return nodeForEpubjsStep(parent, "text", step.index, ignoreClass);
  }
  return null;
}
