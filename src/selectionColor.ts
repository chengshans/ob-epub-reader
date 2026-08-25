/** Parse #rgb / #rrggbb / rgb() / rgba() into rgba(..., alpha). */
export function colorToRgba(color: string | undefined, alpha: number): string | null {
  if (!color) return null;
  const a = Math.max(0, Math.min(1, alpha));
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) {
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    }
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  const rgb = color
    .trim()
    .match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgb) {
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${a})`;
  }
  return null;
}

/** Raise rgba alpha to at least minAlpha; return null if unparseable. */
export function boostRgbaAlpha(color: string | undefined, minAlpha: number): string | null {
  if (!color) return null;
  const rgb = color
    .trim()
    .match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgb) {
    const current = rgb[4] !== undefined ? parseFloat(rgb[4]) : 1;
    const a = Math.max(
      Number.isFinite(current) ? current : 0,
      Math.max(0, Math.min(1, minAlpha))
    );
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${a})`;
  }
  return colorToRgba(color, minAlpha);
}
