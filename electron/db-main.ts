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
    'character_relations',
  ];
  for (const t of emptyTables) {
    if (!fs.existsSync(filePath(t + '.json'))) {
      saveJSON(t + '.json', {} as Record<string, any>);
    }
  }

  // 旧版 content_blocks.json 一次性清理（已切换到新版富文本，不再使用）
  const legacyBlocksPath = filePath('content_blocks.json');
  if (fs.existsSync(legacyBlocksPath)) {
    try {
      fs.unlinkSync(legacyBlocksPath);
    } catch {
      /* ignore */
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

  // —— story_stats 缓存表 —— //
  // 首次创建时初始化为空对象；已存在时执行首次运行迁移（兼容老数据）
  if (!fs.existsSync(filePath('story_stats.json'))) {
    saveJSON('story_stats.json', {} as Record<string, any>);
  }

  initialized = true;

  // 启动迁移：如果 story_stats.json 为空但 stories 不为空，全量填充
  // （用户从老版本升级到带 stats 缓存的新版本时自动执行）
  migrateStoryStatsIfNeeded();
}

/** 首次运行迁移：如果 story_stats.json 为空但 stories 不为空，全量填充 */
function migrateStoryStatsIfNeeded(): void {
  const statsAll = readStoryStatsAll();
  const stories = listStories();
  if (stories.length > 0 && Object.keys(statsAll).length === 0) {
    console.log(
      `[db-main] 首次运行 stats 迁移：开始为 ${stories.length} 个作品计算 stats...`,
    );
    for (const s of stories) recomputeStoryStats(s.id);
    console.log('[db-main] stats 迁移完成');
  }
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

export interface StoryWithStats extends StoryRow {
  wordCount: number;
  sectionCount: number;
  chapterCount: number;
}

// —— Story Stats 缓存 —— //
// 设计：把首页/作品列表常用的聚合统计（字数/节数/章数）预计算到 story_stats.json
// 写入点维护：每次章节/节增删或正文修改时主动更新缓存
type StoryStatsRow = {
  story_id: string;
  word_count: number;
  section_count: number;
  chapter_count: number;
  updated_at: string;
};

/** 读取整个 stats 缓存表 */
function readStoryStatsAll(): Record<string, StoryStatsRow> {
  return readTable<StoryStatsRow>('story_stats');
}

/** 写入整个 stats 缓存表（原子写入） */
function writeStoryStatsAll(all: Record<string, StoryStatsRow>): void {
  writeTable('story_stats', all);
}

/** 读取单个 story 的 stats 缓存行（不存在则返回 null） */
function readStoryStats(storyId: string): StoryStatsRow | null {
  return readStoryStatsAll()[storyId] || null;
}

/** 写入单个 story 的 stats 缓存行（覆盖） */
function writeStoryStats(
  storyId: string,
  row: Omit<StoryStatsRow, 'story_id' | 'updated_at'>,
): void {
  const all = readStoryStatsAll();
  all[storyId] = { ...row, story_id: storyId, updated_at: nowISO() };
  writeStoryStatsAll(all);
}

/** 删除单个 story 的 stats 缓存行 */
function deleteStoryStats(storyId: string): void {
  const all = readStoryStatsAll();
  if (all[storyId]) {
    delete all[storyId];
    writeStoryStatsAll(all);
  }
}

/**
 * 全量重算单个 story 的统计（用于章节/节增删场景）。
 * 读 chapters.json + sections.json 中属于该 story 的部分，重新聚合并写入缓存。
 */
function recomputeStoryStats(storyId: string): void {
  const allChapters = Object.values(readTable<ChapterRow>('chapters')).filter(
    (c) => c.story_id === storyId,
  );
  const chapterIds = new Set(allChapters.map((c) => c.id));
  const allSections = Object.values(readTable<SectionRow>('sections')).filter(
    (s) => s.chapter_id != null && chapterIds.has(s.chapter_id),
  );
  let wordCount = 0;
  for (const sec of allSections) {
    wordCount += sec.word_count || 0;
  }
  writeStoryStats(storyId, {
    word_count: wordCount,
    section_count: allSections.length,
    chapter_count: allChapters.length,
  });
}

/**
 * 读取所有作品 + 预聚合统计（字数/节数/章数）。
 * 改为读 story_stats.json 缓存表（1 次文件读），首次运行 / 缓存缺失时返回 0 兜底。
 * chapters/sections 是物理删除（无 is_deleted 字段），无需过滤。
 */
export function listStoriesWithStats(): StoryWithStats[] {
  const stories = listStories();
  if (stories.length === 0) return [];
  const statsAll = readStoryStatsAll();
  return stories.map((story) => {
    const stats = statsAll[story.id];
    return {
      ...story,
      wordCount: stats?.word_count ?? 0,
      sectionCount: stats?.section_count ?? 0,
      chapterCount: stats?.chapter_count ?? 0,
    };
  });
}

export function getStory(id: string): StoryRow | undefined {
  return readTable<StoryRow>('stories')[id];
}

export function createStory(data: { title: string; description?: string; category?: string }): StoryRow {
  const existing = listStories();
  const order = existing.length > 0 ? Math.max(...existing.map((s) => s.order_index || 0)) + 1 : 0;
  const row = createRow<StoryRow>('stories', {
    title: data.title || '未命名作品',
    description: data.description || '',
    category: data.category || '',
    order_index: order,
    is_starred: 0,
    is_pinned: 0,
  } as any);
  // 维护 stats 缓存：新增作品时初始化为空统计行
  writeStoryStats(row.id, { word_count: 0, section_count: 0, chapter_count: 0 });
  return row;
}

export function updateStory(id: string, patch: Partial<StoryRow>): StoryRow | undefined {
  const r = updateRow<StoryRow>('stories', id, patch as any);
  return r || undefined;
}

export function deleteStory(id: string): void {
  // 删除故事 → 连带删除其下所有相关数据
  deleteRow('stories', id);
  // 级联：world_settings, characters, outlines, volumes, chapters, sections, relations
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

  // 删除章 / 节（通过卷 → 章 → 节）
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
  for (const key of Object.keys(allSections2)) {
    if (chapterIdsOfStory.has(allSections2[key].chapter_id)) {
      delete allSections2[key];
    }
  }
  writeTable('sections', allSections2);
  // 维护 stats 缓存：删除作品时一并删除对应 stats 缓存行
  deleteStoryStats(id);
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
  const row = createRow<ChapterRow>('chapters', {
    story_id: data.story_id,
    volume_id: data.volume_id ?? null,
    title: data.title,
    order_index: order,
  } as any);
  // 维护 stats 缓存：新增章节后 chapterCount+1
  recomputeStoryStats(data.story_id);
  return row;
}

export function updateChapter(id: string, patch: Partial<ChapterRow>): ChapterRow | undefined {
  return updateRow<ChapterRow>('chapters', id, patch as any) || undefined;
}

export function deleteChapter(id: string): void {
  // 先取 chapter.story_id，删除后用于重算 stats
  const chapter = readTable<ChapterRow>('chapters')[id];
  // 连带删除此章下的节
  const sections = Object.values(readTable<SectionRow>('sections')).filter((s) => s.chapter_id === id);
  for (const s of sections) deleteSection(s.id);
  deleteRow('chapters', id);
  // 维护 stats 缓存：删除章节后 chapterCount-N（一次性重算覆盖所有变化）
  if (chapter?.story_id) recomputeStoryStats(chapter.story_id);
}

export function reorderChapters(storyId: string, orderedIds: string[]): void {
  orderedIds.forEach((id, i) => updateChapter(id, { order_index: i }));
}

// 跨卷拖动：同时更新 chapter.volume_id 和 order_index
export function moveChapters(
  storyId: string,
  targetVolumeId: string | null,
  orderedIds: string[],
): void {
  orderedIds.forEach((id, i) => {
    updateChapter(id, { volume_id: targetVolumeId, order_index: i });
  });
}

function countWordsInHtml(html: string | null | undefined): number {
  if (!html) return 0;
  const text = String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, '');
  return text.length;
}

// —— Section —— //

type SectionRow = {
  id: string;
  chapter_id: string | null;
  title: string;
  content: string | null; // 正文（富文本 JSON）
  bbcode?: string | null; // 原始 BBCode 文本（来自"收集安科"导入的节；BBCode 视图优先用本字段）
  order_index: number;
  word_count?: number;
  created_at: string;
  updated_at: string;
};

export function listSections(chapterId: string): SectionRow[] {
  const all = readTable<SectionRow>('sections');
  return Object.values(all)
    .filter((r) => r.chapter_id === chapterId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
}

export function listSectionMetadata(chapterId: string) {
  return listSections(chapterId).map((r) => ({
    id: r.id,
    chapter_id: r.chapter_id,
    title: r.title,
    order_index: r.order_index,
    word_count: r.word_count || 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export function createSection(data: { chapter_id: string; title: string; content?: string | null; bbcode?: string | null; order_index?: number }): SectionRow {
  const existing = listSections(data.chapter_id);
  const order = typeof data.order_index === 'number' ? data.order_index : existing.length;
  const wc = countWordsInHtml(data.content ?? null);
  const row = createRow<SectionRow>('sections', {
    chapter_id: data.chapter_id,
    title: data.title,
    content: data.content ?? null,
    bbcode: data.bbcode ?? null,
    word_count: wc,
    order_index: order,
  } as any);
  // 维护 stats 缓存：新增节后 sectionCount+1, wordCount+=wc
  const chapter = readTable<ChapterRow>('chapters')[data.chapter_id];
  if (chapter?.story_id) recomputeStoryStats(chapter.story_id);
  return row;
}

export function updateSection(id: string, patch: Partial<SectionRow>): SectionRow | undefined {
  const r = updateRow<SectionRow>('sections', id, patch as any) || undefined;
  // 维护 stats 缓存：patch 可能含 content（影响 word_count）→ 重算最稳
  if (r && r.chapter_id && patch.content !== undefined) {
    const chapter = readTable<ChapterRow>('chapters')[r.chapter_id];
    if (chapter?.story_id) recomputeStoryStats(chapter.story_id);
  }
  return r;
}

export function deleteSection(id: string): void {
  // 先取 section.chapter_id，删除后用于反查 story_id 重算 stats
  const section = readTable<SectionRow>('sections')[id];
  deleteRow('sections', id);
  // 维护 stats 缓存：删除节后 sectionCount-1, wordCount-=wc
  if (section?.chapter_id) {
    const chapter = readTable<ChapterRow>('chapters')[section.chapter_id];
    if (chapter?.story_id) recomputeStoryStats(chapter.story_id);
  }
}

// —— Bulk Create (导入加速：只读写文件一次) —— //

export function bulkCreateVolumes(rows: Array<{ story_id: string; title: string; order_index?: number; _oldId?: string }>): Array<{ id: string; _oldId?: string }> {
  const all = readTable<VolumeRow>('volumes');
  const now = nowISO();
  const result: Array<{ id: string; _oldId?: string }> = [];
  for (const r of rows) {
    const id = uuid4();
    const order = typeof r.order_index === 'number' ? r.order_index : Object.values(all).filter((v: any) => v.story_id === r.story_id).length;
    all[id] = {
      id,
      story_id: r.story_id,
      title: r.title,
      order_index: order,
      created_at: now,
      updated_at: now,
    } as VolumeRow;
    result.push({ id, _oldId: r._oldId });
  }
  writeTable('volumes', all);
  return result;
}

export function bulkCreateChapters(rows: Array<{ story_id: string; volume_id?: string | null; title: string; order_index?: number; _oldId?: string }>): Array<{ id: string; _oldId?: string }> {
  const all = readTable<ChapterRow>('chapters');
  const now = nowISO();
  const result: Array<{ id: string; _oldId?: string }> = [];
  for (const r of rows) {
    const id = uuid4();
    const order = typeof r.order_index === 'number' ? r.order_index : Object.values(all).filter((c: any) => c.story_id === r.story_id).length;
    all[id] = {
      id,
      story_id: r.story_id,
      volume_id: r.volume_id ?? null,
      title: r.title,
      order_index: order,
      created_at: now,
      updated_at: now,
    } as ChapterRow;
    result.push({ id, _oldId: r._oldId });
  }
  writeTable('chapters', all);
  // 维护 stats 缓存：批量导入章节后，对所有涉及的 story 各重算一次（去重后通常 1 次）
  const involvedStoryIds = new Set(rows.map((r) => r.story_id));
  for (const sid of involvedStoryIds) recomputeStoryStats(sid);
  return result;
}

export function bulkCreateSections(rows: Array<{ chapter_id: string; title: string; content?: string | null; bbcode?: string | null; order_index?: number; _oldId?: string }>): Array<{ id: string; _oldId?: string }> {
  const all = readTable<SectionRow>('sections');
  const now = nowISO();
  const result: Array<{ id: string; _oldId?: string }> = [];
  for (const r of rows) {
    const id = uuid4();
    const order = typeof r.order_index === 'number' ? r.order_index : Object.values(all).filter((s: any) => s.chapter_id === r.chapter_id).length;
    const wc = countWordsInHtml(r.content ?? null);
    all[id] = {
      id,
      chapter_id: r.chapter_id,
      title: r.title,
      content: r.content ?? null,
      bbcode: r.bbcode ?? null,
      word_count: wc,
      order_index: order,
      created_at: now,
      updated_at: now,
    } as SectionRow;
    result.push({ id, _oldId: r._oldId });
  }
  writeTable('sections', all);
  // 维护 stats 缓存：批量导入节后，通过 chapter_id 反查 story_id，对所有涉及的 story 各重算一次
  const allChapters = readTable<ChapterRow>('chapters');
  const involvedStoryIds = new Set<string>();
  for (const r of rows) {
    const ch = allChapters[r.chapter_id];
    if (ch?.story_id) involvedStoryIds.add(ch.story_id);
  }
  for (const sid of involvedStoryIds) recomputeStoryStats(sid);
  return result;
}

export function getSectionContent(id: string): string | null {
  const all = readTable<SectionRow>('sections');
  return all[id] ? all[id].content : null;
}

export function setSectionContent(id: string, content: string | null): void {
  // 增量优化：避免每次改一个字就重算整个 story 的所有节
  // 读旧 word_count → 算 delta → 直接更新 stats 缓存行
  const all = readTable<SectionRow>('sections');
  const old = all[id];
  const oldWc = old?.word_count || 0;
  const wc = countWordsInHtml(content);
  if (old) {
    all[id] = { ...old, content, word_count: wc, updated_at: nowISO() };
    writeTable('sections', all);
    // 增量更新 story stats 缓存（反查 story_id 通过 chapter_id）
    if (old.chapter_id) {
      const chapter = readTable<ChapterRow>('chapters')[old.chapter_id];
      if (chapter?.story_id) {
        const stats = readStoryStats(chapter.story_id);
        if (stats) {
          writeStoryStats(chapter.story_id, {
            word_count: Math.max(0, stats.word_count + (wc - oldWc)),
            section_count: stats.section_count,
            chapter_count: stats.chapter_count,
          });
        } else {
          // 缓存缺失，兜底全量重算
          recomputeStoryStats(chapter.story_id);
        }
      }
    }
  }
  // 节不存在时无操作
}

export function setSectionBBCode(id: string, bbcode: string | null): void {
  updateRow<SectionRow>('sections', id, { bbcode } as any);
}

export function reorderSections(chapterId: string, orderedIds: string[]): void {
  orderedIds.forEach((id, i) => updateSection(id, { order_index: i }));
}

// 跨章拖动：同时更新 section.chapter_id 和 order_index
export function moveSections(
  targetChapterId: string | null,
  orderedIds: string[],
): void {
  orderedIds.forEach((id, i) => {
    updateSection(id, { chapter_id: targetChapterId, order_index: i });
  });
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
      sections: listSections(ch.id),
    })),
  };
}

export function getDataDirectory(): string {
  return getDataDir();
}
