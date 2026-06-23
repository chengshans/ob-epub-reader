let mockLanguage = "en";

export function setMockLanguage(lang: string): void {
  mockLanguage = lang;
}

export function getLanguage(): string {
  return mockLanguage;
}

export const moment = {
  locale: () => mockLanguage,
};

export class TFile {
  path = "";
  extension = "";
  basename = "";
}

export class App {}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export class Notice {
  constructor(_message: string) {
    /* noop */
  }
}

export class Modal {
  app: App;
  contentEl = document.createElement("div");
  constructor(app: App) {
    this.app = app;
  }
  open() {}
  close() {}
}

export class Plugin {
  app = new App();
  async loadData() {
    return {};
  }
  async saveData(_data: unknown) {}
}

export class ItemView {
  contentEl = document.createElement("div");
  app = new App();
  getViewType() {
    return "";
  }
  getDisplayText() {
    return "";
  }
}

export class FileView extends ItemView {
  file: TFile | null = null;
}

export class WorkspaceLeaf {}

export class Setting {
  settingEl = document.createElement("div");
  descEl = document.createElement("div");
  controlEl = document.createElement("div");
  constructor(_el: HTMLElement) {}
  setName(_n: string) {
    return this;
  }
  setDesc(_d: string) {
    return this;
  }
  setHeading() {
    return this;
  }
  addText(_fn: (c: unknown) => void) {
    return this;
  }
  addToggle(_fn: (c: unknown) => void) {
    return this;
  }
  addDropdown(_fn: (c: unknown) => void) {
    return this;
  }
  addSlider(_fn: (c: unknown) => void) {
    return this;
  }
  addButton(_fn: (c: unknown) => void) {
    return this;
  }
  addExtraButton(_fn: (c: unknown) => void) {
    return this;
  }
}

export class PluginSettingTab {
  app: App;
  containerEl = document.createElement("div");
  constructor(app: App) {
    this.app = app;
  }
}

export class ButtonComponent {
  buttonEl = document.createElement("button");
  setButtonText(_t: string) {
    return this;
  }
  setCta() {
    return this;
  }
  setDisabled(_d: boolean) {
    return this;
  }
  onClick(_fn: () => void) {
    return this;
  }
}

export class ExtraButtonComponent {
  extraSettingsEl = document.createElement("div");
  setIcon(_i: string) {
    return this;
  }
  setTooltip(_t: string) {
    return this;
  }
  onClick(_fn: () => void) {
    return this;
  }
}

export function addIcon(_id: string, _svg: string) {}
