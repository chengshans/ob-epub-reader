export interface EpubPluginSettings {
  excerptFolder: string;
  aiApiUrl: string;
  aiApiKey: string;
  aiModel: string;
  aiPromptTemplate: string;
  defaultFlow: "paginated" | "scrolled";
  fontSize: number;
}

export const DEFAULT_SETTINGS: EpubPluginSettings = {
  excerptFolder: "epub-books/anno",
  aiApiUrl: "https://api.openai.com/v1",
  aiApiKey: "",
  aiModel: "gpt-4o-mini",
  aiPromptTemplate: "请解释以下这段话的含义：\n\n{text}",
  defaultFlow: "paginated",
  fontSize: 16,
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

export interface Annotation {
  id: string;
  cfiRange: string;
  text: string;
  color: HighlightColor;
  note?: string;
  chapter: string;
  created: string;
}

/** Bridge from EpubReaderView back to the plugin for deep-link jumps. */
export interface EpubOpenBridge {
  consumePendingCfi(filePath: string): string;
}
