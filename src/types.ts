import { i18next, isI18nInitialized, t } from "./i18n/i18n";

export type ReadingThemeId = "obsidian" | "white" | "yellow" | "green" | "sepia" | "dark";

export interface ReadingThemeDef {
  id: ReadingThemeId;
  label: string;
  /** obsidian 模式下为空，运行时读 CSS 变量 */
  background: string;
  text: string;
  link: string;
  selection: string;
  /** 工具栏色块展示色 */
  swatch: string;
}

const READING_THEME_STYLES: Omit<ReadingThemeDef, "label">[] = [
  {
    id: "obsidian",
    background: "",
    text: "",
    link: "",
    selection: "",
    swatch: "linear-gradient(135deg, #ffffff 50%, #1e1e1e 50%)",
  },
  {
    id: "white",
    background: "#FFFFFF",
    text: "#333333",
    link: "#576B95",
    selection: "rgba(87, 107, 149, 0.25)",
    swatch: "#FFFFFF",
  },
  {
    id: "yellow",
    background: "#FAF9DE",
    text: "#333333",
    link: "#576B95",
    selection: "rgba(232, 179, 57, 0.35)",
    swatch: "#FAF9DE",
  },
  {
    id: "green",
    background: "#E3EDCD",
    text: "#333333",
    link: "#3A7D44",
    selection: "rgba(58, 166, 117, 0.3)",
    swatch: "#E3EDCD",
  },
  {
    id: "sepia",
    background: "#F4ECD8",
    text: "#5C4B37",
    link: "#8B6914",
    selection: "rgba(139, 105, 20, 0.25)",
    swatch: "#F4ECD8",
  },
  {
    id: "dark",
    background: "#1C1C1E",
    text: "#A8A8A8",
    link: "#7EB6FF",
    selection: "rgba(123, 104, 238, 0.4)",
    swatch: "#1C1C1E",
  },
];

const READING_THEME_IDS = new Set<string>(READING_THEME_STYLES.map((theme) => theme.id));

export function getReadingThemes(): ReadingThemeDef[] {
  return READING_THEME_STYLES.map((theme) => ({
    ...theme,
    label: isI18nInitialized() ? t(`defaults.readingThemes.${theme.id}`) : theme.id,
  }));
}

/** @deprecated Use getReadingThemes() after initializeI18n() */
export const READING_THEMES: ReadingThemeDef[] = READING_THEME_STYLES.map((theme) => ({
  ...theme,
  label: theme.id,
}));

export function getReadingTheme(id: ReadingThemeId): ReadingThemeDef {
  return getReadingThemes().find((theme) => theme.id === id) ?? getReadingThemes()[0];
}

export function normalizeReadingTheme(raw: string | undefined): ReadingThemeId {
  if (raw && READING_THEME_IDS.has(raw)) return raw as ReadingThemeId;
  return "obsidian";
}

// ---- Note types (想法类型) ----

export type NoteType = "note" | "inspiration" | "practice" | "revisit" | "question";

export interface NoteTypeDef {
  id: NoteType;
  label: string;
  icon: string;
}

const NOTE_TYPE_ICONS: Record<NoteType, string> = {
  note: "📝",
  inspiration: "💡",
  practice: "✅",
  revisit: "🔁",
  question: "❓",
};

const NOTE_TYPE_IDS: NoteType[] = ["note", "inspiration", "practice", "revisit", "question"];

export function getDefaultNoteTypes(): NoteTypeDef[] {
  return NOTE_TYPE_IDS.map((id) => ({
    id,
    icon: NOTE_TYPE_ICONS[id],
    label: isI18nInitialized() ? t(`defaults.noteTypes.${id}`) : id,
  }));
}

/** Static fallback before i18n init (icons only; labels are ids). */
export const DEFAULT_NOTE_TYPES: NoteTypeDef[] = NOTE_TYPE_IDS.map((id) => ({
  id,
  icon: NOTE_TYPE_ICONS[id],
  label: id,
}));

const NOTE_TYPE_LABEL_MAX = 20;
const NOTE_TYPE_ICON_MAX = 8;

function sanitizeNoteTypeDef(def: NoteTypeDef, fallback: NoteTypeDef): NoteTypeDef {
  const label = def.label?.trim().slice(0, NOTE_TYPE_LABEL_MAX);
  const icon = def.icon?.trim().slice(0, NOTE_TYPE_ICON_MAX);
  return {
    id: fallback.id,
    label: label || fallback.label,
    icon: icon || fallback.icon,
  };
}

