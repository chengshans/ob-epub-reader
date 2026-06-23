import i18next from "i18next";
import { resolvePluginLocale } from "./detect";
import type { PluginUiLocale } from "../types";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

let initialized = false;

export async function initializeI18n(preference: PluginUiLocale = "auto"): Promise<void> {
  if (initialized) return;

  await i18next.init({
    lng: resolvePluginLocale(preference),
    fallbackLng: "en",
    returnEmptyString: false,
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    interpolation: { escapeValue: false },
  });

  initialized = true;
}

export async function applyPluginLocale(preference: PluginUiLocale): Promise<void> {
  const lng = resolvePluginLocale(preference);
  if (!initialized) {
    await initializeI18n(preference);
    return;
  }
  await i18next.changeLanguage(lng);
}

export function t(key: string, params?: Record<string, string | number>): string {
  if (!initialized) {
    throw new Error("i18n.t() called before initialization. Call initializeI18n() first.");
  }
  return i18next.t(key, params);
}

export function isI18nInitialized(): boolean {
  return initialized;
}

export { i18next };

/** @internal Test-only reset */
export function resetI18nForTests(): void {
  initialized = false;
}
