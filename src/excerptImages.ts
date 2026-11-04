/** 摘录配图落盘所用的纯函数工具（无 Obsidian 依赖，便于单测） */

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/avif": "avif",
  "image/tiff": "tiff",
};

const KNOWN_EXTENSIONS = /^(png|jpg|gif|webp|svg|bmp|avif|tiff)$/;

/** 由 MIME（blob.type）推导扩展名；blob 无类型时退回 data URL / 原文件名后缀 */
export function excerptImageExtension(mime: string, source = ""): string {
  const normalizedMime = (mime || "").toLowerCase().split(";")[0].trim();
  const byMime = MIME_EXTENSIONS[normalizedMime];
  if (byMime) return byMime;

  const dataUrl = source.match(/^data:image\/([a-z0-9.+-]+)/i);
  if (dataUrl) {
    const candidate = dataUrl[1].toLowerCase().replace("jpeg", "jpg").replace("svg+xml", "svg");
    if (KNOWN_EXTENSIONS.test(candidate)) return candidate;
  }

  const urlExt = source.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
  if (urlExt) {
    const candidate = urlExt[1].toLowerCase().replace("jpeg", "jpg");
    if (KNOWN_EXTENSIONS.test(candidate)) return candidate;
  }

  return "png";
}

/** 内容短哈希（16 位十六进制），同一图片重复摘录会命中同一文件名 */
export async function shortContentHash(data: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .slice(0, 8)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  let hash = 0x811c9dc5;
  const bytes = new Uint8Array(data);
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
