import esbuild from "esbuild";
import process from "process";
import fs from "fs";
import path from "path";

const PLUGIN_DIR =
  process.env.PLUGIN_DIR ||
  path.resolve("dist");

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

  // Copy manifest.json and styles.css to plugin dir
  fs.copyFileSync("manifest.json", path.join(PLUGIN_DIR, "manifest.json"));
  if (fs.existsSync("src/styles.css")) {
    fs.copyFileSync("src/styles.css", path.join(PLUGIN_DIR, "styles.css"));
  }
  console.log("Build complete. Files copied to:", PLUGIN_DIR);
} else {
  await context.watch();
  // Copy manifest.json and styles.css in dev mode too
  fs.copyFileSync("manifest.json", path.join(PLUGIN_DIR, "manifest.json"));
  if (fs.existsSync("src/styles.css")) {
    fs.copyFileSync("src/styles.css", path.join(PLUGIN_DIR, "styles.css"));
  }
  console.log("Watching...");
}
