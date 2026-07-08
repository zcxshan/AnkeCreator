// ============================================================
// 创作日志类型定义（per-story，每个作品独立）
// ============================================================

/** 创作统计快照（自动计算，不持久化） */
export interface CreationLogStats {
  total: {
    wordCount: number;
    sectionCount: number;
    chapterCount: number;
    characterCount: number;
    volumeCount: number;
  };
  today: { wordCount: number; sectionCount: number; chapterCount: number };
  thisWeek: { wordCount: number; sectionCount: number; chapterCount: number };
  thisMonth: { wordCount: number; sectionCount: number; chapterCount: number };
  thisYear: { wordCount: number; sectionCount: number; chapterCount: number };
  dailyStats: { date: string; wordCount: number; sectionCount: number }[];
}
