import { cfiInnerPayload, unescapeCfiString } from "./cfiString";

export interface CfiStep {
  type: "element" | "text";
  index: number;
  id: string | null;
}

export interface CfiTerminal {
  kind: "char";
  offset: number;
  assertion: string | null;
}

export interface CfiComponent {
  steps: CfiStep[];
  terminal: CfiTerminal | null;
}

export interface ParsedCfi {
  base: CfiComponent;
  path: CfiComponent;
  range: boolean;
  start: CfiComponent | null;
  end: CfiComponent | null;
}

function parseStep(stepStr: string): CfiStep | null {
  const idMatch = stepStr.match(/\[(.*)\]$/);
  const id = idMatch ? unescapeCfiString(idMatch[1]) : null;
  const num = parseInt(stepStr, 10);
  if (Number.isNaN(num)) return null;

  if (num % 2 === 0) {
    return { type: "element", index: num / 2 - 1, id };
  }
  return { type: "text", index: (num - 1) / 2, id };
}

function parseTerminal(termStr: string): CfiTerminal | null {
  const assertionMatch = termStr.match(/\[(.*)\]$/);
  let offsetPart = termStr;
  let assertion: string | null = null;
  if (assertionMatch) {
    assertion = unescapeCfiString(assertionMatch[1]);
    offsetPart = termStr.slice(0, termStr.indexOf("["));
  }
  const offset = parseInt(offsetPart.replace(/^:/, ""), 10);
  if (Number.isNaN(offset)) return null;
  return { kind: "char", offset, assertion };
}

function parseComponent(componentStr: string): CfiComponent {
  const component: CfiComponent = { steps: [], terminal: null };
  const colonParts = componentStr.split(":");
  const pathPart = colonParts[0];
  const steps = pathPart.split("/").filter(Boolean);

  component.steps = steps
    .map((s) => parseStep(s))
    .filter((s): s is CfiStep => s != null);

  if (colonParts.length > 1) {
    const terminalStr = colonParts.slice(1).join(":");
    component.terminal = parseTerminal(terminalStr);
  }

  return component;
}

export function parseCfi(cfiStr: string): ParsedCfi | null {
  const trimmed = unescapeCfiString(cfiStr.trim());
  if (!trimmed.startsWith("epubcfi(") || !trimmed.endsWith(")")) return null;

  const inner = cfiInnerPayload(trimmed);
  const bang = inner.indexOf("!");
  if (bang < 0) return null;

  const basePart = inner.slice(0, bang);
  let afterBang = inner.slice(bang + 1);
  const rangeParts = splitRange(afterBang);

  const parsed: ParsedCfi = {
    base: parseComponent(basePart),
    path: parseComponent(rangeParts.parent),
    range: rangeParts.isRange,
    start: null,
    end: null,
  };

  if (rangeParts.isRange) {
    parsed.start = parseComponent(rangeParts.start);
    parsed.end = parseComponent(rangeParts.end);
  }

  return parsed;
}

function splitRange(afterBang: string): {
  isRange: boolean;
  parent: string;
  start: string;
  end: string;
} {
  let depth = 0;
  for (let i = 0; i < afterBang.length; i++) {
    const c = afterBang[i];
    if (c === "^" && i + 1 < afterBang.length) {
      i++;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      const rest = afterBang.slice(i + 1);
      const comma2 = findTopLevelComma(rest);
      if (comma2 >= 0) {
        return {
          isRange: true,
          parent: afterBang.slice(0, i),
          start: rest.slice(0, comma2),
          end: rest.slice(comma2 + 1),
        };
      }
    }
  }
  return { isRange: false, parent: afterBang, start: "", end: "" };
}

function findTopLevelComma(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "^" && i + 1 < s.length) {
      i++;
      continue;
    }
    if (s[i] === "(") depth++;
    if (s[i] === ")") depth--;
    if (s[i] === "," && depth === 0) return i;
  }
  return -1;
}

/** Strip bracket assertions for canonical comparison. */
export function stripAssertions(path: string): string {
  return path.replace(/\[[^\]]*\]/g, "");
}
