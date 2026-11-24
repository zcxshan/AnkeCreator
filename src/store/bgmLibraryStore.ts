// ============================================================
// BGM 资源库（仅 URL 添加）
//
// BGM 只有「URL + 名称」两个信息，无需落库到 SQLite；用 localStorage
// 持久化即可跨会话保留。相对地址（./mon_xxx）会按「NGA url 头部」
// 补全为可播放 URL，同时保留原文用于导出 BBCode。
// ============================================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { expandNgaUrl } from '../utils/ngaUrl';

export interface BgmItem {
  id: string;
  name: string;
  /** 可直接播放的完整 URL */
  url: string;
  /** 用户输入的原始地址（相对地址用于 BBCode 回写） */
  raw?: string;
  createdAt: number;
}

interface BgmState {
  items: BgmItem[];
  addByUrl: (name: string, url: string) => { ok: boolean; error?: string };
  remove: (id: string) => void;
  clear: () => void;
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `bgm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 支持 http(s) 绝对地址，或 NGA 相对地址（./mon_xxx / mon_xxx） */
export function isValidBgmUrl(url: string): boolean {
  const value = url.trim();
  if (!value) return false;
  if (/^https?:\/\/\S+$/i.test(value)) return true;
  return /^\.?\/(?:mon_|attachments\/)/i.test(value) || /^mon_[^\s]+$/i.test(value);
}

function deriveName(url: string): string {
  const clean = url.split('?')[0].split('/').filter(Boolean).pop() ?? 'BGM';
  return decodeURIComponent(clean);
}

export const useBgmLibraryStore = create<BgmState>()(
  persist(
    (set, get) => ({
      items: [],
      addByUrl: (name, url) => {
        const raw = url.trim();
        if (!isValidBgmUrl(raw)) {
          return { ok: false, error: '请输入 http(s):// 或 ./mon_ 开头的音频地址' };
        }
        const full = expandNgaUrl(raw);
        const finalName = name.trim() || deriveName(raw);
        if (get().items.some((item) => item.url === full)) {
          return { ok: false, error: '该 BGM 已在资源库中' };
        }
        const item: BgmItem = {
          id: createId(),
          name: finalName,
          url: full,
          raw: full === raw ? undefined : raw,
          createdAt: Date.now(),
        };
        set((state) => ({ items: [...state.items, item] }));
        return { ok: true };
      },
      remove: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
      clear: () => set({ items: [] }),
    }),
    { name: 'anke-bgm-library', version: 1 },
  ),
);
