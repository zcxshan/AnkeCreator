// ============================================================
// 作品相关类型（Story / Volume / Chapter / Section + 聚合）
// ============================================================

import type { Entity } from './entity'
import type { Character, WorldSetting, Outline } from './character-world-outline'

export interface Story extends Entity {
  title: string;
  description?: string;
  category?: string;
  order_index?: number;
  is_starred?: boolean;
  is_pinned?: boolean;
  is_deleted?: boolean;
  deleted_at?: string;
}

export interface Volume extends Entity {
  story_id: string;
  title: string;
  order_index: number;
  /** 预计算的卷字数缓存（所有章节字数之和） */
  word_count?: number;
}

export interface Chapter extends Entity {
  story_id: string;
  volume_id: string | null;
  title: string;
  order_index: number;
  /** 预计算的章字数缓存（所有节字数之和） */
  word_count?: number;
}

export interface Section extends Entity {
  chapter_id: string;
  title: string;
  order_index: number;
  /**
   * 新一代富文本：contenteditable HTML 字符串（含 data-type 节点）。
   * 老 content_blocks 表系统已删除，本字段是节的唯一正文存储。
   */
  content?: string;
  /**
   * 原始 BBCode 文本（可选）。
   * - 仅当 section 是从"收集安科"导入时设置
   * - 编辑器 BBCode 视图优先使用本字段直接渲染，避免 HTML ↔ BBCode 回转失真
   * - Visual 视图仍使用 content（HTML）渲染
   * - 用户在 BBCode 视图编辑后，本字段会被更新（或由 visual 视图反推）
   */
  bbcode?: string;
  /** 预计算的正文字数缓存（0=未计算/无内容） */
  word_count?: number;
}

/**
 * 节元数据（不含正文 content/bbcode），用于列表/目录等场景的按需加载。
 * 打开作品时只加载元数据，正文通过 getSectionContent 按需获取。
 */
export interface SectionMeta extends Entity {
  chapter_id: string;
  title: string;
  order_index: number;
  /** 预计算的正文字数缓存 */
  word_count?: number;
}

// ------------------------------------------------------------
// 聚合（导出/导入使用）
// ------------------------------------------------------------

export interface ChapterWithSections extends Chapter {
  sections: Section[];
}

/**
 * 收藏夹（用户自建的故事分组容器）
 * - 桌面端存于 favorites.json（主进程 DB）
 * - 浏览器降级存于 src/db/favorites.ts 的内存 Map
 */
export interface Favorite {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface StoryWithAll extends Story {
  world_settings: WorldSetting[];
  characters: Character[];
  outlines: Outline[];
  volumes: Volume[];
  chapters: ChapterWithSections[];
}
