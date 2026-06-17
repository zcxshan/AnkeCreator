// ============================================================
// 主进程数据持久化层（Electron main process）
//
// 使用 Node.js fs + JSON 实现，不依赖任何原生模块（如 better-sqlite3）
// 因此：
//  - 不需要编译
//  - 不触发 Windows 杀毒软件
//  - 打包进 asar 后仍能正常工作（数据放在 userData 目录）
//
// 文件结构：
//  <userData>/AnkeCreatorData/
//    ├── stories.json              // 故事列表（包含标题、描述等）
//    ├── world_settings.json       // 世界观设定（跨故事/按 story_id 分组）
//    ├── characters.json           // 人物（含差分 variants 内嵌）
//    ├── outlines.json             // 大纲
//    ├── volumes.json              // 卷
//    ├── chapters.json             // 章
//    ├── sections.json             // 节（含 content 正文）
//    ├── content_blocks.json       // 内容块
//    ├── character_relations.json  // 人物关系
//    ├── world_templates.json      // 世界观模板
//    └── character_templates.json  // 人物模板
//
// 每个文件都是 Record<string, T>，key 为实体 id。
// 写操作通过 fs.writeFileSync（同步），读取通过 fs.readFileSync。
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { WorldSettingTemplate, CharacterTemplate, CharacterVariant } from '../src/types';

// —— 工具函数 —— //

function uuid4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function nowISO(): string {
  return new Date().toISOString();
}

let dataDir: string | null = null;
function getDataDir(): string {
  if (!dataDir) {
    const base = app.getPath('userData');
    dataDir = path.join(base, 'AnkeCreatorData');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }
  return dataDir;
}

function filePath(name: string): string {
  return path.join(getDataDir(), name);
}

function loadJSON<T>(name: string, fallback: T): T {
  const p = filePath(name);
  try {
    if (!fs.existsSync(p)) return fallback;
    const raw = fs.readFileSync(p, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (e) {
    console.error('[db-main] loadJSON failed for', name, e);
    return fallback;
  }
}

function saveJSON(name: string, data: unknown): void {
  const p = filePath(name);
  try {
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 0), 'utf-8');
    fs.renameSync(tmp, p); // 原子替换，防止写入中途崩溃损坏数据
  } catch (e) {
    console.error('[db-main] saveJSON failed for', name, e);
    throw e;
  }
}

// —— 初始化 —— //

let initialized = false;

export function initMainDatabase(): void {
  if (initialized) return;
  const dir = getDataDir();
  console.log('[db-main] data directory:', dir);

  // —— stories —— //
  const storiesFile = filePath('stories.json');
  if (!fs.existsSync(storiesFile)) {
    saveJSON('stories.json', {} as Record<string, any>);
  }

  // 初始化空表
  const emptyTables = [
    'world_settings',
    'characters',
    'outlines',
    'volumes',
    'chapters',
    'sections',
    'content_blocks',
    'character_relations',
  ];
  for (const t of emptyTables) {
    if (!fs.existsSync(filePath(t + '.json'))) {
      saveJSON(t + '.json', {} as Record<string, any>);
    }
  }

  // —— 模板文件 —— //
  // 不再 seed 预置模板。文件首次创建时初始化为空对象。
  // 旧 is_preset=1 记录在首次加载时被过滤清理（见 cleanupLegacyPresetTemplates）。
  const worldTplPath = filePath('world_templates.json');
  if (!fs.existsSync(worldTplPath)) {
    saveJSON('world_templates.json', {});
  } else {
    cleanupLegacyPresetTemplates('world_templates.json');
  }

  const charTplPath = filePath('character_templates.json');
  if (!fs.existsSync(charTplPath)) {
    saveJSON('character_templates.json', {});
  } else {
    cleanupLegacyPresetTemplates('character_templates.json');
  }

  initialized = true;
}

// 一次性清理老版本遗留的预置模板（is_preset === 1）
function cleanupLegacyPresetTemplates(file: string): void {
  const rows = loadJSON<Record<string, any>>(file, {});
  let changed = false;
  for (const id of Object.keys(rows)) {
    if (Number(rows[id]?.is_preset) === 1) {
      delete rows[id];
      changed = true;
    }
  }
  if (changed) {
    saveJSON(file, rows);
    console.log(`[db-main] 已清理 ${file} 中的预置模板`);
  }
}

