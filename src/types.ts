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

export const READING_THEMES: ReadingThemeDef[] = [
  {
    id: "obsidian",
    label: "跟随 Obsidian",
    background: "",
    text: "",
    link: "",
    selection: "",
    swatch: "linear-gradient(135deg, #ffffff 50%, #1e1e1e 50%)",
  },
  {
    id: "white",
    label: "默认白",
    background: "#FFFFFF",
    text: "#333333",
    link: "#576B95",
    selection: "rgba(87, 107, 149, 0.25)",
    swatch: "#FFFFFF",
  },
  {
    id: "yellow",
    label: "护眼黄",
    background: "#FAF9DE",
    text: "#333333",
    link: "#576B95",
    selection: "rgba(232, 179, 57, 0.35)",
    swatch: "#FAF9DE",
  },
  {
    id: "green",
    label: "护眼绿",
    background: "#E3EDCD",
    text: "#333333",
    link: "#3A7D44",
    selection: "rgba(58, 166, 117, 0.3)",
    swatch: "#E3EDCD",
  },
  {
    id: "sepia",
    label: "羊皮纸",
    background: "#F4ECD8",
    text: "#5C4B37",
    link: "#8B6914",
    selection: "rgba(139, 105, 20, 0.25)",
    swatch: "#F4ECD8",
  },
  {
    id: "dark",
    label: "夜间",
    background: "#1C1C1E",
    text: "#A8A8A8",
    link: "#7EB6FF",
    selection: "rgba(123, 104, 238, 0.4)",
    swatch: "#1C1C1E",
  },
];

const READING_THEME_IDS = new Set<string>(READING_THEMES.map((t) => t.id));

export function getReadingTheme(id: ReadingThemeId): ReadingThemeDef {
  return READING_THEMES.find((t) => t.id === id) ?? READING_THEMES[0];
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

export const DEFAULT_NOTE_TYPES: NoteTypeDef[] = [
  { id: "note", label: "做笔记", icon: "📝" },
  { id: "inspiration", label: "灵感", icon: "💡" },
  { id: "practice", label: "准备实践", icon: "✅" },
  { id: "revisit", label: "反复看", icon: "🔁" },
  { id: "question", label: "疑问", icon: "❓" },
];

/** @deprecated Use DEFAULT_NOTE_TYPES */
export const NOTE_TYPES = DEFAULT_NOTE_TYPES;

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
  return DEFAULT_NOTE_TYPES.map((fallback) => {
    const custom = stored?.find((t) => t.id === fallback.id);
    return sanitizeNoteTypeDef(custom ?? fallback, fallback);
  });
}

export function normalizeNoteType(raw: string | undefined, types: NoteTypeDef[]): NoteType {
  const ids = new Set(types.map((t) => t.id));
  if (raw && ids.has(raw)) return raw as NoteType;
  return "note";
}

export function noteTypeIcon(id: NoteType | undefined, types: NoteTypeDef[]): string {
  return types.find((t) => t.id === (id ?? "note"))?.icon ?? DEFAULT_NOTE_TYPES[0].icon;
}

export function noteTypeLabel(id: NoteType | undefined, types: NoteTypeDef[]): string {
  return types.find((t) => t.id === (id ?? "note"))?.label ?? DEFAULT_NOTE_TYPES[0].label;
}

export interface EpubPluginSettings {
  excerptFolder: string;
  aiApiUrl: string;
  aiApiKey: string;
  aiModel: string;
  aiPromptTemplate: string;
  defaultFlow: "paginated" | "scrolled";
  fontSize: number;
  readingTheme: ReadingThemeId;
  /** 想法图标直径 (px) */
  noteIconSize: number;
  /** 相对高亮右缘的水平偏移 (px)，正值向右 */
  noteIconOffsetX: number;
  /** 垂直偏移 (px)，正值向下 */
  noteIconOffsetY: number;
  /** 五种想法类型的图标与显示名称（id 固定，仅可改 label / icon） */
  noteTypes: NoteTypeDef[];
}

export const DEFAULT_SETTINGS: EpubPluginSettings = {
  excerptFolder: "epub-books/anno",
  aiApiUrl: "https://api.openai.com/v1",
  aiApiKey: "",
  aiModel: "gpt-4o-mini",
  aiPromptTemplate: "请解释以下这段话的含义：\n\n{text}",
  defaultFlow: "scrolled",
  fontSize: 16,
  readingTheme: "obsidian",
  noteIconSize: 20,
  noteIconOffsetX: 2,
  noteIconOffsetY: 0,
  noteTypes: DEFAULT_NOTE_TYPES.map((t) => ({ ...t })),
};

export interface BookProgress {
  cfi: string;
  chapter: string;
  percent: number;
  lastRead: string;
  readingTimeSeconds?: number;
}

/** 将累计阅读秒数格式化为时分秒，如 390 → "6分30秒"，4980 → "1小时23分0秒" */
export function formatReadingTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0 || hours > 0) parts.push(`${minutes}分`);
  parts.push(`${secs}秒`);
  return parts.join("");
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
  const hourMatch = trimmed.match(/(\d+)小时/);
  const minMatch = trimmed.match(/(\d+)分/);
  const secMatch = trimmed.match(/(\d+)秒/);
  if (hourMatch) seconds += Number(hourMatch[1]) * 3600;
  if (minMatch) seconds += Number(minMatch[1]) * 60;
  if (secMatch) seconds += Number(secMatch[1]);
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

// Five drawing-line colors offered to the user.
export const HIGHLIGHT_COLORS: HighlightColorDef[] = [
  { id: "yellow", label: "黄", hex: "#e8b339" },
  { id: "red", label: "红", hex: "#e0533d" },
  { id: "green", label: "绿", hex: "#3aa675" },
  { id: "blue", label: "蓝", hex: "#3b82c4" },
  { id: "purple", label: "紫", hex: "#8b5cf6" },
];

export function colorHex(id: HighlightColor): string {
  return HIGHLIGHT_COLORS.find((c) => c.id === id)?.hex ?? "#e8b339";
}

export const NOTE_ICON_SIZE_MIN = 14;
export const NOTE_ICON_SIZE_MAX = 100;
export const NOTE_ICON_OFFSET_X_MIN = -8;
export const NOTE_ICON_OFFSET_X_MAX = 100;
export const NOTE_ICON_OFFSET_Y_MIN = -8;
export const NOTE_ICON_OFFSET_Y_MAX = 10;

export function clampNoteIconSize(value: number): number {
  return Math.min(NOTE_ICON_SIZE_MAX, Math.max(NOTE_ICON_SIZE_MIN, Math.round(value)));
}

/** Emoji glyph size inside the circular note icon button (≈68% of diameter). */
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

/** Bridge from EpubReaderView back to the plugin for deep-link jumps. */
export interface EpubOpenBridge {
  consumePendingCfi(filePath: string): string;
}
