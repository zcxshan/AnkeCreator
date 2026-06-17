// ============================================================
// Toast 提示消息状态管理 - toastStore
//
// 负责：
//  - 管理全局 Toast 消息队列
//  - 支持 success / error / warning / info 四种类型
//  - 支持 undo 按钮回调（用于删除撤销等场景）
//
// 使用方式：
//   const { showToast, hideToast } = useToastStore();
//   const id = showToast('已保存', 'success');
//   showToast('已删除', 'info', { undo: () => restore() });
// ============================================================

import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number; // ms, 0 = 不自动消失
  undo?: () => void;
}

interface ToastState {
  toasts: Toast[];
  showToast: (
    message: string,
    type?: ToastType,
    options?: { duration?: number; undo?: () => void }
  ) => string;
  hideToast: (id: string) => void;
  clearToasts: () => void;
}

const MAX_VISIBLE_TOASTS = 3;
const DEFAULT_DURATION = 3000;
const UNDO_DURATION = 5000;

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  showToast: (message, type = 'info', options = {}) => {
    const id = genId();
    let duration = options.duration;
    if (duration === undefined) {
      duration = options.undo ? UNDO_DURATION : DEFAULT_DURATION;
    }
    const newToast: Toast = {
      id,
      message,
      type,
      duration,
      undo: options.undo,
    };
    const current = get().toasts;
    const next = [...current, newToast];
    if (next.length > MAX_VISIBLE_TOASTS) {
      next.splice(0, next.length - MAX_VISIBLE_TOASTS);
    }
    set({ toasts: next });
    return id;
  },

  hideToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  clearToasts: () => set({ toasts: [] }),
}));