/** Merge stored settings with defaults; always returns exactly five fixed ids. */
export function resolveNoteTypes(stored?: NoteTypeDef[]): NoteTypeDef[] {
  return getDefaultNoteTypes().map((fallback) => {
    const custom = stored?.find((entry) => entry.id === fallback.id);
    return sanitizeNoteTypeDef(custom ?? fallback, fallback);
  });
}

export function normalizeNoteType(raw: string | undefined, types: NoteTypeDef[]): NoteType {
  const ids = new Set(types.map((entry) => entry.id));
  if (raw && ids.has(raw)) return raw as NoteType;
  return "note";
}

export function noteTypeIcon(id: NoteType | undefined, types: NoteTypeDef[]): string {
  return types.find((entry) => entry.id === (id ?? "note"))?.icon ?? NOTE_TYPE_ICONS.note;
}

export function noteTypeLabel(id: NoteType | undefined, types: NoteTypeDef[]): string {
  return types.find((entry) => entry.id === (id ?? "note"))?.label ?? getDefaultNoteTypes()[0].label;
}

/** 摘录导出 / 跳转链接的写入格式（五种固定预设） */
export type SourceLinkFormat =
  | "callout-title"
  | "inline-suffix"
  | "inline-colored"
  | "wiki-text-alias"
  | "plain-text";

const SOURCE_LINK_FORMAT_IDS_LIST: SourceLinkFormat[] = [
  "callout-title",
  "inline-suffix",
  "inline-colored",
  "wiki-text-alias",
  "plain-text",
];

export function getSourceLinkFormats(): {
  id: SourceLinkFormat;
  label: string;
  desc: string;
  pros: string;
  cons: string;
}[] {
  return SOURCE_LINK_FORMAT_IDS_LIST.map((id) => ({
    id,
    label: t(`settings.formats.${id}.label`),
    desc: t(`settings.formats.${id}.desc`),
    pros: t(`settings.formats.${id}.pros`),
    cons: t(`settings.formats.${id}.cons`),
  }));
}

/** @deprecated Use getSourceLinkFormats() */
export const SOURCE_LINK_FORMATS = SOURCE_LINK_FORMAT_IDS_LIST.map((id) => ({ id, label: id, desc: "", pros: "", cons: "" }));

const SOURCE_LINK_FORMAT_IDS = new Set<string>(SOURCE_LINK_FORMAT_IDS_LIST);

export function normalizeSourceLinkFormat(value: unknown): SourceLinkFormat {
  if (value === "wiki-link") return "callout-title";
  if (typeof value === "string" && SOURCE_LINK_FORMAT_IDS.has(value)) {
    return value as SourceLinkFormat;
  }
  return "callout-title";
}

// ---- Feature groups (功能分组) ----

export interface FeatureGroupSettings {
  annotationsAndExcerpts: boolean;
  bookshelf: boolean;
  readerCollapsed?: boolean;
  annotationsCollapsed?: boolean;
  bookshelfCollapsed?: boolean;
}

export const DEFAULT_FEATURE_GROUPS: FeatureGroupSettings = {
  annotationsAndExcerpts: true,
  bookshelf: true,
  readerCollapsed: false,
  annotationsCollapsed: false,
  bookshelfCollapsed: false,
};

export function normalizeFeatureGroups(raw?: Partial<FeatureGroupSettings>): FeatureGroupSettings {
  return {
    annotationsAndExcerpts: raw?.annotationsAndExcerpts !== false,
    bookshelf: raw?.bookshelf !== false,
    readerCollapsed: raw?.readerCollapsed === true,
    annotationsCollapsed: raw?.annotationsCollapsed === true,
    bookshelfCollapsed: raw?.bookshelfCollapsed === true,
  };
}

export type FeatureGroupId = "reader" | "annotations" | "bookshelf";

export function isFeatureGroupCollapsed(
  groups: FeatureGroupSettings,
  groupId: FeatureGroupId
): boolean {
  if (groupId === "reader") return groups.readerCollapsed === true;
  if (groupId === "annotations") return groups.annotationsCollapsed === true;
  return groups.bookshelfCollapsed === true;
}

export function isAnnotationsAndExcerptsEnabled(settings: EpubPluginSettings): boolean {
  return settings.featureGroups.annotationsAndExcerpts;
}

export function isBookshelfEnabled(settings: EpubPluginSettings): boolean {
  return settings.featureGroups.bookshelf;
}

export type ToolbarPlacement = "top" | "bottom";

export type PluginUiLocale = "auto" | "en" | "zh" | "zh-TW" | "ja";

export function normalizeUiLocale(raw: unknown): PluginUiLocale {
  if (
    raw === "en" ||
    raw === "zh" ||
    raw === "zh-TW" ||
    raw === "ja" ||
    raw === "auto"
  ) {
    return raw;
  }
  return "auto";
}

