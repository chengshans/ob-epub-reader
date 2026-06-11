# EPUB Marginalia

**中文** | [English](README.md)

在 Obsidian 中直接阅读 EPUB 电子书，支持目录导航、阅读进度、文本高亮与标注、摘录导出，以及 AI 辅助解读。

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
- **目录与笔记侧栏** — 章节目录、当前书籍的标注列表
- **阅读进度** — 自动保存位置，书架可查看各书阅读百分比
- **文本高亮与标注** — 选中文字后可画线（黄/红/绿/蓝/紫）或添加想法
- **摘录导出** — 标注自动写入 Vault 中的 Markdown 摘录文件，含「回到原文」跳转链接
- **深度链接** — 支持 `obsidian://ob-epub-goto?file=...&cfi=...` 从笔记跳回 EPUB 原文
- **AI 集成** — 选中文字后调用 OpenAI 兼容 API，将解读写入摘录文件
- **阅读模式** — 分页 / 滚动，可调字体大小
- **键盘与滚轮** — 方向键、PageUp/PageDown、鼠标滚轮翻页

## 使用

### 打开书籍

- 在文件列表中点击任意 `.epub` 文件
- 命令面板：`打开 EPUB 书架` — 浏览 Vault 中所有 EPUB 及阅读进度
- 命令面板：`在 EPUB 阅读器中打开` — 打开当前选中的 EPUB 文件

### 高亮与标注

1. 在阅读器中选中文字，弹出上下文菜单
2. 选择颜色画线，或点击「标注」添加想法
3. 摘录写入 `{摘录文件夹}/《书名》摘录.md`

摘录块示例：

```markdown
> [!ob-epub|yellow] 第三章 · 2026-06-09 12:00 ^ann-abc123
> 选中的原文内容

可选的想法文字

[回到原文](obsidian://ob-epub-goto?file=books%2Fexample.epub&cfi=epubcfi(...))

---
```

### AI 解读

1. 在设置中配置 AI API URL、Key、模型和 Prompt 模板
2. 选中文字后点击上下文菜单中的 **AI**
3. 解读结果追加到对应摘录文件

Prompt 模板中使用 `{text}` 作为选中文字的占位符。

### 回到原文

摘录文件中的「回到原文」链接、或 `ob-epub` callout 点击后，会跳转到 EPUB 阅读器的对应位置（分屏模式下同样有效）。

## 设置

在 **设置 → EPUB Marginalia** 中可配置：

| 选项 | 说明 | 默认值 |
|------|------|--------|
| 摘录文件夹 | 摘录 Markdown 保存目录（进度写入各书 frontmatter） | `epub-books/anno` |
| 默认阅读模式 | 分页 / 滚动 | 分页 |
| 默认字体大小 | 内容区字号（px） | 16 |
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
```

直接部署到 Vault 插件目录：

```bash
PLUGIN_DIR="/path/to/vault/.obsidian/plugins/ob-epub-reader" npm run build
```

## 许可

MIT
