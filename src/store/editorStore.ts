// ============================================================
// 编辑器状态管理 - editorStore
//
// 负责：
//  - 当前节的富文本内容（contenteditable HTML 缓存）
//  - 文本样式工具栏状态（添加新文本时使用）
//  - 活动样式（光标/选区处 + 用户最近一次切换）
//  - 保存状态（用于底部状态栏提示）
//  - 自动保存（500ms 防抖；写盘成功后才标记为已保存）
// ============================================================

import { create } from 'zustand';
import * as db from '../db/index';
import { useToastStore } from './toastStore';
import { htmlToNGABBCode } from '../utils/ngaHtmlToBBCode';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'failed';

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
  /** 当前节的 BBCode 缓存（与 content 同步写入；null 表示尚未派生） */
  sectionBbcode: string | null;
  sectionLoading: boolean;
  // 正在加载的目标 sectionId：loadSection 期间不清空 sectionId，
  // 仅用 loadingSectionId 标记"目标节"，避免防抖保存失效（race condition 修复）
  loadingSectionId: string | null;

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
  saveError: string | null;
  lastSavedAt: string | null;

  // 加载
  loadSection: (sectionId: string | null) => void;
  /** 清空内存中的正文（作品切换时调用，避免编辑器残留上一作品内容） */
  clearSection: () => void;

  // 新一代富文本内容
  /**
   * 更新正文并触发防抖保存。
   * - bbcode 省略：保存时按 content 派生 BBCode（可视化编辑路径）
   * - bbcode 显式传入：原样写入（BBCode 编辑路径，保留用户原文格式）
   */
  setSectionContent: (content: string, bbcode?: string | null) => void;
  flushSectionContent: () => Promise<boolean>; // 立即写回数据库（例如切换节、退出前）

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

  // 保存状态
  markSaving: () => void;
  markSaved: () => void;
  markFailed: (error: string) => void;
  retryPendingSave: () => Promise<boolean>;

  // 需求5: 快速跳转 — 按节记录滚动位置（跨会话持久化到 localStorage）
  sectionScrollPositions: Record<string, number>;
  setSectionScrollPosition: (sectionId: string, scrollTop: number) => void;
  getSectionScrollPosition: (sectionId: string) => number | undefined;
}

// 防抖保存：500ms 内连续输入会被合并为一次保存
const SAVE_DEBOUNCE_MS = 500;
const SAVE_RETRY_DELAYS_MS = [300, 900];

let debouncedSaveTimer: number | null = null;
let pendingSaveSectionId: string | null = null;
let pendingSaveContent: string | null = null;
// undefined = 保存时按 content 派生；显式值 = 用户 BBCode 原文
let pendingSaveBbcode: string | null | undefined = undefined;
let inFlightSave: Promise<boolean> | null = null;
let lastFailureToastAt = 0;
/** 节加载请求令牌：快速切换节时只有最后一次请求的结果允许落地 */
let loadRequestToken = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e ?? '未知错误');
}

/** 写盘（含重试）。只有真正 resolve 且未返回 false 才算成功。 */
async function persistWithRetry(
  sectionId: string,
  content: string,
  bbcode: string | null,
): Promise<{ ok: boolean; error?: string }> {
  let lastError = '';
  for (let attempt = 0; attempt <= SAVE_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const result: unknown = await db.setSectionContent(sectionId, content, bbcode);
      // 浏览器/IndexedDB 实现失败时会 resolve(false)，必须当作失败处理
      if (result === false) throw new Error('数据库拒绝写入（可能是磁盘空间不足或文件被占用）');
      return { ok: true };
    } catch (e) {
      lastError = errorMessage(e);
      if (attempt < SAVE_RETRY_DELAYS_MS.length) {
        await sleep(SAVE_RETRY_DELAYS_MS[attempt]);
      }
    }
  }
  return { ok: false, error: lastError };
}

/** 只允许一条失败提示，避免连续保存失败时刷屏 */
function notifySaveFailure(message: string): void {
  const now = Date.now();
  if (now - lastFailureToastAt < 10000) return;
  lastFailureToastAt = now;
  useToastStore.getState().showToast(`保存失败：${message}`, 'error', { duration: 0 });
}

async function runPendingSave(): Promise<boolean> {
  if (pendingSaveSectionId === null || pendingSaveContent === null) return true;
  const sectionId = pendingSaveSectionId;
  const content = pendingSaveContent;
  const explicitBbcode = pendingSaveBbcode;
  // 先清空 pending，输入期间产生的新内容会重新填充，避免保存完成后覆盖新内容
  pendingSaveSectionId = null;
  pendingSaveContent = null;
  pendingSaveBbcode = undefined;

  useEditorStore.getState().markSaving();
  // 可视化路径没有显式 BBCode：保存时按即将落盘的 HTML 派生，保证两视图一致
  const bbcode = explicitBbcode !== undefined ? explicitBbcode : htmlToNGABBCode(content);
  const result = await persistWithRetry(sectionId, content, bbcode);

  if (result.ok) {
    // 保存期间没有新输入 → 才标记为已保存
    if (pendingSaveSectionId === null) {
      useEditorStore.setState({ sectionBbcode: bbcode });
      useEditorStore.getState().markSaved();
    }
    return true;
  }

  // 失败：保留这份内容等待重试（若期间已有新内容则保留新的）
  if (pendingSaveSectionId === null) {
    pendingSaveSectionId = sectionId;
    pendingSaveContent = content;
    pendingSaveBbcode = explicitBbcode;
  }
  useEditorStore.getState().markFailed(result.error ?? '未知错误');
  notifySaveFailure(result.error ?? '未知错误');
  return false;
}

