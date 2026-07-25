// ============================================================
// 骰子状态管理 - diceStore
// ------------------------------------------------------------
// 职责：
//   - 创建 / 编辑 骰子配置（选项/数值）
//   - 投掷骰子并得到 DiceResult
//   - 管理 DiceBlockPayloadV2 的创建与升级
//   - 将旧版 DiceBlockPayload 升级到 DiceBlockPayloadV2
// ============================================================

import { create } from 'zustand';
import type {
  DiceBlockPayload,
  DiceBlockPayloadV2,
  DiceConfig,
  DiceOptionValue,
  DiceResult,
  DiceKind,
  DiceTextStyle,
  DiceStyleConfig,
} from '../types';
import {
  createDefaultNumericDice,
  createDefaultOptionDice,
  createOptionId,
  parseValueExpression,
  rollDice,
  validateOptionCoverage,
} from '../utils/diceEngine';

export { createDefaultNumericDice, createDefaultOptionDice };

// ---------- payload 版本升级 ----------

export function isV2Payload(
  payload: DiceBlockPayload | DiceBlockPayloadV2,
): payload is DiceBlockPayloadV2 {
  return (
    !!payload &&
    typeof payload === 'object' &&
    'version' in payload &&
    (payload as DiceBlockPayloadV2).version === 2
  );
}

/** 把旧版 payload 升级到 V2 */
export function upgradeToV2(
  payload: DiceBlockPayload | DiceBlockPayloadV2,
): DiceBlockPayloadV2 {
  if (isV2Payload(payload)) return payload;

  const legacy = payload as DiceBlockPayload;
  const faces =
    legacy.dice_type === '1d2' ? 2 : legacy.dice_type === '1d10' ? 10 : 100;
  const options: DiceOptionValue[] = (legacy.options || []).map((o) => {
    const values: number[] = [];
    const lo = Math.min(o.range_start, o.range_end);
    const hi = Math.max(o.range_start, o.range_end);
    for (let v = lo; v <= hi; v++) values.push(v);
    const displayValue =
      o.range_start === o.range_end
        ? String(o.range_start)
        : `${o.range_start}-${o.range_end}`;
    return {
      id: o.id || createOptionId(),
      values,
      displayValue,
      content: o.content,
    };
  });

  const config: DiceConfig = {
    id: Math.random().toString(36).slice(2, 10),
    kind: 'option',
    name: `D${faces} 骰点`,
    faces,
    options,
  };

  return {
    version: 2,
    config,
    lastResult:
      typeof legacy.last_roll === 'number'
        ? {
            configId: config.id,
            kind: 'option',
            rolls: [legacy.last_roll],
            total: legacy.last_roll,
            modifier: 0,
            displayText: `[1D${faces}=${legacy.last_roll}]`,
            hitOptionId:
              options.find((o) => o.values.includes(legacy.last_roll as number))
                ?.id ?? null,
            timestamp: Date.now(),
          }
        : null,
    history: [],
  };
}

// ---------- store ----------

interface DialogState {
  open: boolean;
  /** 正在编辑的配置（可能来自已有 block 的 config 拷贝） */
  draft: DiceConfig | null;
  /** 关联的内容块 id：非空时保存会回填到该内容块 */
  targetBlockId: string | null;
  /** 新建/编辑的默认类型 */
  initialKind: DiceKind;
  /** 需求4:编辑已有骰子时保存的原始 payload(用于保留 lastResult/history/style) */
  originalPayload?: DiceBlockPayloadV2 | null;
  /** 需求4:样式草稿 */
  styleDraft: DiceStyleConfig;
}

interface DiceStoreState {
  // 配置弹窗状态
  dialog: DialogState;

  // ---- 弹窗动作 ----
  openDialog: (opts?: {
    draft?: DiceConfig;
    targetBlockId?: string;
    initialKind?: DiceKind;
    /** 需求4:编辑已有骰子时传入原始 payload,用于保留 lastResult/history 并回填 style */
    originalPayload?: DiceBlockPayloadV2;
    /**
     * 从外部传入的选项列表（如 NGA 安价文本解析结果）
     * - 若提供，则忽略 draft，按 initialOptions 构建新 draft
     * - faces 自动设为 options.length
     * - kind 强制设为 'option'
     */
    initialOptions?: { displayValue: string; content: string }[];
  }) => void;
  closeDialog: () => void;
  setDraft: (draft: DiceConfig) => void;

