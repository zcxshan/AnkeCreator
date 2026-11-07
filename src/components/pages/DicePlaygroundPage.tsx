// ============================================================
// 玩骰子页面
// ------------------------------------------------------------
// 独立的骰子投掷工具页，不依赖任何作品。
// 用户输入骰子表达式（如 1d100、2d6+3）即可投掷并查看结果。
// 复用 diceEngine.rollExpression 解析与投掷。
// ============================================================

import { useState, useRef, useEffect } from 'react';
import { Icon } from '../common/Icon';
import { rollExpression } from '../../utils/diceEngine';
import { useToastStore } from '../../store/toastStore';
import { useSettingStore } from '../../store/settingStore';
import { playDiceRollSound } from '../../utils/diceSound';
import { askConfirm } from '../common/confirmPrompt';
// 改动 3：补齐 store 导入
import {
  useDicePlaygroundHistoryStore,
  type PlaygroundRollEntry,
} from '../../store/dicePlaygroundHistoryStore';

interface DicePlaygroundPageProps {
  onBack: () => void;
}

const QUICK_PRESETS = [
  { label: '1d100', expr: '1d100' },
  { label: '1d20', expr: '1d20' },
  { label: '2d6', expr: '2d6' },
  { label: '3d10', expr: '3d10' },
  { label: '1d6+3', expr: '1d6+3' },
  { label: '2d6kh1', expr: '2d6kh1' },
];

const MAX_HISTORY = 20;

