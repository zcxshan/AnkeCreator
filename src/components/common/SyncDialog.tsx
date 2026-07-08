import { useState } from 'react';
import type { DiffItem, SyncSource } from '../../utils/structureSync';

interface SyncDialogProps {
  open: boolean;
  onClose: () => void;
  source: SyncSource;
  volumeDiffs: DiffItem[];
  chapterDiffs: DiffItem[];
  onConfirm: (volumeDiffs: DiffItem[], chapterDiffs: DiffItem[]) => void;
}

export function SyncDialog({
  open,
  onClose,
  source,
  volumeDiffs: initialVolDiffs,
  chapterDiffs: initialChDiffs,
  onConfirm,
}: SyncDialogProps) {
  const [volDiffs, setVolDiffs] = useState<DiffItem[]>(initialVolDiffs);
  const [chDiffs, setChDiffs] = useState<DiffItem[]>(initialChDiffs);

  const [lastKey, setLastKey] = useState('');
  const key = `${open}-${source}-${initialVolDiffs.length}-${initialChDiffs.length}`;
  if (key !== lastKey) {
    setLastKey(key);
    setVolDiffs(initialVolDiffs.map((d) => ({ ...d })));
    setChDiffs(initialChDiffs.map((d) => ({ ...d })));
  }

  if (!open) return null;

  const sourceLabel = source === 'outline' ? '大纲' : '目录';
  const destLabel = source === 'outline' ? '目录' : '大纲';

  const toggleSelected = (
    items: DiffItem[],
    id: string,
  ): DiffItem[] =>
    items.map((d) => (d.id === id ? { ...d, selected: !d.selected } : d));

  const setKeep = (items: DiffItem[], id: string, keep: 'source' | 'dest'): DiffItem[] =>
    items.map((d) => (d.id === id ? { ...d, keep, selected: true } : d));

  const toggleAll = (items: DiffItem[], select: boolean): DiffItem[] =>
    items.map((d) => {
      if (d.kind === 'conflict') return d;
      return { ...d, selected: select };
    });

  const volSelectedCount = volDiffs.filter((d) => d.selected).length;
  const chSelectedCount = chDiffs.filter((d) => d.selected).length;
  const totalSelected = volSelectedCount + chSelectedCount;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--bg-overlay)' }}
      onClick={onClose}
    >
      <div
        className="flex flex-col w-[540px] max-w-[92vw] max-h-[80vh] rounded-xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--bg-base)', border: '1px solid var(--border-color)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="shrink-0 flex items-center justify-between px-5 py-3 border-b"
          style={{ borderColor: 'var(--border-color)', background: 'var(--bg-sidebar)' }}
        >
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>结构同步</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {sourceLabel} → {destLabel}
            </div>
          </div>
          <button
            className="w-7 h-7 flex items-center justify-center rounded-md text-sm transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {volDiffs.length === 0 && chDiffs.length === 0 ? (
            <div className="py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
              ✓ 两边结构完全一致，没有差异
            </div>
          ) : (
            <>
              {volDiffs.length > 0 && (
                <Section
                  title="卷"
                  items={volDiffs}
                  sourceLabel={sourceLabel}
                  destLabel={destLabel}
                  onToggleSelected={(id) =>
                    setVolDiffs(toggleSelected(volDiffs, id))
                  }
                  onSetKeep={(id, keep) => setVolDiffs(setKeep(volDiffs, id, keep))}
                  onToggleAll={(sel) => setVolDiffs(toggleAll(volDiffs, sel))}
                />
              )}

              {chDiffs.length > 0 && (
                <div className={volDiffs.length > 0 ? 'mt-5' : ''}>
                  <Section
                    title="章"
                    items={chDiffs}
                    sourceLabel={sourceLabel}
                    destLabel={destLabel}
                    onToggleSelected={(id) =>
                      setChDiffs(toggleSelected(chDiffs, id))
                    }
                    onSetKeep={(id, keep) => setChDiffs(setKeep(chDiffs, id, keep))}
                    onToggleAll={(sel) => setChDiffs(toggleAll(chDiffs, sel))}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div
          className="shrink-0 flex items-center justify-between px-5 py-3 border-t"
          style={{ borderColor: 'var(--border-color)', background: 'var(--bg-sidebar)' }}
        >
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            已勾选 <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{totalSelected}</span> 项
            {volSelectedCount > 0 && <> · {volSelectedCount} 卷</>}
            {chSelectedCount > 0 && <> · {chSelectedCount} 章</>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              取消
            </button>
            <button
              onClick={() => onConfirm(volDiffs, chDiffs)}
              disabled={totalSelected === 0}
              className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'var(--success)', color: 'var(--text-on-accent)' }}
              onMouseEnter={(e) => {
                if (totalSelected > 0) e.currentTarget.style.opacity = '0.85';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '1';
              }}
            >
              确认同步
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SectionProps {
  title: string;
  items: DiffItem[];
  sourceLabel: string;
  destLabel: string;
  onToggleSelected: (id: string) => void;
  onSetKeep: (id: string, keep: 'source' | 'dest') => void;
  onToggleAll: (selected: boolean) => void;
}

function Section({ title, items, sourceLabel, destLabel, onToggleSelected, onSetKeep, onToggleAll }: SectionProps) {
  const nonConflictCount = items.filter((i) => i.kind !== 'conflict').length;
  const selectedNonConflict = items.filter(
    (i) => i.kind !== 'conflict' && i.selected,
  ).length;
  const allNonConflictSelected =
    nonConflictCount > 0 && selectedNonConflict === nonConflictCount;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}（{items.length}）
        </div>
        {nonConflictCount > 0 && (
          <button
            onClick={() => onToggleAll(!allNonConflictSelected)}
            className="text-xs transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            {allNonConflictSelected ? '全不选' : '全选'}
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {items.map((d) => (
          <DiffRow
            key={d.id}
            item={d}
            sourceLabel={sourceLabel}
            destLabel={destLabel}
            onToggleSelected={() => onToggleSelected(d.id)}
            onSetKeep={(keep) => onSetKeep(d.id, keep)}
          />
        ))}
      </div>
    </div>
  );
}

interface DiffRowProps {
  item: DiffItem;
  sourceLabel: string;
  destLabel: string;
  onToggleSelected: () => void;
  onSetKeep: (keep: 'source' | 'dest') => void;
}

function DiffRow({ item, sourceLabel, destLabel, onToggleSelected, onSetKeep }: DiffRowProps) {
  const iconKind =
    item.kind === 'add' ? '+' : item.kind === 'remove' ? '−' : '⚠';
  const kindLabel =
    item.kind === 'add'
      ? `新增到${destLabel}`
      : item.kind === 'remove'
        ? `从${destLabel}删除`
        : '标题冲突';
  const kindColor =
    item.kind === 'add'
      ? 'var(--success)'
      : item.kind === 'remove'
        ? 'var(--text-secondary)'
        : 'var(--warning)';

  return (
    <div
      className="flex items-start gap-2 p-2 rounded-md border"
      style={{
        background: item.selected ? 'var(--success-bg)' : 'transparent',
        borderColor: item.selected ? 'var(--success)' : 'var(--border-color)',
      }}
    >
      <input
        type="checkbox"
        className="mt-0.5"
        checked={item.selected}
        onChange={onToggleSelected}
      />
      <div
        className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-[11px] font-bold"
        style={{ background: 'var(--success-bg)', color: kindColor }}
      >
        {iconKind}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>{item.title}</div>
        <div className="text-[10px]" style={{ color: kindColor }}>
          {kindLabel}
        </div>

        {item.kind === 'conflict' && (
          <div className="mt-1.5 flex items-center gap-2 text-[11px]">
            <label
              className="flex items-center gap-1 cursor-pointer"
              style={{ color: item.keep === 'source' ? 'var(--success)' : 'var(--text-secondary)' }}
            >
              <input
                type="radio"
                name={'keep-' + item.id}
                checked={item.keep === 'source'}
                onChange={() => onSetKeep('source')}
              />
              {sourceLabel}: {item.title}
            </label>
            <span style={{ color: 'var(--text-muted)' }}>·</span>
            <label
              className="flex items-center gap-1 cursor-pointer"
              style={{ color: item.keep === 'dest' ? 'var(--success)' : 'var(--text-secondary)' }}
            >
              <input
                type="radio"
                name={'keep-' + item.id}
                checked={item.keep === 'dest'}
                onChange={() => onSetKeep('dest')}
              />
              {destLabel}: {item.otherTitle || item.title}
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
