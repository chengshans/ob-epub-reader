import { isI18nInitialized, t } from "./i18n";

/** All link aliases ever written — parsing must accept every entry. */
export const KNOWN_LINK_ALIASES = ["原文", "Source"] as const;

/** All goto aliases ever written — parsing must accept every entry. */
export const KNOWN_GOTO_ALIASES = ["回到原文", "Back to source"] as const;

/** Markdown link text for legacy obsidian:// goto URLs. */
export const KNOWN_GOTO_MARKDOWN_LABELS = [...KNOWN_GOTO_ALIASES] as const;

export function currentLinkAlias(): string {
  return isI18nInitialized() ? t("excerpt.linkAlias") : KNOWN_LINK_ALIASES[0];
}

export function currentGotoAlias(): string {
  return isI18nInitialized() ? t("excerpt.gotoAlias") : KNOWN_GOTO_ALIASES[0];
}

export function currentWikiTextAlias(): string {
  return isI18nInitialized() ? t("excerpt.wikiTextAlias") : KNOWN_LINK_ALIASES[0];
}

/** Build a regex alternation from alias strings (escaped). */
export function aliasAlternation(aliases: readonly string[]): string {
  return aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
}

export function isKnownLinkAlias(text: string): boolean {
  return (KNOWN_LINK_ALIASES as readonly string[]).includes(text);
}

export function isKnownGotoAlias(text: string): boolean {
  return (KNOWN_GOTO_ALIASES as readonly string[]).includes(text);
}

export function isKnownGotoLinkText(text: string): boolean {
  return isKnownGotoAlias(text) || isKnownLinkAlias(text);
}

/** Regex fragment: `|alias1|alias2]]` for wiki inline suffix links. */
export function wikiLinkAliasSuffixPattern(): string {
  return `\\|(?:${aliasAlternation(KNOWN_LINK_ALIASES)})\\]\\]`;
}

/** Regex for legacy standalone wiki goto links. */
export function legacyGotoWikiLinkPattern(flags = "g"): RegExp {
  return new RegExp(
    `\\[\\[[^\\]]+\\.epub#cfi=.+\\|(?:${aliasAlternation(KNOWN_GOTO_ALIASES)})\\]\\]`,
    flags
  );
}

/** Regex for legacy markdown obsidian:// goto links. */
export function legacyGotoMarkdownPattern(): RegExp {
  return new RegExp(
    `\\[(?:${aliasAlternation(KNOWN_GOTO_MARKDOWN_LABELS)})\\]\\(\\s*(?:obsidian:\\/\\/ob-epub-goto\\?|#ob-epub-goto\\?)([^)\\n]+)\\)`
  );
}
