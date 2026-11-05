import {
  useState,
  useMemo,
  useRef,
  useCallback,
  useDeferredValue,
  memo,
} from 'react';
import { useStoryStore } from '../../store/storyStore';
import { useEditorStore } from '../../store/editorStore';
import {
  useDiceHistoryStore,
  type DiceHistoryRecord,
} from '../../store/diceHistoryStore';
import { useToastStore } from '../../store/toastStore';
import { useSettingStore } from '../../store/settingStore';
import { rollExpression } from '../../utils/diceEngine';
import { playDiceRollSound } from '../../utils/diceSound';
import { Icon } from '../common/Icon';
import { ConfirmDialog } from '../common/ConfirmDialog';

// ========== 快速骰子面板（properties tab 顶部） ==========

type QuickResult = { total: number; detail: string; allRolls: number[] };

const QUICK_DICE_PRESETS = ['1d100', '1d20', '2d6', '1d6+3'];

export function QuickDicePanel() {
  const [expr, setExpr] = useState('1d100');
  const [result, setResult] = useState<QuickResult | null>(null);
  const [isRolling, setIsRolling] = useState(false);
  const [displayTotal, setDisplayTotal] = useState<number | null>(null);
  const [lastExpr, setLastExpr] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const doRoll = (expression: string) => {
    const trimmed = expression.trim();
    if (!trimmed) {
      useToastStore.getState().showToast('请输入骰子表达式', 'warning');
      return;
    }
    if (isRolling) return;

    let r: QuickResult;
    try {
      const res = rollExpression(trimmed);
      r = { total: res.total, detail: res.detail, allRolls: res.allRolls };
    } catch (err) {
      useToastStore.getState().showToast(
        `表达式错误：${(err as Error).message || '无法解析'}`,
        'error',
      );
      return;
    }

    // 音效（仅在设置开启时）
    if (useSettingStore.getState().soundEnabled) {
      void playDiceRollSound();
    }

    setLastExpr(trimmed);
    setIsRolling(true);

    // 渐进减速数字滚动（800ms）
    const tickDelays = [50, 50, 50, 50, 50, 50, 75, 75, 75, 75, 100, 100];
    const maxValue = 100;
    let tickIdx = 0;
    const tickFn = () => {
      const v = Math.floor(Math.random() * maxValue) + 1;
      setDisplayTotal(v);
      if (tickIdx < tickDelays.length) {
        window.setTimeout(tickFn, tickDelays[tickIdx]);
        tickIdx++;
      } else {
        setDisplayTotal(r.total);
        setResult(r);
        setIsRolling(false);
      }
    };
    tickFn();
  };

  const fallbackCopy = (text: string, ok: () => void) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      ok();
    } catch {
      useToastStore.getState().showToast('复制失败', 'error');
    }
  };

  const handleCopy = () => {
    if (!result) return;
    const text = `[${lastExpr || expr.trim()}=${result.total}]`;
    const ok = () => useToastStore.getState().showToast('已复制：' + text, 'success');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(ok, () => fallbackCopy(text, ok));
    } else {
      fallbackCopy(text, ok);
    }
  };

  return (
    <div
      className="border-[color:var(--border-color)] bg-[var(--bg-base)] rounded-lg border p-3"
    >
      <div className="text-[var(--text-primary)] text-xs font-semibold mb-2 flex items-center gap-1">
        <Icon name="dices" size={14} />
        快速骰子
      </div>
      <div className="flex gap-2 mb-2">
        <input
          ref={inputRef}
          type="text"
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              doRoll(expr);
            }
          }}
          disabled={isRolling}
          placeholder="1d100、2d6+3..."
          className="border border-[color:var(--border-color)] bg-[var(--bg-input)] text-[var(--text-primary)] flex-1 min-w-0 px-2 py-1 text-xs rounded-md outline-none disabled:opacity-50"
        />
        <button
          onClick={() => doRoll(expr)}
          disabled={isRolling}
          className={`${`px-3 py-1 text-xs rounded-md font-medium disabled:opacity-60 disabled:cursor-not-allowed ${isRolling ? 'anke-dice-playground-press' : ''}`} bg-[var(--accent)] text-[var(--text-on-accent)] border border-[color:var(--accent)]`}
        >
          投
        </button>
      </div>
      <div className="flex flex-wrap gap-1 mb-2">
        {QUICK_DICE_PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => {
              setExpr(p);
              doRoll(p);
            }}
            disabled={isRolling}
            className="bg-[var(--bg-hover)] text-[var(--text-secondary)] border border-[color:var(--border-color)] text-[10px] px-1.5 py-0.5 rounded disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {p}
          </button>
        ))}
      </div>
      {(result || isRolling) && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-1 min-w-0">
            <span
              className={`inline-flex items-center ${isRolling ? 'anke-dice-playground-spin' : ''}`}
              style={{ display: 'inline-flex' }}
            >
              <Icon name="dices" size={16} />
            </span>
            <span
              className="text-[var(--text-secondary)] text-[10px] font-mono truncate"
            >
              {isRolling ? expr.trim() : lastExpr}
            </span>
            <span className="text-[var(--text-muted)] text-[10px]">
              =
            </span>
            <span
              className="text-[var(--accent)] text-lg font-bold tabular-nums"
            >
              {isRolling ? displayTotal : result?.total}
            </span>
          </div>
          {!isRolling && result && (
            <button
              onClick={handleCopy}
              className="border-[color:var(--accent)] text-[var(--accent)] bg-transparent cursor-pointer text-[10px] px-2 py-1 rounded border shrink-0"
              title="复制骰点文本"
            >
              <span className="inline-flex items-center gap-1">
                <Icon name="copy" size={12} />
                复制
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ========== 骰点历史记录面板 ==========

type DiceGroupMode = 'flat' | 'time' | 'story';

interface DiceGroup {
  key: string;
  title: string;
  records: DiceHistoryRecord[];
}

// P1-1: 抽离为独立 memo 组件，避免无关重渲染
// - 自定义 memo 比较：仅当 record 或 diceExists 变化时才重渲染
// - 回调（onRemove/onInsert/onRestore/onJump）是闭包，捕获 ref 或 store.getState()，即使引用变化也能正确工作
// - formatTime 移入组件内部，避免父组件每次 render 重建
interface DiceRecordItemProps {
  record: DiceHistoryRecord;
  diceExists: boolean;
  onRemove: (id: string) => void;
  onInsertUnrolledDice: (sectionId: string, payloadSnapshot: string) => void;
  onRestoreDice: (sectionId: string, payloadSnapshot: string) => void;
  onJumpToDice: (sectionId: string, payloadSnapshot: string) => void;
}

const DiceRecordItem = memo(function DiceRecordItem({
  record: r,
  diceExists,
  onRemove,
  onInsertUnrolledDice,
  onRestoreDice,
  onJumpToDice,
}: DiceRecordItemProps) {
  const formatTime = (ts: number): string => {
    try {
      const d = new Date(ts);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return String(ts);
    }
  };

  return (
    <div
      className="border-[color:var(--border-color)] bg-[var(--bg-base)] relative p-3 rounded-lg border transition-colors"
    >
      {/* 单条删除 */}
      <button
        onClick={() => onRemove(r.id)}
        className="text-[var(--text-muted)] bg-transparent absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded text-[12px] leading-none"
        title="删除该条记录"
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
      >
        ×
      </button>
      <div className="text-[var(--text-secondary)] text-[10px] mb-1">
        {formatTime(r.timestamp)}
      </div>
      <div className="flex items-center gap-2 mb-1">
        <div className="text-[var(--text-primary)] text-xs font-semibold truncate">
          {r.diceName}
        </div>
        <div
          className="bg-[var(--accent-soft)] text-[var(--accent)] text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
        >
          {r.diceType}
        </div>
      </div>
      <div className="text-[var(--accent)] text-xs font-mono mb-1">
        结果: {r.result}
      </div>
      {r.resultDetail && r.resultDetail !== r.result && (
        <div className="text-[var(--text-secondary)] text-[11px] mb-2 leading-relaxed">
          {r.resultDetail}
        </div>
      )}
      <div className="border-t border-t-[color:var(--border-color)] flex items-center justify-between pt-2 mt-1">
        <div className="text-[var(--text-secondary)] text-[10px] truncate flex-1 pr-2">
          → {r.sectionTitle || '(未命名节)'}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onInsertUnrolledDice(r.sectionId, r.payloadSnapshot)}
            className="border-[color:var(--accent)] text-[var(--accent)] bg-transparent text-[10px] px-2 py-1 rounded-md font-medium border"
            title="在当前光标插入一个相同格式未掷骰的骰子"
          >
            插入
          </button>
          <button
            onClick={() => onRestoreDice(r.sectionId, r.payloadSnapshot)}
            disabled={diceExists}
            className="border-[color:var(--accent)] text-[var(--accent)] bg-transparent text-[10px] px-2 py-1 rounded-md font-medium border disabled:opacity-40 disabled:cursor-not-allowed"
            title={diceExists ? '该骰子仍在编辑区，无需恢复' : '在编辑区重新插入一个相同的骰子'}
          >
            恢复
          </button>
          <button
            onClick={() => onJumpToDice(r.sectionId, r.payloadSnapshot)}
            className="bg-[var(--accent)] text-[var(--text-on-accent)] text-[10px] px-2 py-1 rounded-md font-medium"
          >
            跳转
          </button>
        </div>
      </div>
    </div>
  );
}, (prev, next) => {
  // 自定义比较：仅当 record 引用或 diceExists 变化时才重渲染
  // 回调函数引用变化不触发重渲染（它们是闭包，内部用 ref/store.getState() 保证正确性）
  return prev.record === next.record && prev.diceExists === next.diceExists;
});

export function DiceHistoryPanel({
  storyId,
  onJumpToDice,
  onRestoreDice,
  onInsertUnrolledDice,
  onCheckDiceExists,
}: {
  storyId?: string | null;
  onJumpToDice: (sectionId: string, payloadSnapshot: string) => void;
  onRestoreDice: (sectionId: string, payloadSnapshot: string) => void;
  onInsertUnrolledDice: (sectionId: string, payloadSnapshot: string) => void;
  onCheckDiceExists: (sectionId: string, payloadSnapshot: string) => boolean;
}) {
  const allRecords = useDiceHistoryStore((s) => s.records);
  const clearAll = useDiceHistoryStore((s) => s.clearAll);
  const removeRecord = useDiceHistoryStore((s) => s.removeRecord);
  const stories = useStoryStore((s) => s.stories);
  // 独立订阅 sectionContent（不再经父组件透传），右栏在内容写入时也不随整页重渲染
  const sectionContent = useEditorStore((s) => s.sectionContent);
  const [pendingClearDice, setPendingClearDice] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // useDeferredValue: 搜索防抖，避免每次按键都触发 groups useMemo 重算（200+ 条记录时卡顿）
  // 输入框 value 仍用 searchQuery（保证输入响应），groups/空状态用 deferredSearchQuery
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [groupMode, setGroupMode] = useState<DiceGroupMode>('time');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // storyId → title 映射（用于「作品」分组标题）
  const storyNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stories) m.set(s.id, s.title);
    return m;
  }, [stories]);

  // P1-1 性能优化：用 useDeferredValue + useMemo 缓存「骰子是否仍在编辑区」结果
  // - deferredSectionContent 滞后于 sectionContent，避免用户在编辑器输入时频繁触发 DOM 查询
  // - onCheckDiceExistsRef 避免 onCheckDiceExists 内联函数变化导致 useMemo 失效
  // - existingDiceMap 仅在 deferredSectionContent 或 allRecords 变化时重算，不再每 render 调 N 次 DOM 查询
  const deferredSectionContent = useDeferredValue(sectionContent ?? '');
  const onCheckDiceExistsRef = useRef(onCheckDiceExists);
  onCheckDiceExistsRef.current = onCheckDiceExists;
  const existingDiceMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const r of allRecords) {
      map.set(r.id, onCheckDiceExistsRef.current(r.sectionId, r.payloadSnapshot));
    }
    return map;
    // onCheckDiceExistsRef 是 ref，不需要作为依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredSectionContent, allRecords]);

  // 范围 + 搜索过滤 + 分组
  const groups = useMemo<DiceGroup[]>(() => {
    // 0. 归档记录（已删除作品的）单独分出：统一归入「已删除作品」组，不混入当前分组
    const archived = allRecords.filter((r) => r.isArchived);
    // 1. 范围过滤：「作品」模式取全部；其他模式仅当前作品（均不含归档记录）
    let list = allRecords.filter((r) => !r.isArchived);
    if (groupMode !== 'story') {
      list = storyId ? list.filter((r) => r.storyId === storyId) : [];
    }
    // 2. 搜索过滤（大小写不敏感，用 deferredSearchQuery 防抖）
    const q = deferredSearchQuery.trim().toLowerCase();
    const matches = (r: DiceHistoryRecord) =>
      [r.diceName, r.diceType, r.result, r.resultDetail, r.sectionTitle]
        .join(' ')
        .toLowerCase()
        .includes(q);
    if (q) {
      list = list.filter(matches);
    }
    // 3. 分组（当前/未归档记录）
    const result: DiceGroup[] = [];
    if (groupMode === 'flat') {
      result.push({ key: 'all', title: '全部记录', records: list });
    } else if (groupMode === 'time') {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const yesterdayStart = todayStart - 86400000;
      const weekStart = todayStart - 6 * 86400000;
      const buckets: Record<string, { title: string; records: DiceHistoryRecord[] }> = {
        today: { title: '今天', records: [] },
        yesterday: { title: '昨天', records: [] },
        week: { title: '本周', records: [] },
        earlier: { title: '更早', records: [] },
      };
      for (const r of list) {
        if (r.timestamp >= todayStart) buckets.today.records.push(r);
        else if (r.timestamp >= yesterdayStart) buckets.yesterday.records.push(r);
        else if (r.timestamp >= weekStart) buckets.week.records.push(r);
        else buckets.earlier.records.push(r);
      }
      for (const k of ['today', 'yesterday', 'week', 'earlier'] as const) {
        if (buckets[k].records.length > 0) result.push({ key: k, title: buckets[k].title, records: buckets[k].records });
      }
    } else {
      // story 分组
      const byStory = new Map<string, DiceHistoryRecord[]>();
      for (const r of list) {
        const key = r.storyId || '__unknown__';
        const arr = byStory.get(key) || [];
        arr.push(r);
        byStory.set(key, arr);
      }
      for (const [sid, recs] of byStory.entries()) {
        result.push({
          key: sid,
          title: sid === '__unknown__' ? '未知作品' : (storyNameMap.get(sid) || '未知作品'),
          records: recs,
        });
      }
    }
    // 4. 「已删除作品」归档组（仅当搜索过滤后非空才显示）
    const archivedFiltered = q ? archived.filter(matches) : archived;
    if (archivedFiltered.length > 0) {
      result.push({ key: '__archived__', title: '已删除作品', records: archivedFiltered });
    }
    return result;
  }, [allRecords, storyId, groupMode, deferredSearchQuery, storyNameMap]);

  const toggleCollapse = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalCount = groups.reduce((sum, g) => sum + g.records.length, 0);

  // P1-1: 稳定的 removeRecord 回调，避免 DiceRecordItem 因回调变化重渲染
  const handleRemove = useCallback((id: string) => {
    removeRecord(id);
    useToastStore.getState().showToast('已删除该条记录', 'success');
  }, [removeRecord]);

  const groupBtn = (mode: DiceGroupMode, label: string) => {
    const active = groupMode === mode;
    return (
      <button
        onClick={() => setGroupMode(mode)}
        className="px-2 py-1 text-[10px] font-medium"
        style={{
          background: active ? 'var(--accent)' : 'var(--bg-card)',
          color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="p-3 flex flex-col h-full">
      {/* 顶部工具栏：搜索框 + 分组切换 */}
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索骰子名/类型/结果/节..."
          className="border border-[color:var(--border-color)] bg-[var(--bg-input)] text-[var(--text-primary)] flex-1 min-w-0 px-2 py-1 text-xs rounded-md outline-none"
        />
        <div
          className="border border-[color:var(--border-color)] flex shrink-0 rounded-md overflow-hidden"
        >
          {groupBtn('story', '作品')}
          {groupBtn('time', '时间')}
          {groupBtn('flat', '平铺')}
        </div>
      </div>
      <div className="flex items-center justify-between mb-2 shrink-0">
        <div className="text-[var(--text-primary)] text-xs font-semibold">
          骰点历史 <span className="text-[var(--text-secondary)] font-normal">共 {totalCount} 条</span>
        </div>
        {totalCount > 0 && (
          <button
            onClick={() => setPendingClearDice(true)}
            className="border-[color:var(--border-color)] text-[var(--text-secondary)] text-[10px] px-2 py-1 rounded-md border transition-colors"
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.borderColor = 'var(--danger)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
          >
            清空
          </button>
        )}
      </div>

      {totalCount === 0 ? (
        <div className="text-[var(--text-secondary)] flex-1 flex items-center justify-center text-xs py-16">
          {deferredSearchQuery ? '没有匹配的记录' : '还没有骰点记录，去正文编辑器掷一次骰子试试。'}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {groups.map((g) => {
            const collapsed = collapsedGroups.has(g.key);
            // 「已删除作品」归档组在任何分组模式下都显示标题，与当前作品记录区分
            const showHeader = groupMode !== 'flat' || g.key === '__archived__';
            return (
              <div key={g.key}>
                {showHeader && (
                  <div
                    onClick={() => toggleCollapse(g.key)}
                    className="text-[var(--text-primary)] flex items-center gap-1 px-1 py-1 cursor-pointer text-[11px] font-semibold select-none"
                  >
                    <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={12} />
                    <span>{g.title}</span>
                    <span className="text-[var(--text-secondary)] font-normal">({g.records.length})</span>
                  </div>
                )}
                {!collapsed && (
                  <div className="space-y-2 mt-1">
                    {g.records.map((r) => (
                      <DiceRecordItem
                        key={r.id}
                        record={r}
                        diceExists={existingDiceMap.get(r.id) ?? false}
                        onRemove={handleRemove}
                        onInsertUnrolledDice={onInsertUnrolledDice}
                        onRestoreDice={onRestoreDice}
                        onJumpToDice={onJumpToDice}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pendingClearDice && (
        <ConfirmDialog
          open={true}
          title="清空确认"
          message="确定清空全部骰点记录？此操作不可撤销。"
          danger
          onConfirm={() => {
            clearAll();
            useToastStore.getState().showToast('已清空', 'success');
            setPendingClearDice(false);
          }}
          onCancel={() => setPendingClearDice(false)}
        />
      )}
    </div>
  );
}
