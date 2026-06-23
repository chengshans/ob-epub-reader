import { beforeAll } from "vitest";
import { setMockLanguage } from "./mocks/obsidian";
import { resetI18nForTests, initializeI18n } from "../src/i18n/i18n";

let setupDone = false;

export async function setupI18n(locale = "zh"): Promise<void> {
  resetI18nForTests();
  setMockLanguage(locale);
  await initializeI18n();
  setupDone = true;
}

export function ensureI18nSetup(): void {
  if (!setupDone) {
    throw new Error("Call setupI18n() in beforeAll first");
  }
}

/** Convenience for test files */
export function withI18n(locale = "zh"): void {
  beforeAll(async () => {
    await setupI18n(locale);
  });
}
