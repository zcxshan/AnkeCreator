// ============================================================
// 编辑器状态管理 - editorStore
//
// 负责：
//  - 当前节的内容块列表（缓存）
//  - 选中的内容块
//  - 文本样式工具栏状态（当添加新文本块时使用）
//  - 保存状态（用于底部状态栏提示）
//  - 用户手动触发保存（不再自动保存）
// ============================================================

import { create } from 'zustand';
import type {
  AnyContentBlock,
  TextBlockPayload,
  ImageBlockPayload,
  DiceBlockPayload,
  DiceBlockPayloadV2,
  TextStyles,
  DiceType,
} from '../types';
import * as db from '../db/database';

type SaveStatus = 'idle' | 'saving' | 'saved';

interface EditorState {
  // 当前节（内存缓存）
  sectionId: string | null;
  // 旧的内容块（保留用于兼容）
  blocks: AnyContentBlock[];
  selectedBlockId: string | null;

  // 新一代富文本：JSON 字符串（TipTap doc JSON）
  sectionContent: string | null;

  // 文本样式工具栏状态（用于新块 & 选中块的样式）
  toolbarStyles: TextStyles;

  // 保存状态
  saveStatus: SaveStatus;
  lastSavedAt: string | null;

  // 加载
  loadSection: (sectionId: string | null) => void;

  // 新一代富文本内容
  loadSectionContent: (sectionId: string) => void;
  setSectionContent: (content: string) => void;
  flushSectionContent: () => void; // 立即写回数据库（例如切换节、退出前）

  // 块操作（操作本身立刻写入数据库；不再触发自动保存）
  addTextBlock: (text?: string) => void;
  addImageBlock: (src: string) => void;
  addDiceBlock: (diceType: DiceType) => void;
  addDiceBlockV2: (payload: DiceBlockPayloadV2) => void;
  updateBlockPayload: (blockId: string, payload: unknown) => void;
  deleteBlock: (blockId: string) => void;
  reorderBlocks: (orderedIds: string[]) => void;

  // 选中
  setSelectedBlock: (blockId: string | null) => void;

  // 工具栏
  setToolbarStyle: (patch: Partial<TextStyles>) => void;
  resetToolbar: () => void;

  // 手动保存
  markSaving: () => void;
  markSaved: () => void;

  // 骰点
  rollDice: (blockId: string) => void;
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
      db.setSectionContent(pendingSaveSectionId, pendingSaveContent);
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
    db.setSectionContent(pendingSaveSectionId, pendingSaveContent);
    const state = useEditorStore.getState();
    state.markSaved();
    pendingSaveSectionId = null;
    pendingSaveContent = null;
  }
}

function defaultDiceOptions(type: DiceType): { range_start: number; range_end: number; content: string; id: string }[] {
  const id = () => Math.random().toString(36).slice(2, 10);
  if (type === '1d2') {
    return [
      { id: id(), range_start: 1, range_end: 1, content: '否' },
      { id: id(), range_start: 2, range_end: 2, content: '是' },
    ];
  }
  if (type === '1d10') {
    return [
      { id: id(), range_start: 1, range_end: 3, content: '选项A' },
      { id: id(), range_start: 4, range_end: 6, content: '选项B' },
      { id: id(), range_start: 7, range_end: 9, content: '选项C' },
      { id: id(), range_start: 10, range_end: 10, content: '大成功' },
    ];
  }
  return [
    { id: id(), range_start: 1, range_end: 25, content: '选项A' },
    { id: id(), range_start: 26, range_end: 50, content: '选项B' },
    { id: id(), range_start: 51, range_end: 75, content: '选项C' },
    { id: id(), range_start: 76, range_end: 100, content: '选项D' },
  ];
}

