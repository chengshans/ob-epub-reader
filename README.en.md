# EPUB Marginalia

[中文](README.md) | **English**

Read EPUB ebooks inside Obsidian with a built-in reader, margin notes, vault excerpts, deep links back to the source, reading themes, and optional AI interpretation.

## Installation

### From Obsidian Community Plugins

1. Open **Settings → Community plugins**
2. Disable **Restricted mode** if needed, then click **Browse**
3. Search for **EPUB Marginalia**
4. Click **Install**, then **Enable**

### Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/chengshans/ob-epub-reader/releases)
2. Copy them into `.obsidian/plugins/ob-epub-reader/` in your vault
3. Enable **EPUB Marginalia** under **Settings → Community plugins**

## Features

- **Built-in reader** — Open any `.epub` file in your vault from the file explorer
- **TOC and notes sidebar** — Chapter outline and annotations for the current book (search and filter by color or note type)
- **EPUB bookshelf** — Browse all EPUBs in the vault with progress and cumulative reading time
- **Reading progress** — Auto-saved position; excerpt frontmatter stores percent, chapter, and reading time
- **Highlights and margin notes** — Select text to highlight (yellow/red/green/blue/purple) or add a thought
- **Five note types** — Note, Inspiration, Practice, Revisit, Question; labels and icons are configurable in settings
- **Excerpt export** — Annotations sync to Markdown excerpt files in your vault with back-to-source links
- **Deep links** — `obsidian://ob-epub-goto?file=...&cfi=...` jumps from notes to the exact passage in the EPUB
- **AI integration** — Send selected text to any OpenAI-compatible API and append the response to the excerpt file
- **Reading modes** — Paginated or scroll; adjustable font size
- **Reading themes** — Follow Obsidian, White, Yellow, Green, Sepia, Dark (switch in toolbar; set default in settings)
- **Keyboard and mouse** — Arrow keys, Page Up/Down, and mouse wheel for page turns

## Usage

### Open a book

- Click any `.epub` file in the file explorer
- Command palette: **打开 EPUB 书架** — Browse all EPUBs in the vault and their progress
- Command palette: **在 EPUB 阅读器中打开** — Open the currently selected EPUB file

### Highlights and margin notes

1. Select text in the reader to open the context menu
2. Pick a highlight color, or choose **标注** to add a thought (one of five note types)
3. Excerpts are written to `{excerpt folder}/《Book Title》摘录.md`
4. Click the note icon beside highlighted text, or use the sidebar list, to view, edit, or delete annotations

Example excerpt block:

```markdown
> [!ob-epub|yellow] Chapter 3 · 2026-06-09 12:00 ^ann-abc123
> Selected passage text

<!-- ob-epub-note-type: inspiration -->
Optional thought text

<!-- ob-epub-cfi: epubcfi(...)/2/4[chap01ref]!/4/2/1:0 -->
[回到原文](obsidian://ob-epub-goto?file=books%2Fexample.epub&cfi=epubcfi(...))

---
```

### AI interpretation

The plugin includes lightweight AI interpretation: select a passage and call an OpenAI-compatible API in one click; the response is appended to the excerpt file.

1. Configure AI API URL, key, model, and prompt template in settings
2. Select text and choose **AI** from the context menu
3. The response is appended to the book’s excerpt file

Use `{text}` in the prompt template as a placeholder for the selection.

