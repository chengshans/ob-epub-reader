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
