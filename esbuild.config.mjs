import esbuild from "esbuild";
import process from "process";
import fs from "fs";
import path from "path";

const PLUGIN_DIR =
  process.env.PLUGIN_DIR ||
  path.resolve("dist");

const OBSIDIAN_SYNC_DIRS = [
  process.env.OBSIDIAN_PLUGIN_DIR,
  "/mnt/3a6ae4bf-b0e7-4fcc-9941-3d3ffc2d95c0/seven/ZYW-HUB/ai-co-reading/.obsidian/plugins/ob-epub-reader",
].filter(Boolean);

function copyBuildAssets(pluginDir) {
  const manifestDest = path.join(pluginDir, "manifest.json");
  if (path.resolve(manifestDest) !== path.resolve("manifest.json")) {
    fs.copyFileSync("manifest.json", manifestDest);
  }

  if (fs.existsSync("src/styles.css")) {
    const stylesDest = path.join(pluginDir, "styles.css");
    if (path.resolve(stylesDest) !== path.resolve("src/styles.css")) {
      fs.copyFileSync("src/styles.css", stylesDest);
    }
  }
}

function syncToObsidianVaults(pluginDir) {
  const files = ["main.js", "manifest.json", "styles.css"];
  for (const destDir of OBSIDIAN_SYNC_DIRS) {
    if (!fs.existsSync(destDir)) continue;
    for (const file of files) {
      const src = path.join(pluginDir, file);
      if (!fs.existsSync(src)) continue;
      fs.copyFileSync(src, path.join(destDir, file));
    }
    console.log("Synced to Obsidian vault:", destDir);
  }
}

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/autocomplete", "@codemirror/collab", "@codemirror/commands", "@codemirror/language", "@codemirror/lint", "@codemirror/search", "@codemirror/state", "@codemirror/view", "@lezer/common", "@lezer/highlight", "@lezer/lr"],
  format: "cjs",
  target: "node18",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outdir: PLUGIN_DIR,
  outbase: "src",
  entryNames: "main",
});

if (prod) {
  await context.rebuild();
  await context.dispose();

  copyBuildAssets(PLUGIN_DIR);
  syncToObsidianVaults(PLUGIN_DIR);
  console.log("Build complete. Files copied to:", PLUGIN_DIR);
} else {
  await context.watch();
  copyBuildAssets(PLUGIN_DIR);
  syncToObsidianVaults(PLUGIN_DIR);
  console.log("Watching...");
}
