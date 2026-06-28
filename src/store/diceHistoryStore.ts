import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface DiceHistoryRecord {
  id: string;
  timestamp: number;
  storyId: string;            // 所属 storyId；旧数据/未关联时为空串
  diceName: string;
  diceType: string;          // e.g. "1d10" / "选项骰(10面)"
  result: string;            // 简短结果，如 "D10 = 8" 或 "3D6=2+5+3=10"
  resultDetail: string;      // 详细结果（例如命中了哪个选项 / 修饰符）
  sectionId: string;
  sectionTitle: string;
  payloadSnapshot: string;   // 掷骰后完整 data-payload JSON 字符串，供定位卡片
}

interface DiceHistoryState {
  records: DiceHistoryRecord[];
  addRecord: (r: DiceHistoryRecord) => void;
  /** 批量添加记录（导入用），超过 200 条时 FIFO 淘汰最旧的 */
  addRecords: (records: DiceHistoryRecord[]) => void;
  clearAll: () => void;
  removeRecord: (id: string) => void;
  /** 删除指定 story 的所有记录（删除作品时级联清理） */
  clearByStory: (storyId: string) => void;
  /** 按 storyId 过滤记录；找不到或 storyId 为空时返回空数组 */
  getRecordsByStory: (storyId: string) => DiceHistoryRecord[];
}

function genId(): string {
  return `dhr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useDiceHistoryStore = create<DiceHistoryState>()(
  persist(
    (set, get) => ({
      records: [],
      addRecord: (r) => {
        const next = [
          { ...r, id: r.id || genId() },
          ...get().records,
        ].slice(0, 200);
        set({ records: next });
      },
      addRecords: (incoming) => {
        if (!Array.isArray(incoming) || incoming.length === 0) return;
        const normalized = incoming.map((r) => ({ ...r, id: r.id || genId() }));
        const next = [...normalized, ...get().records].slice(0, 200);
        set({ records: next });
      },
      clearAll: () => set({ records: [] }),
      removeRecord: (id) =>
        set({ records: get().records.filter((r) => r.id !== id) }),
      clearByStory: (storyId) =>
        set({ records: get().records.filter((r) => r.storyId !== storyId) }),
      getRecordsByStory: (storyId) => {
        if (!storyId) return [];
        return get().records.filter((r) => r.storyId === storyId);
      },
    }),
    {
      name: 'anke-creator-dice-history',
      version: 1,
    },
  ),
);

/** 工具：从骰子 payload + 节信息构建一条记录 */
export function buildDiceHistoryRecord(params: {
  payload: any;
  storyId: string;
  sectionId: string;
  sectionTitle: string;
}): DiceHistoryRecord | null {
  const { payload, storyId, sectionId, sectionTitle } = params;
  if (!payload || !payload.config) return null;
  const cfg: any = payload.config;
  const last: any = payload.lastResult;
  if (!last) return null;

  const kind: string = cfg.kind || 'option';
  const diceName: string = cfg.name || '骰子';

  let diceType: string;
  let result: string;
  let resultDetail: string;

  if (kind === 'numeric') {
    const count = Math.max(1, Math.min(10, Math.floor(cfg.count ?? 1)));
    const faces = Math.max(1, Math.min(1000, Math.floor(cfg.numericFaces ?? 100)));
    const modifier = Math.floor(cfg.modifier ?? 0);
    const modStr =
      modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : `${modifier}`;
    diceType = `${count}d${faces}${modStr}`;

    const total: number = typeof last.total === 'number' ? last.total : 0;
    const rolls: number[] = Array.isArray(last.rolls) ? last.rolls : [total];
    if (count === 1 && modifier === 0) {
      result = `D${faces} = ${total}`;
      resultDetail = `掷出 ${total}`;
    } else {
      result = `${count > 1 ? count : ''}D${faces}${modStr}=${rolls.join('+')}${
        modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : modifier
      }=${total}`;
      resultDetail = `各骰：${rolls.join(', ')}${modifier ? `，修饰符：${modStr}` : ''}，合计：${total}`;
    }
  } else {
    // 选项骰
    const faces = Math.max(1, Math.floor(cfg.faces ?? 2));
    diceType = `选项骰(${faces}面)`;
    const value: number = typeof last.total === 'number' ? last.total : (last.rolls?.[0] ?? 0);
    result = `D${faces} = ${value}`;
    if (last.hitOptionContent) {
      resultDetail = `命中：${last.hitOptionContent}`;
    } else {
      resultDetail = `掷出 ${value}（无匹配选项）`;
    }
  }

  return {
    id: '',
    timestamp: typeof last.timestamp === 'number' ? last.timestamp : Date.now(),
    storyId: storyId || '',
    diceName,
    diceType,
    result,
    resultDetail,
    sectionId,
    sectionTitle,
    payloadSnapshot: JSON.stringify(payload),
  };
}
