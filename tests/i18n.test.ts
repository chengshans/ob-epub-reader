import { describe, expect, it, beforeAll } from "vitest";
import { setMockLanguage } from "./mocks/obsidian";
import { detectObsidianLocale, resolvePluginLocale } from "../src/i18n/detect";
import { applyPluginLocale, initializeI18n, resetI18nForTests, t } from "../src/i18n/i18n";
import en from "../src/i18n/locales/en.json";
import zh from "../src/i18n/locales/zh.json";

function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Record<string, unknown>, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

describe("i18n", () => {
  it("detectObsidianLocale maps zh", () => {
    setMockLanguage("zh");
    expect(detectObsidianLocale()).toBe("zh");
  });

  it("detectObsidianLocale maps zh-TW to zh", () => {
    setMockLanguage("zh-TW");
    expect(detectObsidianLocale()).toBe("zh");
  });

  it("detectObsidianLocale falls back to en", () => {
    setMockLanguage("fr");
    expect(detectObsidianLocale()).toBe("en");
  });

  it("resolvePluginLocale honors explicit zh/en", () => {
    setMockLanguage("en");
    expect(resolvePluginLocale("zh")).toBe("zh");
    expect(resolvePluginLocale("en")).toBe("en");
  });

  it("resolvePluginLocale auto follows Obsidian", () => {
    setMockLanguage("ja");
    expect(resolvePluginLocale("auto")).toBe("en");
    setMockLanguage("zh");
    expect(resolvePluginLocale("auto")).toBe("zh");
  });

  describe("t()", () => {
    beforeAll(async () => {
      resetI18nForTests();
      setMockLanguage("en");
      await initializeI18n("en");
    });

    it("returns English string", () => {
      expect(t("commands.openBookshelf")).toBe("Open EPUB bookshelf");
    });

    it("interpolates params", () => {
      expect(t("notice.convertDone", { count: 3 })).toBe("Updated 3 excerpt file(s)");
    });
  });

  describe("applyPluginLocale", () => {
    beforeAll(async () => {
      resetI18nForTests();
      setMockLanguage("en");
      await initializeI18n("auto");
    });

    it("switches to zh without reload", async () => {
      await applyPluginLocale("zh");
      expect(t("commands.openBookshelf")).toBe("打开 EPUB 书架");
    });
  });

  it("zh.json has same keys as en.json", () => {
    const enKeys = new Set(flattenKeys(en as Record<string, unknown>));
    const zhKeys = new Set(flattenKeys(zh as Record<string, unknown>));
    expect(zhKeys).toEqual(enKeys);
  });
});
