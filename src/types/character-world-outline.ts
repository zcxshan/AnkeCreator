// ============================================================
// 角色 / 世界观 / 大纲 / 模板 相关类型
//
// 合并文件以减少空文件（plan 中 4 个域，文件大小均衡）
// ============================================================

import type { Entity } from './entity'

// ============================================================
// 角色
// ============================================================

export interface Character extends Entity {
  story_id: string;
  name: string;
  avatar?: string; // 本地路径或 base64
  personality?: string; // 性格描述
  attributes?: Record<string, string | number>; // { HP: 100, 力量: 18, ... }
  notes?: string;
  order_index: number;
  /** 人物差分（表情/姿势/服饰等图片变体），由 db.listCharacters 顺带填充 */
  variants?: CharacterVariant[];
}

/** 人物差分：一种图片变体（如某个表情、某个姿势、某套服装等）。 */
export interface CharacterVariant extends Entity {
  character_id: string;
  name: string; // 差分名称
  url: string; // 差分图片（base64 / 远程 URL / 本地路径）
  order_index: number;
}

/** 人物关系：源角色 + 关系名 + 目标角色。 */
export interface CharacterRelation extends Entity {
  story_id: string;
  source_id: string;
  target_id: string;
  relation: string;
  note?: string;
  order_index: number;
}

// ============================================================
// 世界观
// ============================================================

export interface WorldSetting extends Entity {
  story_id: string;
  title: string;
  content?: string; // 富文本或纯文本
  order_index: number;
}

// ============================================================
// 大纲
// ============================================================

export type OutlineTargetType = 'volume' | 'chapter';

export interface OutlinePayload {
  title: string;
  target_type: OutlineTargetType;
  /** 大纲侧章归属的卷 outline.id（章必填，卷为 null） */
  parent_outline_id: string | null;
  /** 关联目录侧的 volume.id 或 chapter.id（可为空表示未关联） */
  target_id: string;
  body: string;
}

export interface Outline extends Entity {
  story_id: string;
  content: string;
  order_index: number;
}

// ============================================================
// 模板（独立表，不属于具体作品）
// ============================================================

/** 世界观设定模板。结构与 WorldSetting 类似但无 story_id；含 order_index 用于拖动排序 */
export interface WorldSettingTemplate extends Entity {
  title: string;
  content?: string;
  order_index: number;
}

/** 人物模板。结构与 Character 类似但无 story_id；含 order_index 用于拖动排序 */
export interface CharacterTemplate extends Entity {
  name: string;
  avatar?: string;
  personality?: string;
  attributes?: Record<string, string | number>;
  notes?: string;
  variants?: CharacterVariant[];
  order_index: number;
}
