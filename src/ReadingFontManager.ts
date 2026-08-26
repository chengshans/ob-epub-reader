import { Notice, Plugin, normalizePath, requestUrl } from "obsidian";
import { t } from "./i18n/i18n";
import { sanitizeOpenTypeForChromium } from "./fontSanitize";
import {
  CustomReadingFont,
  EpubPluginSettings,
  ReadingFontId,
  customReadingFontFamily,
  getReadingFonts,
  isCustomReadingFontId,
  normalizeCustomFonts,
  normalizeReadingFont,
  parseCustomReadingFontId,
  toCustomReadingFontId,
} from "./types";

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

const CUSTOM_FONT_EXTS = new Set([".ttf", ".otf", ".woff", ".woff2"]);

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

function extFromFileName(name: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  if (!m) return null;
  const ext = `.${m[1].toLowerCase()}`;
  return CUSTOM_FONT_EXTS.has(ext) ? ext : null;
}

function labelFromFileName(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "").trim() || name;
}

function newCustomFontId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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

export type ReadingFontManagerHost = Plugin & {
  settings: Pick<EpubPluginSettings, "customFonts" | "readingFont">;
};

/**
 * 可下载字体 + 用户导入字体：缓存到插件目录 fonts/，注入 @font-face。
 */
export class ReadingFontManager {
  private plugin: ReadingFontManagerHost;
  private inflight = new Map<string, Promise<boolean>>();
  /** 已生成的 @font-face CSS，供换章时同步注入，避免 await 导致首帧回退系统字体 */
  private fontFaceCssCache = new Map<string, string>();
  /** 自定义字体二进制缓存，供 iframe FontFace API 加载（绕过部分环境下 resource URL 无法加载字体的问题） */
  private customFontBytesCache = new Map<string, ArrayBuffer>();
  /** 已在某个 document 上注册过的 family，避免重复 load */
  private loadedFontDocs = new WeakMap<Document, Set<string>>();

  constructor(plugin: ReadingFontManagerHost) {
    this.plugin = plugin;
  }

  private get fontsDir(): string {
    return normalizePath(`${this.plugin.manifest.dir}/fonts`);
  }

  private get customDir(): string {
    return normalizePath(`${this.fontsDir}/custom`);
  }

  private assetPath(fileName: string): string {
    return normalizePath(`${this.fontsDir}/${fileName}`);
  }

  private customAssetPath(fileName: string): string {
    return normalizePath(`${this.customDir}/${fileName}`);
  }

  private customFonts(): CustomReadingFont[] {
    return normalizeCustomFonts(this.plugin.settings.customFonts);
  }

  private normalizeId(id: string): ReadingFontId {
    return normalizeReadingFont(id, this.customFonts());
  }