export interface EpubPluginSettings {
  excerptFolder: string;
  excerptFilename: string;
  sourceLinkFormat: SourceLinkFormat;
  defaultExcerptHighlightColor: HighlightColor;
  defaultFlow: "paginated" | "scrolled";
  fontSize: number;
  readingSidePadding: number;
  readingTheme: ReadingThemeId;
  noteIconSize: number;
  noteIconOffsetX: number;
  noteIconOffsetY: number;
  epubHighlightOpacity: number;
  excerptCalloutOpacity: number;
  noteTypes: NoteTypeDef[];
  featureGroups: FeatureGroupSettings;
  autoPasteExcerpt: boolean;
  toolbarPlacement: ToolbarPlacement;
  uiLocale: PluginUiLocale;
}

export function getDefaultSettings(): EpubPluginSettings {
  return {
    excerptFolder: "epub-books/anno",
    excerptFilename: isI18nInitialized() ? t("defaults.excerptFilename") : "{title} excerpts.md",
    sourceLinkFormat: "callout-title",
    defaultExcerptHighlightColor: "yellow",
    defaultFlow: "scrolled",
    fontSize: 16,
    readingSidePadding: 12,
    readingTheme: "obsidian",
    noteIconSize: 20,
    noteIconOffsetX: 2,
    noteIconOffsetY: 0,
    epubHighlightOpacity: 0.38,
    excerptCalloutOpacity: 0.2,
    noteTypes: getDefaultNoteTypes().map((entry) => ({ ...entry })),
    featureGroups: { ...DEFAULT_FEATURE_GROUPS },
    autoPasteExcerpt: true,
    toolbarPlacement: "bottom",
    uiLocale: "auto",
  };
}

/** @deprecated Use getDefaultSettings() after initializeI18n() */
export const DEFAULT_SETTINGS: EpubPluginSettings = getDefaultSettings();

export function normalizeToolbarPlacement(
  raw: unknown,
  legacyImmersiveDefault?: boolean
): ToolbarPlacement {
  if (raw === "top" || raw === "bottom") return raw;
  if (legacyImmersiveDefault === false) return "top";
  return getDefaultSettings().toolbarPlacement;
}

export interface BookProgress {
  cfi: string;
  chapter: string;
  percent: number;
  lastRead: string;
  readingTimeSeconds?: number;
}

export function unknownChapterLabel(): string {
  return isI18nInitialized() ? t("defaults.unknownChapter") : "Unknown chapter";
}

function isChineseLocale(): boolean {
  return isI18nInitialized() && (i18next.language === "zh" || i18next.language.startsWith("zh"));
}

/** 将累计阅读秒数格式化为可读时长 */
export function formatReadingTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (isChineseLocale()) {
    const parts: string[] = [];
    if (hours > 0) parts.push(t("time.hours", { n: hours }));
    if (minutes > 0 || hours > 0) parts.push(t("time.minutes", { n: minutes }));
    parts.push(t("time.seconds", { n: secs }));
    return parts.join("");
  }

  const parts: string[] = [];
  if (hours > 0) parts.push(t("time.hours", { n: hours }));
  if (minutes > 0 || hours > 0) parts.push(t("time.minutes", { n: minutes }));
  parts.push(t("time.seconds", { n: secs }));
  return parts.join(" ");
}

/** 解析时分秒字符串或纯秒数字符串，返回累计秒数 */
export function parseReadingTime(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;

  if (/^\d+$/.test(trimmed)) return Math.floor(Number(trimmed));

  const hmsMatch = trimmed.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (hmsMatch) {
    return Number(hmsMatch[1]) * 3600 + Number(hmsMatch[2]) * 60 + Number(hmsMatch[3]);
  }

  let seconds = 0;
  const hourMatch = trimmed.match(/(\d+)小时|(\d+)小時|(\d+)h\b/i);
  const minMatch = trimmed.match(/(\d+)分|(\d+)m\b/i);
  const secMatch = trimmed.match(/(\d+)秒|(\d+)s\b/i);
  if (hourMatch) seconds += Number(hourMatch[1] ?? hourMatch[2] ?? hourMatch[3]) * 3600;
  if (minMatch) seconds += Number(minMatch[1] ?? minMatch[2]) * 60;
  if (secMatch) seconds += Number(secMatch[1] ?? secMatch[2]);
  return seconds;
}

export interface ProgressData {
  progress: Record<string, BookProgress>;
}

// ---- Annotations (画线 / 标注) ----

export type HighlightColor = "yellow" | "red" | "green" | "blue" | "purple";