// —— 通用 CRUD —— //

type Row = { id: string; created_at: string; updated_at: string; [k: string]: any };

function readTable<T extends Row>(table: string): Record<string, T> {
  return loadJSON<Record<string, T>>(table + '.json', {});
}

function writeTable<T>(table: string, data: Record<string, T>): void {
  saveJSON(table + '.json', data);
}

function createRow<T extends Row>(table: string, obj: Omit<T, 'id' | 'created_at' | 'updated_at'> & Partial<Pick<T, 'id' | 'created_at' | 'updated_at'>>): T {
  const now = nowISO();
  const row: any = {
    ...obj,
    id: (obj as any).id || uuid4(),
    created_at: (obj as any).created_at || now,
    updated_at: now,
  };
  const all = readTable<T>(table);
  all[row.id] = row;
  writeTable(table, all);
  return row;
}

function updateRow<T extends Row>(table: string, id: string, patch: Partial<T>): T | null {
  const all = readTable<T>(table);
  if (!all[id]) return null;
  const next: any = { ...all[id], ...patch, updated_at: nowISO() };
  all[id] = next;
  writeTable(table, all);
  return next;
}

function deleteRow<T extends Row>(table: string, id: string): boolean {
  const all = readTable<T>(table);
  if (!all[id]) return false;
  delete all[id];
  writeTable(table, all);
  return true;
}

// —— Story —— //

type StoryRow = {
  id: string;
  title: string;
  description: string;
  category: string;
  order_index: number;
  is_starred: number;
  is_pinned: number;
  is_deleted?: number;
  deleted_at?: string;
  created_at: string;
  updated_at: string;
};

export function listStories(): StoryRow[] {
  const all = readTable<StoryRow>('stories');
  return Object.values(all)
    .filter((s) => !s.is_deleted)
    .sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return b.is_pinned - a.is_pinned;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
}

export function getStory(id: string): StoryRow | undefined {
  return readTable<StoryRow>('stories')[id];
}

export function createStory(data: { title: string; description?: string; category?: string }): StoryRow {
  const existing = listStories();
  const order = existing.length > 0 ? Math.max(...existing.map((s) => s.order_index || 0)) + 1 : 0;
  return createRow<StoryRow>('stories', {
    title: data.title || '未命名作品',
    description: data.description || '',
    category: data.category || '',
    order_index: order,
    is_starred: 0,
    is_pinned: 0,
  } as any);
}

export function updateStory(id: string, patch: Partial<StoryRow>): StoryRow | undefined {
  const r = updateRow<StoryRow>('stories', id, patch as any);
  return r || undefined;
}

export function deleteStory(id: string): void {
  // 删除故事 → 连带删除其下所有相关数据
  deleteRow('stories', id);
  // 级联：world_settings, characters, outlines, volumes, chapters, sections, content_blocks, relations
  const cascadeByStory = (table: string) => {
    const all = readTable<any>(table);
    for (const key of Object.keys(all)) {
      if (all[key].story_id === id) delete all[key];
    }
    writeTable(table, all);
  };
  cascadeByStory('world_settings');
  cascadeByStory('characters');
  cascadeByStory('outlines');
  cascadeByStory('volumes');
  cascadeByStory('character_relations');

  // 删除章 / 节 / 内容块（通过卷 → 章 → 节）
  const chapters = Object.values(readTable<any>('chapters')).filter((c: any) => c.story_id === id);
  const volumes = Object.values(readTable<any>('volumes')).filter((v: any) => v.story_id === id);
  const allChapters = readTable<any>('chapters');
  for (const ch of chapters) delete allChapters[ch.id];
  writeTable('chapters', allChapters);

  const allVolumes = readTable<any>('volumes');
  for (const v of volumes) delete allVolumes[v.id];
  writeTable('volumes', allVolumes);

  // sections 级联：通过该故事的章 id 找到所有节并删除
  const chapterIdsOfStory = new Set(chapters.map((c: any) => c.id));
  const allSections2 = readTable<any>('sections');
  const sectionIdsOfStory = new Set<string>();
  for (const key of Object.keys(allSections2)) {
    if (chapterIdsOfStory.has(allSections2[key].chapter_id)) {
      sectionIdsOfStory.add(key);
      delete allSections2[key];
    }
  }
  writeTable('sections', allSections2);

  // content_blocks
  const allBlocks = readTable<any>('content_blocks');
  for (const key of Object.keys(allBlocks)) {
    if (sectionIdsOfStory.has(allBlocks[key].section_id)) {
      delete allBlocks[key];
    }
  }
  writeTable('content_blocks', allBlocks);
}

