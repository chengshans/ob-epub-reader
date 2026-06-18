# EPUB Marginalia

[中文](README.md) | **English**

Read EPUB ebooks inside Obsidian with a built-in reader, margin notes, vault excerpts, deep links back to the source, and reading themes.

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
- **Copy and highlight** — Color dots copy excerpts; with annotations off, dots copy only; when a Markdown note is open, excerpts auto-insert at the last cursor
- **Five note types** — Note, Inspiration, Practice, Revisit, Question; labels and icons are configurable in settings
- **Excerpt export** — Annotations sync to Markdown excerpt files with four configurable excerpt link formats
- **Deep links** — Wiki links `#cfi=...` jump from excerpts to the EPUB passage; legacy `obsidian://ob-epub-goto` URLs and old block-ref formats are auto-migrated
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

**Split-view co-reading**: With EPUB and Markdown side by side, **Copy** or a color dot writes the excerpt to the clipboard and inserts it at the last cursor in the recently edited note (reading mode: clipboard only).

Example excerpt block (default **Callout + title link** format):

```markdown
> [!ob-epub|yellow] [[book.epub#cfi=/6/14!/4/2/1:0&end=...|Chapter 3]]
> Selected passage text

<!-- ob-epub-note-type: inspiration -->
Optional thought text

---
```

### Excerpt link formats

Under **Settings → Excerpt title link format**, choose one of four presets. Changes apply only to new annotations; for existing excerpts, use **Convert existing excerpt links → Convert now** to batch-rewrite.

| Preview | ID | Setting name | Write example | Color |
| :--: | ---- | ------------ | ------------- | ----- |
| ![Callout + title link](assets/readme-excerpt-formats/callout-title.png) | `callout-title` | Callout + title link | `> [!ob-epub\|purple] [[book.epub#cfi=...\|Chapter]]` + `> passage` | callout metadata |
| ![Passage + trailing source link](assets/readme-excerpt-formats/inline-suffix.png) | `inline-suffix` | Passage + trailing source link | `Passage. [[book.epub#cfi=...\|Source]]` | not stored; reads back as `yellow` |
| ![Colored passage + trailing source link](assets/readme-excerpt-formats/inline-colored.png) | `inline-colored` | Colored passage + trailing source link | `<span style="color: #8b5cf6;">Passage</span> [[...\|Source]]` | span hex → nearest highlight color |
| ![Link as passage text](assets/readme-excerpt-formats/wiki-text-alias.png) | `wiki-text-alias` | Link as passage text | `[[book.epub#cfi=...\|Full excerpt text]]` | not stored; reads back as `yellow` |

Thought block (shared by all four formats):

```markdown
<!-- ob-epub-note-type: inspiration -->
Thought content
```

Multi-line excerpts: formats 2/3 (`inline-suffix`, `inline-colored`) keep line breaks; format 4 (`wiki-text-alias`) collapses line breaks to a single line (space-joined) when writing; escape `\|` and `\]` in aliases.

### Back to source

Wiki links in excerpts (`[[book.epub#cfi=...|...]]`), **Source** links, or `ob-epub` callout title links all jump to the matching passage in the EPUB reader (works in split view).

> Legacy `obsidian://ob-epub-goto?file=...&cfi=...` URLs, old block-ref links, and legacy CFI-comment layouts are migrated to the currently selected excerpt format on first plugin load or via manual conversion.

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
| Excerpt title link format | Four presets; see above | Callout + title link |
| Convert existing excerpt links | Batch-rewrite all `《Title》摘录.md` files in the excerpt folder to the current format | — |
| Default reading mode | Paginated / scroll | Scroll |
| Default font size | Reader font size (px) | 16 |
| Default reading theme | Follow Obsidian / White / Yellow / Green / Sepia / Dark | Follow Obsidian |
| Note types | Labels and icons for five note categories (fixed ids; reset to defaults available) | See settings tab |
| Note icon size | Diameter of note icons beside highlights (px) | 20 |
| Note icon position | Horizontal / vertical offset from highlight (px) | 2 / 0 |

## Data storage

| File | Location | Contents |
|------|----------|----------|
| `《Book Title》摘录.md` | `{excerpt folder}/` | Highlights and margin notes; frontmatter includes reading progress |
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
