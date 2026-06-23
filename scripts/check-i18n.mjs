#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, "../src/i18n/locales");

function flattenKeys(obj, prefix = "") {
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flattenKeys(value, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

const enPath = path.join(localesDir, "en.json");
const en = JSON.parse(fs.readFileSync(enPath, "utf8"));
const enKeys = new Set(flattenKeys(en));

let failed = false;
for (const file of fs.readdirSync(localesDir)) {
  if (!file.endsWith(".json") || file === "en.json") continue;
  const locale = file.replace(/\.json$/, "");
  const data = JSON.parse(fs.readFileSync(path.join(localesDir, file), "utf8"));
  const keys = new Set(flattenKeys(data));

  const missing = [...enKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !enKeys.has(k));

  if (missing.length > 0) {
    console.error(`[${locale}] missing keys (${missing.length}):`);
    for (const k of missing) console.error(`  - ${k}`);
    failed = true;
  }
  if (extra.length > 0) {
    console.error(`[${locale}] extra keys (${extra.length}):`);
    for (const k of extra) console.error(`  - ${k}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log(`i18n check passed (${enKeys.size} keys, ${fs.readdirSync(localesDir).filter((f) => f.endsWith(".json")).length - 1} locale(s))`);