export const useEditorStore = create<EditorState>((set, get) => ({
  sectionId: null,
  blocks: [],
  selectedBlockId: null,
  sectionContent: null,
  // 默认工具栏样式：Word 风格的宋体 + 小四(12pt)
  toolbarStyles: {
    size: 12,
    font: 'simsun',
  },
  saveStatus: 'idle',
  lastSavedAt: null,

  loadSection: (sectionId) => {
    // 切换节之前：先把挂起的防抖保存 flush 到数据库
    flushDebouncedSave();
    // 再把当前节的内存 content 写回数据库（兜底）
    const cur = get();
    if (cur.sectionId && cur.sectionContent != null) {
      db.setSectionContent(cur.sectionId, cur.sectionContent);
    }
    if (!sectionId) {
      set({ sectionId: null, blocks: [], selectedBlockId: null, sectionContent: null });
      return;
    }
    if (get().sectionId === sectionId) return;
    const blocks = db.listBlocks(sectionId);
    const content = db.getSectionContent(sectionId);
    set({
      sectionId,
      blocks,
      sectionContent: content,
      selectedBlockId: blocks.length > 0 ? blocks[0].id : null,
    });
  },

  loadSectionContent: (sectionId) => {
    if (!sectionId) {
      set({ sectionContent: null });
      return;
    }
    const content = db.getSectionContent(sectionId);
    set({ sectionContent: content });
  },

  setSectionContent: (content) => {
    // 更新内存状态 + 防抖保存到数据库
    set({ sectionContent: content });
    const { sectionId } = get();
    if (sectionId) {
      scheduleDebouncedSave(sectionId, content);
    }
  },

  flushSectionContent: () => {
    flushDebouncedSave();
    const { sectionId, sectionContent } = get();
    if (!sectionId) return;
    db.setSectionContent(sectionId, sectionContent);
    get().markSaved();
  },

  addTextBlock: (text = '') => {
    const { sectionId } = get();
    if (!sectionId) return;
    const payload: TextBlockPayload = {
      text,
      styles: { ...get().toolbarStyles },
    };
    const block = db.createTextBlock(sectionId, payload);
    set((state) => ({
      blocks: [...state.blocks, block].sort((a, b) => a.order_index - b.order_index),
      selectedBlockId: block.id,
    }));
  },

  addImageBlock: (src) => {
    const { sectionId } = get();
    if (!sectionId) return;
    const payload: ImageBlockPayload = { src };
    const block = db.createImageBlock(sectionId, payload);
    set((state) => ({
      blocks: [...state.blocks, block].sort((a, b) => a.order_index - b.order_index),
      selectedBlockId: block.id,
    }));
  },

  addDiceBlock: (diceType) => {
    const { sectionId } = get();
    if (!sectionId) return;
    const payload: DiceBlockPayload = {
      dice_type: diceType,
      last_roll: null,
      options: defaultDiceOptions(diceType),
    };
    const block = db.createDiceBlock(sectionId, payload);
    set((state) => ({
      blocks: [...state.blocks, block].sort((a, b) => a.order_index - b.order_index),
      selectedBlockId: block.id,
    }));
  },

  // —— 新一代骰子：通过 V2 payload 创建骰子块 ——
  addDiceBlockV2: (payload) => {
    const { sectionId } = get();
    if (!sectionId) return;
    const block = db.createDiceBlock(sectionId, payload);
    set((state) => ({
      blocks: [...state.blocks, block].sort((a, b) => a.order_index - b.order_index),
      selectedBlockId: block.id,
    }));
  },

  updateBlockPayload: (blockId, payload) => {
    db.updateBlockPayload(blockId, payload);
    set((state) => ({
      blocks: state.blocks.map((b) =>
        b.id === blockId ? ({ ...b, payload } as AnyContentBlock) : b,
      ),
    }));
  },

  deleteBlock: (blockId) => {
    db.deleteBlock(blockId);
    set((state) => ({
      blocks: state.blocks.filter((b) => b.id !== blockId),
      selectedBlockId: state.selectedBlockId === blockId ? null : state.selectedBlockId,
    }));
  },

  reorderBlocks: (orderedIds) => {
    const { sectionId } = get();
    if (!sectionId) return;
    db.reorderBlocks(sectionId, orderedIds);
    set((state) => {
      const orderMap: Record<string, number> = {};
      orderedIds.forEach((id, i) => (orderMap[id] = i));
      return {
        blocks: state.blocks
          .slice()
          .sort((a, b) => (orderMap[a.id] ?? 0) - (orderMap[b.id] ?? 0))
          .map((b, i) => ({ ...b, order_index: i })),
      };
    });
  },

  setSelectedBlock: (blockId) => set({ selectedBlockId: blockId }),

  setToolbarStyle: (patch) =>
    set((state) => ({
      toolbarStyles: { ...state.toolbarStyles, ...patch },
    })),

  resetToolbar: () =>
    set({
      toolbarStyles: {
        size: 12,
        font: 'simsun',
      },
    }),

  markSaving: () => set({ saveStatus: 'saving' }),
  markSaved: () =>
    set({ saveStatus: 'saved', lastSavedAt: new Date().toISOString() }),

  rollDice: (blockId) => {
    const block = get().blocks.find((b) => b.id === blockId);
    if (!block || block.type !== 'dice') return;
    const payload = block.payload as DiceBlockPayload;
    const max =
      payload.dice_type === '1d2' ? 2 : payload.dice_type === '1d10' ? 10 : 100;
    const value = Math.floor(Math.random() * max) + 1;
    const nextPayload: DiceBlockPayload = { ...payload, last_roll: value };
    get().updateBlockPayload(blockId, nextPayload);
  },
}));

// 默认样式：Word 风格的宋体 + 小四(12pt)
export const DEFAULT_TEXT_STYLES: TextStyles = {
  bold: false,
  italic: false,
  underline: false,
  size: 12,
  font: 'simsun',
};

export function useSelectedBlock(): AnyContentBlock | null {
  const { blocks, selectedBlockId } = useEditorStore();
  if (!selectedBlockId) return null;
  return blocks.find((b) => b.id === selectedBlockId) ?? null;
}
