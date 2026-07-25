// ============================================================
// 编辑器状态管理 - editorStore
//
// 负责：
//  - 当前节的富文本内容（contenteditable HTML 缓存）
//  - 文本样式工具栏状态（添加新文本时使用）
//  - 活动样式（光标/选区处 + 用户最近一次切换）
//  - 保存状态（用于底部状态栏提示）
//  - 用户手动触发保存（不再自动保存）
// ============================================================

import { create } from 'zustand';
import * as db from '../db/index';

type SaveStatus = 'idle' | 'saving' | 'saved';

/**
 * 活动样式（contenteditable 内联编辑用）
 * 记录最近一次切换/光标位置上的样式，下一次输入新文本时自动应用
 */
export interface ActiveEditorStyles {
  color?: string;       // CSS 颜色（含 #hex / rgb(...) / 颜色名）
  fontSize?: string;    // CSS font-size（px/pt/%）
  fontFamily?: string;  // CSS font-family
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  sup?: boolean;        // 上标（与 sub 互斥）
  sub?: boolean;        // 下标（与 sup 互斥）
}

interface EditorState {
  // 当前节（内存缓存）
  sectionId: string | null;
  // 新一代富文本：JSON 字符串（TipTap doc JSON）
  sectionContent: string | null;
  sectionLoading: boolean;

  // 活动样式：选区/光标位置上的样式 + 用户最近一次切换，下一次输入会延续
  activeStyles: ActiveEditorStyles;

  // 光标/选区起点的样式（仅用于工具栏展示，由 RichTextEditor.onSelectionChange 同步）
  // 与 activeStyles 区别：cursorStyles 反映"光标处是什么样"，activeStyles 反映"用户激活的状态"
  cursorStyles: ActiveEditorStyles;

  // 选区字数统计（由 RichTextEditor.onSelectionChange 同步）
  // 非折叠选区时为 { words, dice }，折叠/无选区时为 null
  selectionStats: { words: number; dice: number } | null;

  // 保存状态
  saveStatus: SaveStatus;
  lastSavedAt: string | null;

  // 加载
  loadSection: (sectionId: string | null) => void;

  // 新一代富文本内容
  loadSectionContent: (sectionId: string) => void;
  setSectionContent: (content: string) => void;
  flushSectionContent: () => void; // 立即写回数据库（例如切换节、退出前）

  // 活动样式（contenteditable）
  setActiveStyles: (patch: Partial<ActiveEditorStyles>) => void;
  clearActiveStyles: () => void;
  /**
   * 锁定 activeStyles：锁定后 handleKeyUp/handleMouseUp 不会覆盖 activeStyles，
   * 直到下一次 handleBeforeInput 完成插入后解锁。
   * 用于解决"选颜色B后输入文字仍是颜色A"的问题（keyup 用光标处样式覆盖了用户选择）。
   */
  activeStylesLocked: boolean;
  lockActiveStyles: () => void;
  unlockActiveStyles: () => void;

  // 光标处样式（contenteditable 工具栏展示用）
  setCursorStyles: (patch: Partial<ActiveEditorStyles>) => void;

  // 手动保存
  markSaving: () => void;
  markSaved: () => void;

  // 需求5: 快速跳转 — 按节记录滚动位置（跨会话持久化到 localStorage）
  sectionScrollPositions: Record<string, number>;
  setSectionScrollPosition: (sectionId: string, scrollTop: number) => void;
  getSectionScrollPosition: (sectionId: string) => number | undefined;
}

// 防抖保存：500ms 内连续输入会被合并为一次保存
let debouncedSaveTimer: number | null = null;
let pendingSaveSectionId: string | null = null;
let pendingSaveContent: string | null = null;

function scheduleDebouncedSave(sectionId: string, content: string): void {
  pendingSaveSectionId = sectionId;
  pendingSaveContent = content;
  if (debouncedSaveTimer !== null) {
    window.clearTimeout(debouncedSaveTimer);
  }
  debouncedSaveTimer = window.setTimeout(() => {
    if (pendingSaveSectionId !== null && pendingSaveContent !== null) {
      db.setSectionContent(pendingSaveSectionId, pendingSaveContent).catch(() => {});
      const state = useEditorStore.getState();
      state.markSaved();
    }
    debouncedSaveTimer = null;
    pendingSaveSectionId = null;
    pendingSaveContent = null;
  }, 500);
}

