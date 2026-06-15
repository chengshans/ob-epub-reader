# Obsidian 插件代码标准（ob-epub）

> 适用范围：**EPUB Marginalia**（`ob-epub-reader`）及本仓库后续 Obsidian 插件开发。  
> 目标：通过社区插件审核、与 Obsidian 主题兼容、降低维护成本。

---

## 1. 项目结构

```
ob-epub/
├── src/                  # TypeScript 源码（唯一业务逻辑入口）
│   ├── main.ts           # 插件入口：onload / 命令 / 视图注册
│   ├── types.ts          # 设置、数据模型、常量
│   ├── styles.css        # 全部插件样式（构建时复制到输出目录）
│   └── *.ts              # 功能模块（View、Store、Modal 等）
├── manifest.json         # 社区插件元数据（id、版本、minAppVersion）
├── versions.json         # 各插件版本对应的最低 Obsidian 版本
├── patches/              # patch-package 依赖补丁
├── eslint.config.mjs     # ESLint + obsidianmd 规则
├── esbuild.config.mjs    # 打包配置
└── docs/                 # 项目文档
```

**原则：**

- 业务逻辑只写在 `src/`，不直接改 `dist/` 或 `main.js`。
- 样式集中在 `src/styles.css`，不在 TS 里内联大段 CSS。
- `obsidian`、`electron`、`@codemirror/*` 等由 Obsidian 运行时提供，**不打包**进 `main.js`。

---

## 2. manifest.json 与版本

### 2.1 必填字段约定

| 字段 | 要求 |
|------|------|
| `id` | 与插件目录名一致，如 `ob-epub-reader` |
| `minAppVersion` | **必须**覆盖代码中使用的最高版本 API（当前 `1.7.2`） |
| `description` | **不得**包含单词 `Obsidian`（社区审核冗余词） |
| `isDesktopOnly` | 仅桌面端能力时设为 `true` |

### 2.2 API 版本对齐

代码使用的 API 不得低于 `minAppVersion`。常见对照：

| API | 最低 Obsidian 版本 |
|-----|-------------------|
| `vault.createFolder()` | 1.4.0 |
| `vault.getFileByPath()` | 1.5.7 |
| `workspace.getLeaf()` | 0.16.0 |
| `workspace.revealLeaf()` | 1.7.2 |
| `ButtonComponent.setDestructive()` | **1.13.0**（本项目目标 1.12.7，**禁用**) |

新增高版本 API 时，同步提升 `manifest.json` 的 `minAppVersion`，并在 `versions.json` 中为**新版本号**写入对应值；历史条目保留不改。

### 2.4 曾踩坑记录（v1.3.11 → v1.3.12）

#### innerHTML 赋值

```typescript
// ❌ 触发 Unsafe assignment to innerHTML
quote.innerHTML = this.highlightQuery(quoteText, query);

// ✅ 用 DOM API 逐段构建
private appendHighlightedQuery(el: HTMLElement, text: string, query: string): void {
  const trimmed = query.trim();
  if (!trimmed) { el.appendText(text); return; }
  // ... 匹配段用 el.createEl("mark", { cls: "epub-notes-highlight", text: slice })
}
```

#### 高版本 Button API

```typescript
// ❌ setDestructive 为 1.13 API；运行时检测仍会被 lint 报错，且 1.12 上会导致按钮失效
btn.setDestructive().setCta();

// ✅ setCta + CSS 类，全版本兼容
btn.buttonEl.addClass("epub-confirm-delete");
btn.setCta();
```

参考：`src/ConfirmModal.ts`、`src/EpubReaderView.ts`（v1.3.12）。

### 2.3 版本号发布

- 插件版本：`manifest.json` → `package.json` → `versions.json` 三者一致。
- 每次发版更新 `versions.json` 中新版本与 `minAppVersion` 的映射。

---

## 3. TypeScript 编码规范

### 3.1 模块与命名

- 插件主类：`export default class ObEpubPlugin extends Plugin`（`main.ts`）。
- 自定义视图：`*View.ts`，导出 `VIEW_TYPE` 常量 + `ItemView` / `FileView` 子类。
- 数据持久化：`*Store.ts`，封装 `vault` / `loadData` / `saveData`。
- 设置与类型：集中在 `types.ts`，提供 `DEFAULT_SETTINGS` 与接口定义。
- 命令 `id`：短横线命名，**不含插件 id 前缀**（如 `open-bookshelf`，非 `ob-epub-open-bookshelf`）。
- 命令 `name`：中文描述，符合 sentence case 审核习惯时可中英混用。

### 3.2 类型安全

