import { normalizePath } from "obsidian";
import { BookProgress, DailyReadingSnapshot } from "./types";

export type ReadingHistoryStore = Record<string, DailyReadingSnapshot[]>;

function todayKey(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function normalizeReadingHistory(raw: unknown): ReadingHistoryStore {
  if (!raw || typeof raw !== "object") return {};
  const result: ReadingHistoryStore = {};
  for (const [path, entries] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    const list: DailyReadingSnapshot[] = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Partial<DailyReadingSnapshot>;
      if (!e.date) continue;
      list.push({
        date: String(e.date),
        seconds: Math.max(0, Number(e.seconds) || 0),
        percent: Math.min(100, Math.max(0, Number(e.percent) || 0)),
      });
    }
    if (list.length > 0) {
      result[normalizePath(path)] = list;
    }
  }
  return result;
}

/** Upsert today's snapshot for a book when progress is saved. */
export function recordDailyReadingSnapshot(
  history: ReadingHistoryStore,
  epubPath: string,
  progress: BookProgress
): ReadingHistoryStore {
  const key = normalizePath(epubPath);
  const date = todayKey();
  const seconds = Math.max(0, progress.readingTimeSeconds ?? 0);
  const percent = Math.min(100, Math.max(0, progress.percent ?? 0));
  const prev = [...(history[key] ?? [])];
  const idx = prev.findIndex((s) => s.date === date);
  const snapshot: DailyReadingSnapshot = { date, seconds, percent };
  if (idx >= 0) {
    const existing = prev[idx];
    prev[idx] = {
      date,
      seconds: Math.max(existing.seconds, seconds),
      percent: Math.max(existing.percent, percent),
    };
  } else {
    prev.push(snapshot);
  }
  prev.sort((a, b) => a.date.localeCompare(b.date));
  return { ...history, [key]: prev.slice(-90) };
}

export function sumReadingSeconds(history: DailyReadingSnapshot[]): number {
  if (history.length === 0) return 0;
  return history.reduce((acc, s) => acc + s.seconds, 0);
}

export function latestPercent(history: DailyReadingSnapshot[]): number {
  if (history.length === 0) return 0;
  return history[history.length - 1].percent;
}
