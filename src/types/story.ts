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
}

export interface Chapter extends Entity {
  story_id: string;
  volume_id: string | null;
  title: string;
  order_index: number;
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
}

// ------------------------------------------------------------
// 聚合（导出/导入使用）
// ------------------------------------------------------------

export interface ChapterWithSections extends Chapter {
  sections: Section[];
}

export interface StoryWithAll extends Story {
  world_settings: WorldSetting[];
  characters: Character[];
  outlines: Outline[];
  volumes: Volume[];
  chapters: ChapterWithSections[];
}
