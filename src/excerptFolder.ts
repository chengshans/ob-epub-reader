import { normalizePath } from "obsidian";
import { isI18nInitialized, t } from "./i18n/i18n";

export const EXCERPT_FOLDER_PLACEHOLDER = "{filefolder}";
export const EXCERPT_TITLE_PLACEHOLDER = "{title}";
export const EXCERPT_FILENAME_PLACEHOLDER = "{filename}";
/** @deprecated Use getDefaultExcerptFilename() — kept for regex fallbacks and legacy defaults. */
export const DEFAULT_EXCERPT_FILENAME = "《{title}》摘录.md";

export function getDefaultExcerptFilename(): string {
  return isI18nInitialized() ? t("defaults.excerptFilename") : DEFAULT_EXCERPT_FILENAME;
}

const PLACEHOLDER_SPLIT_RE = /(\{title\}|\{filename\})/;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface ExcerptFilenameMatcher {
  regex: RegExp;
  titleGroup: number | null;
  filenameGroup: number | null;
}

function buildExcerptFilenameMatcher(template: string): ExcerptFilenameMatcher {
  const trimmed = (template || DEFAULT_EXCERPT_FILENAME).trim();
  const parts = trimmed.split(PLACEHOLDER_SPLIT_RE);
  let pattern = "^";
  let groupNum = 0;
  let titleGroup: number | null = null;
  let filenameGroup: number | null = null;

  for (const part of parts) {
    if (!part) continue;
    if (part === EXCERPT_TITLE_PLACEHOLDER) {
      groupNum += 1;
      titleGroup = groupNum;
      pattern += "([\\s\\S]+?)";
    } else if (part === EXCERPT_FILENAME_PLACEHOLDER) {
      groupNum += 1;
      filenameGroup = groupNum;
      pattern += "([\\s\\S]+?)";
    } else {
      pattern += escapeRegex(part);
    }
  }

  pattern += "$";
  return { regex: new RegExp(pattern), titleGroup, filenameGroup };
}

/** Loose name match for scanning vault excerpt markdown files. */
export function buildLooseExcerptNameRegex(template: string): RegExp {
  const trimmed = (template || DEFAULT_EXCERPT_FILENAME).trim();
  const parts = trimmed.split(PLACEHOLDER_SPLIT_RE);
  let pattern = "^";
  for (const part of parts) {
    if (!part) continue;
    if (part === EXCERPT_TITLE_PLACEHOLDER || part === EXCERPT_FILENAME_PLACEHOLDER) {
      pattern += "[\\s\\S]+?";
    } else {
      pattern += escapeRegex(part);
    }
  }
  pattern += "$";
  return new RegExp(pattern);
}

/** Default excerpt filename pattern (`《{title}》摘录.md`). */
export const EXCERPT_MD_NAME_RE = buildLooseExcerptNameRegex(DEFAULT_EXCERPT_FILENAME);

function sanitizeExcerptFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "_");
}

export function resolveExcerptFilename(template: string, epubFilePath: string): string {
  const trimmed = (template || DEFAULT_EXCERPT_FILENAME).trim();
  const basename = epubFilePath.split("/").pop() ?? epubFilePath;
  const title = basename.replace(/\.epub$/i, "").trimEnd();
  const filename = basename;

  const resolved = trimmed
    .split(EXCERPT_FILENAME_PLACEHOLDER)
    .join(filename)
    .split(EXCERPT_TITLE_PLACEHOLDER)
    .join(title);

  return sanitizeExcerptFilename(resolved);
}

function extractEpubBasenameFromExcerptName(
  name: string,
  filenameTemplate: string
): string | null {
  const matcher = buildExcerptFilenameMatcher(filenameTemplate);
  const match = name.match(matcher.regex);
  if (!match) return null;

  if (matcher.filenameGroup !== null) {
    const raw = match[matcher.filenameGroup]?.trim();
    if (!raw) return null;
    return raw.toLowerCase().endsWith(".epub") ? raw : `${raw}.epub`;
  }

  if (matcher.titleGroup !== null) {
    const title = match[matcher.titleGroup]?.trimEnd();
    return title ? `${title}.epub` : null;
  }

  return null;
}

export function isDynamicExcerptFolder(template: string): boolean {
  return template.includes(EXCERPT_FOLDER_PLACEHOLDER);
}

