import { App, normalizePath, TFile } from "obsidian";
import { AnnotationVaultStore } from "./AnnotationVaultStore";
import { EpubPluginSettings, Annotation } from "./types";
import {
  buildLooseExcerptNameRegex,
  inferEpubPathFromExcerptLocation,
  isDynamicExcerptFolder,
} from "./excerptFolder";

export type ExcerptExportFormat = "markdown" | "csv" | "plain";

export interface ExcerptExportFilters {
  epubPath?: string;
  since?: string;
  until?: string;
  format: ExcerptExportFormat;
}

export interface ExcerptExportRow {
  epubPath: string;
  excerptPath: string;
  annotation: Annotation;
}

function parseAnnotationDate(ann: Annotation): Date | null {
  if (!ann.created) return null;
  const d = new Date(ann.created);
  return Number.isNaN(d.getTime()) ? null : d;
}

function inDateRange(ann: Annotation, since?: string, until?: string): boolean {
  const d = parseAnnotationDate(ann);
  if (!d) return true;
  if (since && d < new Date(`${since}T00:00:00`)) return false;
  if (until && d > new Date(`${until}T23:59:59`)) return false;
  return true;
}

function listExcerptFiles(app: App, settings: EpubPluginSettings): TFile[] {
  const folderTemplate = settings.excerptFolder;
  const nameRe = buildLooseExcerptNameRegex(settings.excerptFilename);
  const all = app.vault.getMarkdownFiles();
  if (isDynamicExcerptFolder(folderTemplate)) {
    return all.filter((f) => nameRe.test(f.name));
  }
  const folder = folderTemplate.replace(/\/$/, "");
  const prefix = folder ? `${folder}/` : "";
  return all.filter((f) => f.path.startsWith(prefix) && nameRe.test(f.name));
}

function resolveEpubFromExcerpt(excerptPath: string, content: string): string | null {
  const fromFrontmatter = content.match(/^epub-source:\s*(.+)$/m);
  if (fromFrontmatter) return normalizePath(fromFrontmatter[1].trim());
  return inferEpubPathFromExcerptLocation(excerptPath) ?? null;
}

export async function collectExcerptExportRows(
  app: App,
  store: AnnotationVaultStore,
  settings: EpubPluginSettings,
  filters: ExcerptExportFilters
): Promise<ExcerptExportRow[]> {
  const rows: ExcerptExportRow[] = [];
  const files = listExcerptFiles(app, settings);
  const targetEpub = filters.epubPath ? normalizePath(filters.epubPath) : null;

  for (const file of files) {
    const content = await app.vault.read(file);
    const epubPath = resolveEpubFromExcerpt(file.path, content) ?? "";
    if (!epubPath) continue;
    if (targetEpub && normalizePath(epubPath) !== targetEpub) continue;

    const annotations = store.parseContent(content, epubPath);
    for (const ann of annotations) {
      if (!inDateRange(ann, filters.since, filters.until)) continue;
      rows.push({ epubPath, excerptPath: file.path, annotation: ann });
    }
  }

  rows.sort((a, b) => {
    const da = parseAnnotationDate(a.annotation)?.getTime() ?? 0;
    const db = parseAnnotationDate(b.annotation)?.getTime() ?? 0;
    return da - db;
  });
  return rows;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function formatExcerptExport(rows: ExcerptExportRow[], format: ExcerptExportFormat): string {
  if (format === "csv") {
    const header = "epub,chapter,text,note,type,color,cfi,createdAt";
    const lines = rows.map(({ epubPath, annotation: ann }) =>
      [
        csvEscape(epubPath),
        csvEscape(ann.chapter ?? ""),
        csvEscape(ann.text ?? ""),
        csvEscape(ann.note ?? ""),
        csvEscape(ann.noteType ?? ""),
        csvEscape(ann.color ?? ""),
        csvEscape(ann.cfiRange ?? ""),
        csvEscape(ann.created ?? ""),
      ].join(",")
    );
    return [header, ...lines].join("\n");
  }

  if (format === "plain") {
    return rows
      .map(({ annotation: ann }) => {
        const parts = [ann.text ?? ""];
        if (ann.note) parts.push(`(${ann.note})`);
        return parts.join(" ");
      })
      .join("\n\n");
  }

  return rows
    .map(({ epubPath, annotation: ann }) => {
      const lines = [
        `## ${ann.chapter ?? ""}`,
        "",
        ann.text ?? "",
      ];
      if (ann.note) lines.push("", `> ${ann.note}`);
      lines.push("", `epub: ${epubPath}`, `cfi: ${ann.cfiRange ?? ""}`, "");
      return lines.join("\n");
    })
    .join("\n---\n\n");
}
