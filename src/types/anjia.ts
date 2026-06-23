// ============================================================
// NGA 导出器相关类型（导出 + 安价抓取）
//
// - NGADiceRenderResult: 骰子导出结果（collapse + dice_line）
// - NGAExportOptions: 导出选项（include_*/mark_hit/分隔线）
// - NGAExportResult: 导出结果（code + 拆好的 fragments）
// ============================================================

// ------------------------------------------------------------
// 导出器
// ------------------------------------------------------------

export interface NGADiceRenderResult {
  /** 展示在帖子里的完整 collapse 文本 */
  collapse: string;
  /** 便于玩家点按的裸骰子行 */
  dice_line: string;
}

export interface NGAExportOptions {
  include_world_settings?: boolean;
  include_characters?: boolean;
  include_outlines?: boolean;
  /** 是否自动把上一次骰点命中的选项用箭头标记 */
  mark_hit?: boolean;
  /** 每节之间的分隔线 */
  section_separator?: string;
  /** 每章之间的分隔线 */
  chapter_separator?: string;
}

export interface NGAExportResult {
  code: string;
  /** 为方便发帖拆好的片段 */
  fragments: {
    title: string;
    code: string;
  }[];
}
