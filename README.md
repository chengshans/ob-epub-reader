# EPUB Marginalia

[中文](README.zh.md) | **English**

Read EPUB ebooks inside Obsidian with a built-in reader, margin notes, vault excerpts, deep links back to the source, and optional AI interpretation.

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
- **TOC and notes sidebar** — Chapter outline and annotations for the current book
- **Reading progress** — Auto-saved position; bookshelf shows completion percentage per book
- **Highlights and margin notes** — Select text to highlight (yellow/red/green/blue/purple) or add a thought
- **Excerpt export** — Annotations sync to Markdown excerpt files in your vault with back-to-source links
- **Deep links** — `obsidian://ob-epub-goto?file=...&cfi=...` jumps from notes to the exact passage in the EPUB
- **AI integration** — Send selected text to any OpenAI-compatible API and append the response to the excerpt file
- **Reading modes** — Paginated or scroll; adjustable font size
- **Keyboard and mouse** — Arrow keys, Page Up/Down, and mouse wheel for page turns

## Usage

### Open a book

- Click any `.epub` file in the file explorer
- Command palette: **打开 EPUB 书架** — Browse all EPUBs in the vault and their progress
- Command palette: **在 EPUB 阅读器中打开** — Open the currently selected EPUB file

### Highlights and margin notes

1. Select text in the reader to open the context menu
2. Pick a highlight color, or choose **标注** to add a thought
3. Excerpts are written to `{excerpt folder}/《Book Title》摘录.md`

Example excerpt block:

```markdown
> [!ob-epub|yellow] Chapter 3 · 2026-06-09 12:00 ^ann-abc123
> Selected passage text

Optional thought text

[回到原文](obsidian://ob-epub-goto?file=books%2Fexample.epub&cfi=epubcfi(...))

---
```

### AI interpretation

1. Configure AI API URL, key, model, and prompt template in settings
2. Select text and choose **AI** from the context menu
3. The response is appended to the book’s excerpt file

Use `{text}` in the prompt template as a placeholder for the selection.

### Back to source

Click **回到原文** in an excerpt file, or click an `ob-epub` callout, to jump to that passage in the EPUB reader (works in split view).

## Settings

Configure under **Settings → EPUB Marginalia**:

| Option | Description | Default |
|--------|-------------|---------|
| Excerpt folder | Directory for excerpt Markdown files (progress stored in each book’s frontmatter) | `epub-books/anno` |
| Default reading mode | Paginated / scroll | Paginated |
| Default font size | Reader font size (px) | 16 |
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

- Obsidian 1.0.0+
- Desktop only

## Development

```bash
npm install
npm run build    # output to dist/
npm run release  # build + zip for GitHub release
npm run dev      # watch mode
```

To deploy directly into a vault plugin folder:

```bash
PLUGIN_DIR="/path/to/vault/.obsidian/plugins/ob-epub-reader" npm run build
```

## License

MIT
