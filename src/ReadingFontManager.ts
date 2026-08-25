import { Notice, Plugin, normalizePath, requestUrl } from "obsidian";
import { t } from "./i18n/i18n";
import { ReadingFontId, getReadingFonts, normalizeReadingFont } from "./types";

export type DownloadableFontId =
  | "notoSans"
  | "notoSerif"
  | "lxgwWenKai"
  | "lxgwWenKaiScreen";

interface FontAsset {
  fileName: string;
  urls: string[];
  weight: number;
}

interface DownloadableFontSpec {
  id: DownloadableFontId;
  family: string;
  assets: FontAsset[];
}

/** GitHub Release 镜像（国内可达性） */
function githubReleaseUrls(repoPath: string, tag: string, fileName: string): string[] {
  const path = `${repoPath}/releases/download/${tag}/${fileName}`;
  return [
    `https://github.com/${path}`,
    `https://ghfast.top/https://github.com/${path}`,
    `https://cdn.jsdelivr.net/gh/${repoPath}@${tag}/fonts/TTF/${fileName}`,
  ];
}

const DOWNLOADABLE: Record<DownloadableFontId, DownloadableFontSpec> = {
  notoSans: {
    id: "notoSans",
    family: "Noto Sans SC",
    assets: [
      {
        fileName: "noto-sans-sc-latin-400.woff2",
        weight: 400,
        urls: [
          "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.2.9/files/noto-sans-sc-latin-400-normal.woff2",
          "https://unpkg.com/@fontsource/noto-sans-sc@5.2.9/files/noto-sans-sc-latin-400-normal.woff2",
        ],
      },
      {
        fileName: "noto-sans-sc-chinese-simplified-400.woff2",
        weight: 400,
        urls: [
          "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.2.9/files/noto-sans-sc-chinese-simplified-400-normal.woff2",
          "https://unpkg.com/@fontsource/noto-sans-sc@5.2.9/files/noto-sans-sc-chinese-simplified-400-normal.woff2",
        ],
      },
    ],
  },
  notoSerif: {
    id: "notoSerif",
    family: "Noto Serif SC",
    assets: [
      {
        fileName: "noto-serif-sc-latin-400.woff2",
        weight: 400,
        urls: [
          "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.2.9/files/noto-serif-sc-latin-400-normal.woff2",
          "https://unpkg.com/@fontsource/noto-serif-sc@5.2.9/files/noto-serif-sc-latin-400-normal.woff2",
        ],
      },
      {
        fileName: "noto-serif-sc-chinese-simplified-400.woff2",
        weight: 400,
        urls: [
          "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.2.9/files/noto-serif-sc-chinese-simplified-400-normal.woff2",
          "https://unpkg.com/@fontsource/noto-serif-sc@5.2.9/files/noto-serif-sc-chinese-simplified-400-normal.woff2",
        ],
      },
    ],
  },
  lxgwWenKai: {
    id: "lxgwWenKai",
    family: "LXGW WenKai",
    assets: [
      {
        fileName: "LXGWWenKai-Regular.ttf",
        weight: 400,
        urls: githubReleaseUrls("lxgw/LxgwWenKai", "v1.522", "LXGWWenKai-Regular.ttf"),
      },
    ],
  },
  lxgwWenKaiScreen: {
    id: "lxgwWenKaiScreen",
    family: "LXGW WenKai Screen",
    assets: [
      {
        fileName: "LXGWWenKaiScreen.ttf",
        weight: 400,
        urls: githubReleaseUrls(
          "lxgw/LxgwWenKai-Screen",
          "v1.522",
          "LXGWWenKaiScreen.ttf"
        ),
      },
    ],
  },
};

export function isDownloadableFontId(id: ReadingFontId): id is DownloadableFontId {
  return (
    id === "notoSans" ||
    id === "notoSerif" ||
    id === "lxgwWenKai" ||
    id === "lxgwWenKaiScreen"
  );
}

function fontFormatHint(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".woff2")) return 'format("woff2")';
  if (lower.endsWith(".woff")) return 'format("woff")';
  if (lower.endsWith(".otf")) return 'format("opentype")';
  return 'format("truetype")';
}

export function getDownloadableFontFamily(id: DownloadableFontId): string {
  return DOWNLOADABLE[id].family;
}

/** 常驻 Notice + 进度条，展示字体下载状态 */
class FontDownloadProgressNotice {
  private notice: Notice;
  private textEl: HTMLElement;
  private fillEl: HTMLElement;
  private label: string;
  private assetIndex: number;
  private assetTotal: number;

