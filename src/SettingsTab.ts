import { App, PluginSettingTab, Setting } from "obsidian";
import type ObEpubPlugin from "./main";
import { READING_THEMES, ReadingThemeId } from "./types";
import {
  NOTE_ICON_OFFSET_X_MAX,
  NOTE_ICON_OFFSET_X_MIN,
  NOTE_ICON_OFFSET_Y_MAX,
  NOTE_ICON_OFFSET_Y_MIN,
  NOTE_ICON_SIZE_MAX,
  NOTE_ICON_SIZE_MIN,
} from "./types";

export class EpubSettingsTab extends PluginSettingTab {
  plugin: ObEpubPlugin;

  constructor(app: App, plugin: ObEpubPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("ob-epub-settings");
    new Setting(containerEl).setName("常规").setHeading();

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

    new Setting(containerEl)
      .setName("默认阅读主题")
      .setDesc("EPUB 正文区背景与文字配色")
      .addDropdown((drop) => {
        for (const theme of READING_THEMES) {
          drop.addOption(theme.id, theme.label);
        }
        drop
          .setValue(this.plugin.settings.readingTheme)
          .onChange(async (value) => {
            this.plugin.settings.readingTheme = value as ReadingThemeId;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl).setName("想法图标").setHeading();

    new Setting(containerEl)
      .setName("图标大小")
      .setDesc(`原文想法图标的直径（${NOTE_ICON_SIZE_MIN}–${NOTE_ICON_SIZE_MAX} px）`)
      .addSlider((slider) =>
        slider
          .setLimits(NOTE_ICON_SIZE_MIN, NOTE_ICON_SIZE_MAX, 1)
          .setValue(this.plugin.settings.noteIconSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.noteIconSize = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("水平位置")
      .setDesc(
        `相对高亮右缘的偏移（${NOTE_ICON_OFFSET_X_MIN} ~ +${NOTE_ICON_OFFSET_X_MAX} px，正值向右）`
      )
      .addSlider((slider) =>
        slider
          .setLimits(NOTE_ICON_OFFSET_X_MIN, NOTE_ICON_OFFSET_X_MAX, 1)
          .setValue(this.plugin.settings.noteIconOffsetX)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.noteIconOffsetX = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("垂直位置")
      .setDesc(
        `相对高亮垂直居中的偏移（${NOTE_ICON_OFFSET_Y_MIN} ~ +${NOTE_ICON_OFFSET_Y_MAX} px，正值向下）`
      )
      .addSlider((slider) =>
        slider
          .setLimits(NOTE_ICON_OFFSET_Y_MIN, NOTE_ICON_OFFSET_Y_MAX, 1)
          .setValue(this.plugin.settings.noteIconOffsetY)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.noteIconOffsetY = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("AI 集成").setHeading();

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
