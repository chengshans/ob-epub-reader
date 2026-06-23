import { getLanguage } from "obsidian";
import type { PluginUiLocale } from "../types";

/** Obsidian language code → i18next resources key */
const OBSIDIAN_LOCALE_MAP: Record<string, string> = {
  en: "en",
  zh: "zh",
  ja: "ja",
  "zh-TW": "zh-TW",
  "zh-HK": "zh-TW",
};

/** Resolve Obsidian app language to plugin locale (no user override). */
export function detectObsidianLocale(): string {
  const raw = getLanguage() || "en";
  if (OBSIDIAN_LOCALE_MAP[raw]) return OBSIDIAN_LOCALE_MAP[raw];
  if (raw === "zh-CN") return "zh";
  if (raw.startsWith("zh")) return "zh";
  return "en";
}

/** Resolve effective plugin locale from user preference. */
export function resolvePluginLocale(preference: PluginUiLocale): string {
  if (
    preference === "en" ||
    preference === "zh" ||
    preference === "zh-TW" ||
    preference === "ja"
  ) {
    return preference;
  }
  return detectObsidianLocale();
}
