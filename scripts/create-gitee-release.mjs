import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const version = manifest.version;
const tag = `v${version}`;
const zipName = `ob-epub-reader-${version}.zip`;
const zipPath = path.join(root, "release", zipName);
const owner = process.env.GITEE_OWNER || "mmlya";
const repo = process.env.GITEE_REPO || "ob-epub-reader";
const token = process.env.GITEE_ACCESS_TOKEN || process.env.GITEE_TOKEN;

if (!token) {
  console.error("请设置 GITEE_ACCESS_TOKEN 环境变量（Gitee 私人令牌）");
  process.exit(1);
}

if (!fs.existsSync(zipPath)) {
  console.error(`未找到发布包: ${zipPath}，请先运行 npm run release`);
  process.exit(1);
}

const api = "https://gitee.com/api/v5";

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: token, ...body }),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function uploadAttachment(releaseId) {
  const url = `${api}/repos/${owner}/${repo}/releases/${releaseId}/attach_files?access_token=${token}`;
  const out = execSync(`curl -sS -w "\\n%{http_code}" -X POST "${url}" -F "file=@${zipPath}"`, {
    encoding: "utf8",
  });
  const lines = out.trimEnd().split("\n");
  const status = Number(lines.pop());
  const text = lines.join("\n");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (status < 200 || status >= 300) {
    throw new Error(`Upload ${status}: ${JSON.stringify(data)}`);
  }
  return data;
}
const releaseNotes = [
  `## EPUB Reader ${version}`,
  "",
  "Obsidian 插件发布包，解压到 `.obsidian/plugins/ob-epub-reader/` 后启用即可。",
  "",
  "### 包含文件",
  "- `main.js`",
  "- `manifest.json`",
  "- `styles.css`",
  "",
  "### 安装",
  "1. 下载附件 `ob-epub-reader-*.zip`",
  "2. 解压到 Vault 的 `.obsidian/plugins/ob-epub-reader/`",
  "3. 在 Obsidian 设置中启用 **EPUB Reader**",
].join("\n");

const release = await apiPost(`${api}/repos/${owner}/${repo}/releases`, {
  tag_name: tag,
  name: tag,
  body: releaseNotes,
  target_commitish: "main",
  prerelease: false,
});

console.log(`Release created: id=${release.id}, tag=${release.tag_name}`);
const attachment = uploadAttachment(release.id);
console.log(`Attachment uploaded: ${attachment.name ?? zipName}`);
console.log(`https://gitee.com/${owner}/${repo}/releases/tag/${tag}`);