export interface HighlightColorDef {
  id: HighlightColor;
  label: string;
  hex: string;
}

const HIGHLIGHT_COLOR_HEX: Record<HighlightColor, string> = {
  yellow: "#e8b339",
  red: "#e0533d",
  green: "#3aa675",
  blue: "#3b82c4",
  purple: "#8b5cf6",
};

const HIGHLIGHT_COLOR_IDS_LIST: HighlightColor[] = ["yellow", "red", "green", "blue", "purple"];

export function getHighlightColors(): HighlightColorDef[] {
  return HIGHLIGHT_COLOR_IDS_LIST.map((id) => ({
    id,
    hex: HIGHLIGHT_COLOR_HEX[id],
    label: isI18nInitialized() ? t(`defaults.highlightColors.${id}`) : id,
  }));
}

/** @deprecated Use getHighlightColors() */
export const HIGHLIGHT_COLORS: HighlightColorDef[] = HIGHLIGHT_COLOR_IDS_LIST.map((id) => ({
  id,
  hex: HIGHLIGHT_COLOR_HEX[id],
  label: id,
}));

export function colorHex(id: HighlightColor): string {
  return HIGHLIGHT_COLOR_HEX[id] ?? HIGHLIGHT_COLOR_HEX.yellow;
}

const HIGHLIGHT_COLOR_IDS = new Set<string>(HIGHLIGHT_COLOR_IDS_LIST);

export function normalizeHighlightColor(value: unknown): HighlightColor {
  if (typeof value === "string" && HIGHLIGHT_COLOR_IDS.has(value)) {
    return value as HighlightColor;
  }
  return HIGHLIGHT_COLOR_IDS_LIST[0];
}

export const NOTE_ICON_SIZE_MIN = 14;
export const NOTE_ICON_SIZE_MAX = 100;
export const NOTE_ICON_OFFSET_X_MIN = -8;
export const NOTE_ICON_OFFSET_X_MAX = 100;
export const NOTE_ICON_OFFSET_Y_MIN = -8;
export const NOTE_ICON_OFFSET_Y_MAX = 10;

export const HIGHLIGHT_OPACITY_MIN = 0.15;
export const HIGHLIGHT_OPACITY_MAX = 0.85;

export const READING_SIDE_PADDING_MIN = 12;
export const READING_SIDE_PADDING_MAX = 120;
export const READING_SIDE_PADDING_STEP = 2;
export const READING_SIDE_PADDING_DEFAULT = 12;

export function clampReadingSidePadding(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return READING_SIDE_PADDING_DEFAULT;
  const clamped = Math.min(
    READING_SIDE_PADDING_MAX,
    Math.max(READING_SIDE_PADDING_MIN, Math.round(n))
  );
  const stepped =
    Math.round(clamped / READING_SIDE_PADDING_STEP) * READING_SIDE_PADDING_STEP;
  return Math.min(READING_SIDE_PADDING_MAX, Math.max(READING_SIDE_PADDING_MIN, stepped));
}

export function clampHighlightOpacity(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.38;
  return Math.min(HIGHLIGHT_OPACITY_MAX, Math.max(HIGHLIGHT_OPACITY_MIN, n));
}

export function clampNoteIconSize(value: number): number {
  return Math.min(NOTE_ICON_SIZE_MAX, Math.max(NOTE_ICON_SIZE_MIN, Math.round(value)));
}

export function noteIconGlyphSize(iconSize: number): number {
  return Math.max(8, Math.round(clampNoteIconSize(iconSize) * 0.68));
}

export function clampNoteIconOffsetX(value: number): number {
  return Math.min(NOTE_ICON_OFFSET_X_MAX, Math.max(NOTE_ICON_OFFSET_X_MIN, Math.round(value)));
}

export function clampNoteIconOffsetY(value: number): number {
  return Math.min(NOTE_ICON_OFFSET_Y_MAX, Math.max(NOTE_ICON_OFFSET_Y_MIN, Math.round(value)));
}

export interface Annotation {
  id: string;
  cfiRange: string;
  text: string;
  color: HighlightColor;
  note?: string;
  noteType?: NoteType;
  chapter: string;
  created: string;
}

export interface EpubOpenBridge {
  consumePendingCfi(filePath: string): string;
  attachStatusBarChrome(
    toolbar: HTMLElement,
    progress: HTMLElement | null,
    container: HTMLElement
  ): void;
  detachStatusBarChrome(
    toolbar: HTMLElement,
    progress: HTMLElement | null,
    container: HTMLElement
  ): void;
  isStatusBarChromeAttached(): boolean;
}
