/**
 * 批注框草稿存储（issue #17）。
 *
 * 用户在批注框输入过程中误触 Esc / 遮罩导致 Modal 关闭时，未提交的文本
 * 会暂存到这里；下次打开同一批注（新建按 CFI、编辑按注释 id 作 key）
 * 时可恢复。直接用 localStorage 而非内存 Map，插件重载后草稿仍在。
 */
/* global window: readonly -- eslint 配置未开 browser globals，草稿存 localStorage 需要显式声明 window */

export interface NoteDraftSnapshot {
  note: string;
  color: string;
  noteType: string;
}

/** 决定草稿如何呈现：新建批注自动恢复；编辑批注只提供恢复入口，不覆盖原文 */
export type DraftAction = "auto-restore" | "recover" | null;

const DRAFT_STORE_KEY = "ob-epub:note-drafts";
const MAX_DRAFTS = 20;

/** localStorage 不可用（如被禁用/测试环境）时的内存兜底 */
let memoryFallback: Record<string, string> | null = null;

interface MinimalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getStore(): MinimalStorage {
  try {
    const ls = window.localStorage;
    // Node 22 的实验性 localStorage 访问才抛错，用一次探针真实触发
    const probe = "__ob_epub_probe__";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    if (!memoryFallback) memoryFallback = {};
    return {
      getItem: (key) => memoryFallback?.[key] ?? null,
      setItem: (key, value) => {
        memoryFallback![key] = value;
      },
      removeItem: (key) => {
        delete memoryFallback![key];
      },
    };
  }
}

function readDrafts(): Record<string, NoteDraftSnapshot> {
  try {
    const raw = getStore().getItem(DRAFT_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, NoteDraftSnapshot>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDrafts(drafts: Record<string, NoteDraftSnapshot>): void {
  try {
    // 超出上限时按插入顺序丢弃最旧的草稿，避免无限增长
    const keys = Object.keys(drafts);
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_DRAFTS))) {
      delete drafts[key];
    }
    getStore().setItem(DRAFT_STORE_KEY, JSON.stringify(drafts));
  } catch {
    /* 存储不可用时草稿降级为无操作，不影响正常输入 */
  }
}

export function saveNoteDraft(key: string, snapshot: NoteDraftSnapshot): void {
  const drafts = readDrafts();
  drafts[key] = snapshot;
  writeDrafts(drafts);
}

export function getNoteDraft(key: string): NoteDraftSnapshot | null {
  return readDrafts()[key] ?? null;
}

export function clearNoteDraft(key: string): void {
  const drafts = readDrafts();
  if (key in drafts) {
    delete drafts[key];
    writeDrafts(drafts);
  }
}

export function clearAllNoteDrafts(): void {
  writeDrafts({});
}

/**
 * 打开批注框时决定草稿的呈现方式：
 * - "auto-restore"：新建批注（无预填文本）→ 草稿直接填入输入框并显示提示条
 * - "recover"：编辑已有批注（预填文本与草稿不同）→ 保留原文，提供一键恢复
 * - null：无草稿，或草稿与预填内容一致（例如取消后原样重开）
 */
export function resolveDraftAction(
  prefilledNote: string,
  draft: NoteDraftSnapshot | null
): DraftAction {
  if (!draft || !draft.note) return null;
  if (!prefilledNote) return "auto-restore";
  return draft.note !== prefilledNote ? "recover" : null;
}