export function flushDebouncedSave(): void {
  if (debouncedSaveTimer !== null) {
    window.clearTimeout(debouncedSaveTimer);
    debouncedSaveTimer = null;
  }
  if (pendingSaveSectionId !== null && pendingSaveContent !== null) {
    db.setSectionContent(pendingSaveSectionId, pendingSaveContent).catch(() => {});
    const state = useEditorStore.getState();
    state.markSaved();
    pendingSaveSectionId = null;
    pendingSaveContent = null;
  }
}

// 需求5: 从 localStorage 读取节滚动位置
const SCROLL_POSITIONS_KEY = 'anke:section-scroll-positions';
function loadScrollPositions(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SCROLL_POSITIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveScrollPositions(positions: Record<string, number>): void {
  try { localStorage.setItem(SCROLL_POSITIONS_KEY, JSON.stringify(positions)); } catch {}
}

export const useEditorStore = create<EditorState>((set, get) => ({
  sectionId: null,
  sectionContent: null,
  sectionLoading: false,
  activeStyles: {},
  cursorStyles: {},
  selectionStats: null,
  activeStylesLocked: false,
  saveStatus: 'idle',
  lastSavedAt: null,
  sectionScrollPositions: loadScrollPositions(),

  loadSection: async (sectionId) => {
    flushDebouncedSave();
    const cur = get();
    if (cur.sectionId && cur.sectionContent != null) {
      await db.setSectionContent(cur.sectionId, cur.sectionContent);
    }
    if (!sectionId) {
      set({ sectionId: null, sectionContent: null, sectionLoading: false, activeStyles: {}, activeStylesLocked: false, selectionStats: null });
      return;
    }
    if (get().sectionId === sectionId) return;
    // 保留旧 sectionContent 供 UI 过渡显示，避免字数跳变为 0
    set({ sectionId: null, sectionLoading: true });
    const content = await db.getSectionContent(sectionId);
    set({ sectionId, sectionContent: content, sectionLoading: false, activeStyles: {}, activeStylesLocked: false, selectionStats: null });
  },

  loadSectionContent: async (sectionId) => {
    if (!sectionId) {
      set({ sectionContent: null, sectionLoading: false });
      return;
    }
    set({ sectionLoading: true });
    const content = await db.getSectionContent(sectionId);
    set({ sectionContent: content, sectionLoading: false });
  },

  setSectionContent: (content) => {
    // 更新内存状态 + 防抖保存到数据库
    set({ sectionContent: content });
    const { sectionId } = get();
    if (sectionId) {
      scheduleDebouncedSave(sectionId, content);
    }
  },

  flushSectionContent: async () => {
    flushDebouncedSave();
    const { sectionId, sectionContent } = get();
    if (!sectionId) return;
    await db.setSectionContent(sectionId, sectionContent);
    get().markSaved();
  },

  setActiveStyles: (patch) =>
    set((state) => ({
      activeStyles: { ...state.activeStyles, ...patch },
    })),

  clearActiveStyles: () => set({ activeStyles: {}, activeStylesLocked: false }),

  lockActiveStyles: () => set({ activeStylesLocked: true }),
  unlockActiveStyles: () => set({ activeStylesLocked: false }),

  setCursorStyles: (patch) =>
    set((state) => ({
      cursorStyles: { ...state.cursorStyles, ...patch },
    })),

  markSaving: () => set({ saveStatus: 'saving' }),
  markSaved: () =>
    set({ saveStatus: 'saved', lastSavedAt: new Date().toISOString() }),

  setSectionScrollPosition: (sectionId, scrollTop) => {
    set((state) => {
      const positions = { ...state.sectionScrollPositions, [sectionId]: scrollTop };
      saveScrollPositions(positions);
      return { sectionScrollPositions: positions };
    });
  },

  getSectionScrollPosition: (sectionId) => {
    return get().sectionScrollPositions[sectionId];
  },
}));
