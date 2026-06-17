// 安价抓取历史
// - 持久化到 localStorage
// - 上限 10 条，超出时移除最旧
// - 单条 items 截断到 100 条（防止 localStorage 超限）
import type { AnjiaItem } from './ngaCrawler';

export interface AnjiaHistoryEntry {
  id: string;
  url: string;
  startFloor: number;
  endFloor: number;
  prefix: string;
  items: AnjiaItem[];
  createdAt: number;
  label: string;
}

export type AnjiaHistoryDraft = Omit<AnjiaHistoryEntry, 'id' | 'createdAt' | 'label'>;

const KEY = 'anjia-history';
const MAX_ENTRIES = 10;
const MAX_ITEMS_PER_ENTRY = 100;

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function buildLabel(url: string, startFloor: number, endFloor: number, prefix: string): string {
  // 从 URL 提取 tid
  const tidMatch = url.match(/[?&]tid=(\d+)/i);
  const tid = tidMatch ? tidMatch[1] : '???';
  const range = startFloor === endFloor ? `${startFloor}楼` : `${startFloor}-${endFloor}楼`;
  const prefixPart = prefix ? ` · ${prefix}` : '';
  return `tid=${tid} · ${range}${prefixPart}`;
}

export function loadHistory(): AnjiaHistoryEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data as AnjiaHistoryEntry[];
  } catch (e) {
    console.warn('[anjiaHistory] 加载历史失败：', e);
    return [];
  }
}

function persist(entries: AnjiaHistoryEntry[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
  } catch (e) {
    console.warn('[anjiaHistory] 保存历史失败（容量超限？）：', e);
  }
}

export function saveToHistory(draft: AnjiaHistoryDraft): AnjiaHistoryEntry {
  const list = loadHistory();
  // 截断 items
  const items = draft.items.slice(0, MAX_ITEMS_PER_ENTRY);
  const entry: AnjiaHistoryEntry = {
    id: genId(),
    url: draft.url,
    startFloor: draft.startFloor,
    endFloor: draft.endFloor,
    prefix: draft.prefix,
    items,
    createdAt: Date.now(),
    label: buildLabel(draft.url, draft.startFloor, draft.endFloor, draft.prefix),
  };
  // 新条目放到最前
  const next = [entry, ...list].slice(0, MAX_ENTRIES);
  persist(next);
  return entry;
}

export function deleteFromHistory(id: string): void {
  const list = loadHistory();
  const next = list.filter((e) => e.id !== id);
  persist(next);
}

export function clearHistory(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(KEY);
  } catch (e) {
    console.warn('[anjiaHistory] 清除历史失败：', e);
  }
}

/** 把时间戳格式化为"YYYY-MM-DD HH:mm" */
export function formatHistoryTime(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}
