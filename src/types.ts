export interface EpubPluginSettings {
  excerptFolder: string;
  aiApiUrl: string;
  aiApiKey: string;
  aiModel: string;
  aiPromptTemplate: string;
  defaultFlow: "paginated" | "scrolled";
  fontSize: number;
  /** 想法图标直径 (px) */
  noteIconSize: number;
  /** 相对高亮右缘的水平偏移 (px)，正值向右 */
  noteIconOffsetX: number;
  /** 垂直偏移 (px)，正值向下 */
  noteIconOffsetY: number;
}

export const DEFAULT_SETTINGS: EpubPluginSettings = {
  excerptFolder: "epub-books/anno",
  aiApiUrl: "https://api.openai.com/v1",
  aiApiKey: "",
  aiModel: "gpt-4o-mini",
  aiPromptTemplate: "请解释以下这段话的含义：\n\n{text}",
  defaultFlow: "paginated",
  fontSize: 16,
  noteIconSize: 20,
  noteIconOffsetX: 2,
  noteIconOffsetY: 0,
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

// ---- Note types (想法类型) ----

export type NoteType = "note" | "inspiration" | "practice" | "revisit" | "question";

export interface NoteTypeDef {
  id: NoteType;
  label: string;
  icon: string;
}

export const NOTE_TYPES: NoteTypeDef[] = [
  { id: "note", label: "做笔记", icon: "📝" },
  { id: "inspiration", label: "灵感", icon: "💡" },
  { id: "practice", label: "准备实践", icon: "✅" },
  { id: "revisit", label: "反复看", icon: "🔁" },
  { id: "question", label: "疑问", icon: "❓" },
];

const NOTE_TYPE_IDS = new Set<string>(NOTE_TYPES.map((t) => t.id));

export function normalizeNoteType(raw: string | undefined): NoteType {
  if (raw && NOTE_TYPE_IDS.has(raw)) return raw as NoteType;
  return "note";
}

export function noteTypeIcon(id?: NoteType): string {
  return NOTE_TYPES.find((t) => t.id === (id ?? "note"))?.icon ?? "📝";
}

export function noteTypeLabel(id?: NoteType): string {
  return NOTE_TYPES.find((t) => t.id === (id ?? "note"))?.label ?? "做笔记";
}

export const NOTE_ICON_SIZE_MIN = 14;
export const NOTE_ICON_SIZE_MAX = 30;
export const NOTE_ICON_OFFSET_X_MIN = -8;
export const NOTE_ICON_OFFSET_X_MAX = 30;
export const NOTE_ICON_OFFSET_Y_MIN = -8;
export const NOTE_ICON_OFFSET_Y_MAX = 8;

export function clampNoteIconSize(value: number): number {
  return Math.min(NOTE_ICON_SIZE_MAX, Math.max(NOTE_ICON_SIZE_MIN, Math.round(value)));
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
