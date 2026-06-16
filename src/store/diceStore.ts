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
}

interface DiceStoreState {
  // 配置弹窗状态
  dialog: DialogState;

  // ---- 弹窗动作 ----
  openDialog: (opts?: {
    draft?: DiceConfig;
    targetBlockId?: string;
    initialKind?: DiceKind;
  }) => void;
  closeDialog: () => void;
  setDraft: (draft: DiceConfig) => void;

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
  };
}

export const useDiceStore = create<DiceStoreState>((set, get) => ({
  dialog: initialDialog(),

  openDialog: (opts) => {
    const kind = opts?.initialKind || 'option';
    const defaultDraft =
      kind === 'numeric' ? createDefaultNumericDice() : createDefaultOptionDice();
    set({
      dialog: {
        open: true,
        draft: opts?.draft ? JSON.parse(JSON.stringify(opts.draft)) : defaultDraft,
        targetBlockId: opts?.targetBlockId ?? null,
        initialKind: kind,
      },
    });
  },

  closeDialog: () =>
    set((s) => ({
      dialog: { ...s.dialog, open: false },
    })),

  setDraft: (draft) => set((s) => ({ dialog: { ...s.dialog, draft } })),

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
        name: current.name || (kind === 'numeric' ? '数值骰点' : '选项骰点'),
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
