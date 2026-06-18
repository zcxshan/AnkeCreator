import { create } from 'zustand';

/**
 * 全局图片警告弹窗 store
 * - 任何上传入口（EditorToolbar / TemplatesPage / CharacterEditor / CharacterEditorInline）
 *   都可调用 showImageWarning() 弹窗
 * - LocalImageWarningDialog 在 App 顶层挂一次，订阅 open 状态
 * - resolver 用 Promise.resolve(true/false) 异步通知调用方
 */
interface ImageWarningStore {
  open: boolean;
  resolver: ((confirmed: boolean) => void) | null;
  /** 显示警告弹窗，返回 Promise<boolean>（true = 用户确认继续，false = 用户取消） */
  showImageWarning: () => Promise<boolean>;
  /** 内部：dialog 确认/取消时调用，触发 resolver */
  resolve: (ok: boolean) => void;
}

export const useImageWarningStore = create<ImageWarningStore>((set, get) => ({
  open: false,
  resolver: null,
  showImageWarning: () =>
    new Promise<boolean>((resolve) => {
      set({ open: true, resolver: resolve });
    }),
  resolve: (ok: boolean) => {
    const r = get().resolver;
    if (r) r(ok);
    set({ open: false, resolver: null });
  },
}));
