import esbuild from "esbuild";
import process from "process";
import fs from "fs";
import path from "path";

const PLUGIN_DIR =
  process.env.PLUGIN_DIR ||
  path.resolve("dist");

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
  console.log("Build complete. Files copied to:", PLUGIN_DIR);
} else {
  await context.watch();
  copyBuildAssets(PLUGIN_DIR);
  console.log("Watching...");
}
