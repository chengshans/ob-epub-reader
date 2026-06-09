import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const root = process.cwd();
const distDir = path.join(root, "dist");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const version = manifest.version;
const zipName = `ob-epub-reader-${version}.zip`;
const releaseDir = path.join(root, "release");
const zipPath = path.join(releaseDir, zipName);

const required = ["main.js", "manifest.json", "styles.css"];
for (const file of required) {
  const p = path.join(distDir, file);
  if (!fs.existsSync(p)) {
    console.error(`Missing build artifact: ${p}`);
    process.exit(1);
  }
}

fs.mkdirSync(releaseDir, { recursive: true });
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

execSync(`zip -j "${zipPath}" ${required.map((f) => `"${path.join(distDir, f)}"`).join(" ")}`, {
  stdio: "inherit",
  cwd: root,
});

console.log(`Release package: ${zipPath}`);