- 文件判断用 `instanceof TFile`，**禁止** `as TFile` 强转（`obsidianmd/no-tfile-tfolder-cast`）。
- 对外部库（如 epubjs）的 `any` 尽量局部收敛，新代码避免无必要的 `any` 扩散。
- 设置项变更后调用 `await this.plugin.saveSettings()`。

### 3.3 异步与生命周期

```typescript
// 命令 / 事件回调中的 async：用 void 避免 floating promise
callback: () => {
  void this.openBookshelf();
},

// 注册的事件、定时器在 onunload 中清理（View 内同理）
this.registerEvent(this.app.vault.on("create", handler));
```

- `registerView`、`registerEvent`、`registerDomEvent` 等由 Obsidian 自动注销，无需手动 `off`。
- View 内 `ResizeObserver`、`setTimeout` 等在 `onClose` / `onunload` 中释放。

---

## 4. Obsidian API 使用

### 4.1 网络请求

- **禁止**使用全局 `fetch`（规则：`no-restricted-globals` / `obsidianmd` 推荐）。
- 使用 Obsidian 内置 `requestUrl`，可绕过浏览器 CORS 限制。

```typescript
import { requestUrl } from "obsidian";

const response = await requestUrl({
  url: apiUrl,
  method: "POST",
  contentType: "application/json",
  headers: { Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model, messages }),
  throw: false, // 默认 true；需自行处理 4xx/5xx 时设为 false
});

if (response.status < 200 || response.status >= 300) {
  throw new Error(`API 错误 (${response.status}): ${response.text}`);
}

const data = response.json as ChatCompletionResponse;
```

- `response.json`、`response.text` 为同步属性（非 Promise）；`response.json` 类型为 `any`，应对返回值定义接口再断言。
- 本插件参考实现：`src/AIService.ts`。

### 4.2 Vault 与文件

- 按路径取文件：优先 `vault.getFileByPath()`，可保留 `getAbstractFileByPath()` 作兼容。
- 创建目录：`await vault.createFolder(path)`，失败时 `.catch(() => {})` 仅用于「已存在」类幂等场景。
- 避免 `vault.getFiles()` 全量遍历查找单文件；已知路径时直接 `getFileByPath`。

### 4.3 工作区与视图

- 打开新标签：`workspace.getLeaf("tab")`。
- 聚焦已有 leaf：`await workspace.revealLeaf(leaf)`（≥ 1.7.2）。
- 自定义视图通过 `registerView(VIEW_TYPE, factory)` 注册，扩展名用 `registerExtensions`。

### 4.4 深链接

- 协议名不与核心冲突（本插件：`ob-epub-goto`）。
- URL 参数做 `decodeProtocolParam` 等解码，兼容历史双重编码。

---

## 5. UI 与设置页

### 5.1 设置页（PluginSettingTab）

- 分组标题用 `Setting.setHeading()`，**不要**手写 `<h2>` / `<h3>`：

```typescript
new Setting(containerEl).setName("想法图标").setHeading();
```

- 分组标题**不要**包含插件名称（规则：`obsidianmd/ui/no-plugin-name-in-settings-headings`）。设置页顶部已由 Obsidian 显示插件名，标题只需描述分组内容：

```typescript
// 不要
new Setting(containerEl).setName("EPUB Marginalia 设置").setHeading();

// 推荐
new Setting(containerEl).setName("常规").setHeading();
new Setting(containerEl).setName("AI 集成").setHeading();
```

- 单项用 `new Setting(containerEl).setName().setDesc().addText|addDropdown|addSlider...`。
- 容器可加插件专属 class：`containerEl.addClass("ob-epub-settings")`。

### 5.2 自定义 View / Modal

- Modal 标题可用 `createEl("h3")`；书架等自定义 View 可用语义化标题。
- 用户可见文案：英文界面遵循 sentence case（`obsidianmd/ui/sentence-case`）；中文界面按产品习惯即可。

### 5.3 主题变量

样式优先使用 Obsidian CSS 变量，保证亮/暗主题一致：

```css
color: var(--text-normal);
background: var(--background-secondary);
border-color: var(--background-modifier-border);
```

---

## 6. 样式规范（重点）

社区审核规则：`obsidianmd/no-static-styles-assignment`。

### 6.1 禁止

```typescript
// 不要
el.style.display = "none";
el.style.width = "50%";
dot.style.background = "#e8b339";
```

### 6.2 推荐做法