function scheduleDebouncedSave(
  sectionId: string,
  content: string,
  bbcode?: string | null,
): void {
  pendingSaveSectionId = sectionId;
  pendingSaveContent = content;
  pendingSaveBbcode = bbcode;
  useEditorStore.setState({ saveStatus: 'pending', saveError: null });
  if (debouncedSaveTimer !== null) {
    window.clearTimeout(debouncedSaveTimer);
  }
  debouncedSaveTimer = window.setTimeout(() => {
    debouncedSaveTimer = null;
    void flushPendingSave();
  }, SAVE_DEBOUNCE_MS);
}

async function flushPendingSave(): Promise<boolean> {
  if (debouncedSaveTimer !== null) {
    window.clearTimeout(debouncedSaveTimer);
    debouncedSaveTimer = null;
  }
  // 已有写入在途时先等它结束，保证顺序（旧内容不会覆盖新内容）
  if (inFlightSave) {
    await inFlightSave;
    if (pendingSaveSectionId === null) return true;
  }
  if (pendingSaveSectionId === null || pendingSaveContent === null) return true;

  const task = runPendingSave();
  inFlightSave = task;
  const ok = await task;
  if (inFlightSave === task) inFlightSave = null;
  return ok;
}

/** 立即写回所有挂起的编辑内容（切换节、退出、关闭窗口前） */
export function flushDebouncedSave(): Promise<boolean> {
  return flushPendingSave();
}

/** 是否存在尚未成功落盘的内容（用于关闭前拦截） */
export function hasPendingSave(): boolean {
  return pendingSaveSectionId !== null || inFlightSave !== null;
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
  sectionBbcode: null,
  sectionLoading: false,
  loadingSectionId: null,
  activeStyles: {},
  cursorStyles: {},
  selectionStats: null,
  activeStylesLocked: false,
  saveStatus: 'idle',
  saveError: null,
  lastSavedAt: null,
  sectionScrollPositions: loadScrollPositions(),

  loadSection: async (sectionId) => {
    const token = ++loadRequestToken;
    await flushPendingSave();
    // 等待 flush 期间又发起了更新的加载 → 放弃本次，避免旧结果覆盖新节
    if (token !== loadRequestToken) return;
    if (!sectionId) {
      set({
        sectionId: null,
        sectionContent: null,
        sectionBbcode: null,
        sectionLoading: false,
        loadingSectionId: null,
        activeStyles: {},
        activeStylesLocked: false,
        selectionStats: null,
      });
      return;
    }
    const cur = get();
    if (cur.sectionId === sectionId) return;
    // 关键修复：不清空 sectionId，只用 loadingSectionId 标记加载中
    // 这样 setSectionContent 的 if(sectionId) 检查仍能触发防抖保存
    set({ loadingSectionId: sectionId, sectionLoading: true });
    const [content, bbcode] = await Promise.all([
      db.getSectionContent(sectionId),
      db.getSectionBBCode(sectionId),
    ]);
    // 仅当仍是当前请求的 section 时才更新状态（防止快速切换覆盖）
    if (token === loadRequestToken && get().loadingSectionId === sectionId) {
      set({
        sectionId,
        sectionContent: content,
        sectionBbcode: bbcode,
        sectionLoading: false,
        loadingSectionId: null,
        activeStyles: {},
        activeStylesLocked: false,
        selectionStats: null,
      });
    }
  },

  clearSection: () =>
    set({
      sectionId: null,
      sectionContent: null,
      sectionBbcode: null,
      sectionLoading: false,
      loadingSectionId: null,
      activeStyles: {},
      activeStylesLocked: false,
      selectionStats: null,
    }),

  setSectionContent: (content, bbcode) => {
    // 更新内存状态 + 防抖保存到数据库（content 与 bbcode 在同一次落盘写入）
    set(bbcode === undefined ? { sectionContent: content } : { sectionContent: content, sectionBbcode: bbcode });
    const { sectionId } = get();
    if (sectionId) {
      scheduleDebouncedSave(sectionId, content, bbcode);
    }
  },

  flushSectionContent: async () => {
    // 若当前内容尚未进入 pending（例如加载后未编辑），直接补一次写入
    const { sectionId, sectionContent, sectionBbcode } = get();
    if (pendingSaveSectionId === null && sectionId && sectionContent != null) {
      scheduleDebouncedSave(sectionId, sectionContent, sectionBbcode ?? undefined);
    }
    return flushPendingSave();
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

  markSaving: () => set({ saveStatus: 'saving', saveError: null }),
  markSaved: () =>
    set({ saveStatus: 'saved', saveError: null, lastSavedAt: new Date().toISOString() }),
  markFailed: (error) => set({ saveStatus: 'failed', saveError: error }),
  retryPendingSave: () => flushPendingSave(),

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
