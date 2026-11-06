import { describe, it, expect } from 'vitest';
import { computeCreationLogStats } from './creationLogStats';

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

const base = { characters: [], volumes: [] };

describe('computeCreationLogStats', () => {
  it('修改旧章节后，今日字数应统计到（按 updated_at 而非 created_at）', () => {
    const stats = computeCreationLogStats({
      ...base,
      chapters: [],
      sections: [
        { word_count: 800, created_at: daysAgo(10), updated_at: daysAgo(0) },
        { word_count: 200, created_at: daysAgo(3), updated_at: daysAgo(3) },
      ],
    });
    expect(stats.today.wordCount).toBe(800);
    expect(stats.today.sectionCount).toBe(1);
    expect(stats.total.wordCount).toBe(1000);
    expect(stats.streak).toBe(1);
  });

  it('缺失 updated_at 时回退到 created_at', () => {
    const stats = computeCreationLogStats({
      ...base,
      chapters: [],
      sections: [{ word_count: 500, created_at: daysAgo(0) }],
    });
    expect(stats.today.wordCount).toBe(500);
    expect(stats.streak).toBe(1);
  });

  it('非法日期不会污染每日聚合，也不影响累计字数', () => {
    const stats = computeCreationLogStats({
      ...base,
      chapters: [{ created_at: 'not-a-date' }],
      sections: [
        { word_count: 300, created_at: 'not-a-date', updated_at: 'also-bad' },
        { word_count: 100, created_at: daysAgo(0), updated_at: daysAgo(0) },
      ],
    });
    expect(stats.total.wordCount).toBe(400);
    expect(stats.today.wordCount).toBe(100);
    expect(stats.dailyStats).toHaveLength(14);
    expect(stats.heatmap).toHaveLength(91);
    expect(stats.dailyStats.some((d) => d.date.includes('NaN'))).toBe(false);
    expect(stats.heatmap.some((d) => d.date.includes('NaN'))).toBe(false);
  });

  it('热力图与每日趋势长度固定，空数据也能渲染', () => {
    const stats = computeCreationLogStats({ ...base, chapters: [], sections: [] });
    expect(stats.dailyStats).toHaveLength(14);
    expect(stats.heatmap).toHaveLength(91);
    expect(stats.heatmap.every((d) => d.wordCount === 0)).toBe(true);
    expect(stats.streak).toBe(0);
    expect(stats.total.wordCount).toBe(0);
  });
});