// —— 回收站：软删除 / 恢复 / 永久删除 ——

export function softDeleteStory(id: string): void {
  const now = new Date().toISOString();
  updateRow<StoryRow>('stories', id, {
    is_deleted: 1,
    deleted_at: now,
    updated_at: now,
  } as any);
}

export function restoreStory(id: string): void {
  const now = new Date().toISOString();
  updateRow<StoryRow>('stories', id, {
    is_deleted: 0,
    deleted_at: '',
    updated_at: now,
  } as any);
}

export function permanentlyDeleteStory(id: string): void {
  // 复用 deleteStory 的逻辑：真实删除 + 级联
  deleteStory(id);
}

export function listTrashedStories(): StoryRow[] {
  const all = readTable<StoryRow>('stories');
  return Object.values(all)
    .filter((s) => s.is_deleted === 1)
    .sort((a, b) => new Date(b.deleted_at || b.updated_at).getTime() - new Date(a.deleted_at || a.updated_at).getTime());
}

export function cleanupOldTrashed(days: number): number {
  const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const all = readTable<StoryRow>('stories');
  const oldIds: string[] = [];
  for (const s of Object.values(all)) {
    if (s.is_deleted === 1 && s.deleted_at && s.deleted_at < threshold) {
      oldIds.push(s.id);
    }
  }
  for (const id of oldIds) {
    permanentlyDeleteStory(id);
  }
  return oldIds.length;
}

// —— WorldSettings —— //

type WorldSettingRow = {
  id: string;
  story_id: string;
  title: string;
  content: string;
  order_index: number;
  created_at: string;
  updated_at: string;
};

export function listWorldSettings(storyId: string): WorldSettingRow[] {
  const all = readTable<WorldSettingRow>('world_settings');
  return Object.values(all)
    .filter((r) => r.story_id === storyId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
}

export function createWorldSetting(data: Omit<WorldSettingRow, 'id' | 'created_at' | 'updated_at'> & Partial<Pick<WorldSettingRow, 'order_index'>>): WorldSettingRow {
  const existing = listWorldSettings(data.story_id);
  const order = typeof data.order_index === 'number' ? data.order_index : existing.length;
  return createRow<WorldSettingRow>('world_settings', {
    story_id: data.story_id,
    title: data.title || '未命名世界观',
    content: data.content || '',
    order_index: order,
  } as any);
}

export function updateWorldSetting(id: string, patch: Partial<WorldSettingRow>): WorldSettingRow | undefined {
  return updateRow<WorldSettingRow>('world_settings', id, patch as any) || undefined;
}

export function deleteWorldSetting(id: string): void {
  deleteRow('world_settings', id);
}

/** 按 orderedIds 重新排序当前故事下所有世界观（按顺序写入 order_index） */
export function reorderWorldSettings(storyId: string, orderedIds: string[]): void {
  orderedIds.forEach((id, i) => updateWorldSetting(id, { order_index: i }));
}

// —— Character —— //

type CharacterVariantRow = { id: string; name: string; url: string; order_index: number };
type CharacterRow = {
  id: string;
  story_id: string;
  name: string;
  avatar: string;
  personality: string;
  attributes: string; // JSON string
  notes: string;
  variants: string; // JSON string of CharacterVariantRow[]
  order_index: number;
  created_at: string;
  updated_at: string;
};

function parseJSON<T>(raw: any, fallback: T): T {
  if (raw == null) return fallback;
  try {
    return typeof raw === 'string' ? (JSON.parse(raw) as T) : (raw as T);
  } catch {
    return fallback;
  }
}

function serializeJSON(obj: any): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return JSON.stringify({});
  }
}

