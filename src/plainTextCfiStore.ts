import type { Annotation } from "./types";

export interface PlainTextAnnMeta {
  id: string;
  cfiRange: string;
  text: string;
}

export type PlainTextCfiData = Record<string, PlainTextAnnMeta[]>;

export interface PlainTextCfiPersistence {
  load(epubPath: string): Promise<PlainTextAnnMeta[]>;
  save(epubPath: string, meta: PlainTextAnnMeta[]): Promise<void>;
}

export function annotationsToPlainTextMeta(annotations: Annotation[]): PlainTextAnnMeta[] {
  return annotations.map((ann) => ({
    id: ann.id,
    cfiRange: ann.cfiRange,
    text: ann.text,
  }));
}

/** Restore CFI/id for plain-text excerpt blocks that store only body text in the vault file. */
export function mergePlainTextCfi(
  annotations: Annotation[],
  meta: PlainTextAnnMeta[]
): void {
  for (let i = 0; i < annotations.length; i++) {
    const ann = annotations[i];
    if (ann.cfiRange) continue;

    const byText = meta.find((entry) => entry.text === ann.text);
    const byIndex = meta[i];
    const entry =
      byText ?? (byIndex && byIndex.text === ann.text ? byIndex : undefined);
    if (!entry) continue;

    ann.id = entry.id;
    ann.cfiRange = entry.cfiRange;
  }
}