| 场景 | 做法 |
|------|------|
| 显示 / 隐藏 | `el.hide()` / `el.show()` / `el.toggleVisibility(bool)` |
| 固定样式 | `styles.css` + `addClass()` / `toggleClass()` |
| 运行时动态值（进度、坐标、字号） | `el.setCssProps({ width: "50%", top: "12px" })` |
| 枚举色（高亮五色） | `data-color="yellow"` + CSS `[data-color="yellow"] { background: … }` |
| 状态类（折叠、居中菜单） | `.is-collapsed`、`.is-centered` 等 |

### 6.3 CSS 组织

- 插件根容器使用统一前缀：`ob-epub-`、`epub-`，避免污染全局。
- 与 `types.ts` 中常量同步的色值，在 `styles.css` 顶部注释标明（如 callout 颜色）。

---

## 7. 安全与依赖

### 7.1 禁止动态注入 script

打包后的 `main.js` 中**不得**出现 `document.createElement("script")`（社区安全扫描）。

- EPUB 渲染保持 `allowScriptedContent: false`。
- 第三方库（epubjs、jszip、localforage 等）若内含 script 注入，通过 `patches/` + `patch-package` 移除，**不要**直接改 `node_modules` 而不提交补丁。

当前补丁目录：

```
patches/
├── epubjs+0.3.93.patch
├── jszip+3.10.1.patch
├── localforage+1.10.0.patch
├── setimmediate+1.0.5.patch
└── immediate+3.0.6.patch
```

`npm install` 后由 `postinstall: patch-package` 自动应用。

### 7.2 依赖原则

- 运行时依赖尽量少；能 CSS 解决的不用 JS 库。
- 新增依赖前评估：是否会打入 bundle、是否引入 script / eval / 全量 polyfill。

---

## 8. ESLint 与校验

### 8.1 本地检查

```bash
npm run lint        # eslint src
npm run build       # 生产构建
```

配置：`eslint.config.mjs`，继承 `eslint-plugin-obsidianmd` 的 `recommended`。

### 8.2 发版前必过项（社区审核相关）

| 规则 | 说明 |
|------|------|
| `no-unsupported-api` | API 版本 ≤ `minAppVersion` |
| `no-innerHTML` | 禁止 `innerHTML` 赋值，用 `appendText` / `createEl` / `DOMParser` |
| `no-static-styles-assignment` | 不用 `el.style.xxx =` |
| 设置页标题 | 使用 `Setting.setHeading()` |
| `no-plugin-name-in-settings-headings` | 分组标题不含插件名 |
| `no-restricted-globals`（`fetch`） | 网络请求用 `requestUrl` |
| `description` | 不含 `Obsidian` |
| 动态 script | `main.js` 中无 `createElement("script")` |

### 8.3 构建后自检

```bash
npm run build
grep -c 'createElement("script")' dist/main.js   # 期望为 0
```

---

## 9. 构建与部署

```bash
# 开发（监听）
npm run dev

# 生产构建
npm run build

# 直接写入 Vault 插件目录
PLUGIN_DIR="/path/to/.obsidian/plugins/ob-epub-reader" npm run build
```

构建产出：`main.js`、`manifest.json`、`styles.css`（三者缺一不可）。

本地验证：Obsidian 中重载插件（关闭再开启，或 `Ctrl/Cmd + R`）。

详细流程见 [构建与发布流程.md](./构建与发布流程.md)。

---

## 10. 新功能开发检查清单

提交 PR 或发版前逐项确认：

- [ ] 无 `innerHTML` 赋值；动态内容用 `appendText` / `createEl` / `DOMParser`
- [ ] 无超出 `minAppVersion` 的 Obsidian API（尤其 `setDestructive` 等 1.13+ API）
- [ ] `minAppVersion` 与新增 API 一致
- [ ] `versions.json` 已更新新版本条目
- [ ] 无 `el.style.*` 直接赋值；动态样式用 `setCssProps` / CSS 类
- [ ] 设置页分组用 `setHeading()`，标题不含插件名
- [ ] `manifest.json` description 无 `Obsidian`
- [ ] 网络请求用 `requestUrl`，不用 `fetch`（参考 `src/AIService.ts`）
- [ ] 文件类型判断用 `instanceof TFile`
- [ ] async 回调已 `void` 或 `await` 妥善处理
- [ ] `npm run lint` 无新增与本次改动相关的 error
- [ ] `npm run build` 成功，`main.js` 无 `createElement("script")`
- [ ] 新依赖如需 patch，已提交 `patches/*.patch`

---

## 11. 参考链接

- [Obsidian Plugin Developer Docs](https://docs.obsidian.md/)
- [eslint-plugin-obsidianmd](https://github.com/obsidianmd/eslint-plugin)
- [Community plugin submission](https://github.com/obsidianmd/obsidian-releases)