  // ---- 需求4:样式草稿编辑 ----
  /** 设置某类文本的样式字段 */
  setStyleDraft: (category: 'resultText' | 'selectedOption' | 'unselectedOption', patch: Partial<DiceTextStyle>) => void;
  /** 重置某类文本的样式(或全部) */
  resetStyleDraft: (category?: 'resultText' | 'selectedOption' | 'unselectedOption') => void;

  // ---- 针对 draft 的字段级编辑 ----
  setDraftName: (name: string) => void;
  setDraftKind: (kind: DiceKind) => void;

  // 选项骰子字段
  setDraftFaces: (faces: number) => void;
  addDraftOption: () => void;
  removeDraftOption: (optionId: string) => void;
  updateDraftOption: (
    optionId: string,
    patch: Partial<Omit<DiceOptionValue, 'id'>>,
  ) => void;

  // 数值骰子字段
  setDraftCount: (count: number) => void;
  setDraftNumericFaces: (faces: number) => void;
  setDraftModifier: (modifier: number) => void;
  setDraftExpression: (expression: string) => void;

  // ---- 校验 ----
  validateDraftCoverage: () => { ok: boolean; missing: number[]; overlaps: number[] } | null;

  // ---- 针对内容块的操作（由 editorStore 桥接） ----
  /** 对某个 DiceBlockPayloadV2 执行掷骰，返回新的 payload */
  rollOnPayload: (payload: DiceBlockPayloadV2) => DiceBlockPayloadV2;
}

function initialDialog(): DialogState {
  return {
    open: false,
    draft: null,
    targetBlockId: null,
    initialKind: 'option',
    originalPayload: null,
    styleDraft: {},
  };
}