export function DicePlaygroundPage({ onBack }: DicePlaygroundPageProps) {
  const [expr, setExpr] = useState('1d100');
  const [lastResult, setLastResult] = useState<PlaygroundRollEntry | null>(null);
  // 改动 3：history 改用 zustand persist store（持久化，关闭/重启后保留）
  const history = useDicePlaygroundHistoryStore((s) => s.history);
  const addHistory = useDicePlaygroundHistoryStore((s) => s.add);
  const clearHistoryStore = useDicePlaygroundHistoryStore((s) => s.clear);
  const [isRolling, setIsRolling] = useState(false);
  const [displayTotal, setDisplayTotal] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doRoll = (expression: string) => {
    const trimmed = expression.trim();
    if (!trimmed) {
      useToastStore.getState().showToast('请输入骰子表达式', 'warning');
      return;
    }
    if (isRolling) return;

    let result;
    try {
      result = rollExpression(trimmed);
    } catch (err) {
      useToastStore.getState().showToast(
        `表达式错误：${(err as Error).message || '无法解析'}`,
        'error',
      );
      return;
    }

    // 音效（仅在设置开启时；playDiceRollSound 内部 try/catch，失败安全 no-op）
    if (useSettingStore.getState().soundEnabled) {
      void playDiceRollSound();
    }

    setIsRolling(true);

    // 动画：渐进减速数字滚动（6 快速 + 4 中速 + 2 慢速 = 800ms）
    const tickDelays = [50, 50, 50, 50, 50, 50, 75, 75, 75, 75, 100, 100];
    const maxValue = 100; // 滚动随机值上限
    let tickIdx = 0;
    const tickFn = () => {
      const v = Math.floor(Math.random() * maxValue) + 1;
      setDisplayTotal(v);
      if (tickIdx < tickDelays.length) {
        window.setTimeout(tickFn, tickDelays[tickIdx]);
        tickIdx++;
      } else {
        // 动画结束，定格真实结果
        setDisplayTotal(result.total);
        const entry: PlaygroundRollEntry = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          expr: trimmed,
          total: result.total,
          detail: result.detail,
          allRolls: result.allRolls,
          timestamp: Date.now(),
        };
        setLastResult(entry);
        // 改动 9：写到 persist store，关闭页面/重启后历史保留
        addHistory(entry);
        setIsRolling(false);
      }
    };
    tickFn();
  };

  const handleRoll = () => doRoll(expr);

  const handleClearHistory = async () => {
    // 改动 9：二次确认，避免误清空
    const confirmed = await askConfirm({
      title: '清空历史记录',
      message: '确定清空所有历史记录？此操作不可撤销。',
      confirmText: '清空',
      danger: true,
    });
    if (!confirmed) return;
    clearHistoryStore();
    setLastResult(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRoll();
    }
  };

  return (
    <div
      className="an-page text-[var(--text-primary)] flex flex-col min-h-full"
    >
      {/* 顶栏（sticky 在内容滚动区顶部，即 TitleBar 下方；z-40） */}
      <div
        className="flex items-center gap-3 px-6 py-4 shrink-0 sticky top-0 z-40"
        style={{ background: 'var(--an-paper-2)', borderBottom: '3px solid var(--an-ink)' }}
      >
        <button
          onClick={onBack}
          className="an-pill"
        >
          <Icon name="back" size={16} /> 返回
        </button>
        <div className="flex items-center gap-2">
          <Icon name="dices" size={20} />
          <h1
            className="m-0 text-[var(--an-ink)]"
            style={{ fontFamily: 'var(--an-font-display)', fontSize: 22 }}
          >
            玩骰子
          </h1>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[900px] mx-auto space-y-6">
          {/* 输入区 */}
          <section className="an-card p-5">
            <label
              className="text-[var(--text-secondary)] block text-xs mb-2 font-medium"
            >
              骰子表达式
            </label>
            <div className="flex gap-2 items-stretch">
              <input
                ref={inputRef}
                type="text"
                value={expr}
                onChange={(e) => setExpr(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isRolling}
                placeholder="例如：1d100、2d6+3、1d20"
                className="text-[var(--text-primary)] flex-1 px-4 text-sm outline-none disabled:opacity-50"
                style={{
                  height: 40,
                  borderRadius: 999,
                  background: 'var(--bg-input)',
                  border: '2px solid var(--an-ink)',
                }}
              />
              <button
                onClick={handleRoll}
                disabled={isRolling}
                className={`${isRolling ? 'anke-dice-playground-press' : ''} px-6 text-sm rounded-full font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5`}
                style={{
                  height: 40,
                  background: 'var(--an-pink)',
                  color: '#3a2340',
                  border: '2px solid var(--an-ink)',
                }}
              >
                <Icon name="dices" size={16} /> 投掷
              </button>
            </div>

            {/* 快捷表达式 */}
            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_PRESETS.map((p) => (
                <button
                  key={p.expr}
                  onClick={() => {
                    setExpr(p.expr);
                    doRoll(p.expr);
                  }}
                  disabled={isRolling}
                  className="an-pill text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ height: 32, paddingInline: 12 }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* 表达式语法提示 */}
            <div
              className="text-[var(--text-muted)] mt-3 text-xs leading-relaxed"
            >
              语法：NdM（N 个 M 面骰）、四则运算 + - * /、括号、kh/kl（保留最高/低）、!（爆炸）、{'>='}（骰池）
            </div>
          </section>

          {/* 最近一次结果（投骰动画期间也显示） */}
          {(lastResult || isRolling) && (
            <section
              className="an-card p-6 text-center"
              style={{ background: 'var(--an-lemon-soft)' }}
            >
              <div className="text-[var(--an-ink)] text-xs mb-3 font-medium flex items-center justify-center gap-2">
                <span>最近一次投掷</span>
                <span
                  className={`${isRolling ? 'anke-dice-playground-spin' : ''} text-[16px] inline-flex`}
                >
                  <Icon name="dices" size={16} />
                </span>
              </div>
              <div className="flex items-baseline justify-center gap-3 flex-wrap">
                <span className="text-[var(--an-ink-soft)] text-sm">
                  {isRolling ? expr.trim() : lastResult?.expr}
                </span>
                <span className="text-[var(--an-ink-soft)]">=</span>
                <span className="text-[var(--an-ink)] text-6xl font-bold tabular-nums">
                  {isRolling ? displayTotal : lastResult?.total}
                </span>
              </div>
              {!isRolling && lastResult && (
                <>
                  <div
                    className="text-[var(--text-secondary)] mt-3 text-sm font-mono"
                  >
                    {lastResult.detail}
                  </div>
                  {lastResult.allRolls.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 anke-dice-playground-fade">
                      {lastResult.allRolls.map((r, i) => (
                        <span
                          key={i}
                          className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[color:var(--border-color)] min-w-[28px] inline-flex items-center justify-center text-xs font-semibold rounded px-2 py-1"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {/* 历史记录 */}
          {history.length > 0 && (
            <section className="an-card p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[var(--text-primary)] text-sm font-semibold m-0">
                  历史记录（最近 {history.length} 次）
                </h2>
                <button
                  onClick={handleClearHistory}
                  className="an-pill text-xs"
                  style={{ height: 32 }}
                >
                  清空
                </button>
              </div>
              <div className="space-y-2">
                {history.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center gap-3 px-3 py-2"
                    style={{
                      background: 'var(--an-paper)',
                      border: '2px solid var(--an-ink)',
                      borderRadius: 12,
                    }}
                  >
                    <span
                      className="text-[var(--text-muted)] text-xs tabular-nums shrink-0"
                    >
                      {new Date(h.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      className="text-[var(--text-secondary)] text-sm font-mono shrink-0"
                    >
                      {h.expr}
                    </span>
                    <span className="text-[var(--text-muted)]">=</span>
                    <span
                      className="text-[var(--accent)] text-lg font-bold tabular-nums"
                    >
                      {h.total}
                    </span>
                    <span
                      className="text-[var(--text-muted)] text-xs truncate flex-1"
                      title={h.detail}
                    >
                      {h.detail}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 空状态提示 */}
          {!lastResult && !isRolling && history.length === 0 && (
            <div
              className="bg-[var(--bg-card)] border border-[color:var(--border-color)] rounded-2xl p-12 text-center"
            >
              <div className="text-4xl mb-3"><Icon name="dices" size={48} />
              </div>
              <p className="text-[var(--text-primary)] font-medium">
                输入骰子表达式开始投掷
              </p>
              <p className="text-[var(--text-secondary)] text-sm mt-1">
                支持标准表达式语法，点击上方快捷按钮即可试投
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
