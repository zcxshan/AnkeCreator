// ============================================================
// 创作日志统计 service
// 从 story bundle（getStoryWithAll 返回值）实时计算 CreationLogStats
// 不存历史快照，每次调用都重新计算
// ============================================================

import type { CreationLogStats } from '../types';

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfWeek(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  r.setDate(r.getDate() - r.getDay());
  return r;
}

function startOfMonth(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  r.setDate(1);
  return r;
}

function startOfYear(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  r.setMonth(0, 1);
  return r;
}

/** 将日期格式化为 YYYY-MM-DD（本地时区） */
function toDayKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** 生成近 N 日的日期键数组（从 N-1 天前到今天，共 N 项） */
function lastNDayKeys(now: Date, n: number): string[] {
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    keys.push(toDayKey(d));
  }
  return keys;
}

/** 连续创作天数：从今天（或昨天）向前统计有产出的连续天数 */
function computeStreak(dailyMap: Map<string, { wordCount: number; sectionCount: number }>, now: Date): number {
  const hasData = (d: Date) => {
    const v = dailyMap.get(toDayKey(d));
    return !!v && (v.wordCount > 0 || v.sectionCount > 0);
  };
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  // 今天还没写时，从昨天开始算，避免白天打开日志显示中断
  if (!hasData(cursor)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (hasData(cursor)) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** 从 story bundle 计算创作统计 */
export function computeCreationLogStats(bundle: {
  sections: {
    word_count?: number;
    created_at?: string;
    updated_at?: string;
  }[];
  chapters: { created_at?: string; updated_at?: string }[];
  characters: unknown[];
  volumes: unknown[];
}): CreationLogStats {
  const now = new Date();
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);
  const yearStart = startOfYear(now);

  let totalWords = 0;
  let todayWords = 0;
  let weekWords = 0;
  let monthWords = 0;
  let yearWords = 0;
  let todaySections = 0;
  let weekSections = 0;
  let monthSections = 0;
  let yearSections = 0;
  let todayChapters = 0;
  let weekChapters = 0;
  let monthChapters = 0;
  let yearChapters = 0;

  // 按日聚合（key = YYYY-MM-DD）
  const dailyMap = new Map<string, { wordCount: number; sectionCount: number }>();

  for (const s of bundle.sections) {
    const wc = s.word_count ?? 0;
    totalWords += wc;
    // 活跃度按最后修改时间统计：只按 created_at 会让「修改已有章节」永远不计入今日字数
    const stamp = s.updated_at || s.created_at;
    const ts = stamp ? Date.parse(stamp) : NaN;
    if (Number.isNaN(ts)) continue;
    const d = new Date(ts);
    if (isSameDay(d, now)) {
      todayWords += wc;
      todaySections++;
    }
    if (d >= weekStart) {
      weekWords += wc;
      weekSections++;
    }
    if (d >= monthStart) {
      monthWords += wc;
      monthSections++;
    }
    if (d >= yearStart) {
      yearWords += wc;
      yearSections++;
    }
    // 按日聚合
    const key = toDayKey(d);
    const prev = dailyMap.get(key) ?? { wordCount: 0, sectionCount: 0 };
    prev.wordCount += wc;
    prev.sectionCount += 1;
    dailyMap.set(key, prev);
  }

  for (const c of bundle.chapters) {
    // 章节数按新建时间统计（反映“今天是否开了新章”）
    const stamp = c.created_at || c.updated_at;
    const ts = stamp ? Date.parse(stamp) : NaN;
    if (Number.isNaN(ts)) continue;
    const d = new Date(ts);
    if (isSameDay(d, now)) todayChapters++;
    if (d >= weekStart) weekChapters++;
    if (d >= monthStart) monthChapters++;
    if (d >= yearStart) yearChapters++;
  }

  // 生成近 14 日的数组（无数据的日期填 0）
  const dailyStats = lastNDayKeys(now, 14).map((date) => {
    const v = dailyMap.get(date);
    return {
      date,
      wordCount: v?.wordCount ?? 0,
      sectionCount: v?.sectionCount ?? 0,
    };
  });

  // 近 13 周（91 天）热力图 + 连续创作天数
  const heatmap = lastNDayKeys(now, 91).map((date) => {
    const v = dailyMap.get(date);
    return {
      date,
      wordCount: v?.wordCount ?? 0,
      sectionCount: v?.sectionCount ?? 0,
    };
  });
  const streak = computeStreak(dailyMap, now);

  return {
    total: {
      wordCount: totalWords,
      sectionCount: bundle.sections.length,
      chapterCount: bundle.chapters.length,
      characterCount: bundle.characters.length,
      volumeCount: bundle.volumes.length,
    },
    today: { wordCount: todayWords, sectionCount: todaySections, chapterCount: todayChapters },
    thisWeek: { wordCount: weekWords, sectionCount: weekSections, chapterCount: weekChapters },
    thisMonth: { wordCount: monthWords, sectionCount: monthSections, chapterCount: monthChapters },
    thisYear: { wordCount: yearWords, sectionCount: yearSections, chapterCount: yearChapters },
    dailyStats,
    heatmap,
    streak,
  };
}
