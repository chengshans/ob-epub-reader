import { App, ExtraButtonComponent, Notice, PluginSettingTab, Setting } from "obsidian";
import type ObEpubPlugin from "./main";
import { ExcerptCheckModal } from "./ExcerptCheckModal";
import { t } from "./i18n/i18n";
import {
  getDefaultNoteTypes,
  getHighlightColors,
  getReadingThemes,
  getSourceLinkFormats,
  HIGHLIGHT_OPACITY_MAX,
  HIGHLIGHT_OPACITY_MIN,
  NoteType,
  PluginUiLocale,
  ReadingThemeId,
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
    btn?.setTooltip(collapsed ? t("settings.group.expand") : t("settings.group.collapse"));
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
      btn.setTooltip(collapsed ? t("settings.group.expand") : t("settings.group.collapse"));
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
      s.setName(t("settings.sourceLinkFormat.name"));
    });
    formatSetting.descEl.empty();
    formatSetting.descEl.appendText(t("settings.sourceLinkFormat.desc"));
    formatSetting.descEl.createSpan({
      cls: "ob-epub-settings-warn",
      text: t("settings.sourceLinkFormat.warn"),
    });

    const formatRows = new Map<SourceLinkFormat, HTMLElement>();
    const tableWrap = containerEl.createDiv({ cls: "ob-epub-format-table-wrap ob-epub-group-extra" });
    this.tagGroup(tableWrap, groupId, "extra");
    const table = tableWrap.createEl("table", { cls: "ob-epub-format-table" });
    const headRow = table.createEl("thead").createEl("tr");
    for (const heading of [
      t("settings.formatTable.format"),
      t("settings.formatTable.pros"),
      t("settings.formatTable.cons"),
    ]) {
      headRow.createEl("th", { text: heading });
    }
    const tbody = table.createEl("tbody");
    for (const fmt of getSourceLinkFormats()) {
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
      for (const fmt of getSourceLinkFormats()) {
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
      s.setName(t("settings.defaultExcerptColor.name")).setDesc(t("settings.defaultExcerptColor.desc"));
    });

    const dots = setting.controlEl.createDiv({ cls: "epub-color-dots" });
    for (const c of getHighlightColors()) {
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

    new Setting(containerEl)
      .setName(t("settings.language.name"))
      .setDesc(t("settings.language.desc"))
      .addDropdown((drop) =>
        drop
          .addOption("auto", t("settings.language.auto"))
          .addOption("zh", "简体中文")
          .addOption("zh-TW", "繁體中文")
          .addOption("ja", "日本語")
          .addOption("en", "English")
          .setValue(this.plugin.settings.uiLocale ?? "auto")
          .onChange(async (value) => {
            this.plugin.settings.uiLocale = value as PluginUiLocale;
            await this.plugin.applyUiLocale();
            await this.plugin.saveSettings({ skipViewUpdate: true });
          })
      );

    // ── 阅读器（始终开启）──
    this.addGroupHeader(containerEl, "reader", {
      title: t("settings.groups.reader.title"),
      desc: t("settings.groups.reader.desc"),
    });

    this.addMemberSetting(containerEl, "reader", (s) => {
      s.setName(t("settings.defaultFlow.name"))
        .setDesc(t("settings.defaultFlow.desc"))
        .addDropdown((drop) =>
          drop
            .addOption("paginated", t("settings.defaultFlow.paginated"))
            .addOption("scrolled", t("settings.defaultFlow.scrolled"))
            .setValue(this.plugin.settings.defaultFlow)
            .onChange(async (value) => {
              this.plugin.settings.defaultFlow = value as "paginated" | "scrolled";
              await this.plugin.saveSettings();
            })
        );
    });

    this.addMemberSetting(containerEl, "reader", (s) => {
      s.setName(t("settings.fontSize.name"))
        .setDesc(t("settings.fontSize.desc"))
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
      s.setName(t("settings.readingTheme.name"))
        .setDesc(t("settings.readingTheme.desc"))
        .addDropdown((drop) => {
          for (const theme of getReadingThemes()) {
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

    this.addMemberSetting(containerEl, "reader", (s) => {
      s.setName(t("settings.toolbarPlacement.name"))
        .setDesc(t("settings.toolbarPlacement.desc"))
        .addDropdown((drop) =>
          drop
            .addOption("top", t("settings.toolbarPlacement.top"))
            .addOption("bottom", t("settings.toolbarPlacement.bottom"))
            .setValue(this.plugin.settings.toolbarPlacement ?? "bottom")
            .onChange(async (value) => {
              this.plugin.settings.toolbarPlacement =
                value === "top" ? "top" : "bottom";
              await this.plugin.saveSettings();
            })
        );
    });

    this.addMemberSetting(containerEl, "reader", (s) => {
      s.setName(t("settings.autoPaste.name"))
        .setDesc(t("settings.autoPaste.desc"))
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.autoPasteExcerpt !== false)
            .onChange(async (value) => {
              this.plugin.settings.autoPasteExcerpt = value;
              await this.plugin.saveSettings();
            })
        );
    });

    this.renderSourceLinkFormat(containerEl, "reader");
    this.renderDefaultExcerptColor(containerEl, "reader");
    this.endGroup(containerEl, "reader");

    // ── 标注与摘录 ──
    const annotationsEnabled = this.plugin.settings.featureGroups.annotationsAndExcerpts;

    this.addGroupHeader(containerEl, "annotations", {
      title: t("settings.groups.annotations.title"),
      desc: t("settings.groups.annotations.desc"),
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
        t("settings.groups.annotations.scopeItems.highlights"),
        t("settings.groups.annotations.scopeItems.export"),
        t("settings.groups.annotations.scopeItems.sidebar"),
        t("settings.groups.annotations.scopeItems.progress"),
      ],
      t("settings.groups.annotations.scopeLabel")
    );

    const excerptFolderSetting = this.addMemberSetting(containerEl, "annotations", (s) => {
      s.setName(t("settings.excerptFolder.name")).addText((text) =>
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
    excerptFolderSetting.descEl.appendText(t("settings.excerptFolder.desc"));
    excerptFolderSetting.descEl.createEl("br");
    excerptFolderSetting.descEl.createSpan({
      cls: "ob-epub-settings-warn",
      text: t("settings.excerptFolder.warn"),
    });

    const excerptFilenameSetting = this.addMemberSetting(containerEl, "annotations", (s) => {
      s.setName(t("settings.excerptFilename.name")).addText((text) =>
        text
          .setPlaceholder(t("settings.excerptFilename.placeholder"))
          .setValue(this.plugin.settings.excerptFilename)
          .onChange(async (value) => {
            this.plugin.settings.excerptFilename = value || t("defaults.excerptFilename");
            await this.plugin.saveSettings();
          })
      );
    });
    excerptFilenameSetting.descEl.empty();
    excerptFilenameSetting.descEl.appendText(t("settings.excerptFilename.desc"));
    excerptFilenameSetting.descEl.createEl("br");
    excerptFilenameSetting.descEl.appendText(t("settings.excerptFilename.examples"));

    this.addMemberSetting(containerEl, "annotations", (s) => {
      s.setName(t("settings.excerptCalloutOpacity.name"))
        .setDesc(t("settings.excerptCalloutOpacity.desc"))
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
      s.setName(t("settings.convertLinks.name")).addButton((btn) =>
        btn.setButtonText(t("settings.convertLinks.button")).onClick(async () => {
          btn.setDisabled(true);
          try {
            const count = await this.plugin.annotationVaultStore.convertAllExcerptSourceLinks();
            new Notice(
              count > 0 ? t("notice.convertDone", { count }) : t("notice.convertNone")
            );
          } catch (err) {
            console.error("ob-epub: convert excerpt links failed", err);
            new Notice(t("notice.convertFailed"));
          } finally {
            btn.setDisabled(false);
          }
        })
      );
    });
    convertSetting.descEl.empty();
    convertSetting.descEl.appendText(t("settings.convertLinks.desc"));
    convertSetting.descEl.createEl("br");
    convertSetting.descEl.createSpan({
      cls: "ob-epub-settings-warn",
      text: t("settings.convertLinks.warn"),
    });

    this.addMemberSetting(containerEl, "annotations", (s) => {
      s.setName(t("settings.checkMetadata.name"))
        .setDesc(t("settings.checkMetadata.desc"))
        .addButton((btn) =>
          btn.setButtonText(t("settings.checkMetadata.button")).onClick(async () => {
            btn.setDisabled(true);
            try {
              const report = await this.plugin.annotationVaultStore.checkExcerptMetadata();
              new ExcerptCheckModal(this.app, report).open();
              if (report.withIssues === 0) {
                new Notice(t("notice.checkDone", { count: report.checked }));
              } else {
                new Notice(t("notice.checkIssues", { count: report.withIssues }));
              }
            } catch (err) {
              console.error("ob-epub: excerpt metadata check failed", err);
              new Notice(t("notice.checkFailed"));
            } finally {
              btn.setDisabled(false);
            }
          })
        );
    });

    this.addMemberSetting(containerEl, "annotations", (s) => {
      s.setName(t("settings.highlightOpacity.name"))
        .setDesc(t("settings.highlightOpacity.desc"))
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

    const noteTypesHeading = new Setting(containerEl)
      .setName(t("settings.noteTypes.heading"))
      .setHeading();
    this.tagGroup(noteTypesHeading.settingEl, "annotations", "member");

    const noteTypesDesc = new Setting(containerEl).setDesc(t("settings.noteTypes.desc"));
    this.tagGroup(noteTypesDesc.settingEl, "annotations", "member");

    const noteTypes = resolveNoteTypes(this.plugin.settings.noteTypes);
    for (const def of noteTypes) {
      const fallback = getDefaultNoteTypes().find((t) => t.id === def.id)!;
      const noteTypeSetting = this.addMemberSetting(containerEl, "annotations", (s) => {
        s.setName(fallback.label)
          .setDesc(t("settings.noteTypes.fieldDesc", { id: def.id }))
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
      btn.setButtonText(t("settings.noteTypes.reset")).onClick(async () => {
        this.plugin.settings.noteTypes = getDefaultNoteTypes().map((t) => ({ ...t }));
        await this.plugin.saveSettings();
        this.display();
      })
    );
    this.tagGroup(resetNoteTypes.settingEl, "annotations", "member");

    const noteIconHeading = new Setting(containerEl)
      .setName(t("settings.noteIcon.heading"))
      .setHeading();
    this.tagGroup(noteIconHeading.settingEl, "annotations", "member");

    this.addMemberSetting(containerEl, "annotations", (s) => {
      s.setName(t("settings.noteIcon.size"))
        .setDesc(
          t("settings.noteIcon.sizeDesc", {
            min: NOTE_ICON_SIZE_MIN,
            max: NOTE_ICON_SIZE_MAX,
          })
        )
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
      s.setName(t("settings.noteIcon.offsetX"))
        .setDesc(
          t("settings.noteIcon.offsetXDesc", {
            min: NOTE_ICON_OFFSET_X_MIN,
            max: NOTE_ICON_OFFSET_X_MAX,
          })
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
      s.setName(t("settings.noteIcon.offsetY"))
        .setDesc(
          t("settings.noteIcon.offsetYDesc", {
            min: NOTE_ICON_OFFSET_Y_MIN,
            max: NOTE_ICON_OFFSET_Y_MAX,
          })
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
      title: t("settings.groups.bookshelf.title"),
      desc: t("settings.groups.bookshelf.desc"),
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
      [
        t("settings.groups.bookshelf.scopeItems.ribbon"),
        t("settings.groups.bookshelf.scopeItems.command"),
        t("settings.groups.bookshelf.scopeItems.view"),
      ],
      t("settings.groups.bookshelf.scopeLabel")
    );

    const bookshelfNote = containerEl.createDiv({
      cls: "ob-epub-settings-group-scope-note ob-epub-group-extra",
      text: t("settings.groups.bookshelf.note"),
    });
    this.tagGroup(bookshelfNote, "bookshelf", "extra");

    this.endGroup(containerEl, "bookshelf");
    this.setGroupMembersDisabled("bookshelf", !bookshelfEnabled);

    this.applyAllGroupCollapsedStates();
  }
}
