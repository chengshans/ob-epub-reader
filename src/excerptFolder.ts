import { normalizePath } from "obsidian";

export const EXCERPT_FOLDER_PLACEHOLDER = "{filefolder}";

export const EXCERPT_MD_NAME_RE = /^《.+》摘录\.md$/;

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

export function extractTitleFromExcerptName(name: string): string | null {
  const match = name.match(/^《([\s\S]+?)》摘录\.md$/);
  return match?.[1]?.trimEnd() ?? null;
}

export function epubTitlesMatch(titleA: string, titleB: string): boolean {
  return titleA.trimEnd() === titleB.trimEnd();
}

function resolveFilefolderFromExcerpt(
  excerptPath: string,
  template: string
): { filefolder: string; title: string } | null {
  if (!isDynamicExcerptFolder(template)) return null;

  const normalized = normalizePath(excerptPath);
  const slash = normalized.lastIndexOf("/");
  const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const excerptDir = slash >= 0 ? normalized.slice(0, slash) : "";
  const title = extractTitleFromExcerptName(name);
  if (!title) return null;

  const suffix = templateSuffixAfterFilefolder(template);
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
  template: string
): string | null {
  return resolveFilefolderFromExcerpt(excerptPath, template)?.filefolder ?? null;
}

/** Infer EPUB path from excerpt location and `{filefolder}` template (e.g. `{filefolder}/anno`). */
export function inferEpubPathFromExcerptLocation(
  excerptPath: string,
  template: string
): string | null {
  const resolved = resolveFilefolderFromExcerpt(excerptPath, template);
  if (!resolved) return null;

  const epubName = `${resolved.title}.epub`;
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

export const EXCERPT_CHECK_ISSUE_LABELS: Record<ExcerptCheckIssue, string> = {
  "missing-epub-source": "缺少 frontmatter 字段 epub-source",
  "epub-source-not-found": "epub-source 指向的 EPUB 文件不存在",
  "local-epub-not-found": "按当前摘录文件夹规则，同级目录下找不到对应 EPUB",
  "excerpt-location-mismatch": "摘录文件不在当前设置应保存的路径",
  "epub-source-local-mismatch": "epub-source 与按摘录位置推断的 EPUB 路径不一致",
};
