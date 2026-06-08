import { Notice } from "obsidian";
import { EpubPluginSettings } from "./types";

export class AIService {
  private settings: EpubPluginSettings;

  constructor(settings: EpubPluginSettings) {
    this.settings = settings;
  }

  updateSettings(settings: EpubPluginSettings) {
    this.settings = settings;
  }

  async query(selectedText: string): Promise<string> {
    if (!this.settings.aiApiKey) {
      throw new Error("请先在设置中配置 AI API Key");
    }

    const prompt = this.settings.aiPromptTemplate.replace("{text}", selectedText);
    const apiUrl = this.settings.aiApiUrl.replace(/\/$/, "") + "/chat/completions";

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.aiApiKey}`,
      },
      body: JSON.stringify({
        model: this.settings.aiModel,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`AI API 错误 (${response.status}): ${err}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("AI 返回结果为空");
    }
    return content as string;
  }

  isConfigured(): boolean {
    return !!this.settings.aiApiKey && !!this.settings.aiApiUrl;
  }
}