**Recommended: [Claudian](https://github.com/YishenTu/claudian)** — Built-in AI is best for quick, one-shot explanations. For multi-turn dialogue, vault-aware deep reading, or agent workflows (Claude Code, Codex, etc.) that read and write your notes, install the Obsidian community plugin [Claudian](https://github.com/YishenTu/claudian). EPUB excerpts live as Markdown in your vault; open them in Claudian’s sidebar to co-read with AI, refine thoughts, and expand your notes.

### Back to source

Click **回到原文** in an excerpt file, or click an `ob-epub` callout, to jump to that passage in the EPUB reader (works in split view).

### Reading themes

The reader toolbar offers six theme swatches for instant switching. **Settings → Default reading theme** sets the initial theme for newly opened books.

| Preview | Theme | Background | Description |
| :--: | ----- | ---------- | ----------- |
| ![Follow Obsidian](assets/readme-themes/obsidian.png) | Follow Obsidian | Editor theme | Matches Obsidian editor colors; follows light/dark mode |
| ![White](assets/readme-themes/white.png) | White | `#FFFFFF` | White background, dark gray text — general reading |
| ![Yellow](assets/readme-themes/yellow.png) | Yellow | `#FAF9DE` | Warm pale yellow — easier on the eyes for long sessions |
| ![Green](assets/readme-themes/green.png) | Green | `#E3EDCD` | Soft green — classic eye-comfort mode |
| ![Sepia](assets/readme-themes/sepia.png) | Sepia | `#F4ECD8` | Warm brown tone — paper-like feel |
| ![Dark](assets/readme-themes/dark.png) | Dark | `#1C1C1E` | Dark gray background, light text — low-light reading |

### Note types and icons

When adding a thought, pick one of five types. Its icon appears beside the highlight in the reader and in the sidebar list. Labels and icons are customizable under **Settings → Note types** (internal `id` values stay fixed).

| Icon | Type | id | Best for |
|------|------|----|----------|
| 📝 | Note | `note` | General notes and summaries |
| 💡 | Inspiration | `inspiration` | Insights, associations, ideas |
| ✅ | Practice | `practice` | Actions or methods you plan to try |
| 🔁 | Revisit | `revisit` | Passages worth reading again |
| ❓ | Question | `question` | Unclear points to look up later |

Icon size and position can be adjusted under **Settings → Note icons** (default 20 px diameter, 2 px offset to the right of the highlight).

## Settings

Configure under **Settings → EPUB Marginalia**:

| Option | Description | Default |
|--------|-------------|---------|
| Excerpt folder | Directory for excerpt Markdown files (progress stored in each book’s frontmatter) | `epub-books/anno` |
| Default reading mode | Paginated / scroll | Scroll |
| Default font size | Reader font size (px) | 16 |
| Default reading theme | Follow Obsidian / White / Yellow / Green / Sepia / Dark | Follow Obsidian |
| Note types | Labels and icons for five note categories (fixed ids; reset to defaults available) | See settings tab |
| Note icon size | Diameter of note icons beside highlights (px) | 20 |
| Note icon position | Horizontal / vertical offset from highlight (px) | 2 / 0 |
| AI API URL | OpenAI-compatible endpoint | `https://api.openai.com/v1` |
| AI API key | Stored locally only | (empty) |
| AI model | e.g. `gpt-4o-mini` | `gpt-4o-mini` |
| AI prompt template | Use `{text}` placeholder | See settings tab |

## Data storage

| File | Location | Contents |
|------|----------|----------|
| `《Book Title》摘录.md` | `{excerpt folder}/` | Highlights, margin notes, AI output; frontmatter includes reading progress |
| `data.json` | `.obsidian/plugins/ob-epub-reader/` | Plugin settings (not annotations or progress) |

Progress fields in excerpt frontmatter: `progress-percent`, `progress-cfi`, `progress-chapter`, `last-read`, `reading-time-seconds` (cumulative reading time in seconds).

Older versions stored annotations and progress in `data.json` or `reading-progress.json`. The plugin migrates them into excerpt frontmatter on first load. You may delete `reading-progress.json` after migration.

## Requirements

- Obsidian 1.7.2+
- Desktop only

## Development

```bash
npm install
npm run build    # output to dist/
npm run release  # build + zip for GitHub release
npm run dev      # watch mode
npm test         # run unit tests
```

To deploy directly into a vault plugin folder:

```bash
PLUGIN_DIR="/path/to/vault/.obsidian/plugins/ob-epub-reader" npm run build
```

## License

MIT
