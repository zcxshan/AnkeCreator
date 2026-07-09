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
    <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>📊 时段字数对比</div>
      <svg width={svgWidth} height={chartHeight + 24} style={{ display: 'block', margin: '0 auto', maxWidth: '100%' }}>
        {data.map((d, i) => {
          const h = max > 0 ? Math.max(2, (d.value / max) * chartHeight) : 2;
          const x = i * (barWidth + gap);
          const y = chartHeight - h;
          return (
            <g key={d.label}>
              <rect x={x} y={y} width={barWidth} height={h} rx={3}
                fill={i === 4 ? 'var(--accent, #2563eb)' : 'var(--accent-bg, rgba(37,99,235,0.15))'}
                stroke={i === 4 ? 'none' : 'var(--accent, #2563eb)'}
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
      <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>📈 近 14 日字数趋势</div>
        <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted, #999)', fontSize: 12 }}>
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
    <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>📈 近 14 日字数趋势</div>
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', maxWidth: '100%' }}
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
        <path d={pathD} fill="none" stroke="var(--accent, #2563eb)" strokeWidth={1.5} />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={2.5} fill="var(--accent, #2563eb)" />
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

export function CreationLogPage({ storyId, onBack }: CreationLogPageProps) {
  const [stats, setStats] = useState<CreationLogStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [storyTitle, setStoryTitle] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [story, bundle] = await Promise.all([
        db.getStory(storyId),
        db.getStoryWithAll(storyId),
      ]);
      setStoryTitle(story?.title || '');
      if (bundle) {
        setStats(computeCreationLogStats(bundle as any));
      }
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
    { label: '今日', data: stats.today, color: 'var(--accent, #2563eb)' },
    { label: '本周', data: stats.thisWeek, color: '#16a34a' },
    { label: '本月', data: stats.thisMonth, color: '#0891b2' },
    { label: '本年', data: stats.thisYear, color: '#7c3aed' },
    { label: '累计', data: { wordCount: stats.total.wordCount, sectionCount: stats.total.sectionCount, chapterCount: stats.total.chapterCount }, color: '#d97706' },
  ] : [];

  return (
    <div
      className="min-h-full w-full flex flex-col"
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      {/* 顶栏（sticky 在 TitleBar 下方 32px 处，z-40） */}
      <div
        className="flex items-center gap-3 px-6 py-4 border-b sticky top-8 z-40"
        style={{ borderColor: 'var(--border-color)', background: 'var(--bg-base)' }}
      >
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          ← 返回
        </button>
        <h1
          className="text-lg font-semibold flex items-center gap-2"
          style={{ color: 'var(--text-primary)' }}
        >
          <span>📝</span> 创作日志{storyTitle ? ` - ${storyTitle}` : ''}
        </h1>
        <div className="flex-1" />
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="px-6 py-2 text-sm" style={{ color: 'var(--danger, #e53e3e)' }}>
          {error}
          <button onClick={() => setError('')} className="ml-2 underline">关闭</button>
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-sm" style={{ color: 'var(--text-secondary)' }}>
            加载中...
          </div>
        ) : (
          <>
            {/* 统计区 */}
            {stats && (
              <section className="mb-8">
                <h2 className="text-sm font-semibold tracking-wide uppercase mb-4" style={{ color: 'var(--text-primary)' }}>
                  📊 创作统计
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  {statRows.map((row, idx) => (
                    <div
                      key={row.label}
                      className="rounded-lg p-4"
                      style={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-color)',
                        borderLeft: `3px solid ${row.color}`,
                        transition: 'transform 0.15s, box-shadow 0.15s',
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{row.label}</div>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: row.color }} />
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: row.color, lineHeight: 1.2, marginBottom: 2 }}>
                        {row.data.wordCount.toLocaleString()}
                      </div>
                      <div className="text-xs mb-2" style={{ color: 'var(--text-muted, #999)' }}>字</div>
                      <div className="space-y-1 pt-2" style={{ borderTop: '1px dashed var(--border-color)' }}>
                        <div className="flex justify-between text-xs">
                          <span style={{ color: 'var(--text-secondary)' }}>章节</span>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{row.data.chapterCount}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span style={{ color: 'var(--text-secondary)' }}>小节</span>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{row.data.sectionCount}</span>
                        </div>
                      </div>
                      {idx < 4 && (
                        <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: 'var(--bg-hover, rgba(0,0,0,0.06))', overflow: 'hidden' }}>
                          <div style={{
                            height: '100%',
                            width: `${stats.total.wordCount > 0 ? Math.min(100, (row.data.wordCount / stats.total.wordCount * 100)) : 0}%`,
                            background: row.color,
                            borderRadius: 2,
                            transition: 'width 0.3s ease',
                          }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ maxWidth: 600, margin: '0 auto' }}>
                  <DailyTrendChart dailyStats={stats.dailyStats} />
                  <WordCountBarChart
                    today={stats.today.wordCount}
                    thisWeek={stats.thisWeek.wordCount}
                    thisMonth={stats.thisMonth.wordCount}
                    thisYear={stats.thisYear.wordCount}
                    total={stats.total.wordCount}
                  />
                </div>
                {stats.total.characterCount > 0 || stats.total.volumeCount > 0 ? (
                  <div className="mt-3 flex gap-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
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
