import { App, ExtraButtonComponent, Notice, PluginSettingTab, Setting } from "obsidian";
import type ObEpubPlugin from "./main";
import { ExcerptCheckModal } from "./ExcerptCheckModal";
import {
  DEFAULT_NOTE_TYPES,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_OPACITY_MAX,
  HIGHLIGHT_OPACITY_MIN,
  NoteType,
  READING_THEMES,
  ReadingThemeId,
  SOURCE_LINK_FORMATS,
  SourceLinkFormat,
  FeatureGroupId,
  isFeatureGroupCollapsed,
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

type SettingsGroupId = FeatureGroupId;

export class EpubSettingsTab extends PluginSettingTab {
  plugin: ObEpubPlugin;
  private collapseButtons = new Map<SettingsGroupId, ExtraButtonComponent>();

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

  /** Obsidian 设置页只稳定渲染 containerEl 的直接子节点，分组用 data 属性 + CSS 实现。 */
  private tagGroup(el: HTMLElement, groupId: SettingsGroupId, role: "header" | "member" | "extra"): void {
    el.dataset.obEpubGroup = groupId;
    el.dataset.obEpubGroupRole = role;
    el.addClass(`ob-epub-group-${role}`);
  }

  private setGroupMembersDisabled(groupId: SettingsGroupId, disabled: boolean): void {
    const { containerEl } = this;
    for (const el of containerEl.querySelectorAll(`[data-ob-epub-group="${groupId}"]`)) {
      const role = (el as HTMLElement).dataset.obEpubGroupRole;
      if (role === "header") continue;
      (el as HTMLElement).toggleClass("is-disabled", disabled);
      for (const control of el.querySelectorAll("input, select, button, textarea")) {
        (control as HTMLInputElement).disabled = disabled;
      }
    }
  }

  private endGroup(containerEl: HTMLElement, groupId: SettingsGroupId): void {
    const footer = containerEl.createDiv({ cls: "ob-epub-group-footer" });
    footer.dataset.obEpubGroup = groupId;
    footer.dataset.obEpubGroupRole = "footer";
  }

  private isGroupCollapsed(groupId: SettingsGroupId): boolean {
    return isFeatureGroupCollapsed(this.plugin.settings.featureGroups, groupId);
  }

  private setGroupCollapsedSetting(groupId: SettingsGroupId, collapsed: boolean): void {
    const groups = this.plugin.settings.featureGroups;
    if (groupId === "reader") groups.readerCollapsed = collapsed;
    else if (groupId === "annotations") groups.annotationsCollapsed = collapsed;
    else groups.bookshelfCollapsed = collapsed;
  }

  private applyGroupCollapsed(groupId: SettingsGroupId, collapsed: boolean): void {
    const { containerEl } = this;
    for (const el of containerEl.querySelectorAll(`[data-ob-epub-group="${groupId}"]`)) {
      const node = el as HTMLElement;
      const role = node.dataset.obEpubGroupRole;
      if (role === "header") {
        node.toggleClass("is-collapsed", collapsed);
        continue;
      }
      node.toggleClass("is-collapsed-hidden", collapsed);
    }
    const btn = this.collapseButtons.get(groupId);
    btn?.setIcon(collapsed ? "chevron-right" : "chevron-down");
    btn?.setTooltip(collapsed ? "展开分组" : "折叠分组");
  }

  private async toggleGroupCollapsed(groupId: SettingsGroupId): Promise<void> {
    const collapsed = !this.isGroupCollapsed(groupId);
    this.setGroupCollapsedSetting(groupId, collapsed);
    const existing = (await this.plugin.loadData()) ?? {};
    existing.settings = this.plugin.settings;
    await this.plugin.saveData(existing);
    this.applyGroupCollapsed(groupId, collapsed);
  }

  private applyAllGroupCollapsedStates(): void {
    for (const groupId of ["reader", "annotations", "bookshelf"] as const) {
      this.applyGroupCollapsed(groupId, this.isGroupCollapsed(groupId));
    }
  }

  private renderGroupScopeList(
    containerEl: HTMLElement,
    groupId: SettingsGroupId,
    items: string[],
    label: string
  ): HTMLElement {
    const list = containerEl.createDiv({ cls: "ob-epub-settings-group-scope ob-epub-group-extra" });
    this.tagGroup(list, groupId, "extra");
    list.createDiv({ cls: "ob-epub-settings-group-scope-label", text: label });
    const ul = list.createEl("ul", { cls: "ob-epub-settings-group-scope-list" });
    for (const item of items) {
      ul.createEl("li", { text: item });
    }
    return list;
  }

  private addGroupHeader(
    containerEl: HTMLElement,
    groupId: SettingsGroupId,
    options: {
      title: string;
      desc: string;
      enabled?: boolean;
      onToggle?: (enabled: boolean) => void | Promise<void>;
    }
  ): Setting {
    const collapsed = this.isGroupCollapsed(groupId);
    const header = new Setting(containerEl).setName(options.title).setDesc(options.desc);
    this.tagGroup(header.settingEl, groupId, "header");
    header.settingEl.toggleClass("is-collapsed", collapsed);

    header.addExtraButton((btn) => {
      this.collapseButtons.set(groupId, btn);
      btn.setIcon(collapsed ? "chevron-right" : "chevron-down");
      btn.setTooltip(collapsed ? "展开分组" : "折叠分组");
      btn.onClick(() => {
        void this.toggleGroupCollapsed(groupId);
      });
    });

    if (options.onToggle) {
      header.addToggle((toggle) =>
        toggle
          .setValue(options.enabled ?? true)
          .onChange(async (value) => {
            await options.onToggle?.(value);
          })
      );
    }
    return header;
  }

  private addMemberSetting(
    containerEl: HTMLElement,
    groupId: SettingsGroupId,
    build: (setting: Setting) => void
  ): Setting {
    const setting = new Setting(containerEl);
    this.tagGroup(setting.settingEl, groupId, "member");
    build(setting);
    return setting;
  }

  private renderSourceLinkFormat(containerEl: HTMLElement, groupId: SettingsGroupId): void {
    const formatSetting = this.addMemberSetting(containerEl, groupId, (s) => {
      s.setName("摘录链接格式");
    });
    formatSetting.descEl.empty();
    formatSetting.descEl.appendText("选中复制与新标注使用所选格式；");
    formatSetting.descEl.createSpan({
      cls: "ob-epub-settings-warn",
      text: "修改设置后新建标注会更新原有标注，建议修改前先备份摘录文件夹。",
    });

    const formatRows = new Map<SourceLinkFormat, HTMLElement>();
    const tableWrap = containerEl.createDiv({ cls: "ob-epub-format-table-wrap ob-epub-group-extra" });
    this.tagGroup(tableWrap, groupId, "extra");
    const table = tableWrap.createEl("table", { cls: "ob-epub-format-table" });
    const headRow = table.createEl("thead").createEl("tr");
    for (const heading of ["格式", "优点", "缺点"]) {
      headRow.createEl("th", { text: heading });
    }
    const tbody = table.createEl("tbody");
    for (const fmt of SOURCE_LINK_FORMATS) {
      const row = tbody.createEl("tr");
      if (fmt.id === this.plugin.settings.sourceLinkFormat) {
        row.addClass("is-active");
      }
      row.createEl("td", { text: fmt.label });
      row.createEl("td", { text: fmt.pros });
      row.createEl("td", { text: fmt.cons });
      formatRows.set(fmt.id, row);
    }

    formatSetting.addDropdown((drop) => {
      for (const fmt of SOURCE_LINK_FORMATS) {
        drop.addOption(fmt.id, fmt.label);
      }
      drop
        .setValue(this.plugin.settings.sourceLinkFormat)
        .onChange(async (value) => {
          const format = value as SourceLinkFormat;
          this.plugin.settings.sourceLinkFormat = format;
          for (const [id, row] of formatRows) {
            row.toggleClass("is-active", id === format);
          }
          await this.plugin.saveSettings();
        });
    });
  }

  private renderDefaultExcerptColor(containerEl: HTMLElement, groupId: SettingsGroupId): void {
    const setting = this.addMemberSetting(containerEl, groupId, (s) => {
      s.setName("默认画线颜色").setDesc(
        "不保存颜色的摘录格式（正文 + 文末「原文」、链接即正文）在解析或格式转换时使用的画线颜色"
      );
    });

    const dots = setting.controlEl.createDiv({ cls: "epub-color-dots" });
    for (const c of HIGHLIGHT_COLORS) {
      const dot = dots.createDiv({ cls: "epub-color-dot" });
      dot.setAttribute("data-color", c.id);
      dot.title = c.label;
      if (c.id === this.plugin.settings.defaultExcerptHighlightColor) {
        dot.addClass("is-active");
      }
      dot.addEventListener("click", async () => {
        this.plugin.settings.defaultExcerptHighlightColor = c.id;
        dots.querySelectorAll(".epub-color-dot").forEach((el) => {
          el.toggleClass("is-active", el.getAttribute("data-color") === c.id);
        });
        await this.plugin.saveSettings();
      });
    }
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("ob-epub-settings");
    this.collapseButtons.clear();

    // ── 阅读器（始终开启）──
    this.addGroupHeader(containerEl, "reader", {
      title: "阅读器",
      desc: "核心阅读能力，无总开关（禁用插件请在社区插件设置中操作）",
    });

    this.renderGroupScopeList(
      containerEl,
      "reader",
      [
        "打开 EPUB 与章节目录",
        "分页 / 滚动、字体与阅读主题",
        "选中复制与摘录链接格式",
        "从笔记跳回 EPUB 原文",
      ],
      "始终可用："
    );

    this.addMemberSetting(containerEl, "reader", (s) => {
      s.setName("默认阅读模式")
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
    });

    this.addMemberSetting(containerEl, "reader", (s) => {
      s.setName("默认字体大小")
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
    });

    this.addMemberSetting(containerEl, "reader", (s) => {
      s.setName("默认阅读主题")
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
    });

    this.renderSourceLinkFormat(containerEl, "reader");
    this.renderDefaultExcerptColor(containerEl, "reader");
    this.endGroup(containerEl, "reader");

    // ── 标注与摘录 ──
    const annotationsEnabled = this.plugin.settings.featureGroups.annotationsAndExcerpts;

    this.addGroupHeader(containerEl, "annotations", {
      title: "标注与摘录",
      desc: "高亮、想法、摘录写入与侧栏标注；关闭后选中文字可复制（可选颜色），不可画线与写入摘录",
      enabled: annotationsEnabled,
      onToggle: async (value) => {
        this.plugin.settings.featureGroups.annotationsAndExcerpts = value;
        await this.plugin.saveSettings();
        this.setGroupMembersDisabled("annotations", !value);
      },
    });

    this.renderGroupScopeList(
      containerEl,
      "annotations",
      [
        "文本高亮与五种想法",
        "摘录 Markdown 自动写入",
        "侧栏「标注」列表",
        "阅读进度写入摘录 frontmatter",
      ],
      "开启后可用："
    );

    const excerptFolderSetting = this.addMemberSetting(containerEl, "annotations", (s) => {
      s.setName("摘录文件夹").addText((text) =>
        text
          .setPlaceholder("{filefolder}/anno")
          .setValue(this.plugin.settings.excerptFolder)
          .onChange(async (value) => {
            this.plugin.settings.excerptFolder = value || "epub-books/anno";
            await this.plugin.saveSettings();
          })
      );
    });
    excerptFolderSetting.descEl.empty();
    excerptFolderSetting.descEl.appendText(
      "摘录 Markdown 保存目录；阅读进度写入各书摘录文件的 frontmatter。支持 {filefolder} 占位符（EPUB 所在目录），如 {filefolder}/anno。"
    );
    excerptFolderSetting.descEl.createEl("br");
    excerptFolderSetting.descEl.createSpan({
      cls: "ob-epub-settings-warn",
      text: "移动 EPUB 或文件夹后，需手动更新摘录 frontmatter 中的 epub-source 为新路径，否则标题跳转链接会失效",
    });

    const excerptFilenameSetting = this.addMemberSetting(containerEl, "annotations", (s) => {
      s.setName("摘录文件名").addText((text) =>
        text
          .setPlaceholder("《{title}》摘录.md")
          .setValue(this.plugin.settings.excerptFilename)
          .onChange(async (value) => {
            this.plugin.settings.excerptFilename = value || "《{title}》摘录.md";
            await this.plugin.saveSettings();
          })
      );
    });
    excerptFilenameSetting.descEl.empty();
    excerptFilenameSetting.descEl.appendText(
      "新建摘录时使用的 Markdown 文件名。支持 {title}（EPUB 书名，不含扩展名）与 {filename}（EPUB 完整文件名，如 demo.epub）。"
    );
    excerptFilenameSetting.descEl.createEl("br");
    excerptFilenameSetting.descEl.appendText("示例：《{title}》摘录.md、{title}-notes.md、{filename}.md");

    this.addMemberSetting(containerEl, "annotations", (s) => {
      s.setName("摘录 callout 背景透明度")
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
    });

    const convertSetting = this.addMemberSetting(containerEl, "annotations", (s) => {
      s.setName("转换已有摘录链接").addButton((btn) =>
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
    });
    convertSetting.descEl.empty();
    convertSetting.descEl.appendText(
      "批量将摘录文件夹内所有《书名》摘录.md 转换为当前选中的摘录导出格式；使用 {filefolder} 时会扫描库内全部《书名》摘录.md"
    );
    convertSetting.descEl.createEl("br");
    convertSetting.descEl.createSpan({
      cls: "ob-epub-settings-warn",
      text: "转换会改写摘录文件，建议先备份摘录文件夹",
    });

    this.addMemberSetting(containerEl, "annotations", (s) => {
      s.setName("检查摘录元数据")
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
    });

    this.addMemberSetting(containerEl, "annotations", (s) => {
      s.setName("EPUB 高亮透明度")
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
    });

    const noteTypesHeading = new Setting(containerEl).setName("想法类型").setHeading();
    this.tagGroup(noteTypesHeading.settingEl, "annotations", "member");

    const noteTypesDesc = new Setting(containerEl).setDesc(
      "标注时可选择的五种想法分类；修改名称与图标后，新标注与已有标注的显示会同步更新"
    );
    this.tagGroup(noteTypesDesc.settingEl, "annotations", "member");

    const noteTypes = resolveNoteTypes(this.plugin.settings.noteTypes);
    for (const def of noteTypes) {
      const fallback = DEFAULT_NOTE_TYPES.find((t) => t.id === def.id)!;
      const noteTypeSetting = this.addMemberSetting(containerEl, "annotations", (s) => {
        s.setName(fallback.label)
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
      });
      void noteTypeSetting;
    }

    const resetNoteTypes = new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("恢复默认想法类型").onClick(async () => {
        this.plugin.settings.noteTypes = DEFAULT_NOTE_TYPES.map((t) => ({ ...t }));
        await this.plugin.saveSettings();
        this.display();
      })
    );
    this.tagGroup(resetNoteTypes.settingEl, "annotations", "member");

    const noteIconHeading = new Setting(containerEl).setName("想法图标").setHeading();
    this.tagGroup(noteIconHeading.settingEl, "annotations", "member");

    this.addMemberSetting(containerEl, "annotations", (s) => {
      s.setName("图标大小")
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
    });

    this.addMemberSetting(containerEl, "annotations", (s) => {
      s.setName("水平位置")
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
    });

    this.addMemberSetting(containerEl, "annotations", (s) => {
      s.setName("垂直位置")
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
    });

    this.endGroup(containerEl, "annotations");
    this.setGroupMembersDisabled("annotations", !annotationsEnabled);

    // ── 书架与快捷入口 ──
    const bookshelfEnabled = this.plugin.settings.featureGroups.bookshelf;

    this.addGroupHeader(containerEl, "bookshelf", {
      title: "书架与快捷入口",
      desc: "侧边栏书架、Ribbon 与相关命令",
      enabled: bookshelfEnabled,
      onToggle: async (value) => {
        this.plugin.settings.featureGroups.bookshelf = value;
        await this.plugin.saveSettings();
        this.setGroupMembersDisabled("bookshelf", !value);
      },
    });

    this.renderGroupScopeList(
      containerEl,
      "bookshelf",
      ["Ribbon「EPUB 书架」图标", "命令「打开 EPUB 书架」", "侧边栏书架视图"],
      "开启后可用："
    );

    const bookshelfNote = containerEl.createDiv({
      cls: "ob-epub-settings-group-scope-note ob-epub-group-extra",
      text: "「在 EPUB 阅读器中打开」属于阅读器核心，不受此开关影响。",
    });
    this.tagGroup(bookshelfNote, "bookshelf", "extra");

    this.endGroup(containerEl, "bookshelf");
    this.setGroupMembersDisabled("bookshelf", !bookshelfEnabled);

    this.applyAllGroupCollapsedStates();
  }
}
