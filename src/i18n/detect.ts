import { getLanguage } from "obsidian";
import type { PluginUiLocale } from "../types";

/** Obsidian language code → i18next resources key */
const OBSIDIAN_LOCALE_MAP: Record<string, string> = {
  en: "en",
  zh: "zh",
};

/** Resolve Obsidian app language to plugin locale (no user override). */
export function detectObsidianLocale(): string {
  const raw = getLanguage() || "en";
  if (raw === "zh" || raw.startsWith("zh")) return "zh";
  return OBSIDIAN_LOCALE_MAP[raw] ?? "en";
}

/** Resolve effective plugin locale from user preference. */
export function resolvePluginLocale(preference: PluginUiLocale): string {
  if (preference === "en" || preference === "zh") return preference;
  return detectObsidianLocale();
}
