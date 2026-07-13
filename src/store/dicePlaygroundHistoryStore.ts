// ============================================================
// 玩骰子页面的历史记录 store
// ------------------------------------------------------------
// 独立于作品级 diceHistoryStore（那个是按 storyId 关联的）
// 这里存的是「玩骰子」页面（不绑定任何作品）的投掷历史
// 用 zustand persist 持久化到 localStorage，
// 用户不点清空就一直保留（与作品级骰子记录一致）
// ============================================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PlaygroundRollEntry {
  id: string;
  expr: string;
  total: number;
  detail: string;
  allRolls: number[];
  timestamp: number;
}

interface PlaygroundHistoryState {
  history: PlaygroundRollEntry[];
  /** 添加一条记录（FIFO，最多 100 条） */
  add: (e: PlaygroundRollEntry) => void;
  /** 清空所有历史 */
  clear: () => void;
  /** 替换整个 history（用于导入/迁移） */
  replace: (history: PlaygroundRollEntry[]) => void;
}

function genId(): string {
  return `ph_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useDicePlaygroundHistoryStore = create<PlaygroundHistoryState>()(
  persist(
    (set, get) => ({
      history: [],
      add: (e) => {
        const next = [
          { ...e, id: e.id || genId() },
          ...get().history,
        ].slice(0, 100);
        set({ history: next });
      },
      clear: () => set({ history: [] }),
      replace: (history) => set({ history: history.slice(0, 100) }),
    }),
    {
      name: 'anke-creator-dice-playground-history',
      version: 1,
    },
  ),
);
