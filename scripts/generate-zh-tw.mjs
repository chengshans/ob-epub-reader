#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as OpenCC from "opencc-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, "../src/i18n/locales");
const converter = OpenCC.Converter({ from: "cn", to: "tw" });

/** Taiwan terminology overrides after OpenCC s2twp. */
const TW_OVERRIDES = [
  ["界面", "介面"],
  ["设置", "設定"],
  ["软件", "軟體"],
  ["网络", "網路"],
  ["文件", "檔案"],
  ["默认", "預設"],
  ["跟随", "跟隨"],
  ["信息", "資訊"],
  ["程序", "程式"],
  ["鼠标", "滑鼠"],
  ["视频", "影片"],
  ["服务器", "伺服器"],
  ["内存", "記憶體"],
  ["硬盘", "硬碟"],
  ["复制", "複製"],
  ["粘贴", "貼上"],
  ["剪切", "剪下"],
  ["文件夹", "資料夾"],
  ["目录", "目錄"],
  ["屏幕", "螢幕"],
  ["链接", "連結"],
  ["导出", "匯出"],
  ["导入", "匯入"],
  ["扫描", "掃描"],
  ["备份", "備份"],
  ["转换", "轉換"],
  ["检查", "檢查"],
  ["加载", "載入"],
  ["打开", "開啟"],
  ["关闭", "關閉"],
  ["选中", "選取"],
];

function applyOverrides(text) {
  let out = text;
  for (const [from, to] of TW_OVERRIDES) {
    out = out.split(from).join(to);
  }
  return out;
}

function convertValue(value) {
  if (typeof value === "string") {
    return applyOverrides(converter(value));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = convertValue(v);
    }
    return out;
  }
  return value;
}

const zh = JSON.parse(fs.readFileSync(path.join(localesDir, "zh.json"), "utf8"));
const zhTW = convertValue(zh);

zhTW.commands.openBookshelf = "開啟 EPUB 書架";
zhTW.commands.openReader = "在 EPUB 閱讀器中開啟";
zhTW.settings.language.name = "介面語言";
zhTW.settings.language.desc =
  "外掛介面顯示語言；不影響資料庫內已有摘錄檔案";
zhTW.settings.language.auto = "跟隨 Obsidian";
zhTW.time.hours = "{{n}}小時";
zhTW.excerpt.wikiTextAlias = "摘錄全文";
zhTW.defaults.excerptFilename = "《{title}》摘錄.md";
zhTW.excerpt.excerptHeading = "# 《{{title}}》摘錄";
zhTW.settings.excerptFilename.placeholder = "《{title}》摘錄.md";
zhTW.settings.excerptFilename.examples =
  "範例：《{title}》摘錄.md、{title}-notes.md、{filename}.md";
zhTW.settings.excerptFolder.desc =
  "摘錄 Markdown 儲存目錄；閱讀進度寫入各書摘錄檔案的 frontmatter。支援 {filefolder} 占位符（EPUB 所在目錄），如 {filefolder}/anno。";
zhTW.settings.excerptFolder.warn =
  "移動 EPUB 或資料夾後，需手動更新摘錄 frontmatter 中的 epub-source 為新路徑，否則標題跳轉連結會失效";
zhTW.settings.convertLinks.desc =
  "批次將摘錄資料夾內所有《書名》摘錄.md 轉換為目前選中的摘錄匯出格式；使用 {filefolder} 時會掃描資料庫內全部《書名》摘錄.md";
zhTW.settings.convertLinks.warn =
  "轉換會改寫摘錄檔案，建議先備份摘錄資料夾";
zhTW.settings.checkMetadata.desc =
  "檢查摘錄 frontmatter 的 epub-source 是否指向存在的 EPUB；僅當 epub-source 缺失或無效時，才按 {filefolder} 規則查找同級 EPUB";
zhTW.bookshelf.empty = "資料庫中沒有找到 EPUB 檔案。";
zhTW.settings.groups.reader.desc =
  "核心閱讀能力，無總開關（停用外掛請在社群外掛設定中操作）";
zhTW.settings.groups.bookshelf.note =
  "「在 EPUB 閱讀器中開啟」屬於閱讀器核心，不受此開關影響。";
zhTW.settings.autoPaste.desc =
  "開啟後，複製摘錄會插入最近編輯的 Markdown 筆記；閱讀器工具列「貼上」可快速切換";
zhTW.reader.toolbar.autoPaste =
  "複製摘錄時自動插入開啟的 Markdown 筆記";
zhTW.reader.toolbar.autoPasteOnDesc =
  "自動貼上已開啟：複製摘錄會插入 Markdown";
zhTW.reader.toolbar.autoPasteOffDesc =
  "自動貼上已關閉：複製摘錄僅寫入剪貼簿";
zhTW.notice.readingModeCopied =
  "目標筆記處於閱讀模式，已複製到剪貼簿";
zhTW.notice.progressSaveFailed =
  "閱讀進度儲存失敗（{{path}}），請確認摘錄資料夾存在且可寫";
zhTW.notice.insertedAndCopied = "已插入《{{name}}》並複製摘錄";
zhTW.notice.highlightedAndInserted = "已畫線，已插入《{{name}}》";
zhTW.notice.copiedExcerpt = "已複製摘錄";
zhTW.notice.copyFailed = "複製失敗";
zhTW.reader.contextMenu.copyTitle = "按目前摘錄格式複製到剪貼簿";
zhTW.settings.sourceLinkFormat.desc = "選取複製與新標註使用所選格式；";
zhTW.settings.defaultExcerptColor.desc =
  "不儲存顏色的摘錄格式（正文 + 文末「原文」、連結即正文、純文字）在解析或格式轉換時使用的畫線顏色";
zhTW.settings.formats["inline-suffix"].desc =
  "正文後接 [[書名.epub#cfi=...|原文]]；不儲存畫線顏色，解析與轉換時使用預設畫線顏色";
zhTW.settings.formats["wiki-text-alias"].desc =
  "[[書名.epub#cfi=...|摘錄全文]] 單行；不儲存畫線顏色，解析與轉換時使用預設畫線顏色";
zhTW.settings.formats["inline-colored"].desc =
  "<span style=\"color:…\">正文</span> [[書名.epub#cfi=...|原文]]；透過 span 保留顏色";
zhTW.excerptCheck.issues["excerpt-location-mismatch"] =
  "摘錄檔案不在目前設定應儲存的路徑";
zhTW.excerptCheck.issues["local-epub-not-found"] =
  "按目前摘錄資料夾規則，同級目錄下找不到對應 EPUB";
zhTW.excerptCheck.issues["epub-source-local-mismatch"] =
  "epub-source 與按摘錄位置推斷的 EPUB 路徑不一致";
zhTW.errors.excerptFolderUnset = "摘錄資料夾未設定";

fs.writeFileSync(
  path.join(localesDir, "zh-TW.json"),
  `${JSON.stringify(zhTW, null, 2)}\n`,
  "utf8"
);
console.log("Wrote zh-TW.json");
