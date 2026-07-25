// ============================================================
// 素材网站推荐类型定义
// ============================================================

/** 素材网站分类 */
export type MaterialCategory =
  | '图片'
  | '图标'
  | '字体'
  | '音效'
  | '教程'
  | '工具'
  | '其他';

/** 素材网站推荐条目 */
export interface MaterialSite {
  id: string;
  name: string;
  url: string;
  category: MaterialCategory;
  description?: string;
  created_at: string;
  updated_at: string;
}

/** 分类列表（用于 UI 筛选 + select 选项） */
export const MATERIAL_CATEGORIES: MaterialCategory[] = [
  '图片', '图标', '字体', '音效', '教程', '工具', '其他',
];