  constructor(label: string, assetTotal: number) {
    this.label = label;
    this.assetIndex = 1;
    this.assetTotal = Math.max(1, assetTotal);
    this.notice = new Notice("", 0);
    this.notice.messageEl.empty();
    this.notice.messageEl.addClass("epub-font-download-notice");

    this.textEl = this.notice.messageEl.createDiv({
      cls: "epub-font-download-message",
    });
    const track = this.notice.messageEl.createDiv({
      cls: "epub-font-download-track",
    });
    this.fillEl = track.createDiv({ cls: "epub-font-download-fill" });
    this.showMissing();
  }

  /** 明确提示本机没有该字体，即将下载 */
  showMissing(): void {
    this.fillEl.removeClass("is-failed");
    this.fillEl.removeClass("is-indeterminate");
    this.fillEl.setCssProps({ width: "0%" });
    this.textEl.empty();
    this.textEl.appendText(t("notice.fontMissing", { font: this.label }));
  }

  setAsset(index: number, total: number): void {
    this.assetIndex = index;
    this.assetTotal = Math.max(1, total);
  }

  setProgress(percent: number): void {
    const p = Math.max(0, Math.min(100, Math.round(percent)));
    this.fillEl.removeClass("is-indeterminate");
    this.fillEl.setCssProps({ width: `${p}%` });
    this.textEl.empty();
    this.textEl.appendText(
      t("notice.fontDownloadProgress", {
        font: this.label,
        percent: String(p),
        current: String(this.assetIndex),
        total: String(this.assetTotal),
      })
    );
  }

  /** 无 Content-Length 时用不确定动画，仍显示文件序号 */
  setIndeterminate(): void {
    this.fillEl.addClass("is-indeterminate");
    this.fillEl.setCssProps({ width: "40%" });
    this.textEl.empty();
    this.textEl.appendText(
      t("notice.fontDownloadProgressBusy", {
        font: this.label,
        current: String(this.assetIndex),
        total: String(this.assetTotal),
      })
    );
  }

  /** 按多文件加权：已完成文件 + 当前文件内进度 */
  setWeightedProgress(doneAssets: number, assetLoaded: number, assetTotal: number | null): void {
    const n = this.assetTotal;
    const base = (doneAssets / n) * 100;
    if (assetTotal && assetTotal > 0) {
      this.setProgress(base + (assetLoaded / assetTotal) * (100 / n));
    } else if (assetLoaded > 0) {
      this.setIndeterminate();
    } else {
      this.setProgress(base);
    }
  }

  succeed(): void {
    this.fillEl.removeClass("is-indeterminate");
    this.fillEl.removeClass("is-failed");
    this.fillEl.setCssProps({ width: "100%" });
    this.textEl.empty();
    this.textEl.appendText(t("notice.fontDownloaded", { font: this.label }));
    window.setTimeout(() => this.notice.hide(), 2200);
  }

  fail(): void {
    this.fillEl.removeClass("is-indeterminate");
    this.fillEl.addClass("is-failed");
    this.fillEl.setCssProps({ width: "100%" });
    this.textEl.empty();
    this.textEl.appendText(t("notice.fontDownloadFailed", { font: this.label }));
    window.setTimeout(() => this.notice.hide(), 4000);
  }

  hide(): void {
    this.notice.hide();
  }
}

/**
 * 可下载字体：缓存到插件目录 fonts/，缺失时从 CDN 拉取并注入 @font-face。
 */
export class ReadingFontManager {
  private plugin: Plugin;
  private inflight = new Map<DownloadableFontId, Promise<boolean>>();

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  private get fontsDir(): string {
    return normalizePath(`${this.plugin.manifest.dir}/fonts`);
  }

  private assetPath(fileName: string): string {
    return normalizePath(`${this.fontsDir}/${fileName}`);
  }

