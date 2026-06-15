# EPUB Marginalia

**中文** | [English](README.en.md)

在 Obsidian 中直接阅读 EPUB 电子书，支持目录导航、阅读进度、文本高亮与标注、摘录导出、阅读主题，以及 AI 辅助解读。

## 安装

### 从 Obsidian 社区插件安装

1. 打开 **设置 → 社区插件**
2. 如需要，关闭 **安全模式**，点击 **浏览**
3. 搜索 **EPUB Marginalia**
4. 点击 **安装**，然后 **启用**

### 手动安装

1. 从 [最新 Release](https://github.com/chengshans/ob-epub-reader/releases) 下载 `main.js`、`manifest.json`、`styles.css`
2. 复制到 Vault 的 `.obsidian/plugins/ob-epub-reader/` 目录
3. 在 **设置 → 社区插件** 中启用 **EPUB Marginalia**

## 功能

- **内置阅读器** — 点击 Vault 中的 `.epub` 文件即可在阅读视图中打开
- **目录与标注侧栏** — 章节目录、当前书籍的标注列表（支持搜索与按颜色/想法类型筛选）
- **EPUB 书架** — 浏览 Vault 中所有 EPUB，查看各书阅读进度与累计阅读时长
- **阅读进度** — 自动保存位置，摘录 frontmatter 记录进度百分比、章节与阅读时长
- **文本高亮与标注** — 选中文字后可画线（黄/红/绿/蓝/紫）或添加想法
- **五种想法类型** — 做笔记、灵感、准备实践、反复看、疑问；可在设置中自定义名称与图标
- **摘录导出** — 标注自动写入 Vault 中的 Markdown 摘录文件，含「回到原文」跳转链接
- **深度链接** — 支持 `obsidian://ob-epub-goto?file=...&cfi=...` 从笔记跳回 EPUB 原文
- **AI 集成** — 选中文字后调用 OpenAI 兼容 API，将解读写入摘录文件
- **阅读模式** — 分页 / 滚动，可调字体大小
- **阅读主题** — 跟随 Obsidian、默认白、护眼黄、护眼绿、羊皮纸、夜间（工具栏可切换，设置中可设默认）
- **键盘与滚轮** — 方向键、PageUp/PageDown、鼠标滚轮翻页

## 使用

### 打开书籍

- 在文件列表中点击任意 `.epub` 文件
- 命令面板：`打开 EPUB 书架` — 浏览 Vault 中所有 EPUB 及阅读进度
- 命令面板：`在 EPUB 阅读器中打开` — 打开当前选中的 EPUB 文件

### 高亮与标注

1. 在阅读器中选中文字，弹出上下文菜单
2. 选择颜色画线，或点击「标注」添加想法（可选五种想法类型之一）
3. 摘录写入 `{摘录文件夹}/《书名》摘录.md`
4. 点击原文旁的想法图标，或侧栏标注列表，可查看、编辑或删除标注

摘录块示例：

```markdown
> [!ob-epub|yellow] 第三章 · 2026-06-09 12:00 ^ann-abc123
> 选中的原文内容

<!-- ob-epub-note-type: inspiration -->
可选的想法文字

<!-- ob-epub-cfi: epubcfi(...)/2/4[chap01ref]!/4/2/1:0 -->
[回到原文](obsidian://ob-epub-goto?file=books%2Fexample.epub&cfi=epubcfi(...))

---
```

### AI 解读

**推荐使用 [Claudian](https://github.com/YishenTu/claudian)**：内置 AI 适合段落级的一键释义；若需要多轮对话、结合 Vault 上下文深化理解，或调用 Claude Code / Codex 等代理读写笔记，推荐安装 Obsidian 社区插件 [Claudian](https://github.com/YishenTu/claudian)。EPUB 摘录以 Markdown 保存在 Vault 中，可在 Claudian 侧栏直接引用《书名》摘录.md，与 AI 共读、整理想法、扩展笔记。

### 回到原文

摘录文件中的「回到原文」链接、或 `ob-epub` callout 点击后，会跳转到 EPUB 阅读器的对应位置（分屏模式下同样有效）。

### 阅读主题

阅读器工具栏提供 6 种主题色块，可随时切换；**设置 → 默认阅读主题** 决定新开书籍的初始主题。

| 演示 | 主题 | 背景色 | 说明 |
| :--: | ---- | ------ | ---- |
| ![跟随 Obsidian](assets/readme-themes/obsidian.png) | 跟随 Obsidian | 随编辑器 | 正文配色与 Obsidian 编辑器一致，深浅模式自动跟随 |
| ![默认白](assets/readme-themes/white.png) | 默认白 | `#FFFFFF` | 白底深灰字，通用阅读 |
| ![护眼黄](assets/readme-themes/yellow.png) | 护眼黄 | `#FAF9DE` | 偏暖浅黄底，减轻长时间阅读疲劳 |
| ![护眼绿](assets/readme-themes/green.png) | 护眼绿 | `#E3EDCD` | 淡绿底，类似传统护眼模式 |
| ![羊皮纸](assets/readme-themes/sepia.png) | 羊皮纸 | `#F4ECD8` | 暖棕色调，仿纸质书观感 |
| ![夜间](assets/readme-themes/dark.png) | 夜间 | `#1C1C1E` | 深灰底浅字，适合暗光环境 |

### 想法类型与图标

添加想法时可选择一种类型；类型图标会显示在高亮文字旁，侧栏标注列表也会同步展示。名称与图标可在 **设置 → 想法类型** 中自定义（内部 `id` 固定不变）。

| 图标 | 类型 | id | 适用场景 |
|------|------|----|----------|
| 📝 | 做笔记 | `note` | 一般记录与摘要 |
| 💡 | 灵感 | `inspiration` | 触动、联想、创意 |
| ✅ | 准备实践 | `practice` | 打算落地的方法或行动 |
| 🔁 | 反复看 | `revisit` | 需要多次回看的段落 |
| ❓ | 疑问 | `question` | 尚不清楚、待查证的内容 |

想法图标的大小与位置可在 **设置 → 想法图标** 中调节（默认直径 20 px，相对高亮右缘偏移 2 px）。

## 设置

在 **设置 → EPUB Marginalia** 中可配置：

| 选项 | 说明 | 默认值 |
|------|------|--------|
| 摘录文件夹 | 摘录 Markdown 保存目录（进度写入各书 frontmatter） | `epub-books/anno` |
| 默认阅读模式 | 分页 / 滚动 | 滚动 |
| 默认字体大小 | 内容区字号（px） | 16 |
| 默认阅读主题 | 跟随 Obsidian / 默认白 / 护眼黄 / 护眼绿 / 羊皮纸 / 夜间 | 跟随 Obsidian |
| 想法类型 | 五种想法分类的名称与图标（id 固定，可恢复默认） | 见设置页 |
| 想法图标大小 | 原文旁想法图标的直径（px） | 20 |
| 想法图标位置 | 相对高亮区域的水平/垂直偏移（px） | 2 / 0 |
| AI API URL | OpenAI 兼容接口地址 | `https://api.openai.com/v1` |
| AI API Key | 本地保存，不上传 | （空） |
| AI 模型 | 如 `gpt-4o-mini` | `gpt-4o-mini` |
| AI Prompt 模板 | 使用 `{text}` 占位 | 见设置页 |

## 数据存储

| 文件 | 位置 | 内容 |
|------|------|------|
| `《书名》摘录.md` | `{摘录文件夹}/` | 高亮、标注、AI 解读；frontmatter 含阅读进度 |
| `data.json` | `.obsidian/plugins/ob-epub-reader/` | 插件设置（不含标注与进度） |

摘录 frontmatter 进度字段：`progress-percent`、`progress-cfi`、`progress-chapter`、`last-read`、`reading-time-seconds`（累计阅读秒数）。

旧版本曾将标注和进度保存在 `data.json` 或 `reading-progress.json` 中，插件首次加载时会自动迁移到摘录 frontmatter。迁移后可手动删除旧的 `reading-progress.json`。

## 要求

- Obsidian 1.7.2+
- 仅桌面端

## 开发

```bash
npm install
npm run build    # 输出到 dist/
npm run release  # 构建并打包 zip
npm run dev      # 监听模式
npm test         # 运行单元测试
```

直接部署到 Vault 插件目录：

```bash
PLUGIN_DIR="/path/to/vault/.obsidian/plugins/ob-epub-reader" npm run build
```

## 许可

MIT
