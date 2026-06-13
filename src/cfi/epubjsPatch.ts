import { EpubCFI } from "epubjs";
import { positionForEpubjs, resolveElementStep } from "./nodeIndex";

type EpubCfiProto = {
  position: (anchor: Node) => number;
  filteredPosition: (anchor: Node, ignoreClass?: string) => number;
  walkToNode: (steps: StepLike[], doc: Document, ignoreClass?: string) => Node | null;
  step: (node: Node) => StepLike | undefined;
  filteredStep: (node: Node, ignoreClass?: string) => StepLike | undefined;
};

type StepLike = {
  type: "element" | "text";
  index: number;
  id?: string | null;
  tagName?: string;
};

let patched = false;

export function applyEpubjsCfiPatch(): void {
  if (patched) return;
  patched = true;

  const proto = EpubCFI.prototype as EpubCfiProto;

  proto.position = function (anchor: Node): number {
    const pos = positionForEpubjs(anchor);
    return pos?.index ?? 0;
  };

  proto.filteredPosition = function (anchor: Node, ignoreClass?: string): number {
    const pos = positionForEpubjs(anchor, ignoreClass);
    return pos?.index ?? 0;
  };

  proto.step = function (node: Node): StepLike | undefined {
    const pos = positionForEpubjs(node);
    if (!pos) return undefined;
    const el = node as Element;
    return {
      id: el.id || null,
      tagName: el.tagName,
      type: pos.type,
      index: pos.index,
    };
  };

  proto.filteredStep = function (node: Node, ignoreClass?: string): StepLike | undefined {
    const filtered = (this as { filter?: (n: Node, c?: string) => Node | null }).filter?.(
      node,
      ignoreClass
    );
    const target = filtered ?? node;
    const pos = positionForEpubjs(target, ignoreClass);
    if (!pos) return undefined;
    const el = target as Element;
    return {
      id: el.id || null,
      tagName: el.tagName,
      type: pos.type,
      index: pos.index,
    };
  };

  proto.walkToNode = function (
    steps: StepLike[],
    doc: Document,
    ignoreClass?: string
  ): Node | null {
    let container: Node | null = doc.documentElement;

    for (const step of steps) {
      if (!container) break;

      if (step.type === "element") {
        container = resolveElementStep(doc, container, step, ignoreClass);
      } else if (step.type === "text") {
        container = resolveElementStep(doc, container, step, ignoreClass);
      }

      if (!container) break;
    }

    return container;
  };
}
