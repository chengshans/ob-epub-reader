/**
 * Chromium / Obsidian 使用 OpenType Sanitizer（OTS）。
 * 部分桌面字体带有 OTS 不支持的表（如 vhea 0x00010001），会导致
 * FontFace 报 “Invalid font data”。导入前剥离这些表即可。
 */

const DROP_TAGS = new Set([
  tag("vhea"),
  tag("vmtx"),
  tag("VORG"),
  tag("VDMX"),
  tag("DSIG"),
]);

function tag(s: string): number {
  return (
    (s.charCodeAt(0) << 24) |
    (s.charCodeAt(1) << 16) |
    (s.charCodeAt(2) << 8) |
    s.charCodeAt(3)
  ) >>> 0;
}

function tagString(n: number): string {
  return String.fromCharCode(
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff
  );
}

interface SfntTable {
  tag: number;
  checksum: number;
  offset: number;
  length: number;
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, false);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, false);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, false);
}

function isSfnt(data: ArrayBuffer): boolean {
  if (data.byteLength < 12) return false;
  const view = new DataView(data);
  const scaler = readU32(view, 0);
  // 0x00010000 TrueType, 'OTTO' CFF, 'true'/'typ1' rare
  return (
    scaler === 0x00010000 ||
    scaler === 0x4f54544f || // OTTO
    scaler === 0x74727565 || // true
    scaler === 0x74797031 // typ1
  );
}

function parseTables(data: ArrayBuffer): { scaler: number; tables: SfntTable[] } | null {
  if (!isSfnt(data)) return null;
  const view = new DataView(data);
  const scaler = readU32(view, 0);
  const numTables = readU16(view, 4);
  if (numTables <= 0 || numTables > 100) return null;
  const tables: SfntTable[] = [];
  for (let i = 0; i < numTables; i++) {
    const entry = 12 + i * 16;
    if (entry + 16 > data.byteLength) return null;
    const offset = readU32(view, entry + 8);
    const length = readU32(view, entry + 12);
    if (offset + length > data.byteLength) return null;
    tables.push({
      tag: readU32(view, entry),
      checksum: readU32(view, entry + 4),
      offset,
      length,
    });
  }
  return { scaler, tables };
}

/** 计算表校验和（OpenType 规范：按 4 字节大端累加） */
function tableChecksum(data: Uint8Array): number {
  const paddedLen = (data.length + 3) & ~3;
  let sum = 0;
  for (let i = 0; i < paddedLen; i += 4) {
    const b0 = i < data.length ? data[i] : 0;
    const b1 = i + 1 < data.length ? data[i + 1] : 0;
    const b2 = i + 2 < data.length ? data[i + 2] : 0;
    const b3 = i + 3 < data.length ? data[i + 3] : 0;
    sum = (sum + ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3)) >>> 0;
  }
  return sum;
}

/**
 * 将 OS/2.fsType 设为 0（Installable embedding），避免部分环境限制嵌入。
 * 不修改则原样返回。
 */
function patchOs2FsType(tableData: Uint8Array): Uint8Array {
  // OS/2 至少要有 usFirstCharIndex 之前的字段；fsType 在 offset 8
  if (tableData.byteLength < 10) return tableData;
  const out = new Uint8Array(tableData);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint16(8, 0, false); // fsType
  return out;
}

/**
 * 剥离 Chromium OTS 不支持/易失败的表，返回可 FontFace 加载的新 buffer。
 * 非 SFNT（如纯 woff2 容器）原样返回。
 */
export function sanitizeOpenTypeForChromium(data: ArrayBuffer): {
  data: ArrayBuffer;
  dropped: string[];
  changed: boolean;
} {
  const parsed = parseTables(data);
  if (!parsed) {
    return { data, dropped: [], changed: false };
  }

  const kept = parsed.tables.filter((t) => !DROP_TAGS.has(t.tag));
  const dropped = parsed.tables
    .filter((t) => DROP_TAGS.has(t.tag))
    .map((t) => tagString(t.tag));

  const src = new Uint8Array(data);
  const bodyParts: { tag: number; bytes: Uint8Array }[] = [];
  let changed = dropped.length > 0;

  for (const t of kept) {
    let bytes = src.subarray(t.offset, t.offset + t.length);
    if (t.tag === tag("OS/2")) {
      const patched = patchOs2FsType(bytes);
      if (patched !== bytes) {
        bytes = patched;
        changed = true;
      }
    }
    bodyParts.push({ tag: t.tag, bytes });
  }

  if (!changed) {
    return { data, dropped: [], changed: false };
  }

  // 按 tag 排序（OpenType 要求目录按 tag 字母序）
  bodyParts.sort((a, b) => (a.tag >>> 0) - (b.tag >>> 0));

  const numTables = bodyParts.length;
  const headerSize = 12 + numTables * 16;
  let offset = headerSize;
  const records: { tag: number; checksum: number; offset: number; length: number; bytes: Uint8Array }[] =
    [];

  for (const part of bodyParts) {
    const aligned = (offset + 3) & ~3;
    offset = aligned;
    const checksum = tableChecksum(part.bytes);
    records.push({
      tag: part.tag,
      checksum,
      offset,
      length: part.bytes.length,
      bytes: part.bytes,
    });
    offset += part.bytes.length;
  }

  const totalSize = (offset + 3) & ~3;
  const out = new ArrayBuffer(totalSize);
  const view = new DataView(out);
  const outBytes = new Uint8Array(out);

  writeU32(view, 0, parsed.scaler);
  writeU16(view, 4, numTables);
  // searchRange / entrySelector / rangeShift
  let searchRange = 1;
  let entrySelector = 0;
  while (searchRange * 2 <= numTables) {
    searchRange *= 2;
    entrySelector += 1;
  }
  searchRange *= 16;
  writeU16(view, 6, searchRange);
  writeU16(view, 8, entrySelector);
  writeU16(view, 10, numTables * 16 - searchRange);

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const entry = 12 + i * 16;
    writeU32(view, entry, r.tag);
    writeU32(view, entry + 4, r.checksum);
    writeU32(view, entry + 8, r.offset);
    writeU32(view, entry + 12, r.length);
    outBytes.set(r.bytes, r.offset);
  }

  return { data: out, dropped, changed: true };
}
