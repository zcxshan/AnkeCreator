import { useEffect, useRef, useState } from 'react';

export type AttributeType = 'text' | 'number';

export interface AttributeRow {
  id: string;
  name: string;
  value: string;
  type: AttributeType;
}

interface AttributeTableProps {
  /** 当前属性（键值对） */
  attributes?: Record<string, string | number>;
  /** 属性类型记录：哪些属性被标记为数字 */
  valueTypes?: Record<string, AttributeType>;
  /** 变更回调 —— 返回新的 attributes 与 valueTypes */
  onChange: (
    next: Record<string, string | number>,
    nextTypes: Record<string, AttributeType>,
  ) => void;
}

/** 生成稳定的唯一 ID，不依赖属性名，避免输入时 key 变化导致 input 重建失焦 */
let _attrIdCounter = 0;
function stableId(): string {
  return `__attr_${Date.now()}_${++_attrIdCounter}`;
}

/**
 * 把 attributes + valueTypes 序列化为可比较字符串。
 * 仅在父组件传入的对象引用对应的字符串与本地最新一次发出的字符串不同时才同步。
 */
function serializeAttrsState(
  attributes: Record<string, string | number>,
  valueTypes: Record<string, AttributeType>,
): string {
  const types = valueTypes || {};
  // 仅序列化的 key 顺序需稳定：用 Object.keys 的顺序 + 内部 values
  const attrPairs = Object.keys(attributes)
    .sort()
    .map((k) => `${k}=${String(attributes[k] ?? '')}`);
  const typePairs = Object.keys(types)
    .sort()
    .map((k) => `${k}:${types[k] ?? 'text'}`);
  return `A|${attrPairs.join(',')}|T|${typePairs.join(',')}`;
}

function toRows(
  attributes: Record<string, string | number>,
  valueTypes: Record<string, AttributeType>,
): AttributeRow[] {
  const rows: AttributeRow[] = [];
  for (const [name, rawValue] of Object.entries(attributes)) {
    rows.push({
      id: stableId(),
      name,
      value: String(rawValue),
      type: valueTypes[name] ?? detectType(rawValue),
    });
  }
  return rows;
}

function detectType(value: string | number): AttributeType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string' && value !== '' && !isNaN(Number(value))) return 'number';
  return 'text';
}

function rowsToState(rows: AttributeRow[]): {
  attrs: Record<string, string | number>;
  types: Record<string, AttributeType>;
} {
  const attrs: Record<string, string | number> = {};
  const types: Record<string, AttributeType> = {};
  rows.forEach((r) => {
    if (!r.name.trim()) return;
    if (r.type === 'number' && r.value !== '') {
      const n = Number(r.value);
      attrs[r.name] = isNaN(n) ? r.value : n;
    } else {
      attrs[r.name] = r.value;
    }
    types[r.name] = r.type;
  });
  return { attrs, types };
}

/**
 * 动态属性表格
 *
 *   | 属性名   | 值   | 类型 | 操作 |
 *   | 好感度   | 50   | 数字 | 删除 |
 *   | HP       | 100  | 数字 | 删除 |
 *   | [+添加]  |      |      |      |
 *
 * - 支持随时添加/删除行
 * - 每行可切换类型（数字/文本），数字类型值校验为数字
 * - 变更实时通过 onChange 回调通知父组件
 */