function epubParentFolder(epubFilePath: string): string {
  const normalized = normalizePath(epubFilePath);
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) return "";
  return normalized.slice(0, slash);
}

export function resolveExcerptFolder(template: string, epubFilePath: string): string {
  const trimmed = (template || "epub-books/anno").trim();
  const parent = epubParentFolder(epubFilePath);
  const resolved = trimmed.split(EXCERPT_FOLDER_PLACEHOLDER).join(parent);
  return normalizePath(resolved).replace(/\/$/, "").replace(/^\//, "");
}

function templateSuffixAfterFilefolder(template: string): string {
  const idx = template.indexOf(EXCERPT_FOLDER_PLACEHOLDER);
  if (idx < 0) return "";
  return normalizePath(
    template.slice(idx + EXCERPT_FOLDER_PLACEHOLDER.length).replace(/^\//, "")
  )
    .replace(/\/$/, "")
    .replace(/^\//, "");
}

export function extractTitleFromExcerptName(
  name: string,
  filenameTemplate = DEFAULT_EXCERPT_FILENAME
): string | null {
  const matcher = buildExcerptFilenameMatcher(filenameTemplate);
  const match = name.match(matcher.regex);
  if (!match) return null;

  if (matcher.titleGroup !== null) {
    return match[matcher.titleGroup]?.trimEnd() ?? null;
  }

  if (matcher.filenameGroup !== null) {
    const filename = match[matcher.filenameGroup];
    if (!filename) return null;
    return filename.replace(/\.epub$/i, "").trimEnd();
  }

  return null;
}

export function epubTitlesMatch(titleA: string, titleB: string): boolean {
  return titleA.trimEnd() === titleB.trimEnd();
}

function resolveFilefolderFromExcerpt(
  excerptPath: string,
  folderTemplate: string,
  filenameTemplate: string
): { filefolder: string; title: string } | null {
  if (!isDynamicExcerptFolder(folderTemplate)) return null;

  const normalized = normalizePath(excerptPath);
  const slash = normalized.lastIndexOf("/");
  const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const excerptDir = slash >= 0 ? normalized.slice(0, slash) : "";
  const title = extractTitleFromExcerptName(name, filenameTemplate);
  if (!title) return null;

  const suffix = templateSuffixAfterFilefolder(folderTemplate);
  let filefolder = excerptDir;
  if (suffix) {
    const suffixTail = `/${suffix}`;
    if (!excerptDir.endsWith(suffixTail) && excerptDir !== suffix) return null;
    filefolder = excerptDir.slice(0, excerptDir.length - suffix.length - 1);
  }

  return { filefolder, title };
}

export function inferFilefolderFromExcerptLocation(
  excerptPath: string,
  folderTemplate: string,
  filenameTemplate = DEFAULT_EXCERPT_FILENAME
): string | null {
  return resolveFilefolderFromExcerpt(excerptPath, folderTemplate, filenameTemplate)?.filefolder ?? null;
}

/** Infer EPUB path from excerpt location and `{filefolder}` template (e.g. `{filefolder}/anno`). */
export function inferEpubPathFromExcerptLocation(
  excerptPath: string,
  folderTemplate: string,
  filenameTemplate = DEFAULT_EXCERPT_FILENAME
): string | null {
  const resolved = resolveFilefolderFromExcerpt(excerptPath, folderTemplate, filenameTemplate);
  if (!resolved) return null;

  const epubName =
    extractEpubBasenameFromExcerptName(
      excerptPath.split("/").pop() ?? excerptPath,
      filenameTemplate
    ) ?? `${resolved.title}.epub`;

  return resolved.filefolder
    ? normalizePath(`${resolved.filefolder}/${epubName}`)
    : epubName;
}

export type ExcerptCheckIssue =
  | "missing-epub-source"
  | "epub-source-not-found"
  | "local-epub-not-found"
  | "excerpt-location-mismatch"
  | "epub-source-local-mismatch";

export interface ExcerptMetadataCheckItem {
  excerptPath: string;
  epubSource?: string;
  expectedExcerptPath?: string;
  localEpubPath?: string;
  issues: ExcerptCheckIssue[];
}

export interface ExcerptMetadataCheckReport {
  checked: number;
  withIssues: number;
  items: ExcerptMetadataCheckItem[];
}
