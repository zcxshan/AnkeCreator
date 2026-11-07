// ============================================================
// CreationLogPage：创作日志页（per-story，每个作品独立）
// 高内聚：本页自包含创作日志的全部 UI + 状态 + handlers
// 低耦合：仅通过 services/creationLogStats.ts + db/index 通信
//
// 功能：
// - 统计区（自动）：今日/本周/本月/本年/累计的字数/章节数/小节数
// - 近 14 日字数趋势图（自动）
// - 字数趋势柱状图（5 时段对比）
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { Icon } from '../common/Icon';
import type { CreationLogStats } from '../../types';
import { computeCreationLogStats } from '../../services/creationLogStats';
import * as db from '../../db/index';

interface CreationLogPageProps {
  storyId: string;
  onBack: () => void;
}

// 纯 SVG 柱状图：5 个时段字数对比（今日/本周/本月/本年/累计）
function WordCountBarChart({ today, thisWeek, thisMonth, thisYear, total }: {
  today: number; thisWeek: number; thisMonth: number; thisYear: number; total: number;
}) {
  const data = [
    { label: '今日', value: today },
    { label: '本周', value: thisWeek },
    { label: '本月', value: thisMonth },
    { label: '本年', value: thisYear },
    { label: '累计', value: total },
  ];
  const max = Math.max(...data.map(d => d.value), 1);
  const barWidth = 40;
  const gap = 20;
  const chartHeight = 120;
  const svgWidth = data.length * (barWidth + gap) - gap;

  return (
    <div className="mt-[16px] p-[16px] an-card">
      <div className="text-[13px] font-semibold text-[var(--text-secondary)] mb-[8px]">
        <span className="inline-flex items-center gap-1"><Icon name="chartBar" size={14} />时段字数对比</span>
      </div>
      <svg width={svgWidth} height={chartHeight + 24} style={{ display: 'block', margin: '0 auto', maxWidth: '100%' }}>
        {data.map((d, i) => {
          const h = max > 0 ? Math.max(2, (d.value / max) * chartHeight) : 2;
          const x = i * (barWidth + gap);
          const y = chartHeight - h;
          return (
            <g key={d.label}>
              <rect x={x} y={y} width={barWidth} height={h} rx={3}
                fill={i === 4 ? 'var(--accent)' : 'var(--accent-bg)'}
                stroke={i === 4 ? 'none' : 'var(--accent)'}
                strokeWidth={1}
              />
              <text x={x + barWidth / 2} y={chartHeight + 14} textAnchor="middle"
                style={{ fontSize: 10, fill: 'var(--text-secondary)' }}>
                {d.label}
              </text>
              <text x={x + barWidth / 2} y={y - 4} textAnchor="middle"
                style={{ fontSize: 9, fill: 'var(--text-muted)' }}>
                {d.value > 0 ? d.value.toLocaleString() : ''}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// 近 14 日字数趋势折线图（纯 SVG）
function DailyTrendChart({ dailyStats }: { dailyStats: { date: string; wordCount: number; sectionCount: number }[] }) {
  const hasData = dailyStats.some((d) => d.wordCount > 0 || d.sectionCount > 0);

  if (!hasData) {
    return (
      <div className="mt-[16px] p-[16px] an-card">
        <div className="text-[13px] font-semibold text-[var(--text-secondary)] mb-[8px]">
          <span className="inline-flex items-center gap-1"><Icon name="trendingUp" size={14} />近 14 日字数趋势</span>
        </div>
        <div className="h-[120px] flex items-center justify-center text-[var(--text-muted)] text-[12px]">
          暂无数据
        </div>
      </div>
    );
  }

  const width = 560;
  const height = 120;
  const padLeft = 44;
  const padRight = 12;
  const padTop = 12;
  const padBottom = 24;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  const max = Math.max(...dailyStats.map((d) => d.wordCount), 1);
  const stepX = dailyStats.length > 1 ? innerW / (dailyStats.length - 1) : innerW;

  const points = dailyStats.map((d, i) => {
    const x = padLeft + i * stepX;
    const y = padTop + innerH - (d.wordCount / max) * innerH;
    return { x, y, date: d.date, wordCount: d.wordCount };
  });

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const baseY = padTop + innerH;

  return (
    <div className="mt-[16px] p-[16px] an-card">
      <div className="text-[13px] font-semibold text-[var(--text-secondary)] mb-[8px]">
        <span className="inline-flex items-center gap-1"><Icon name="trendingUp" size={14} />近 14 日字数趋势</span>
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="block max-w-full"
      >
        {/* 轴线 */}
        <line x1={padLeft} y1={padTop} x2={padLeft} y2={baseY} stroke="var(--border-color)" strokeWidth={1} />
        <line x1={padLeft} y1={baseY} x2={padLeft + innerW} y2={baseY} stroke="var(--border-color)" strokeWidth={1} />
        {/* 顶部网格线 + 刻度 */}
        <line x1={padLeft} y1={padTop} x2={padLeft + innerW} y2={padTop} stroke="var(--border-color)" strokeWidth={0.5} strokeDasharray="2 3" />
        <text x={padLeft - 6} y={padTop + 4} textAnchor="end" style={{ fontSize: 9, fill: 'var(--text-muted)' }}>
          {max.toLocaleString()}
        </text>
        <text x={padLeft - 6} y={baseY} textAnchor="end" style={{ fontSize: 9, fill: 'var(--text-muted)' }}>
          0
        </text>
        {/* 折线 + 数据点 */}
        <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={2.5} fill="var(--accent)" />
            {i % 2 === 0 && (
              <text x={p.x} y={baseY + 14} textAnchor="middle" style={{ fontSize: 8, fill: 'var(--text-muted)' }}>
                {p.date.slice(5)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

/** 近 13 周创作热力图：每列一周，颜色越深当日产出越多 */
function CreationHeatmap({
  heatmap,
}: {
  heatmap: { date: string; wordCount: number; sectionCount: number }[];
}) {
  const level = (v: number) => (v <= 0 ? 0 : v < 500 ? 1 : v < 1500 ? 2 : v < 3000 ? 3 : 4);
  const palette = ['var(--bg-hover)', 'rgba(99,102,241,0.22)', 'rgba(99,102,241,0.45)', 'rgba(99,102,241,0.7)', 'var(--accent)'];

  return (
    <div className="mt-[16px] p-[16px] an-card">
      <div className="text-[13px] font-semibold text-[var(--text-secondary)] mb-[10px] flex items-center justify-between">
        <span className="inline-flex items-center gap-1">
          <Icon name="calendar" size={14} />近 13 周创作热力图
        </span>
        <span className="text-[12px] text-[var(--text-muted)] flex items-center gap-1">
          少
          {palette.map((c, i) => (
            <span key={i} style={{ width: 9, height: 9, borderRadius: 2, background: c }} />
          ))}
          多
        </span>
      </div>
      <div
        className="grid gap-[3px]"
        style={{ gridTemplateRows: 'repeat(7, 11px)', gridAutoFlow: 'column', gridAutoColumns: '11px' }}
      >
        {heatmap.map((day) => (
          <div
            key={day.date}
            title={`${day.date} · ${day.wordCount} 字 · ${day.sectionCount} 节`}
            style={{
              width: 11,
              height: 11,
              borderRadius: 2,
              background: palette[level(day.wordCount)],
              border: day.wordCount > 0 ? '1px solid rgba(99,102,241,0.25)' : 'none',
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function CreationLogPage({ storyId, onBack }: CreationLogPageProps) {
  const [stats, setStats] = useState<CreationLogStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [storyTitle, setStoryTitle] = useState('');
  const goalKey = `anke:creation-goal:${storyId}`;
  const [dailyGoal, setDailyGoal] = useState(1000);

  useEffect(() => {
    const stored = Number(localStorage.getItem(goalKey));
    setDailyGoal(stored > 0 ? stored : 1000);
  }, [goalKey]);

  const updateGoal = (value: number) => {
    const next = Math.max(100, Math.min(100000, Math.round(value) || 0));
    setDailyGoal(next);
    localStorage.setItem(goalKey, String(next));
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // 性能：统计只需要元数据（word_count/created_at 等），不能用 getStoryWithAll
      // ——它会把所有节的完整 content 经 IPC 拉进渲染层，大作品（几十 MB）会拖垮页面
      const [story, volumes, chapters, characters] = await Promise.all([
        db.getStory(storyId),
        db.listVolumes(storyId),
        db.listChapters(storyId),
        db.listCharacters(storyId),
      ]);
      setStoryTitle(story?.title || '');
      const sectionLists = await Promise.all(chapters.map((ch) => db.listSectionMetadata(ch.id)));
      const sections = sectionLists.flat();
      setStats(computeCreationLogStats({ sections, chapters, characters, volumes }));
    } catch (e) {
      setError((e as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [storyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  const statRows: { label: string; data: { wordCount: number; sectionCount: number; chapterCount: number }; color: string }[] = stats ? [
    { label: '今日', data: stats.today, color: 'var(--accent)' },
    { label: '本周', data: stats.thisWeek, color: 'var(--tone-success)' },
    { label: '本月', data: stats.thisMonth, color: 'var(--tone-cyan)' },
    { label: '本年', data: stats.thisYear, color: 'var(--tone-violet)' },
    { label: '累计', data: { wordCount: stats.total.wordCount, sectionCount: stats.total.sectionCount, chapterCount: stats.total.chapterCount }, color: 'var(--tone-warn-ink)' },
  ] : [];

  return (
    <div
      className="an-page text-[var(--text-primary)] min-h-full w-full flex flex-col"
    >
      {/* 顶栏（sticky 在内容滚动区顶部，即 TitleBar 下方；z-40） */}
      <div
        className="flex items-center gap-3 px-6 py-4 sticky top-0 z-40"
        style={{ background: 'var(--an-paper-2)', borderBottom: '3px solid var(--an-ink)' }}
      >
        <button
          onClick={onBack}
          className="an-pill"
        >
          ← 返回
        </button>
        <h1
          className="text-[var(--an-ink)] flex items-center gap-2"
          style={{ fontFamily: 'var(--an-font-display)', fontSize: 22 }}
        >
          <span className="inline-flex items-center gap-1">
            <Icon name="pen" size={16} />
            创作日志{storyTitle ? ` - ${storyTitle}` : ''}
          </span>
        </h1>
        <div className="flex-1" />
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="text-[var(--danger)] px-6 py-2 text-sm">
          {error}
          <button onClick={() => setError('')} className="ml-2 underline">关闭</button>
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-6 pb-6" style={{ width: '100%', maxWidth: 1180, margin: '0 auto' }}>
        {loading ? (
          <div className="text-[var(--text-secondary)] flex items-center justify-center h-32 text-sm">
            加载中...
          </div>
        ) : (
          <>
            {/* 顶部统计胶囊：今日 / 本周 / 本月 / 总计 */}
            {stats && (
              <div className="flex flex-wrap gap-3 pt-4">
                <div className="an-stat">
                  今日 <b>{stats.today.wordCount.toLocaleString()}</b> 字
                </div>
                <div className="an-stat">
                  本周 <b>{stats.thisWeek.wordCount.toLocaleString()}</b> 字
                </div>
                <div className="an-stat">
                  本月 <b>{stats.thisMonth.wordCount.toLocaleString()}</b> 字
                </div>
                <div className="an-stat">
                  总计 <b>{stats.total.wordCount.toLocaleString()}</b> 字
                </div>
              </div>
            )}

            {/* 统计区 */}
            {stats && (
              <section className="mb-8">
                <h2 className="text-[13px] font-semibold text-[var(--text-secondary)] mb-4">
                  <span className="inline-flex items-center gap-1"><Icon name="chartBar" size={14} />创作统计</span>
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  {statRows.map((row, idx) => (
                    <div
                      key={row.label}
                      className="an-card p-4"
                      style={{
                        borderLeft: `3px solid ${row.color}`,
                        background: [
                          'var(--an-pink-soft)',
                          'var(--an-mint-soft)',
                          'var(--an-sky-soft)',
                          'var(--an-lemon-soft)',
                          'var(--an-lilac-soft)',
                        ][idx % 5],
                        transition: 'transform 0.15s, box-shadow 0.15s',
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-[var(--text-secondary)] text-xs font-medium">{row.label}</div>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: row.color }} />
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: row.color, lineHeight: 1.2, marginBottom: 2 }}>
                        {row.data.wordCount.toLocaleString()}
                      </div>
                      <div className="text-[var(--text-muted)] text-xs mb-2">字</div>
                      <div className="border-t border-t-[color:var(--border-color)] space-y-1 pt-2">
                        <div className="flex justify-between text-xs">
                          <span className="text-[var(--text-secondary)]">章节</span>
                          <span className="text-[var(--text-primary)] font-medium">{row.data.chapterCount}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-[var(--text-secondary)]">小节</span>
                          <span className="text-[var(--text-primary)] font-medium">{row.data.sectionCount}</span>
                        </div>
                      </div>
                      {idx < 4 && (
                        <div className="mt-[8px] h-[4px] rounded-[var(--radius-tight)] bg-[var(--bg-hover)] overflow-hidden">
                          <div style={{
                            height: '100%',
                            width: `${stats.total.wordCount > 0 ? Math.min(100, (row.data.wordCount / stats.total.wordCount * 100)) : 0}%`,
                            background: row.color,
                            borderRadius: 'var(--radius-tight)',
                            transition: 'width 0.3s ease',
                          }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {/* 连续创作 & 今日目标 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <div className="an-card p-4 flex items-center gap-3">
                    <span className="text-[var(--accent)] shrink-0"><Icon name="sparkles" size={24} /></span>
                    <div>
                      <div className="text-[var(--text-secondary)] text-xs">连续创作</div>
                      <div className="text-[var(--text-primary)] text-xl font-bold leading-tight">
                        {stats.streak}
                        <span className="text-[var(--text-muted)] text-xs font-normal ml-1">天</span>
                      </div>
                    </div>
                  </div>
                  <div className="an-card p-4">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-[var(--text-secondary)] text-xs inline-flex items-center gap-1">
                        <Icon name="target" size={14} />今日目标
                      </div>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={100}
                          step={100}
                          value={dailyGoal}
                          onChange={(e) => updateGoal(Number(e.target.value))}
                          className="w-16 px-1.5 py-0.5 text-[12px] text-right rounded border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-primary)] outline-none"
                        />
                        <span className="text-[12px] text-[var(--text-muted)]">字</span>
                      </div>
                    </div>
                    <div className="h-[6px] rounded-full bg-[var(--bg-hover)] overflow-hidden">
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.min(100, (stats.today.wordCount / Math.max(1, dailyGoal)) * 100)}%`,
                          background: 'var(--accent)',
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                    <div className="text-[12px] text-[var(--text-muted)] mt-1.5">
                      {stats.today.wordCount.toLocaleString()} / {dailyGoal.toLocaleString()} 字
                      {stats.today.wordCount >= dailyGoal ? ' · 目标达成' : ''}
                    </div>
                  </div>
                </div>

                <div style={{ maxWidth: 600, margin: '0 auto' }}>
                  <DailyTrendChart dailyStats={stats.dailyStats} />
                  <CreationHeatmap heatmap={stats.heatmap} />
                  <WordCountBarChart
                    today={stats.today.wordCount}
                    thisWeek={stats.thisWeek.wordCount}
                    thisMonth={stats.thisMonth.wordCount}
                    thisYear={stats.thisYear.wordCount}
                    total={stats.total.wordCount}
                  />
                </div>

                {/* 最近七天创作时间线（贴纸圆点） */}
                <div className="an-card p-5 mt-4" style={{ maxWidth: 600, margin: '16px auto 0' }}>
                  <h3 className="text-[13px] font-semibold text-[var(--text-secondary)] mb-3 inline-flex items-center gap-1">
                    <Icon name="clock" size={14} /> 最近七天
                  </h3>
                  <div className="relative pl-6">
                    <span
                      className="absolute left-[5px] top-1 bottom-1 w-[2px]"
                      style={{ background: 'var(--an-ink-faint)' }}
                    />
                    {[...stats.dailyStats].slice(-7).reverse().map((d) => (
                      <div key={d.date} className="relative mb-3 last:mb-0">
                        <span
                          className="absolute left-[-21px] top-[6px] w-3 h-3 rounded-full"
                          style={{
                            background: d.wordCount > 0 ? 'var(--an-pink)' : 'var(--an-paper)',
                            border: '2px solid var(--an-ink)',
                          }}
                        />
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-[var(--text-primary)] font-medium">{d.date}</span>
                          <span className="text-[var(--text-muted)] tabular-nums">
                            {d.wordCount.toLocaleString()} 字 · {d.sectionCount} 节
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {stats.total.characterCount > 0 || stats.total.volumeCount > 0 ? (
                  <div className="text-[var(--text-secondary)] mt-3 flex gap-4 text-xs">
                    <span>卷数：{stats.total.volumeCount}</span>
                    <span>角色数：{stats.total.characterCount}</span>
                  </div>
                ) : null}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