export function listCharacters(storyId: string): any[] {
  const all = readTable<CharacterRow>('characters');
  return Object.values(all)
    .filter((r) => r.story_id === storyId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    .map((r) => ({
      id: r.id,
      story_id: r.story_id,
      name: r.name,
      avatar: r.avatar || '',
      personality: r.personality || '',
      attributes: parseJSON<Record<string, string | number>>(r.attributes, {}),
      notes: r.notes || '',
      variants: parseJSON<CharacterVariantRow[]>(r.variants, []),
      order_index: r.order_index,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
}

export function createCharacter(data: {
  story_id: string;
  name: string;
  avatar?: string;
  personality?: string;
  attributes?: Record<string, string | number>;
  notes?: string;
  order_index?: number;
}): any {
  const existing = listCharacters(data.story_id);
  const order = typeof data.order_index === 'number' ? data.order_index : existing.length;
  const row = createRow<CharacterRow>('characters', {
    story_id: data.story_id,
    name: data.name || '未命名角色',
    avatar: data.avatar || '',
    personality: data.personality || '',
    attributes: serializeJSON(data.attributes || {}),
    notes: data.notes || '',
    variants: serializeJSON([]),
    order_index: order,
  } as any);
  return {
    id: row.id,
    story_id: row.story_id,
    name: row.name,
    avatar: row.avatar,
    personality: row.personality,
    attributes: parseJSON(row.attributes, {}),
    notes: row.notes,
    variants: [],
    order_index: row.order_index,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function updateCharacter(
  id: string,
  patch: Partial<{
    name: string;
    avatar: string;
    personality: string;
    attributes: Record<string, string | number> | string;
    notes: string;
    order_index: number;
  }>,
): any | undefined {
  const dbPatch: any = {};
  if ('name' in patch) dbPatch.name = patch.name;
  if ('avatar' in patch) dbPatch.avatar = patch.avatar;
  if ('personality' in patch) dbPatch.personality = patch.personality;
  if ('notes' in patch) dbPatch.notes = patch.notes;
  if ('order_index' in patch) dbPatch.order_index = patch.order_index;
  if ('attributes' in patch) {
    dbPatch.attributes = typeof patch.attributes === 'string' ? patch.attributes : serializeJSON(patch.attributes);
  }
  const row = updateRow<CharacterRow>('characters', id, dbPatch);
  if (!row) return undefined;
  return {
    id: row.id,
    story_id: row.story_id,
    name: row.name,
    avatar: row.avatar,
    personality: row.personality,
    attributes: parseJSON(row.attributes, {}),
    notes: row.notes,
    variants: parseJSON<CharacterVariantRow[]>(row.variants, []),
    order_index: row.order_index,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function deleteCharacter(id: string): void {
  deleteRow('characters', id);
}

/**
 * 重新排序某作品下的所有人物
 */
export function reorderCharacters(storyId: string, orderedIds: string[]): void {
  orderedIds.forEach((id, i) => updateCharacter(id, { order_index: i }));
}

// —— Character Variants（内嵌在 characters 的 variants 字段中）—— //

function readCharacterWithVariants(characterId: string): { row: CharacterRow; variants: CharacterVariantRow[] } | null {
  const all = readTable<CharacterRow>('characters');
  const row = all[characterId];
  if (!row) return null;
  const variants = parseJSON<CharacterVariantRow[]>(row.variants, []);
  return { row, variants };
}

function writeCharacterVariants(characterId: string, variants: CharacterVariantRow[]): void {
  updateRow<CharacterRow>('characters', characterId, { variants: serializeJSON(variants) } as any);
}

export function listCharacterVariants(characterId: string): CharacterVariantRow[] {
  const info = readCharacterWithVariants(characterId);
  if (!info) return [];
  return info.variants.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
}

export function createCharacterVariant(data: { character_id: string; name: string; url: string; order_index?: number }): CharacterVariantRow {
  const info = readCharacterWithVariants(data.character_id);
  if (!info) throw new Error('character not found: ' + data.character_id);
  const existing = info.variants;
  const order = typeof data.order_index === 'number' ? data.order_index : existing.length;
  const newVar: CharacterVariantRow = { id: uuid4(), name: data.name || '差分', url: data.url || '', order_index: order };
  existing.push(newVar);
  writeCharacterVariants(data.character_id, existing);
  return newVar;
}

export function createCharacterVariantsBatch(characterId: string, items: { name?: string; url: string }[]): CharacterVariantRow[] {
  const info = readCharacterWithVariants(characterId);
  if (!info) throw new Error('character not found: ' + characterId);
  const existing = info.variants;
  let order = existing.length;
  const created: CharacterVariantRow[] = [];
  for (const it of items) {
    const newVar: CharacterVariantRow = { id: uuid4(), name: (it.name || '差分').trim(), url: it.url || '', order_index: order++ };
    existing.push(newVar);
    created.push(newVar);
  }
  writeCharacterVariants(characterId, existing);
  return created;
}

export function updateCharacterVariant(id: string, patch: Partial<{ name: string; url: string; order_index: number }>): void {
  // 找到 character_id
  const all = readTable<CharacterRow>('characters');
  for (const cid of Object.keys(all)) {
    const variants = parseJSON<CharacterVariantRow[]>(all[cid].variants, []);
    const idx = variants.findIndex((v) => v.id === id);
    if (idx >= 0) {
      variants[idx] = { ...variants[idx], ...patch };
      writeCharacterVariants(cid, variants);
      return;
    }
  }
}

export function deleteCharacterVariant(id: string): void {
  const all = readTable<CharacterRow>('characters');
  for (const cid of Object.keys(all)) {
    const variants = parseJSON<CharacterVariantRow[]>(all[cid].variants, []);
    const filtered = variants.filter((v) => v.id !== id);
    if (filtered.length !== variants.length) {
      writeCharacterVariants(cid, filtered);
      return;
    }
  }
}

export function reorderCharacterVariants(characterId: string, orderedIds: string[]): void {
  const info = readCharacterWithVariants(characterId);
  if (!info) return;
  const orderMap: Record<string, number> = {};
  orderedIds.forEach((id, i) => (orderMap[id] = i));
  const next = info.variants
    .map((v) => ({ ...v, order_index: orderMap[v.id] ?? v.order_index }))
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
  writeCharacterVariants(characterId, next);
}

// —— Character Relations —— //

type RelationRow = {
  id: string;
  story_id: string;
  source_id: string;
  target_id: string;
  relation: string;
  note: string;
  order_index: number;
  created_at: string;
  updated_at: string;
};

export function listCharacterRelations(storyId: string): RelationRow[] {
  const all = readTable<RelationRow>('character_relations');
  return Object.values(all)
    .filter((r) => r.story_id === storyId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
}

export function createCharacterRelation(data: { story_id: string; source_id: string; target_id: string; relation: string; note?: string; order_index?: number }): RelationRow {
  const existing = listCharacterRelations(data.story_id);
  const order = typeof data.order_index === 'number' ? data.order_index : existing.length;
  return createRow<RelationRow>('character_relations', {
    story_id: data.story_id,
    source_id: data.source_id,
    target_id: data.target_id,
    relation: data.relation || '',
    note: data.note || '',
    order_index: order,
  } as any);
}

export function updateCharacterRelation(id: string, patch: Partial<RelationRow>): RelationRow | undefined {
  return updateRow<RelationRow>('character_relations', id, patch as any) || undefined;
}

export function deleteCharacterRelation(id: string): void {
  deleteRow('character_relations', id);
}

// —— Outline —— //

type OutlineRow = {
  id: string;
  story_id: string;
  content: string; // JSON payload（title, target_type, target_id, parent_outline_id, body）
  order_index: number;
  created_at: string;
  updated_at: string;
};

export function listOutlines(storyId: string): OutlineRow[] {
  const all = readTable<OutlineRow>('outlines');
  return Object.values(all)
    .filter((r) => r.story_id === storyId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
}

export function createOutline(data: { story_id: string; content: string; order_index?: number }): OutlineRow {
  const existing = listOutlines(data.story_id);
  const order = typeof data.order_index === 'number' ? data.order_index : existing.length;
  return createRow<OutlineRow>('outlines', {
    story_id: data.story_id,
    content: data.content,
    order_index: order,
  } as any);
}

export function updateOutline(id: string, patch: Partial<{ content: string; order_index: number }>): OutlineRow | undefined {
  return updateRow<OutlineRow>('outlines', id, patch as any) || undefined;
}

export function deleteOutline(id: string): void {
  deleteRow('outlines', id);
}

// —— Volume —— //

type VolumeRow = {
  id: string;
  story_id: string;
  title: string;
  order_index: number;
  created_at: string;
  updated_at: string;
};

export function listVolumes(storyId: string): VolumeRow[] {
  const all = readTable<VolumeRow>('volumes');
  return Object.values(all)
    .filter((r) => r.story_id === storyId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
}

export function createVolume(data: { story_id: string; title: string; order_index?: number }): VolumeRow {
  const existing = listVolumes(data.story_id);
  const order = typeof data.order_index === 'number' ? data.order_index : existing.length;
  return createRow<VolumeRow>('volumes', {
    story_id: data.story_id,
    title: data.title,
    order_index: order,
  } as any);
}

export function updateVolume(id: string, patch: Partial<VolumeRow>): VolumeRow | undefined {
  return updateRow<VolumeRow>('volumes', id, patch as any) || undefined;
}

export function deleteVolume(id: string): void {
  // 连带删除此卷下的章
  const chapters = Object.values(readTable<ChapterRow>('chapters')).filter((c) => c.volume_id === id);
  for (const ch of chapters) deleteChapter(ch.id);
  deleteRow('volumes', id);
}

export function reorderVolumes(storyId: string, orderedIds: string[]): void {
  orderedIds.forEach((id, i) => updateVolume(id, { order_index: i }));
}

// —— Chapter —— //

type ChapterRow = {
  id: string;
  story_id: string;
  volume_id: string | null;
  title: string;
  order_index: number;
  created_at: string;
  updated_at: string;
};

export function listChapters(storyId: string): ChapterRow[] {
  const all = readTable<ChapterRow>('chapters');
  return Object.values(all)
    .filter((r) => r.story_id === storyId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
}

export function listChaptersByVolume(volumeId: string): ChapterRow[] {
  const all = readTable<ChapterRow>('chapters');
  return Object.values(all)
    .filter((r) => r.volume_id === volumeId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
}

export function createChapter(data: { story_id: string; volume_id?: string | null; title: string; order_index?: number }): ChapterRow {
  const existing = listChapters(data.story_id);
  const order = typeof data.order_index === 'number' ? data.order_index : existing.length;
  return createRow<ChapterRow>('chapters', {
    story_id: data.story_id,
    volume_id: data.volume_id ?? null,
    title: data.title,
    order_index: order,
  } as any);
}

export function updateChapter(id: string, patch: Partial<ChapterRow>): ChapterRow | undefined {
  return updateRow<ChapterRow>('chapters', id, patch as any) || undefined;
}

export function deleteChapter(id: string): void {
  // 连带删除此章下的节
  const sections = Object.values(readTable<SectionRow>('sections')).filter((s) => s.chapter_id === id);
  for (const s of sections) deleteSection(s.id);
  deleteRow('chapters', id);
}

export function reorderChapters(storyId: string, orderedIds: string[]): void {
  orderedIds.forEach((id, i) => updateChapter(id, { order_index: i }));
}

// —— Section —— //

type SectionRow = {
  id: string;
  chapter_id: string;
  title: string;
  content: string | null; // 正文（富文本 JSON）
  order_index: number;
  created_at: string;
  updated_at: string;
};

export function listSections(chapterId: string): SectionRow[] {
  const all = readTable<SectionRow>('sections');
  return Object.values(all)
    .filter((r) => r.chapter_id === chapterId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
}

export function createSection(data: { chapter_id: string; title: string; content?: string | null; order_index?: number }): SectionRow {
  const existing = listSections(data.chapter_id);
  const order = typeof data.order_index === 'number' ? data.order_index : existing.length;
  return createRow<SectionRow>('sections', {
    chapter_id: data.chapter_id,
    title: data.title,
    content: data.content ?? null,
    order_index: order,
  } as any);
}

export function updateSection(id: string, patch: Partial<SectionRow>): SectionRow | undefined {
  return updateRow<SectionRow>('sections', id, patch as any) || undefined;
}

export function deleteSection(id: string): void {
  // 连带删除内容块
  const blocks = Object.values(readTable<any>('content_blocks')).filter((b) => b.section_id === id);
  for (const b of blocks) deleteBlock(b.id);
  deleteRow('sections', id);
}

export function getSectionContent(id: string): string | null {
  const all = readTable<SectionRow>('sections');
  return all[id] ? all[id].content : null;
}

export function setSectionContent(id: string, content: string | null): void {
  updateRow<SectionRow>('sections', id, { content } as any);
}

export function reorderSections(chapterId: string, orderedIds: string[]): void {
  orderedIds.forEach((id, i) => updateSection(id, { order_index: i }));
}

// —— Content Blocks —— //

type BlockRow = {
  id: string;
  section_id: string;
  type: 'text' | 'image' | 'dice';
  payload: string; // JSON
  order_index: number;
  created_at: string;
  updated_at: string;
};

export function listBlocks(sectionId: string): any[] {
  const all = readTable<BlockRow>('content_blocks');
  return Object.values(all)
    .filter((r) => r.section_id === sectionId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    .map((r) => ({
      id: r.id,
      section_id: r.section_id,
      type: r.type,
      payload: parseJSON<any>(r.payload, {}),
      order_index: r.order_index,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
}

export function createBlock(sectionId: string, type: 'text' | 'image' | 'dice', payload: any, orderIndex?: number): any {
  const existing = listBlocks(sectionId);
  const order = typeof orderIndex === 'number' ? orderIndex : existing.length;
  const row = createRow<BlockRow>('content_blocks', {
    section_id: sectionId,
    type,
    payload: serializeJSON(payload),
    order_index: order,
  } as any);
  return {
    id: row.id,
    section_id: row.section_id,
    type: row.type,
    payload: parseJSON<any>(row.payload, {}),
    order_index: row.order_index,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function updateBlockPayload(id: string, payload: any): any {
  updateRow<BlockRow>('content_blocks', id, { payload: serializeJSON(payload) } as any);
  const all = readTable<BlockRow>('content_blocks');
  const row = all[id];
  if (!row) return null;
  return {
    id: row.id,
    section_id: row.section_id,
    type: row.type,
    payload: parseJSON<any>(row.payload, {}),
    order_index: row.order_index,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function reorderBlocks(sectionId: string, orderedIds: string[]): void {
  orderedIds.forEach((id, i) => {
    updateRow<BlockRow>('content_blocks', id, { order_index: i } as any);
  });
}

export function deleteBlock(id: string): void {
  deleteRow('content_blocks', id);
}

// —— Templates —— //

export function listWorldSettingTemplates(): WorldSettingTemplate[] {
  const all = readTable<WorldSettingTemplate>('world_templates');
  return Object.values(all).sort(
    (a, b) =>
      (a.order_index ?? 0) - (b.order_index ?? 0) ||
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
}

export function createWorldSettingTemplate(data: { title: string; content?: string }): WorldSettingTemplate {
  const existing = readTable<WorldSettingTemplate>('world_templates');
  const order = Object.values(existing).length;
  return createRow<WorldSettingTemplate>('world_templates', {
    title: data.title,
    content: data.content || '',
    order_index: order,
  } as any);
}

export function updateWorldSettingTemplate(id: string, patch: Partial<{ title: string; content: string; order_index: number }>): WorldSettingTemplate | undefined {
  return updateRow<WorldSettingTemplate>('world_templates', id, patch as any) || undefined;
}

export function deleteWorldSettingTemplate(id: string): void {
  deleteRow('world_templates', id);
}

/** 重新排序所有世界观模板 */
export function reorderWorldSettingTemplates(orderedIds: string[]): void {
  orderedIds.forEach((id, i) =>
    updateWorldSettingTemplate(id, { order_index: i }),
  );
}

export function listCharacterTemplates(): CharacterTemplate[] {
  const all = readTable<CharacterTemplate>('character_templates');
  return Object.values(all)
    .sort(
      (a, b) =>
        (a.order_index ?? 0) - (b.order_index ?? 0) ||
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    )
    .map((r) => ({
      id: r.id,
      name: r.name,
      avatar: r.avatar || '',
      personality: r.personality || '',
      attributes: parseJSON<Record<string, string | number>>(r.attributes, {}),
      notes: r.notes || '',
      variants: parseJSON<CharacterVariant[]>(r.variants, []),
      order_index: r.order_index ?? 0,
      created_at: r.created_at,
      updated_at: r.updated_at,
    } as CharacterTemplate));
}

export function createCharacterTemplate(data: {
  name: string;
  avatar?: string;
  personality?: string;
  attributes?: Record<string, string | number>;
  notes?: string;
  variants?: CharacterVariant[];
}): CharacterTemplate {
  const existing = readTable<CharacterTemplate>('character_templates');
  const order = Object.values(existing).length;
  const row = createRow<CharacterTemplate>('character_templates', {
    name: data.name,
    avatar: data.avatar || '',
    personality: data.personality || '',
    attributes: serializeJSON(data.attributes || {}),
    notes: data.notes || '',
    variants: serializeJSON(data.variants || []),
    order_index: order,
  } as any);
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    personality: row.personality,
    attributes: parseJSON(row.attributes, {}),
    notes: row.notes,
    variants: parseJSON<CharacterVariant[]>(row.variants, []),
    order_index: row.order_index ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  } as CharacterTemplate;
}

export function updateCharacterTemplate(
  id: string,
  patch: Partial<{
    name: string;
    avatar: string;
    personality: string;
    attributes: Record<string, string | number>;
    notes: string;
    variants: CharacterVariant[];
    order_index: number;
  }>,
): CharacterTemplate | undefined {
  const dbPatch: any = {};
  if ('name' in patch) dbPatch.name = patch.name;
  if ('avatar' in patch) dbPatch.avatar = patch.avatar;
  if ('personality' in patch) dbPatch.personality = patch.personality;
  if ('notes' in patch) dbPatch.notes = patch.notes;
  if ('attributes' in patch) dbPatch.attributes = serializeJSON(patch.attributes);
  if ('variants' in patch) dbPatch.variants = serializeJSON(patch.variants);
  if ('order_index' in patch) dbPatch.order_index = patch.order_index;
  const row = updateRow<CharacterTemplate>('character_templates', id, dbPatch);
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    personality: row.personality,
    attributes: parseJSON(row.attributes, {}),
    notes: row.notes,
    variants: parseJSON<CharacterVariant[]>(row.variants, []),
    order_index: row.order_index ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function deleteCharacterTemplate(id: string): void {
  deleteRow('character_templates', id);
}

/** 重新排序所有人物模板 */
export function reorderCharacterTemplates(orderedIds: string[]): void {
  orderedIds.forEach((id, i) =>
    updateCharacterTemplate(id, { order_index: i }),
  );
}

// —— 聚合查询 —— //

export function getStoryWithAll(storyId: string): any {
  const story = getStory(storyId);
  if (!story) return undefined;
  return {
    ...story,
    world_settings: listWorldSettings(storyId),
    characters: listCharacters(storyId),
    outlines: listOutlines(storyId),
    volumes: listVolumes(storyId),
    chapters: listChapters(storyId).map((ch) => ({
      ...ch,
      sections: listSections(ch.id).map((sec) => ({
        ...sec,
        blocks: listBlocks(sec.id),
      })),
    })),
  };
}

export function getDataDirectory(): string {
  return getDataDir();
}
