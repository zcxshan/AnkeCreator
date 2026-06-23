// ============================================================
// 编辑器撤销/重做历史栈（替代 document.execCommand('undo')）
// ------------------------------------------------------------
// 职责：
//   - 维护内容快照栈（past + future + current）
//   - 提供 undo / redo / push / reset 方法
//   - 支持任意类型的内容变化（文本、骰子、折叠块、图片等）
// 设计：
//   - 每次内容变化（debounce 800ms）调用 push(prevContent, newContent)
//   - undo 时把 current 推入 future，从 past 弹一个设为 current
//   - redo 时把 current 推入 past，从 future 弹一个设为 current
//   - 新内容变化清空 future（标准撤销语义）
// ============================================================

import { create } from 'zustand';

const MAX_HISTORY = 50;

export interface EditorHistoryState {
  /** 当前快照 */
  current: string;
  /** 过去的快照（栈顶 = 最近） */
  past: string[];
  /** 未来（已撤销等待重做）的快照（栈顶 = 最近撤销） */
  future: string[];

  /** 初始化/重置历史（章节切换时调用） */
  reset: (content: string) => void;
  /** 推入新快照（仅当与 current 不同时） */
  push: (newContent: string) => void;
  /** 撤销：返回恢复后的内容（null 表示无历史） */
  undo: () => string | null;
  /** 重做：返回恢复后的内容（null 表示无历史） */
  redo: () => string | null;
  /** 是否可撤销 */
  canUndo: () => boolean;
  /** 是否可重做 */
  canRedo: () => boolean;
}

export const useEditorHistoryStore = create<EditorHistoryState>((set, get) => ({
  current: '',
  past: [],
  future: [],

  reset: (content) => {
    set({ current: content, past: [], future: [] });
  },

  push: (newContent) => {
    const state = get();
    if (newContent === state.current) return;
    const newPast = [...state.past, state.current].slice(-MAX_HISTORY);
    set({
      past: newPast,
      future: [], // 任何新编辑清空 redo 栈
      current: newContent,
    });
  },

  undo: () => {
    const state = get();
    if (state.past.length === 0) return null;
    const prev = state.past[state.past.length - 1];
    const newFuture = [state.current, ...state.future].slice(0, MAX_HISTORY);
    set({
      past: state.past.slice(0, -1),
      future: newFuture,
      current: prev,
    });
    return prev;
  },

  redo: () => {
    const state = get();
    if (state.future.length === 0) return null;
    const next = state.future[0];
    const newPast = [...state.past, state.current].slice(-MAX_HISTORY);
    set({
      past: newPast,
      future: state.future.slice(1),
      current: next,
    });
    return next;
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}));