export function AttributeTable({ attributes, valueTypes, onChange }: AttributeTableProps) {
  const [rows, setRows] = useState<AttributeRow[]>(() =>
    toRows(attributes ?? {}, valueTypes ?? {}),
  );

  /**
   * 记录本地最近一次通过 onChange 发出的 attributes+valueTypes 序列化值。
   * 父组件会把这个状态存进 store 再以新引用回传，我们用 lastEmittedRef 来识别
   * "这次是回流的自己"还是"外部真的改了"——前者不同步（避免 input 重建失焦），
   * 后者同步（例如切换到另一个角色 / 模板导入 / 程序化更新）。
   */
  const lastEmittedRef = useRef<string>('');
  // 记录上次主动 setRows 时对应的序列化值（用于"重置回原始"
  const lastSyncedRef = useRef<string>('');

  // 外部传入变更时同步。判断标准：序列化后的状态与"上一次本地发出"和"上一次同步"都不同。
  useEffect(() => {
    const sig = serializeAttrsState(attributes ?? {}, valueTypes ?? {});
    // 本次就是我们刚刚 emit 的回流 → 跳过
    if (sig === lastEmittedRef.current) return;
    // 跟上次同步的状态一致 → 也不需要重新 setRows
    if (sig === lastSyncedRef.current) return;
    lastSyncedRef.current = sig;
    setRows(toRows(attributes ?? {}, valueTypes ?? {}));
  }, [attributes, valueTypes]);

  const updateRow = (id: string, patch: Partial<AttributeRow>) => {
    const next = rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
    setRows(next);
    const { attrs, types } = rowsToState(next);
    // 同步更新 lastEmittedRef，避免父组件回流时 useEffect 误以为是外部修改
    lastEmittedRef.current = serializeAttrsState(attrs, types);
    onChange(attrs, types);
  };

  const deleteRow = (id: string) => {
    const next = rows.filter((r) => r.id !== id);
    setRows(next);
    const { attrs, types } = rowsToState(next);
    lastEmittedRef.current = serializeAttrsState(attrs, types);
    onChange(attrs, types);
  };

  const addRow = () => {
    const next = [...rows, { id: `__new_${Date.now()}`, name: '', value: '', type: 'text' as AttributeType }];
    setRows(next);
  };

  return (
    <div className="rounded border border-[var(--border-color)] bg-[var(--bg-card)] overflow-hidden">
      {/* 表头 */}
      <div className="grid grid-cols-[1.2fr_1fr_90px_60px] gap-2 px-3 py-2 text-xs text-[var(--text-secondary)] bg-[var(--bg-sidebar)] border-b border-[var(--border-color)] uppercase tracking-wide">
        <div>属性名</div>
        <div>值</div>
        <div>类型</div>
        <div className="text-center">操作</div>
      </div>

      {/* 行 */}
      <div className="divide-y divide-[var(--border-color)]">
        {rows.length === 0 && (
          <div className="px-3 py-4 text-xs text-[var(--text-secondary)] italic text-center">
            暂无属性，点击下方"添加属性"按钮新增
          </div>
        )}

        {rows.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[1.2fr_1fr_90px_60px] gap-2 px-3 py-1.5 items-center text-sm"
          >
            <input
              value={r.name}
              onChange={(e) => updateRow(r.id, { name: e.target.value })}
              placeholder="属性名，如 好感度 / HP"
              className="bg-[var(--bg-input)] border border-[var(--border-color)] focus:border-[var(--accent)] rounded px-2 py-1 outline-none text-[var(--text-primary)] text-xs"
            />
            <input
              value={r.value}
              type={r.type === 'number' ? 'number' : 'text'}
              onChange={(e) => updateRow(r.id, { value: e.target.value })}
              placeholder="值"
              className="bg-[var(--bg-input)] border border-[var(--border-color)] focus:border-[var(--accent)] rounded px-2 py-1 outline-none text-[var(--text-primary)] text-xs"
            />
            <select
              value={r.type}
              onChange={(e) => updateRow(r.id, { type: e.target.value as AttributeType })}
              className="bg-[var(--bg-input)] border border-[var(--border-color)] focus:border-[var(--accent)] rounded px-1 py-1 outline-none text-[var(--text-primary)] text-xs"
            >
              <option value="text">文本</option>
              <option value="number">数字</option>
            </select>
            <div className="text-center">
              <button
                onClick={() => deleteRow(r.id)}
                className="text-[var(--text-secondary)] hover:text-[var(--danger)] text-xs"
                title="删除此属性"
              >
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 底部添加按钮 */}
      <div className="px-3 py-2 border-t border-[var(--border-color)] bg-[var(--bg-sidebar)]">
        <button
          onClick={addRow}
          className="text-xs bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--text-on-accent)] px-2 py-1 rounded"
        >
          + 添加属性
        </button>
      </div>
    </div>
  );
}
