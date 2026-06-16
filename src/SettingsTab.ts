import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ObEpubPlugin from "./main";
import { ExcerptCheckModal } from "./ExcerptCheckModal";
import {
  DEFAULT_NOTE_TYPES,
  HIGHLIGHT_OPACITY_MAX,
  HIGHLIGHT_OPACITY_MIN,
  NoteType,
  READING_THEMES,
  ReadingThemeId,
  SOURCE_LINK_FORMATS,
  clampHighlightOpacity,
  resolveNoteTypes,
} from "./types";
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

  private async patchNoteType(id: NoteType, patch: { label?: string; icon?: string }) {
    const types = resolveNoteTypes(this.plugin.settings.noteTypes);
    const idx = types.findIndex((t) => t.id === id);
    if (idx < 0) return;
    if (patch.icon !== undefined) types[idx] = { ...types[idx], icon: patch.icon };
    if (patch.label !== undefined) types[idx] = { ...types[idx], label: patch.label };
    this.plugin.settings.noteTypes = resolveNoteTypes(types);
    await this.plugin.saveSettings();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("ob-epub-settings");
    new Setting(containerEl).setName("常规").setHeading();

    const excerptFolderSetting = new Setting(containerEl)
      .setName("摘录文件夹")
      .addText((text) =>
        text
          .setPlaceholder("{filefolder}/anno")
          .setValue(this.plugin.settings.excerptFolder)
          .onChange(async (value) => {
            this.plugin.settings.excerptFolder = value || "epub-books/anno";
            await this.plugin.saveSettings();
          })
      );
    excerptFolderSetting.descEl.empty();
    excerptFolderSetting.descEl.appendText(
      "摘录 Markdown 保存目录；阅读进度写入各书摘录文件的 frontmatter。支持 {filefolder} 占位符（EPUB 所在目录），如 {filefolder}/anno。"
    );
    excerptFolderSetting.descEl.createEl("br");
    excerptFolderSetting.descEl.createSpan({
      cls: "ob-epub-settings-warn",
      text: "移动 EPUB 或文件夹后，需手动更新摘录 frontmatter 中的 epub-source 为新路径，否则标题跳转链接会失效",
    });

    new Setting(containerEl)
      .setName("检查摘录元数据")
      .setDesc(
        "检查摘录 frontmatter 的 epub-source 是否指向存在的 EPUB；仅当 epub-source 缺失或无效时，才按 {filefolder} 规则查找同级 EPUB"
      )
      .addButton((btn) =>
        btn.setButtonText("开始检查").onClick(async () => {
          btn.setDisabled(true);
          try {
            const report = await this.plugin.annotationVaultStore.checkExcerptMetadata();
            new ExcerptCheckModal(this.app, report).open();
            if (report.withIssues === 0) {
              new Notice(`已检查 ${report.checked} 个摘录文件，未发现问题`);
            } else {
              new Notice(`发现 ${report.withIssues} 个摘录文件存在问题，详见弹窗`);
            }
          } catch (err) {
            console.error("ob-epub: excerpt metadata check failed", err);
            new Notice("检查摘录元数据失败，请查看控制台");
          } finally {
            btn.setDisabled(false);
          }
        })
      );

    new Setting(containerEl)
      .setName("摘录标题跳转格式")
      .setDesc(
        SOURCE_LINK_FORMATS.find((f) => f.id === this.plugin.settings.sourceLinkFormat)?.desc ??
          "摘录 callout 标题内嵌跳转链接的写入格式"
      )
      .addDropdown((drop) => {
        for (const fmt of SOURCE_LINK_FORMATS) {
          drop.addOption(fmt.id, fmt.label);
        }
        drop
          .setValue(this.plugin.settings.sourceLinkFormat)
          .onChange(async (value) => {
            this.plugin.settings.sourceLinkFormat =
              value === "wiki-link" ? "wiki-link" : "block-ref";
            await this.plugin.saveSettings();
            this.display();
          });
      });

    new Setting(containerEl)
      .setName("摘录 callout 背景透明度")
      .setDesc("控制《书名》摘录.md 中 ob-epub callout 背景浓淡")
      .addSlider((slider) =>
        slider
          .setLimits(
            Math.round(HIGHLIGHT_OPACITY_MIN * 100),
            Math.round(HIGHLIGHT_OPACITY_MAX * 100),
            1
          )
          .setValue(Math.round(this.plugin.settings.excerptCalloutOpacity * 100))
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.excerptCalloutOpacity = value / 100;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("转换已有摘录链接")
      .setDesc(
        "按上方所选格式，批量重写摘录文件夹内所有《书名》摘录.md 中的跳转链接；使用 {filefolder} 时会扫描库内全部《书名》摘录.md"
      )
      .addButton((btn) =>
        btn.setButtonText("立即转换").onClick(async () => {
          btn.setDisabled(true);
          try {
            const count = await this.plugin.annotationVaultStore.convertAllExcerptSourceLinks();
            new Notice(count > 0 ? `已更新 ${count} 个摘录文件` : "没有需要转换的摘录文件");
          } catch (err) {
            console.error("ob-epub: convert excerpt links failed", err);
            new Notice("转换摘录链接失败，请查看控制台");
          } finally {
            btn.setDisabled(false);
          }
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
      .setName("EPUB 高亮透明度")
      .setDesc("控制阅读器内画线/高亮层的透明度")
      .addSlider((slider) =>
        slider
          .setLimits(
            Math.round(HIGHLIGHT_OPACITY_MIN * 100),
            Math.round(HIGHLIGHT_OPACITY_MAX * 100),
            1
          )
          .setValue(Math.round(this.plugin.settings.epubHighlightOpacity * 100))
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.epubHighlightOpacity = value / 100;
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

    new Setting(containerEl).setName("想法类型").setHeading();

    new Setting(containerEl).setDesc(
      "标注时可选择的五种想法分类；修改名称与图标后，新标注与已有标注的显示会同步更新"
    );

    const noteTypes = resolveNoteTypes(this.plugin.settings.noteTypes);
    for (const def of noteTypes) {
      const fallback = DEFAULT_NOTE_TYPES.find((t) => t.id === def.id)!;
      new Setting(containerEl)
        .setName(fallback.label)
        .setDesc(`图标与显示名称（内部 ID: ${def.id}）`)
        .addText((text) => {
          text.inputEl.classList.add("ob-epub-note-type-icon-input");
          text.setPlaceholder("📝").setValue(def.icon).onChange(async (value) => {
            await this.patchNoteType(def.id, { icon: value });
          });
        })
        .addText((text) => {
          text.setPlaceholder(fallback.label).setValue(def.label).onChange(async (value) => {
            await this.patchNoteType(def.id, { label: value });
          });
        });
    }

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("恢复默认想法类型").onClick(async () => {
        this.plugin.settings.noteTypes = DEFAULT_NOTE_TYPES.map((t) => ({ ...t }));
        await this.plugin.saveSettings();
        this.display();
      })
    );

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
