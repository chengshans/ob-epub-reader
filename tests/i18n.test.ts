import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { setMockLanguage } from "./mocks/obsidian";
import { detectObsidianLocale, resolvePluginLocale } from "../src/i18n/detect";
import { applyPluginLocale, initializeI18n, resetI18nForTests, t } from "../src/i18n/i18n";
import en from "../src/i18n/locales/en.json";

const localesDir = path.join(__dirname, "../src/i18n/locales");

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

  it("detectObsidianLocale maps zh-TW to zh-TW", () => {
    setMockLanguage("zh-TW");
    expect(detectObsidianLocale()).toBe("zh-TW");
  });

  it("detectObsidianLocale maps zh-HK to zh-TW", () => {
    setMockLanguage("zh-HK");
    expect(detectObsidianLocale()).toBe("zh-TW");
  });

  it("detectObsidianLocale maps ja", () => {
    setMockLanguage("ja");
    expect(detectObsidianLocale()).toBe("ja");
  });

  it("detectObsidianLocale falls back to en", () => {
    setMockLanguage("fr");
    expect(detectObsidianLocale()).toBe("en");
  });

  it("resolvePluginLocale honors explicit locales", () => {
    setMockLanguage("en");
    expect(resolvePluginLocale("zh")).toBe("zh");
    expect(resolvePluginLocale("zh-TW")).toBe("zh-TW");
    expect(resolvePluginLocale("ja")).toBe("ja");
    expect(resolvePluginLocale("en")).toBe("en");
  });

  it("resolvePluginLocale auto follows Obsidian", () => {
    setMockLanguage("ja");
    expect(resolvePluginLocale("auto")).toBe("ja");
    setMockLanguage("zh-TW");
    expect(resolvePluginLocale("auto")).toBe("zh-TW");
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

    it("switches to ja without reload", async () => {
      await applyPluginLocale("ja");
      expect(t("commands.openBookshelf")).toBe("EPUB 本棚を開く");
    });

    it("switches to zh-TW without reload", async () => {
      await applyPluginLocale("zh-TW");
      expect(t("commands.openBookshelf")).toBe("開啟 EPUB 書架");
    });
  });

  it("all locale files have same keys as en.json", () => {
    const enKeys = new Set(flattenKeys(en as Record<string, unknown>));
    const localeFiles = fs
      .readdirSync(localesDir)
      .filter((f) => f.endsWith(".json") && f !== "en.json");

    for (const file of localeFiles) {
      const data = JSON.parse(
        fs.readFileSync(path.join(localesDir, file), "utf8")
      ) as Record<string, unknown>;
      const keys = new Set(flattenKeys(data));
      expect(keys, file).toEqual(enKeys);
    }
  });
});