export const useDiceStore = create<DiceStoreState>((set, get) => ({
  dialog: initialDialog(),

  openDialog: (opts) => {
    // 优先级：initialOptions > draft > 默认
    let baseDraft: DiceConfig;
    if (opts?.initialOptions && opts.initialOptions.length > 0) {
      // 从 NGA 文本导入：构建选项骰子 draft
      const incoming = opts.initialOptions;
      const options: DiceOptionValue[] = incoming.map((o) => ({
        id: createOptionId(),
        values: parseValueExpression(o.displayValue),
        displayValue: o.displayValue,
        content: o.content,
      }));
      baseDraft = {
        id: Math.random().toString(36).slice(2, 10),
        kind: 'option',
        name: '安价选项',
        faces: incoming.length,
        options,
      };
    } else if (opts?.draft) {
      baseDraft = JSON.parse(JSON.stringify(opts.draft));
    } else {
      const kind = opts?.initialKind || 'option';
      baseDraft =
        kind === 'numeric' ? createDefaultNumericDice() : createDefaultOptionDice();
    }
    const kind = opts?.initialKind || 'option';
    const originalPayload = opts?.originalPayload ?? null;
    set({
      dialog: {
        open: true,
        draft: baseDraft,
        targetBlockId: opts?.targetBlockId ?? null,
        initialKind: kind,
        originalPayload,
        styleDraft: originalPayload?.style
          ? JSON.parse(JSON.stringify(originalPayload.style))
          : {},
      },
    });
  },

  closeDialog: () =>
    set((s) => ({
      dialog: { ...s.dialog, open: false },
    })),

  setDraft: (draft) => set((s) => ({ dialog: { ...s.dialog, draft } })),

  setStyleDraft: (category, patch) => {
    set((state) => {
      const cur = state.dialog.styleDraft[category] ?? {};
      return {
        dialog: {
          ...state.dialog,
          styleDraft: {
            ...state.dialog.styleDraft,
            [category]: { ...cur, ...patch },
          },
        },
      };
    });
  },

  resetStyleDraft: (category) => {
    set((state) => {
      if (!category) return { dialog: { ...state.dialog, styleDraft: {} } };
      const next = { ...state.dialog.styleDraft };
      delete next[category];
      return { dialog: { ...state.dialog, styleDraft: next } };
    });
  },

  setDraftName: (name) =>
    set((s) => {
      if (!s.dialog.draft) return {};
      return { dialog: { ...s.dialog, draft: { ...s.dialog.draft, name } } };
    }),

  setDraftKind: (kind) =>
    set((s) => {
      const current = s.dialog.draft;
      if (!current) return {};
      if (current.kind === kind) return {};
      const base: DiceConfig = {
        id: current.id,
        kind,
        name: current.name,
      };
      const next: DiceConfig =
        kind === 'numeric'
          ? { ...base, count: 1, numericFaces: 100, modifier: 0 }
          : { ...base, faces: 2, options: [
              { id: createOptionId(), displayValue: '1', values: [1], content: '否' },
              { id: createOptionId(), displayValue: '2', values: [2], content: '是' },
            ] };
      return { dialog: { ...s.dialog, draft: next } };
    }),

  setDraftFaces: (faces) =>
    set((s) => {
      if (!s.dialog.draft) return {};
      const next: DiceConfig = { ...s.dialog.draft, faces: Math.max(1, Math.floor(faces)) };
      return { dialog: { ...s.dialog, draft: next } };
    }),

  addDraftOption: () =>
    set((s) => {
      if (!s.dialog.draft) return {};
      const current = s.dialog.draft;
      const faces = current.faces ?? 2;
      const options = current.options ?? [];
      const nextOpt: DiceOptionValue = {
        id: createOptionId(),
        displayValue: String(faces),
        values: [faces],
        content: '新选项',
      };
      const next: DiceConfig = { ...current, options: [...options, nextOpt] };
      return { dialog: { ...s.dialog, draft: next } };
    }),

  removeDraftOption: (optionId) =>
    set((s) => {
      if (!s.dialog.draft) return {};
      const current = s.dialog.draft;
      const options = (current.options ?? []).filter((o) => o.id !== optionId);
      return {
        dialog: {
          ...s.dialog,
          draft: { ...current, options },
        },
      };
    }),

  updateDraftOption: (optionId, patch) =>
    set((s) => {
      if (!s.dialog.draft) return {};
      const current = s.dialog.draft;
      const options = (current.options ?? []).map((o) => {
        if (o.id !== optionId) return o;
        const merged: DiceOptionValue = { ...o, ...patch };
        // 若用户修改了 displayValue，重新解析值
        if (patch.displayValue !== undefined) {
          merged.values = parseValueExpression(patch.displayValue);
        }
        return merged;
      });
      return {
        dialog: {
          ...s.dialog,
          draft: { ...current, options },
        },
      };
    }),

  setDraftCount: (count) =>
    set((s) => {
      if (!s.dialog.draft) return {};
      return {
        dialog: {
          ...s.dialog,
          draft: { ...s.dialog.draft, count: Math.max(1, Math.floor(count)) },
        },
      };
    }),

  setDraftNumericFaces: (faces) =>
    set((s) => {
      if (!s.dialog.draft) return {};
      return {
        dialog: {
          ...s.dialog,
          draft: { ...s.dialog.draft, numericFaces: Math.max(1, Math.floor(faces)) },
        },
      };
    }),

  setDraftModifier: (modifier) =>
    set((s) => {
      if (!s.dialog.draft) return {};
      return {
        dialog: {
          ...s.dialog,
          draft: { ...s.dialog.draft, modifier: Math.floor(modifier) },
        },
      };
    }),

  setDraftExpression: (expression) =>
    set((s) => {
      if (!s.dialog.draft) return {};
      return {
        dialog: {
          ...s.dialog,
          draft: { ...s.dialog.draft, expression },
        },
      };
    }),

  validateDraftCoverage: () => {
    const draft = get().dialog.draft;
    if (!draft || draft.kind !== 'option') return null;
    return validateOptionCoverage(draft.options ?? [], draft.faces ?? 2);
  },

  rollOnPayload: (payload) => {
    if (!isV2Payload(payload)) {
      const v2 = upgradeToV2(payload);
      return get().rollOnPayload(v2);
    }
    const result: DiceResult = rollDice(payload.config);
    const history = payload.history ? [...payload.history, result].slice(-20) : [result];
    return { ...payload, lastResult: result, history };
  },
}));