  async ensureFontsDir(): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    if (!(await adapter.exists(this.fontsDir))) {
      await adapter.mkdir(this.fontsDir);
    }
  }

  async ensureCustomDir(): Promise<void> {
    await this.ensureFontsDir();
    const adapter = this.plugin.app.vault.adapter;
    if (!(await adapter.exists(this.customDir))) {
      await adapter.mkdir(this.customDir);
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

  getCustomResourceUrl(fileName: string): string {
    return this.plugin.app.vault.adapter.getResourcePath(this.customAssetPath(fileName));
  }

  findCustomFont(readingFontId: ReadingFontId): CustomReadingFont | null {
    const customId = parseCustomReadingFontId(readingFontId);
    if (!customId) return null;
    return this.customFonts().find((f) => f.id === customId) ?? null;
  }

  /**
   * 从本地文件名 + 二进制写入 fonts/custom/，返回元数据（调用方写入 settings）。
   */
  async importFromBytes(
    originalName: string,
    data: ArrayBuffer
  ): Promise<CustomReadingFont | null> {
    const ext = extFromFileName(originalName);
    if (!ext) {
      new Notice(t("notice.fontUnsupportedFormat"));
      return null;
    }
    try {
      if (!data || data.byteLength < 100) {
        new Notice(t("notice.fontImportFailed"));
        return null;
      }
      // 剥离 Chromium OTS 不支持的表（如 vhea 1.1），否则 FontFace 会 Invalid font data
      const sanitized = sanitizeOpenTypeForChromium(data);
      const payload = sanitized.data;
      if (sanitized.dropped.length) {
        console.info("ob-epub: sanitized font tables", sanitized.dropped.join(","));
      }
      await this.ensureCustomDir();
      const id = newCustomFontId();
      const fileName = `${id}${ext}`;
      const dest = this.customAssetPath(fileName);
      await this.plugin.app.vault.adapter.writeBinary(dest, payload);
      const meta: CustomReadingFont = {
        id,
        label: labelFromFileName(originalName),
        fileName,
      };
      this.customFontBytesCache.set(id, payload.slice(0));
      const readingId = toCustomReadingFontId(id);
      const css = this.buildCustomFontFaceCss(meta);
      this.fontFaceCssCache.set(readingId, css);
      new Notice(t("notice.fontImported", { font: meta.label }));
      return meta;
    } catch (err) {
      console.warn("ob-epub: custom font import failed", err);
      new Notice(t("notice.fontImportFailed"));
      return null;
    }
  }

  /** 从浏览器 File 对象导入 */
  async importFromFile(file: File): Promise<CustomReadingFont | null> {
    try {
      const data = await file.arrayBuffer();
      return this.importFromBytes(file.name, data);
    } catch (err) {
      console.warn("ob-epub: custom font import failed", err);
      new Notice(t("notice.fontImportFailed"));
      return null;
    }
  }

  /** 删除自定义字体文件并清缓存（settings 由调用方更新） */
  async removeCustomFont(meta: CustomReadingFont): Promise<void> {
    const readingId = toCustomReadingFontId(meta.id);
    this.fontFaceCssCache.delete(readingId);
    this.customFontBytesCache.delete(meta.id);
    this.inflight.delete(readingId);
    try {
      const path = this.customAssetPath(meta.fileName);
      const adapter = this.plugin.app.vault.adapter;
      if (await adapter.exists(path)) {
        await adapter.remove(path);
      }
    } catch (err) {
      console.warn("ob-epub: remove custom font failed", meta.id, err);
    }
    new Notice(t("notice.fontDeleted", { font: meta.label }));
  }

  private async readCustomFontBytes(meta: CustomReadingFont): Promise<ArrayBuffer | null> {
    const hit = this.customFontBytesCache.get(meta.id);
    if (hit) return hit;
    try {
      const path = this.customAssetPath(meta.fileName);
      const data = await this.plugin.app.vault.adapter.readBinary(path);
      if (!data || data.byteLength < 100) return null;
      const sanitized = sanitizeOpenTypeForChromium(data);
      const payload = sanitized.data;
      // 拷贝为独立 ArrayBuffer
      const copy = new ArrayBuffer(payload.byteLength);
      new Uint8Array(copy).set(new Uint8Array(payload));
      this.customFontBytesCache.set(meta.id, copy);
      // 若剥离了不兼容表，回写磁盘，避免下次再失败
      if (sanitized.changed) {
        try {
          await this.plugin.app.vault.adapter.writeBinary(path, copy);
          console.info(
            "ob-epub: rewrote sanitized custom font",
            meta.fileName,
            sanitized.dropped.join(",")
          );
        } catch (err) {
          console.warn("ob-epub: rewrite sanitized font failed", meta.id, err);
        }
      }
      return copy;
    } catch (err) {
      console.warn("ob-epub: read custom font failed", meta.id, err);
      return null;
    }
  }

  /**
   * 将当前自定义字体注入 EPUB iframe（父窗口 FontFace + iframe blob @font-face）。
   */
  async applyCustomFontToDocument(
    doc: Document | null | undefined,
    win?: Window | null
  ): Promise<boolean> {
    if (!doc?.head) return false;
    const readingId = this.normalizeId(this.plugin.settings.readingFont);
    const meta = this.findCustomFont(readingId);
    if (!meta) return false;

    const family = customReadingFontFamily(meta.id);
    let loaded = this.loadedFontDocs.get(doc);
    if (loaded?.has(family)) return true;

    const view = win ?? doc.defaultView;
    if (!view) return false;

    const bytes = await this.readCustomFontBytes(meta);
    if (!bytes) {
      this.noticeFontApplyFailedOnce(meta.label);
      return false;
    }

    if (bytes.byteLength > 2_000_000) {
      this.noticeFontApplyingOnce(meta.label);
    }

    const blob = new Blob([bytes], { type: "font/ttf" });
    const blobUrl = URL.createObjectURL(blob);

    const fontStyleId = "ob-epub-custom-font-face";
    let fontStyle = doc.getElementById(fontStyleId) as HTMLStyleElement | null;
    if (!fontStyle) {
      fontStyle = doc.createElement("style");
      fontStyle.id = fontStyleId;
      doc.head.insertBefore(fontStyle, doc.head.firstChild);
    }
    fontStyle.textContent =
      `@font-face{font-family:"${family}";font-style:normal;font-weight:400;font-display:swap;src:url("${blobUrl}") format("truetype")}`;

    let ok = false;
    // 优先在父窗口创建 FontFace（更稳），再加入 iframe document.fonts
    const FaceCtor = window.FontFace ?? view.FontFace;
    if (FaceCtor && doc.fonts) {
      try {
        const face = new FaceCtor(family, bytes, {
          style: "normal",
          weight: "400",
        });
        await face.load();
        doc.fonts.add(face);
        ok = true;
      } catch (err) {
        console.warn("ob-epub: FontFace(binary) failed, try blob url", family, err);
        try {
          const face = new FaceCtor(family, `url("${blobUrl}")`, {
            style: "normal",
            weight: "400",
          });
          await face.load();
          doc.fonts.add(face);
          ok = true;
        } catch (err2) {
          console.warn("ob-epub: FontFace(blob) failed", family, err2);
        }
      }
      try {
        await doc.fonts.ready;
        await doc.fonts.load(`16px "${family}"`);
        if (doc.fonts.check(`16px "${family}"`)) ok = true;
      } catch {
        /* ignore */
      }
    } else {
      ok = true;
    }

    if (!loaded) {
      loaded = new Set();
      this.loadedFontDocs.set(doc, loaded);
    }
    if (ok) {
      loaded.add(family);
    } else {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {
        /* ignore */
      }
      this.noticeFontApplyFailedOnce(meta.label);
    }
    return ok;
  }

  private lastFontNoticeAt = 0;
  private lastFontNoticeKey = "";

  private noticeFontApplyingOnce(label: string): void {
    const key = `applying:${label}`;
    const now = Date.now();
    if (this.lastFontNoticeKey === key && now - this.lastFontNoticeAt < 5000) return;
    this.lastFontNoticeKey = key;
    this.lastFontNoticeAt = now;
    new Notice(t("notice.fontApplying", { font: label }), 4000);
  }

  private noticeFontApplyFailedOnce(label: string): void {
    const key = `failed:${label}`;
    const now = Date.now();
    if (this.lastFontNoticeKey === key && now - this.lastFontNoticeAt < 5000) return;
    this.lastFontNoticeKey = key;
    this.lastFontNoticeAt = now;
    new Notice(t("notice.fontApplyFailed", { font: label }));
  }

  private buildCustomFontFaceCss(meta: CustomReadingFont): string {
    const family = customReadingFontFamily(meta.id);
    const url = this.getCustomResourceUrl(meta.fileName).replace(/\\/g, "/");
    return `@font-face{font-family:"${family}";font-style:normal;font-weight:400;font-display:swap;src:url("${url}") ${fontFormatHint(meta.fileName)}}`;
  }

  /** 同步取缓存的 @font-face CSS（换章首帧注入用） */
  getFontFaceCssSync(id: ReadingFontId): string {
    const fontId = this.normalizeId(id);
    if (isDownloadableFontId(fontId) || isCustomReadingFontId(fontId)) {
      return this.fontFaceCssCache.get(fontId) ?? "";
    }
    return "";
  }

  /** 生成可注入 iframe 的 @font-face CSS；未缓存则返回空串 */
  async buildFontFaceCss(id: ReadingFontId): Promise<string> {
    const fontId = this.normalizeId(id);

    if (isCustomReadingFontId(fontId)) {
      const meta = this.findCustomFont(fontId);
      if (!meta) {
        this.fontFaceCssCache.delete(fontId);
        return "";
      }
      // 每次重新 resolve resource URL（会话相关）；同步热路径仍走内存缓存
      const css = this.buildCustomFontFaceCss(meta);
      this.fontFaceCssCache.set(fontId, css);
      return css;
    }

    if (!isDownloadableFontId(fontId)) return "";
    const hit = this.fontFaceCssCache.get(fontId);
    if (hit) return hit;
    if (!(await this.isCached(fontId))) {
      this.fontFaceCssCache.delete(fontId);
      return "";
    }
    const spec = DOWNLOADABLE[fontId];
    const blocks: string[] = [];
    for (const asset of spec.assets) {
      const url = this.getResourceUrl(asset.fileName).replace(/\\/g, "/");
      // swap：本地字体通常很快；block 会在解析大字体时整页空白
      blocks.push(
        `@font-face{font-family:"${spec.family}";font-style:normal;font-weight:${asset.weight};font-display:swap;src:url("${url}") ${fontFormatHint(asset.fileName)}}`
      );
    }
    const css = blocks.join("\n");
    this.fontFaceCssCache.set(fontId, css);
    return css;
  }

  /**
   * 确保字体可用：可下载字体缺失则拉取；自定义字体校验文件存在。
   * @returns true 表示可注入本地 @font-face 或下载成功
   */
  async ensureAvailable(id: ReadingFontId, opts?: { quiet?: boolean }): Promise<boolean> {
    const fontId = this.normalizeId(id);

    if (isCustomReadingFontId(fontId)) {
      // 自定义字体：即使已有 @font-face CSS，也要确保二进制已读入（供 FontFace / blob 注入）
      const existing = this.inflight.get(fontId);
      if (existing) return existing;
      const task = this.ensureCustomAvailable(fontId);
      this.inflight.set(fontId, task);
      try {
        return await task;
      } finally {
        this.inflight.delete(fontId);
      }
    }

    if (!isDownloadableFontId(fontId)) return true;
    // 内存已有 @font-face CSS：换章热路径，避免反复 vault.exists
    if (this.fontFaceCssCache.has(fontId)) return true;

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

  private async ensureCustomAvailable(fontId: ReadingFontId): Promise<boolean> {
    const meta = this.findCustomFont(fontId);
    if (!meta) return false;
    await this.buildFontFaceCss(fontId);
    const bytes = await this.readCustomFontBytes(meta);
    return bytes !== null;
  }

  private async ensureAvailableInner(
    id: DownloadableFontId,
    quiet: boolean
  ): Promise<boolean> {
    const spec = DOWNLOADABLE[id];
    const label =
      getReadingFonts(this.plugin.settings).find((f) => f.id === id)?.label ?? spec.family;

    if (await this.isCached(id)) {
      await this.buildFontFaceCss(id);
      return true;
    }

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
      await this.buildFontFaceCss(id);
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
