import { App, PluginSettingTab, Setting } from "obsidian";
import type ObEpubPlugin from "./main";

export class EpubSettingsTab extends PluginSettingTab {
  plugin: ObEpubPlugin;

  constructor(app: App, plugin: ObEpubPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "EPUB Reader 设置" });

    new Setting(containerEl)
      .setName("摘录文件夹")
      .setDesc("摘录 Markdown 保存目录；阅读进度写入各书摘录文件的 frontmatter")
      .addText((text) =>
        text
          .setPlaceholder("epub-books/anno")
          .setValue(this.plugin.settings.excerptFolder)
          .onChange(async (value) => {
            this.plugin.settings.excerptFolder = value || "epub-books/anno";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("默认阅读模式")
      .setDesc("分页模式或滚动模式")
      .addDropdown((drop) =>
        drop
          .addOption("paginated", "分页")
          .addOption("scrolled", "滚动")
          .setValue(this.plugin.settings.defaultFlow)
          .onChange(async (value) => {
            this.plugin.settings.defaultFlow = value as "paginated" | "scrolled";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("默认字体大小")
      .setDesc("阅读器内容区字体大小（px）")
      .addSlider((slider) =>
        slider
          .setLimits(10, 32, 1)
          .setValue(this.plugin.settings.fontSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.fontSize = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "AI 集成" });

    new Setting(containerEl)
      .setName("AI API URL")
      .setDesc("OpenAI 兼容接口地址（例：https://api.openai.com/v1）")
      .addText((text) =>
        text
          .setPlaceholder("https://api.openai.com/v1")
          .setValue(this.plugin.settings.aiApiUrl)
          .onChange(async (value) => {
            this.plugin.settings.aiApiUrl = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("AI API Key")
      .setDesc("你的 API Key（保存在本地，不会上传）")
      .addText((text) => {
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.aiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.aiApiKey = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("AI 模型")
      .setDesc("使用的模型名称（例：gpt-4o-mini）")
      .addText((text) =>
        text
          .setPlaceholder("gpt-4o-mini")
          .setValue(this.plugin.settings.aiModel)
          .onChange(async (value) => {
            this.plugin.settings.aiModel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("AI Prompt 模板")
      .setDesc("使用 {text} 作为选中文字的占位符")
      .addTextArea((area) =>
        area
          .setPlaceholder("请解释以下这段话的含义：\n\n{text}")
          .setValue(this.plugin.settings.aiPromptTemplate)
          .onChange(async (value) => {
            this.plugin.settings.aiPromptTemplate = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
