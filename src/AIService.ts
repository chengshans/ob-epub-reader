import { requestUrl } from "obsidian";
import { EpubPluginSettings } from "./types";

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

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

    const response = await requestUrl({
      url: apiUrl,
      method: "POST",
      contentType: "application/json",
      headers: {
        Authorization: `Bearer ${this.settings.aiApiKey}`,
      },
      body: JSON.stringify({
        model: this.settings.aiModel,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1000,
      }),
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`AI API 错误 (${response.status}): ${response.text}`);
    }

    const data = response.json as ChatCompletionResponse;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("AI 返回结果为空");
    }
    return content;
  }

  isConfigured(): boolean {
    return !!this.settings.aiApiKey && !!this.settings.aiApiUrl;
  }
}