  async ensureFontsDir(): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    if (!(await adapter.exists(this.fontsDir))) {
      await adapter.mkdir(this.fontsDir);
    }
  }

  async isCached(id: DownloadableFontId): Promise<boolean> {
    const adapter = this.plugin.app.vault.adapter;
    const spec = DOWNLOADABLE[id];
    for (const asset of spec.assets) {
      if (!(await adapter.exists(this.assetPath(asset.fileName)))) return false;
    }
    return true;
  }

  getResourceUrl(fileName: string): string {
    return this.plugin.app.vault.adapter.getResourcePath(this.assetPath(fileName));
  }

  /** 生成可注入 iframe 的 @font-face CSS；未缓存则返回空串 */
  async buildFontFaceCss(id: ReadingFontId): Promise<string> {
    if (!isDownloadableFontId(id)) return "";
    if (!(await this.isCached(id))) return "";
    const spec = DOWNLOADABLE[id];
    const blocks: string[] = [];
    for (const asset of spec.assets) {
      const url = this.getResourceUrl(asset.fileName).replace(/\\/g, "/");
      blocks.push(
        `@font-face{font-family:"${spec.family}";font-style:normal;font-weight:${asset.weight};font-display:swap;src:url("${url}") ${fontFormatHint(asset.fileName)}}`
      );
    }
    return blocks.join("\n");
  }

  /**
   * 确保可下载字体可用：未缓存则下载（不因系统字体检测跳过，避免误判导致不下载）。
   * @returns true 表示可注入本地 @font-face 或下载成功
   */
  async ensureAvailable(id: ReadingFontId, opts?: { quiet?: boolean }): Promise<boolean> {
    const fontId = normalizeReadingFont(id);
    if (!isDownloadableFontId(fontId)) return true;

    const existing = this.inflight.get(fontId);
    if (existing) return existing;

    const task = this.ensureAvailableInner(fontId, opts?.quiet === true);
    this.inflight.set(fontId, task);
    try {
      return await task;
    } finally {
      this.inflight.delete(fontId);
    }
  }

  private async ensureAvailableInner(
    id: DownloadableFontId,
    quiet: boolean
  ): Promise<boolean> {
    const spec = DOWNLOADABLE[id];
    const label =
      getReadingFonts().find((f) => f.id === id)?.label ?? spec.family;

    if (await this.isCached(id)) return true;

    const progress = quiet
      ? null
      : new FontDownloadProgressNotice(label, spec.assets.length);

    try {
      await this.ensureFontsDir();
      let doneAssets = 0;
      for (let i = 0; i < spec.assets.length; i++) {
        const asset = spec.assets[i];
        progress?.setAsset(i + 1, spec.assets.length);
        progress?.setWeightedProgress(doneAssets, 0, null);
        const ok = await this.downloadAsset(asset, (loaded, total) => {
          progress?.setWeightedProgress(doneAssets, loaded, total);
        });
        if (!ok) {
          progress?.fail();
          return false;
        }
        doneAssets += 1;
        progress?.setWeightedProgress(doneAssets, 0, 1);
      }
      progress?.succeed();
      return true;
    } catch (err) {
      console.warn("ob-epub: font download failed", id, err);
      progress?.fail();
      return false;
    }
  }

  private async downloadAsset(
    asset: FontAsset,
    onProgress: (loaded: number, total: number | null) => void
  ): Promise<boolean> {
    const adapter = this.plugin.app.vault.adapter;
    const dest = this.assetPath(asset.fileName);
    if (await adapter.exists(dest)) {
      onProgress(1, 1);
      return true;
    }

    for (const url of asset.urls) {
      try {
        const data = await this.downloadWithProgress(url, onProgress);
        if (!data || data.byteLength < 1000) continue;
        await adapter.writeBinary(dest, data);
        onProgress(data.byteLength, data.byteLength);
        return true;
      } catch (err) {
        console.warn("ob-epub: font url failed", url, err);
      }
    }
    return false;
  }

  /**
   * 优先 XHR（可上报进度）；失败再退回 requestUrl。
   */
  private async downloadWithProgress(
    url: string,
    onProgress: (loaded: number, total: number | null) => void
  ): Promise<ArrayBuffer | null> {
    try {
      return await this.downloadViaXhr(url, onProgress);
    } catch (err) {
      console.warn("ob-epub: xhr font failed, fallback requestUrl", url, err);
      onProgress(0, null);
      const res = await requestUrl({ url, throw: false });
      if (res.status < 200 || res.status >= 300) return null;
      const data = res.arrayBuffer;
      if (!data || data.byteLength < 1000) return null;
      onProgress(data.byteLength, data.byteLength);
      return data;
    }
  }

  private downloadViaXhr(
    url: string,
    onProgress: (loaded: number, total: number | null) => void
  ): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.responseType = "arraybuffer";
      xhr.onprogress = (ev) => {
        if (ev.lengthComputable && ev.total > 0) {
          onProgress(ev.loaded, ev.total);
        } else if (ev.loaded > 0) {
          onProgress(ev.loaded, null);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300 && xhr.response) {
          resolve(xhr.response as ArrayBuffer);
          return;
        }
        reject(new Error(`HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error("network error"));
      xhr.ontimeout = () => reject(new Error("timeout"));
      xhr.send();
    });
  }
}

/** Host type for ReadingFontManager */
export type ReadingFontManagerHost = Plugin;
