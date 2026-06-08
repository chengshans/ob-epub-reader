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
  excerptFolder: "co-books",
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

export interface AnnotationData {
  annotations: Record<string, Annotation[]>;
}
