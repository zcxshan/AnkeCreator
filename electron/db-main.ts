// ============================================================
// 主进程数据持久化层（Electron main process）—— per-story 文件方案 v2.0
//
// 每个 story 一个独立 JSON 文件，包含该 story 的所有关联数据：
//   - story 元数据
//   - volumes / chapters / sections
//   - world_settings / characters / character_variants / character_relations
//   - outlines
//   - dice_history（由渲染层通过导出/导入携带，日常读写仍由 zustand 管理）
//   - stats（缓存统计）
//
// 文件结构：
//   <dataRoot>/data/stories/<storyId>.json          正常作品
//   <dataRoot>/data/stories/<storyId>.json.bak      上一次写入前的备份
//   <dataRoot>/data/stories/__trash/<storyId>.json  软删除的作品
//   <dataRoot>/data/templates/                      跨作品共享模板
//   <dataRoot>/data/favorites.json                  收藏夹元数据
//   <dataRoot>/data/story_favorites.json            作品-收藏夹关联
//   <dataRoot>/data/story_stats.json                统计缓存（加速列表）
//
// 写入策略：
//   1. 先把当前主文件复制到 .bak（若存在）
//   2. 写入 .tmp 文件
//   3. rename .tmp → 主文件（原子替换）
//   4. 启动时若主文件 JSON 解析失败，自动从 .bak 恢复
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import type { WorldSettingTemplate, CharacterTemplate, CharacterVariant } from '../src/types';
import {
  getDataDir as getDataDirFromPaths,
  getStoriesDir,
  getTrashDir,
  getTemplatesDir,
  migrateFromUserDataIfNeeded,
} from './paths';

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

// —— 类型定义 —— //

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

type VolumeRow = {
  id: string;
  story_id: string;
  title: string;
  order_index: number;
  created_at: string;
  updated_at: string;
};

type ChapterRow = {
  id: string;
  story_id: string;
  volume_id: string | null;
  title: string;
  order_index: number;
  created_at: string;
  updated_at: string;
};

type SectionRow = {
  id: string;
  chapter_id: string | null;
  title: string;
  content: string | null;
  bbcode?: string | null;
  order_index: number;
  word_count?: number;
  created_at: string;
  updated_at: string;
};

type WorldSettingRow = {
  id: string;
  story_id: string;
  title: string;
  content: string;
  order_index: number;
  created_at: string;
  updated_at: string;
};

type CharacterVariantRow = {
  id: string;
  name: string;
  url: string;
  order_index: number;
};

type CharacterRow = {
  id: string;
  story_id: string;
  name: string;
  avatar: string;
  personality: string;
  attributes: string;
  notes: string;
  variants: string;
  order_index: number;
  created_at: string;
  updated_at: string;
};

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

type OutlineRow = {
  id: string;
  story_id: string;
  content: string;
  order_index: number;
  created_at: string;
  updated_at: string;
};

type StoryStatsRow = {
  story_id: string;
  word_count: number;
  section_count: number;
  chapter_count: number;
  updated_at: string;
};

type FavoriteRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type StoryFavoriteRow = {
  story_id: string;
  favorite_id: string;
  added_at: string;
};

type DiceHistoryRecord = {
  id: string;
  timestamp: number;
  storyId: string;
  diceName: string;
  diceType: string;
  result: string;
  resultDetail: string;
  sectionId: string;
  sectionTitle: string;
  payloadSnapshot: string;
};

/** per-story 文件完整结构 */
interface StoryBundle {
  format: 'anke-creator-story-v2';
  version: '2.0';
  exportedAt: string;
  story: StoryRow;
  volumes: VolumeRow[];
  chapters: ChapterRow[];
  sections: SectionRow[];
  world_settings: WorldSettingRow[];
  characters: CharacterRow[];
  character_relations: RelationRow[];
  outlines: OutlineRow[];
  dice_history: DiceHistoryRecord[];
  stats: { word_count: number; section_count: number; chapter_count: number };
}

function emptyBundle(story: StoryRow): StoryBundle {
  return {
    format: 'anke-creator-story-v2',
    version: '2.0',
    exportedAt: nowISO(),
    story,
    volumes: [],
    chapters: [],
    sections: [],
    world_settings: [],
    characters: [],
    character_relations: [],
    outlines: [],
    dice_history: [],
    stats: { word_count: 0, section_count: 0, chapter_count: 0 },
  };
}

// —— 文件读写 —— //

function getDataDir(): string {
  return getDataDirFromPaths();
}

function storyFilePath(storyId: string): string {
  return path.join(getStoriesDir(), `${storyId}.json`);
}

function storyBakPath(storyId: string): string {
  return path.join(getStoriesDir(), `${storyId}.json.bak`);
}

function trashedStoryFilePath(storyId: string): string {
  return path.join(getTrashDir(), `${storyId}.json`);
}

function templateFilePath(name: string): string {
  return path.join(getTemplatesDir(), `${name}.json`);
}

function templateBakPath(name: string): string {
  return path.join(getTemplatesDir(), `${name}.json.bak`);
}

function dataFilePath(name: string): string {
  return path.join(getDataDir(), `${name}.json`);
}

/** 通用 JSON 读取（带 .bak 恢复） */
function loadJSONWithRecovery<T>(filePath: string, bakPath: string, fallback: T): T {
  // 主文件读取
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    }
  } catch (e) {
    console.error(`[db-main] 主文件解析失败，尝试从 .bak 恢复: ${filePath}`, e);
    // 主文件损坏，尝试 .bak
    try {
      if (fs.existsSync(bakPath)) {
        const rawBak = fs.readFileSync(bakPath, 'utf-8');
        const parsed = JSON.parse(rawBak) as T;
        // 恢复主文件
        fs.writeFileSync(filePath, rawBak, 'utf-8');
        console.log(`[db-main] 已从 .bak 恢复: ${filePath}`);
        return parsed;
      }
    } catch (e2) {
      console.error(`[db-main] .bak 恢复也失败: ${bakPath}`, e2);
    }
    return fallback;
  }
  return fallback;
}

/** 通用 JSON 写入（tmp + rename 原子替换 + .bak 备份） */
function saveJSONWithBackup(filePath: string, bakPath: string, data: unknown): void {
  try {
    // 1. 若主文件存在，复制到 .bak
    if (fs.existsSync(filePath)) {
      try {
        fs.copyFileSync(filePath, bakPath);
      } catch (e) {
        console.warn(`[db-main] 备份 .bak 失败（不影响写入）: ${bakPath}`, e);
      }
    }
    // 2. 写入 .tmp
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 0), 'utf-8');
    // 3. rename → 主文件（原子替换）
    fs.renameSync(tmp, filePath);
  } catch (e) {
    console.error(`[db-main] saveJSONWithBackup failed for ${filePath}`, e);
    throw e;
  }
}

/** 读取 per-story 文件 */
function readStoryFile(storyId: string): StoryBundle | null {
  return loadJSONWithRecovery<StoryBundle | null>(storyFilePath(storyId), storyBakPath(storyId), null);
}

/** 写入 per-story 文件（带 .bak 备份） */
function writeStoryFile(storyId: string, bundle: StoryBundle): void {
  bundle.exportedAt = nowISO();
  saveJSONWithBackup(storyFilePath(storyId), storyBakPath(storyId), bundle);
}

/** 列出 stories/ 目录下所有 storyId（排除 .bak 和 __trash） */
function listStoryIds(): string[] {
  const dir = getStoriesDir();
  try {
    const files = fs.readdirSync(dir);
    return files
      .filter((f) => f.endsWith('.json') && !f.endsWith('.json.bak'))
      .map((f) => f.replace(/\.json$/, ''))
      .filter((id) => id !== '__trash');
  } catch {
    return [];
  }
}

/** 列出 __trash/ 目录下所有 storyId */
function listTrashedStoryIds(): string[] {
  const dir = getTrashDir();
  try {
    const files = fs.readdirSync(dir);
    return files
      .filter((f) => f.endsWith('.json') && !f.endsWith('.json.bak'))
      .map((f) => f.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

/** 读取全局 JSON 文件（无 .bak，用于 favorites/story_favorites/story_stats） */
function loadGlobalJSON<T>(name: string, fallback: T): T {
  const p = dataFilePath(name);
  try {
    if (!fs.existsSync(p)) return fallback;
    const raw = fs.readFileSync(p, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (e) {
    console.error('[db-main] loadGlobalJSON failed for', name, e);
    return fallback;
  }
}

/** 写入全局 JSON 文件（tmp + rename，无 .bak） */
function saveGlobalJSON(name: string, data: unknown): void {
  const p = dataFilePath(name);
  try {
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 0), 'utf-8');
    fs.renameSync(tmp, p);
  } catch (e) {
    console.error('[db-main] saveGlobalJSON failed for', name, e);
    throw e;
  }
}

/** 读取模板文件（带 .bak） */
function readTemplateFile<T>(name: string, fallback: T): T {
  return loadJSONWithRecovery<T>(templateFilePath(name), templateBakPath(name), fallback);
}

/** 写入模板文件（带 .bak） */
function writeTemplateFile<T>(name: string, data: T): void {
  saveJSONWithBackup(templateFilePath(name), templateBakPath(name), data);
}

// —— 初始化 —— //

let initialized = false;

export function initMainDatabase(): void {
  if (initialized) return;
  migrateFromUserDataIfNeeded();
  const dir = getDataDir();
  console.log('[db-main] data directory:', dir);

  // 确保子目录存在
  getStoriesDir();
  getTrashDir();
  getTemplatesDir();

  // 迁移旧格式（AnkeCreatorData/ 下的 10 个全局文件）
  migrateFromOldFormatIfNeeded();

  // 初始化全局文件（favorites / story_favorites / story_stats）
  if (!fs.existsSync(dataFilePath('favorites'))) {
    saveGlobalJSON('favorites', {});
  }
  if (!fs.existsSync(dataFilePath('story_favorites'))) {
    saveGlobalJSON('story_favorites', {});
  }
  if (!fs.existsSync(dataFilePath('story_stats'))) {
    saveGlobalJSON('story_stats', {});
  }

  // 初始化模板文件
  if (!fs.existsSync(templateFilePath('world_templates'))) {
    writeTemplateFile('world_templates', {});
  }
  if (!fs.existsSync(templateFilePath('character_templates'))) {
    writeTemplateFile('character_templates', {});
  }

  initialized = true;

  // 启动迁移：如果 story_stats.json 为空但 stories 不为空，全量填充
  migrateStoryStatsIfNeeded();
}

/** 旧格式 → per-story 文件迁移 */
function migrateFromOldFormatIfNeeded(): void {
  const oldDataDir = path.join(getDataDirFromPaths(), '..', 'AnkeCreatorData');
  // 检查旧目录是否存在（注意：getDataDir 已改为 data/，旧目录是同级 AnkeCreatorData/）
  // 实际旧路径是 <dataRoot>/AnkeCreatorData/
  const dataRoot = path.dirname(getDataDirFromPaths());
  const legacyDir = path.join(dataRoot, 'AnkeCreatorData');
  const migrationFlag = path.join(getDataDir(), '.migrated-from-old-format');

  if (fs.existsSync(migrationFlag)) {
    return; // 已迁移
  }

  if (!fs.existsSync(legacyDir)) {
    return; // 无旧数据
  }

  console.log('[db-main] 检测到旧格式数据，开始迁移:', legacyDir);
  const startMs = Date.now();

  try {
    // 读取旧的 10 个全局表
    const readOld = <T>(name: string): Record<string, T> => {
      const p = path.join(legacyDir, `${name}.json`);
      if (!fs.existsSync(p)) return {};
      try {
        return JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, T>;
      } catch {
        return {};
      }
    };

    const oldStories = readOld<StoryRow>('stories');
    const oldWorldSettings = readOld<WorldSettingRow>('world_settings');
    const oldCharacters = readOld<CharacterRow>('characters');
    const oldOutlines = readOld<OutlineRow>('outlines');
    const oldVolumes = readOld<VolumeRow>('volumes');
    const oldChapters = readOld<ChapterRow>('chapters');
    const oldSections = readOld<SectionRow>('sections');
    const oldRelations = readOld<RelationRow>('character_relations');

    // 为每个 story 组装 bundle
    let count = 0;
    for (const storyId of Object.keys(oldStories)) {
      const story = oldStories[storyId];
      const volumes = Object.values(oldVolumes).filter((v) => v.story_id === storyId);
      const chapters = Object.values(oldChapters).filter((c) => c.story_id === storyId);
      const chapterIds = new Set(chapters.map((c) => c.id));
      const sections = Object.values(oldSections).filter((s) => s.chapter_id && chapterIds.has(s.chapter_id));
      const worldSettings = Object.values(oldWorldSettings).filter((w) => w.story_id === storyId);
      const characters = Object.values(oldCharacters).filter((c) => c.story_id === storyId);
      const relations = Object.values(oldRelations).filter((r) => r.story_id === storyId);
      const outlines = Object.values(oldOutlines).filter((o) => o.story_id === storyId);

      const wordCount = sections.reduce((sum, s) => sum + (s.word_count || 0), 0);
      const bundle: StoryBundle = {
        format: 'anke-creator-story-v2',
        version: '2.0',
        exportedAt: nowISO(),
        story,
        volumes,
        chapters,
        sections,
        world_settings: worldSettings,
        characters,
        character_relations: relations,
        outlines,
        dice_history: [],
        stats: {
          word_count: wordCount,
          section_count: sections.length,
          chapter_count: chapters.length,
        },
      };

      // 若 story 已软删除，写入 __trash/，否则写入 stories/
      const targetPath = story.is_deleted === 1 ? trashedStoryFilePath(storyId) : storyFilePath(storyId);
      try {
        fs.writeFileSync(targetPath, JSON.stringify(bundle, null, 0), 'utf-8');
        count++;
      } catch (e) {
        console.error(`[db-main] 迁移 story ${storyId} 失败:`, e);
      }
    }

    // 复制模板文件
    const oldWorldTpl = path.join(legacyDir, 'world_templates.json');
    const oldCharTpl = path.join(legacyDir, 'character_templates.json');
    if (fs.existsSync(oldWorldTpl)) {
      try {
        const data = JSON.parse(fs.readFileSync(oldWorldTpl, 'utf-8'));
        writeTemplateFile('world_templates', data);
      } catch {}
    }
    if (fs.existsSync(oldCharTpl)) {
      try {
        const data = JSON.parse(fs.readFileSync(oldCharTpl, 'utf-8'));
        writeTemplateFile('character_templates', data);
      } catch {}
    }

    // 复制 favorites / story_favorites
    for (const name of ['favorites', 'story_favorites', 'story_stats']) {
      const oldFile = path.join(legacyDir, `${name}.json`);
      if (fs.existsSync(oldFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(oldFile, 'utf-8'));
          saveGlobalJSON(name, data);
        } catch {}
      }
    }

    // 写迁移标记
    fs.writeFileSync(
      migrationFlag,
      JSON.stringify(
        {
          migratedAt: nowISO(),
          from: legacyDir,
          to: getDataDir(),
          storyCount: count,
          note: '旧格式数据已迁移到 per-story 文件，旧 AnkeCreatorData/ 保留作为备份',
        },
        null,
        2,
      ),
      'utf-8',
    );

    const elapsed = Date.now() - startMs;
    console.log(`[db-main] 旧格式迁移完成：${count} 个作品，耗时 ${elapsed}ms`);
    console.log('[db-main] 旧数据保留在:', legacyDir);
  } catch (e) {
    console.error('[db-main] 旧格式迁移失败:', e);
    // 不写标记，下次启动重试
  }
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

// —— Story Stats 缓存 —— //

function readStoryStatsAll(): Record<string, StoryStatsRow> {
  return loadGlobalJSON<Record<string, StoryStatsRow>>('story_stats', {});
}

function writeStoryStatsAll(all: Record<string, StoryStatsRow>): void {
  saveGlobalJSON('story_stats', all);
}

function readStoryStats(storyId: string): StoryStatsRow | null {
  return readStoryStatsAll()[storyId] || null;
}

function writeStoryStats(
  storyId: string,
  row: Omit<StoryStatsRow, 'story_id' | 'updated_at'>,
): void {
  const all = readStoryStatsAll();
  all[storyId] = { ...row, story_id: storyId, updated_at: nowISO() };
  writeStoryStatsAll(all);
}

function deleteStoryStats(storyId: string): void {
  const all = readStoryStatsAll();
  if (all[storyId]) {
    delete all[storyId];
    writeStoryStatsAll(all);
  }
}

function recomputeStoryStats(storyId: string): void {
  const bundle = readStoryFile(storyId);
  if (!bundle) return;
  const wordCount = bundle.sections.reduce((sum, s) => sum + (s.word_count || 0), 0);
  const newStats = {
    word_count: wordCount,
    section_count: bundle.sections.length,
    chapter_count: bundle.chapters.length,
  };
  // 更新 per-story 文件中的 stats 字段
  bundle.stats = newStats;
  writeStoryFile(storyId, bundle);
  // 更新全局缓存
  writeStoryStats(storyId, newStats);
}

// —— Story —— //

export function listStories(): StoryRow[] {
  const ids = listStoryIds();
  const stories: StoryRow[] = [];
  for (const id of ids) {
    const bundle = readStoryFile(id);
    if (bundle && bundle.story && !bundle.story.is_deleted) {
      stories.push(bundle.story);
    }
  }
  return stories.sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return b.is_pinned - a.is_pinned;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

export interface StoryWithStats extends StoryRow {
  wordCount: number;
  sectionCount: number;
  chapterCount: number;
}

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
  const bundle = readStoryFile(id);
  return bundle?.story;
}

export function createStory(data: { title: string; description?: string; category?: string }): StoryRow {
  const existing = listStories();
  const order = existing.length > 0 ? Math.max(...existing.map((s) => s.order_index || 0)) + 1 : 0;
  const now = nowISO();
  const row: StoryRow = {
    id: uuid4(),
    title: data.title || '未命名作品',
    description: data.description || '',
    category: data.category || '',
    order_index: order,
    is_starred: 0,
    is_pinned: 0,
    created_at: now,
    updated_at: now,
  };
  const bundle = emptyBundle(row);
  writeStoryFile(row.id, bundle);
  writeStoryStats(row.id, { word_count: 0, section_count: 0, chapter_count: 0 });
  return row;
}

export function updateStory(id: string, patch: Partial<StoryRow>): StoryRow | undefined {
  const bundle = readStoryFile(id);
  if (!bundle) return undefined;
  bundle.story = { ...bundle.story, ...patch, updated_at: nowISO() };
  writeStoryFile(id, bundle);
  return bundle.story;
}

export function deleteStory(id: string): void {
  // 物理删除 per-story 文件 + .bak
  const mainPath = storyFilePath(id);
  const bakPath = storyBakPath(id);
  try { if (fs.existsSync(mainPath)) fs.unlinkSync(mainPath); } catch {}
  try { if (fs.existsSync(bakPath)) fs.unlinkSync(bakPath); } catch {}
  // 维护 stats 缓存
  deleteStoryStats(id);
  // 维护收藏夹关联
  cleanupStoryFromFavorites(id);
}

export function softDeleteStory(id: string): void {
  const bundle = readStoryFile(id);
  if (!bundle) return;
  const now = nowISO();
  bundle.story = { ...bundle.story, is_deleted: 1, deleted_at: now, updated_at: now };
  // 移动到 __trash/
  const trashPath = trashedStoryFilePath(id);
  try {
    fs.writeFileSync(trashPath, JSON.stringify(bundle, null, 0), 'utf-8');
    // 删除 stories/ 下的主文件和 .bak
    try { if (fs.existsSync(storyFilePath(id))) fs.unlinkSync(storyFilePath(id)); } catch {}
    try { if (fs.existsSync(storyBakPath(id))) fs.unlinkSync(storyBakPath(id)); } catch {}
  } catch (e) {
    console.error('[db-main] softDeleteStory failed:', e);
  }
}

export function restoreStory(id: string): void {
  const trashPath = trashedStoryFilePath(id);
  if (!fs.existsSync(trashPath)) return;
  try {
    const raw = fs.readFileSync(trashPath, 'utf-8');
    const bundle = JSON.parse(raw) as StoryBundle;
    const now = nowISO();
    bundle.story = { ...bundle.story, is_deleted: 0, deleted_at: '', updated_at: now };
    writeStoryFile(id, bundle);
    fs.unlinkSync(trashPath);
  } catch (e) {
    console.error('[db-main] restoreStory failed:', e);
  }
}

export function permanentlyDeleteStory(id: string): void {
  // 删除 __trash/ 下的文件
  const trashPath = trashedStoryFilePath(id);
  try { if (fs.existsSync(trashPath)) fs.unlinkSync(trashPath); } catch {}
  // 也删除 stories/ 下的（防止残留）
  deleteStory(id);
}

export function listTrashedStories(): StoryRow[] {
  const ids = listTrashedStoryIds();
  const stories: StoryRow[] = [];
  for (const id of ids) {
    try {
      const raw = fs.readFileSync(trashedStoryFilePath(id), 'utf-8');
      const bundle = JSON.parse(raw) as StoryBundle;
      if (bundle.story) stories.push(bundle.story);
    } catch {}
  }
  return stories.sort(
    (a, b) =>
      new Date(b.deleted_at || b.updated_at).getTime() -
      new Date(a.deleted_at || a.updated_at).getTime(),
  );
}

export function cleanupOldTrashed(days: number): number {
  const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const trashed = listTrashedStories();
  let count = 0;
  for (const s of trashed) {
    if (s.is_deleted === 1 && s.deleted_at && s.deleted_at < threshold) {
      permanentlyDeleteStory(s.id);
      count++;
    }
  }
  return count;
}

// —— WorldSetting —— //

export function listWorldSettings(storyId: string): WorldSettingRow[] {
  const bundle = readStoryFile(storyId);
  if (!bundle) return [];
  return bundle.world_settings
    .filter((r) => r.story_id === storyId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
}

export function createWorldSetting(data: Omit<WorldSettingRow, 'id' | 'created_at' | 'updated_at'> & Partial<Pick<WorldSettingRow, 'order_index'>>): WorldSettingRow {
  const bundle = readStoryFile(data.story_id);
  if (!bundle) throw new Error('story not found: ' + data.story_id);
  const existing = bundle.world_settings;
  const order = typeof data.order_index === 'number' ? data.order_index : existing.length;
  const now = nowISO();
  const row: WorldSettingRow = {
    id: uuid4(),
    story_id: data.story_id,
    title: data.title || '未命名世界观',
    content: data.content || '',
    order_index: order,
    created_at: now,
    updated_at: now,
  };
  bundle.world_settings.push(row);
  writeStoryFile(data.story_id, bundle);
  return row;
}

export function updateWorldSetting(id: string, patch: Partial<WorldSettingRow>): WorldSettingRow | undefined {
  // 需要先找到所属 story
  const storyId = findStoryIdByEntityId(id, 'world_settings');
  if (!storyId) return undefined;
  const bundle = readStoryFile(storyId);
  if (!bundle) return undefined;
  const idx = bundle.world_settings.findIndex((r) => r.id === id);
  if (idx < 0) return undefined;
  bundle.world_settings[idx] = { ...bundle.world_settings[idx], ...patch, updated_at: nowISO() };
  writeStoryFile(storyId, bundle);
  return bundle.world_settings[idx];
}

export function deleteWorldSetting(id: string): void {
  const storyId = findStoryIdByEntityId(id, 'world_settings');
  if (!storyId) return;
  const bundle = readStoryFile(storyId);
  if (!bundle) return;
  bundle.world_settings = bundle.world_settings.filter((r) => r.id !== id);
  writeStoryFile(storyId, bundle);
}

export function reorderWorldSettings(storyId: string, orderedIds: string[]): void {
  const bundle = readStoryFile(storyId);
  if (!bundle) return;
  const orderMap: Record<string, number> = {};
  orderedIds.forEach((id, i) => (orderMap[id] = i));
  bundle.world_settings = bundle.world_settings
    .map((r) => ({ ...r, order_index: orderMap[r.id] ?? r.order_index }))
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
  writeStoryFile(storyId, bundle);
}

// —— Character —— //

export function listCharacters(storyId: string): any[] {
  const bundle = readStoryFile(storyId);
  if (!bundle) return [];
  return bundle.characters
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
  const bundle = readStoryFile(data.story_id);
  if (!bundle) throw new Error('story not found: ' + data.story_id);
  const existing = bundle.characters;
  const order = typeof data.order_index === 'number' ? data.order_index : existing.length;
  const now = nowISO();
  const row: CharacterRow = {
    id: uuid4(),
    story_id: data.story_id,
    name: data.name || '未命名角色',
    avatar: data.avatar || '',
    personality: data.personality || '',
    attributes: serializeJSON(data.attributes || {}),
    notes: data.notes || '',
    variants: serializeJSON([]),
    order_index: order,
    created_at: now,
    updated_at: now,
  };
  bundle.characters.push(row);
  writeStoryFile(data.story_id, bundle);
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
  const storyId = findStoryIdByEntityId(id, 'characters');
  if (!storyId) return undefined;
  const bundle = readStoryFile(storyId);
  if (!bundle) return undefined;
  const idx = bundle.characters.findIndex((r) => r.id === id);
  if (idx < 0) return undefined;
  const dbPatch: any = {};
  if ('name' in patch) dbPatch.name = patch.name;
  if ('avatar' in patch) dbPatch.avatar = patch.avatar;
  if ('personality' in patch) dbPatch.personality = patch.personality;
  if ('notes' in patch) dbPatch.notes = patch.notes;
  if ('order_index' in patch) dbPatch.order_index = patch.order_index;
  if ('attributes' in patch) {
    dbPatch.attributes = typeof patch.attributes === 'string' ? patch.attributes : serializeJSON(patch.attributes);
  }
  bundle.characters[idx] = { ...bundle.characters[idx], ...dbPatch, updated_at: nowISO() };
  writeStoryFile(storyId, bundle);
  const row = bundle.characters[idx];
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
  const storyId = findStoryIdByEntityId(id, 'characters');
  if (!storyId) return;
  const bundle = readStoryFile(storyId);
  if (!bundle) return;
  bundle.characters = bundle.characters.filter((r) => r.id !== id);
  writeStoryFile(storyId, bundle);
}

export function reorderCharacters(storyId: string, orderedIds: string[]): void {
  const bundle = readStoryFile(storyId);
  if (!bundle) return;
  const orderMap: Record<string, number> = {};
  orderedIds.forEach((id, i) => (orderMap[id] = i));
  bundle.characters = bundle.characters
    .map((r) => ({ ...r, order_index: orderMap[r.id] ?? r.order_index }))
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
  writeStoryFile(storyId, bundle);
}

// —— Character Variants —— //

function findCharacterInBundle(bundle: StoryBundle, characterId: string): CharacterRow | undefined {
  return bundle.characters.find((c) => c.id === characterId);
}

export function listCharacterVariants(characterId: string): CharacterVariantRow[] {
  // 需要遍历所有 stories 找到 character（variants 内嵌在 characters 中）
  // 优化：先按 characterId 反查 storyId（用 findStoryIdByEntityId）
  const storyId = findStoryIdByEntityId(characterId, 'characters');
  if (!storyId) return [];
  const bundle = readStoryFile(storyId);
  if (!bundle) return [];
  const char = findCharacterInBundle(bundle, characterId);
  if (!char) return [];
  return parseJSON<CharacterVariantRow[]>(char.variants, []).sort(
    (a, b) => (a.order_index || 0) - (b.order_index || 0),
  );
}

export function createCharacterVariant(data: { character_id: string; name: string; url: string; order_index?: number }): CharacterVariantRow {
  const storyId = findStoryIdByEntityId(data.character_id, 'characters');
  if (!storyId) throw new Error('character not found: ' + data.character_id);
  const bundle = readStoryFile(storyId);
  if (!bundle) throw new Error('story not found: ' + storyId);
  const charIdx = bundle.characters.findIndex((c) => c.id === data.character_id);
  if (charIdx < 0) throw new Error('character not found: ' + data.character_id);
  const variants = parseJSON<CharacterVariantRow[]>(bundle.characters[charIdx].variants, []);
  const order = typeof data.order_index === 'number' ? data.order_index : variants.length;
  const newVar: CharacterVariantRow = { id: uuid4(), name: data.name || '差分', url: data.url || '', order_index: order };
  variants.push(newVar);
  bundle.characters[charIdx].variants = serializeJSON(variants);
  bundle.characters[charIdx].updated_at = nowISO();
  writeStoryFile(storyId, bundle);
  return newVar;
}

export function createCharacterVariantsBatch(characterId: string, items: { name?: string; url: string }[]): CharacterVariantRow[] {
  const storyId = findStoryIdByEntityId(characterId, 'characters');
  if (!storyId) throw new Error('character not found: ' + characterId);
  const bundle = readStoryFile(storyId);
  if (!bundle) throw new Error('story not found: ' + storyId);
  const charIdx = bundle.characters.findIndex((c) => c.id === characterId);
  if (charIdx < 0) throw new Error('character not found: ' + characterId);
  const variants = parseJSON<CharacterVariantRow[]>(bundle.characters[charIdx].variants, []);
  let order = variants.length;
  const created: CharacterVariantRow[] = [];
  for (const it of items) {
    const newVar: CharacterVariantRow = { id: uuid4(), name: (it.name || '差分').trim(), url: it.url || '', order_index: order++ };
    variants.push(newVar);
    created.push(newVar);
  }
  bundle.characters[charIdx].variants = serializeJSON(variants);
  bundle.characters[charIdx].updated_at = nowISO();
  writeStoryFile(storyId, bundle);
  return created;
}

export function updateCharacterVariant(id: string, patch: Partial<{ name: string; url: string; order_index: number }>): void {
  // 遍历所有 stories 查找 variant
  const ids = listStoryIds();
  for (const storyId of ids) {
    const bundle = readStoryFile(storyId);
    if (!bundle) continue;
    let found = false;
    for (let i = 0; i < bundle.characters.length; i++) {
      const variants = parseJSON<CharacterVariantRow[]>(bundle.characters[i].variants, []);
      const idx = variants.findIndex((v) => v.id === id);
      if (idx >= 0) {
        variants[idx] = { ...variants[idx], ...patch };
        bundle.characters[i].variants = serializeJSON(variants);
        bundle.characters[i].updated_at = nowISO();
        found = true;
        break;
      }
    }
    if (found) {
      writeStoryFile(storyId, bundle);
      return;
    }
  }
}

export function deleteCharacterVariant(id: string): void {
  const ids = listStoryIds();
  for (const storyId of ids) {
    const bundle = readStoryFile(storyId);
    if (!bundle) continue;
    let found = false;
    for (let i = 0; i < bundle.characters.length; i++) {
      const variants = parseJSON<CharacterVariantRow[]>(bundle.characters[i].variants, []);
      const filtered = variants.filter((v) => v.id !== id);
      if (filtered.length !== variants.length) {
        bundle.characters[i].variants = serializeJSON(filtered);
        bundle.characters[i].updated_at = nowISO();
        found = true;
        break;
      }
    }
    if (found) {
      writeStoryFile(storyId, bundle);
      return;
    }
  }
}

export function reorderCharacterVariants(characterId: string, orderedIds: string[]): void {
  const storyId = findStoryIdByEntityId(characterId, 'characters');
  if (!storyId) return;
  const bundle = readStoryFile(storyId);
  if (!bundle) return;
  const charIdx = bundle.characters.findIndex((c) => c.id === characterId);
  if (charIdx < 0) return;
  const orderMap: Record<string, number> = {};
  orderedIds.forEach((id, i) => (orderMap[id] = i));
  const variants = parseJSON<CharacterVariantRow[]>(bundle.characters[charIdx].variants, [])
    .map((v) => ({ ...v, order_index: orderMap[v.id] ?? v.order_index }))
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
  bundle.characters[charIdx].variants = serializeJSON(variants);
  bundle.characters[charIdx].updated_at = nowISO();
  writeStoryFile(storyId, bundle);
}

// —— Character Relations —— //

export function listCharacterRelations(storyId: string): RelationRow[] {
  const bundle = readStoryFile(storyId);
  if (!bundle) return [];
  return bundle.character_relations
    .filter((r) => r.story_id === storyId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
}

export function createCharacterRelation(data: { story_id: string; source_id: string; target_id: string; relation: string; note?: string; order_index?: number }): RelationRow {
  const bundle = readStoryFile(data.story_id);
  if (!bundle) throw new Error('story not found: ' + data.story_id);
  const existing = bundle.character_relations;
  const order = typeof data.order_index === 'number' ? data.order_index : existing.length;
  const now = nowISO();
  const row: RelationRow = {
    id: uuid4(),
    story_id: data.story_id,
    source_id: data.source_id,
    target_id: data.target_id,
    relation: data.relation || '',
    note: data.note || '',
    order_index: order,
    created_at: now,
    updated_at: now,
  };
  bundle.character_relations.push(row);
  writeStoryFile(data.story_id, bundle);
  return row;
}

export function updateCharacterRelation(id: string, patch: Partial<RelationRow>): RelationRow | undefined {
  const storyId = findStoryIdByEntityId(id, 'character_relations');
  if (!storyId) return undefined;
  const bundle = readStoryFile(storyId);
  if (!bundle) return undefined;
  const idx = bundle.character_relations.findIndex((r) => r.id === id);
  if (idx < 0) return undefined;
  bundle.character_relations[idx] = { ...bundle.character_relations[idx], ...patch, updated_at: nowISO() };
  writeStoryFile(storyId, bundle);
  return bundle.character_relations[idx];
}

export function deleteCharacterRelation(id: string): void {
  const storyId = findStoryIdByEntityId(id, 'character_relations');
  if (!storyId) return;
  const bundle = readStoryFile(storyId);
  if (!bundle) return;
  bundle.character_relations = bundle.character_relations.filter((r) => r.id !== id);
  writeStoryFile(storyId, bundle);
}

// —— Outline —— //

export function listOutlines(storyId: string): OutlineRow[] {
  const bundle = readStoryFile(storyId);
  if (!bundle) return [];
  return bundle.outlines
    .filter((r) => r.story_id === storyId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
}

export function createOutline(data: { story_id: string; content: string; order_index?: number }): OutlineRow {
  const bundle = readStoryFile(data.story_id);
  if (!bundle) throw new Error('story not found: ' + data.story_id);
  const existing = bundle.outlines;
  const order = typeof data.order_index === 'number' ? data.order_index : existing.length;
  const now = nowISO();
  const row: OutlineRow = {
    id: uuid4(),
    story_id: data.story_id,
    content: data.content,
    order_index: order,
    created_at: now,
    updated_at: now,
  };
  bundle.outlines.push(row);
  writeStoryFile(data.story_id, bundle);
  return row;
}

export function updateOutline(id: string, patch: Partial<{ content: string; order_index: number }>): OutlineRow | undefined {
  const storyId = findStoryIdByEntityId(id, 'outlines');
  if (!storyId) return undefined;
  const bundle = readStoryFile(storyId);
  if (!bundle) return undefined;
  const idx = bundle.outlines.findIndex((r) => r.id === id);
  if (idx < 0) return undefined;
  bundle.outlines[idx] = { ...bundle.outlines[idx], ...patch, updated_at: nowISO() };
  writeStoryFile(storyId, bundle);
  return bundle.outlines[idx];
}

export function deleteOutline(id: string): void {
  const storyId = findStoryIdByEntityId(id, 'outlines');
  if (!storyId) return;
  const bundle = readStoryFile(storyId);
  if (!bundle) return;
  bundle.outlines = bundle.outlines.filter((r) => r.id !== id);
  writeStoryFile(storyId, bundle);
}

// —— Volume —— //

export function listVolumes(storyId: string): VolumeRow[] {
  const bundle = readStoryFile(storyId);
  if (!bundle) return [];
  return bundle.volumes
    .filter((r) => r.story_id === storyId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
}

export function createVolume(data: { story_id: string; title: string; order_index?: number }): VolumeRow {
  const bundle = readStoryFile(data.story_id);
  if (!bundle) throw new Error('story not found: ' + data.story_id);
  const existing = bundle.volumes;
  const order = typeof data.order_index === 'number' ? data.order_index : existing.length;
  const now = nowISO();
  const row: VolumeRow = {
    id: uuid4(),
    story_id: data.story_id,
    title: data.title,
    order_index: order,
    created_at: now,
    updated_at: now,
  };
  bundle.volumes.push(row);
  bundle.story.updated_at = now;
  writeStoryFile(data.story_id, bundle);
  return row;
}

export function updateVolume(id: string, patch: Partial<VolumeRow>): VolumeRow | undefined {
  const storyId = findStoryIdByEntityId(id, 'volumes');
  if (!storyId) return undefined;
  const bundle = readStoryFile(storyId);
  if (!bundle) return undefined;
  const idx = bundle.volumes.findIndex((r) => r.id === id);
  if (idx < 0) return undefined;
  bundle.volumes[idx] = { ...bundle.volumes[idx], ...patch, updated_at: nowISO() };
  bundle.story.updated_at = nowISO();
  writeStoryFile(storyId, bundle);
  return bundle.volumes[idx];
}

export function deleteVolume(id: string): void {
  const storyId = findStoryIdByEntityId(id, 'volumes');
  if (!storyId) return;
  const bundle = readStoryFile(storyId);
  if (!bundle) return;
  // 级联删除该卷下的章和节
  const chaptersToDel = bundle.chapters.filter((c) => c.volume_id === id);
  for (const ch of chaptersToDel) {
    bundle.sections = bundle.sections.filter((s) => s.chapter_id !== ch.id);
  }
  bundle.chapters = bundle.chapters.filter((c) => c.volume_id !== id);
  bundle.volumes = bundle.volumes.filter((r) => r.id !== id);
  bundle.story.updated_at = nowISO();
  writeStoryFile(storyId, bundle);
  recomputeStoryStats(storyId);
}

export function reorderVolumes(storyId: string, orderedIds: string[]): void {
  const bundle = readStoryFile(storyId);
  if (!bundle) return;
  const orderMap: Record<string, number> = {};
  orderedIds.forEach((id, i) => (orderMap[id] = i));
  bundle.volumes = bundle.volumes
    .map((r) => ({ ...r, order_index: orderMap[r.id] ?? r.order_index }))
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
  bundle.story.updated_at = nowISO();
  writeStoryFile(storyId, bundle);
}

// —— Chapter —— //

export function listChapters(storyId: string): ChapterRow[] {
  const bundle = readStoryFile(storyId);
  if (!bundle) return [];
  return bundle.chapters
    .filter((r) => r.story_id === storyId)
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
}

export function listChaptersByVolume(volumeId: string): ChapterRow[] {
  // 需要遍历所有 stories 找到 volumeId
  const ids = listStoryIds();
  for (const storyId of ids) {
    const bundle = readStoryFile(storyId);
    if (!bundle) continue;
    const chapters = bundle.chapters
      .filter((r) => r.volume_id === volumeId)
      .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
    if (chapters.length > 0) return chapters;
  }
  return [];
}

export function createChapter(data: { story_id: string; volume_id?: string | null; title: string; order_index?: number }): ChapterRow {
  const bundle = readStoryFile(data.story_id);
  if (!bundle) throw new Error('story not found: ' + data.story_id);
  const existing = bundle.chapters;
  const order = typeof data.order_index === 'number' ? data.order_index : existing.length;
  const now = nowISO();
  const row: ChapterRow = {
    id: uuid4(),
    story_id: data.story_id,
    volume_id: data.volume_id ?? null,
    title: data.title,
    order_index: order,
    created_at: now,
    updated_at: now,
  };
  bundle.chapters.push(row);
  bundle.story.updated_at = now;
  writeStoryFile(data.story_id, bundle);
  recomputeStoryStats(data.story_id);
  return row;
}

export function updateChapter(id: string, patch: Partial<ChapterRow>): ChapterRow | undefined {
  const storyId = findStoryIdByEntityId(id, 'chapters');
  if (!storyId) return undefined;
  const bundle = readStoryFile(storyId);
  if (!bundle) return undefined;
  const idx = bundle.chapters.findIndex((r) => r.id === id);
  if (idx < 0) return undefined;
  bundle.chapters[idx] = { ...bundle.chapters[idx], ...patch, updated_at: nowISO() };
  bundle.story.updated_at = nowISO();
  writeStoryFile(storyId, bundle);
  return bundle.chapters[idx];
}

export function deleteChapter(id: string): void {
  const storyId = findStoryIdByEntityId(id, 'chapters');
  if (!storyId) return;
  const bundle = readStoryFile(storyId);
  if (!bundle) return;
  // 级联删除该章下的节
  bundle.sections = bundle.sections.filter((s) => s.chapter_id !== id);
  bundle.chapters = bundle.chapters.filter((r) => r.id !== id);
  bundle.story.updated_at = nowISO();
  writeStoryFile(storyId, bundle);
  recomputeStoryStats(storyId);
}

export function reorderChapters(storyId: string, orderedIds: string[]): void {
  const bundle = readStoryFile(storyId);
  if (!bundle) return;
  const orderMap: Record<string, number> = {};
  orderedIds.forEach((id, i) => (orderMap[id] = i));
  bundle.chapters = bundle.chapters
    .map((r) => ({ ...r, order_index: orderMap[r.id] ?? r.order_index }))
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
  writeStoryFile(storyId, bundle);
}

export function moveChapters(
  storyId: string,
  targetVolumeId: string | null,
  orderedIds: string[],
): void {
  const bundle = readStoryFile(storyId);
  if (!bundle) return;
  const orderMap: Record<string, number> = {};
  orderedIds.forEach((id, i) => (orderMap[id] = i));
  bundle.chapters = bundle.chapters.map((r) =>
    orderedIds.includes(r.id)
      ? { ...r, volume_id: targetVolumeId, order_index: orderMap[r.id], updated_at: nowISO() }
      : r,
  );
  bundle.story.updated_at = nowISO();
  writeStoryFile(storyId, bundle);
}

// —— Section —— //

export function listSections(chapterId: string): SectionRow[] {
  // 需要遍历所有 stories 找到 chapterId
  const ids = listStoryIds();
  for (const storyId of ids) {
    const bundle = readStoryFile(storyId);
    if (!bundle) continue;
    const sections = bundle.sections
      .filter((r) => r.chapter_id === chapterId)
      .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
    if (sections.length > 0) return sections;
  }
  return [];
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
  // 通过 chapter_id 反查 storyId
  const storyId = findStoryIdByChapterId(data.chapter_id);
  if (!storyId) throw new Error('chapter not found: ' + data.chapter_id);
  const bundle = readStoryFile(storyId);
  if (!bundle) throw new Error('story not found: ' + storyId);
  const existing = bundle.sections.filter((s) => s.chapter_id === data.chapter_id);
  const order = typeof data.order_index === 'number' ? data.order_index : existing.length;
  const wc = countWordsInHtml(data.content ?? null);
  const now = nowISO();
  const row: SectionRow = {
    id: uuid4(),
    chapter_id: data.chapter_id,
    title: data.title,
    content: data.content ?? null,
    bbcode: data.bbcode ?? null,
    word_count: wc,
    order_index: order,
    created_at: now,
    updated_at: now,
  };
  bundle.sections.push(row);
  bundle.story.updated_at = now;
  writeStoryFile(storyId, bundle);
  recomputeStoryStats(storyId);
  return row;
}

export function updateSection(id: string, patch: Partial<SectionRow>): SectionRow | undefined {
  const storyId = findStoryIdByEntityId(id, 'sections');
  if (!storyId) return undefined;
  const bundle = readStoryFile(storyId);
  if (!bundle) return undefined;
  const idx = bundle.sections.findIndex((r) => r.id === id);
  if (idx < 0) return undefined;
  bundle.sections[idx] = { ...bundle.sections[idx], ...patch, updated_at: nowISO() };
  bundle.story.updated_at = nowISO();
  writeStoryFile(storyId, bundle);
  if (patch.content !== undefined) recomputeStoryStats(storyId);
  return bundle.sections[idx];
}

export function deleteSection(id: string): void {
  const storyId = findStoryIdByEntityId(id, 'sections');
  if (!storyId) return;
  const bundle = readStoryFile(storyId);
  if (!bundle) return;
  bundle.sections = bundle.sections.filter((r) => r.id !== id);
  bundle.story.updated_at = nowISO();
  writeStoryFile(storyId, bundle);
  recomputeStoryStats(storyId);
}

// —— Bulk Create (导入加速) —— //

export function bulkCreateVolumes(rows: Array<{ story_id: string; title: string; order_index?: number; _oldId?: string }>): Array<{ id: string; _oldId?: string }> {
  // 按 story_id 分组，每个 story 只读写一次文件
  const byStory: Record<string, Array<{ story_id: string; title: string; order_index?: number; _oldId?: string }>> = {};
  for (const r of rows) {
    if (!byStory[r.story_id]) byStory[r.story_id] = [];
    byStory[r.story_id].push(r);
  }
  const result: Array<{ id: string; _oldId?: string }> = [];
  const now = nowISO();
  for (const storyId of Object.keys(byStory)) {
    const bundle = readStoryFile(storyId);
    if (!bundle) continue;
    for (const r of byStory[storyId]) {
      const id = uuid4();
      const order = typeof r.order_index === 'number' ? r.order_index : bundle.volumes.length;
      bundle.volumes.push({
        id,
        story_id: storyId,
        title: r.title,
        order_index: order,
        created_at: now,
        updated_at: now,
      });
      result.push({ id, _oldId: r._oldId });
    }
    bundle.story.updated_at = now;
    writeStoryFile(storyId, bundle);
  }
  return result;
}

export function bulkCreateChapters(rows: Array<{ story_id: string; volume_id?: string | null; title: string; order_index?: number; _oldId?: string }>): Array<{ id: string; _oldId?: string }> {
  const byStory: Record<string, typeof rows> = {};
  for (const r of rows) {
    if (!byStory[r.story_id]) byStory[r.story_id] = [];
    byStory[r.story_id].push(r);
  }
  const result: Array<{ id: string; _oldId?: string }> = [];
  const now = nowISO();
  for (const storyId of Object.keys(byStory)) {
    const bundle = readStoryFile(storyId);
    if (!bundle) continue;
    for (const r of byStory[storyId]) {
      const id = uuid4();
      const order = typeof r.order_index === 'number' ? r.order_index : bundle.chapters.length;
      bundle.chapters.push({
        id,
        story_id: storyId,
        volume_id: r.volume_id ?? null,
        title: r.title,
        order_index: order,
        created_at: now,
        updated_at: now,
      });
      result.push({ id, _oldId: r._oldId });
    }
    bundle.story.updated_at = now;
    writeStoryFile(storyId, bundle);
    recomputeStoryStats(storyId);
  }
  return result;
}

export function bulkCreateSections(rows: Array<{ chapter_id: string; title: string; content?: string | null; bbcode?: string | null; order_index?: number; _oldId?: string }>): Array<{ id: string; _oldId?: string }> {
  // 通过 chapter_id 反查 storyId，按 story 分组
  const byStory: Record<string, typeof rows> = {};
  const chapterToStory: Record<string, string> = {};
  // 先扫描所有 stories 建立 chapterId → storyId 映射
  const storyIds = listStoryIds();
  for (const sid of storyIds) {
    const bundle = readStoryFile(sid);
    if (!bundle) continue;
    for (const ch of bundle.chapters) {
      chapterToStory[ch.id] = sid;
    }
  }
  for (const r of rows) {
    const sid = chapterToStory[r.chapter_id];
    if (!sid) continue;
    if (!byStory[sid]) byStory[sid] = [];
    byStory[sid].push(r);
  }
  const result: Array<{ id: string; _oldId?: string }> = [];
  const now = nowISO();
  for (const storyId of Object.keys(byStory)) {
    const bundle = readStoryFile(storyId);
    if (!bundle) continue;
    for (const r of byStory[storyId]) {
      const id = uuid4();
      const order = typeof r.order_index === 'number' ? r.order_index : bundle.sections.filter((s) => s.chapter_id === r.chapter_id).length;
      const wc = countWordsInHtml(r.content ?? null);
      bundle.sections.push({
        id,
        chapter_id: r.chapter_id,
        title: r.title,
        content: r.content ?? null,
        bbcode: r.bbcode ?? null,
        word_count: wc,
        order_index: order,
        created_at: now,
        updated_at: now,
      });
      result.push({ id, _oldId: r._oldId });
    }
    bundle.story.updated_at = now;
    writeStoryFile(storyId, bundle);
    recomputeStoryStats(storyId);
  }
  return result;
}

export function getSectionContent(id: string): string | null {
  const storyId = findStoryIdByEntityId(id, 'sections');
  if (!storyId) return null;
  const bundle = readStoryFile(storyId);
  if (!bundle) return null;
  const sec = bundle.sections.find((s) => s.id === id);
  return sec ? sec.content : null;
}

export function setSectionContent(id: string, content: string | null): void {
  const storyId = findStoryIdByEntityId(id, 'sections');
  if (!storyId) return;
  const bundle = readStoryFile(storyId);
  if (!bundle) return;
  const idx = bundle.sections.findIndex((s) => s.id === id);
  if (idx < 0) return;
  const oldWc = bundle.sections[idx].word_count || 0;
  const wc = countWordsInHtml(content);
  bundle.sections[idx] = { ...bundle.sections[idx], content, word_count: wc, updated_at: nowISO() };
  bundle.story.updated_at = nowISO();
  writeStoryFile(storyId, bundle);
  // 增量更新 stats 缓存
  const stats = readStoryStats(storyId);
  if (stats) {
    writeStoryStats(storyId, {
      word_count: Math.max(0, stats.word_count + (wc - oldWc)),
      section_count: stats.section_count,
      chapter_count: stats.chapter_count,
    });
  } else {
    recomputeStoryStats(storyId);
  }
  // 同步更新 per-story 文件中的 stats
  const updatedBundle = readStoryFile(storyId);
  if (updatedBundle) {
    updatedBundle.stats = {
      word_count: stats ? Math.max(0, stats.word_count + (wc - oldWc)) : wc,
      section_count: updatedBundle.sections.length,
      chapter_count: updatedBundle.chapters.length,
    };
    updatedBundle.story.updated_at = nowISO();
    writeStoryFile(storyId, updatedBundle);
  }
}

export function setSectionBBCode(id: string, bbcode: string | null): void {
  updateSection(id, { bbcode });
}

export function reorderSections(chapterId: string, orderedIds: string[]): void {
  const storyId = findStoryIdByChapterId(chapterId);
  if (!storyId) return;
  const bundle = readStoryFile(storyId);
  if (!bundle) return;
  const orderMap: Record<string, number> = {};
  orderedIds.forEach((id, i) => (orderMap[id] = i));
  bundle.sections = bundle.sections.map((r) =>
    r.chapter_id === chapterId
      ? { ...r, order_index: orderMap[r.id] ?? r.order_index, updated_at: nowISO() }
      : r,
  );
  bundle.story.updated_at = nowISO();
  writeStoryFile(storyId, bundle);
}

export function moveSections(
  targetChapterId: string | null,
  orderedIds: string[],
): void {
  // 可能跨 story，按 story 分组处理
  const storyIds = listStoryIds();
  const bundles = new Map<string, StoryBundle>();
  for (const sid of storyIds) {
    const bundle = readStoryFile(sid);
    if (bundle) bundles.set(sid, bundle);
  }
  const orderMap: Record<string, number> = {};
  orderedIds.forEach((id, i) => (orderMap[id] = i));
  // 找到目标 chapter 所属的 story
  let targetStoryId: string | null = null;
  if (targetChapterId) {
    for (const [sid, bundle] of bundles) {
      if (bundle.chapters.some((c) => c.id === targetChapterId)) {
        targetStoryId = sid;
        break;
      }
    }
  }
  // 从所有 bundles 中移除 orderedIds 中的 sections
  const movedSections: SectionRow[] = [];
  for (const [sid, bundle] of bundles) {
    const remaining: SectionRow[] = [];
    for (const s of bundle.sections) {
      if (orderedIds.includes(s.id)) {
        movedSections.push(s);
      } else {
        remaining.push(s);
      }
    }
    bundle.sections = remaining;
  }
  // 把移除的 sections 加到目标 bundle
  if (targetStoryId) {
    const targetBundle = bundles.get(targetStoryId)!;
    for (const s of movedSections) {
      targetBundle.sections.push({
        ...s,
        chapter_id: targetChapterId,
        order_index: orderMap[s.id] ?? s.order_index,
        updated_at: nowISO(),
      });
    }
  }
  // 写回所有修改过的 bundles
  for (const [sid, bundle] of bundles) {
    bundle.story.updated_at = nowISO();
    writeStoryFile(sid, bundle);
  }
}

// —— 辅助：根据实体 id 反查 storyId —— //

function findStoryIdByEntityId(entityId: string, entityType: 'world_settings' | 'characters' | 'character_relations' | 'outlines' | 'volumes' | 'chapters' | 'sections'): string | null {
  const ids = listStoryIds();
  for (const storyId of ids) {
    const bundle = readStoryFile(storyId);
    if (!bundle) continue;
    if (entityType === 'sections') {
      if (bundle.sections.some((r) => r.id === entityId)) return storyId;
    } else if (entityType === 'chapters') {
      if (bundle.chapters.some((r) => r.id === entityId)) return storyId;
    } else if (entityType === 'volumes') {
      if (bundle.volumes.some((r) => r.id === entityId)) return storyId;
    } else if (entityType === 'world_settings') {
      if (bundle.world_settings.some((r) => r.id === entityId)) return storyId;
    } else if (entityType === 'characters') {
      if (bundle.characters.some((r) => r.id === entityId)) return storyId;
    } else if (entityType === 'character_relations') {
      if (bundle.character_relations.some((r) => r.id === entityId)) return storyId;
    } else if (entityType === 'outlines') {
      if (bundle.outlines.some((r) => r.id === entityId)) return storyId;
    }
  }
  return null;
}

function findStoryIdByChapterId(chapterId: string): string | null {
  const ids = listStoryIds();
  for (const storyId of ids) {
    const bundle = readStoryFile(storyId);
    if (!bundle) continue;
    if (bundle.chapters.some((c) => c.id === chapterId)) return storyId;
  }
  return null;
}

// —— Templates —— //

export function listWorldSettingTemplates(): WorldSettingTemplate[] {
  const all = readTemplateFile<Record<string, WorldSettingTemplate>>('world_templates', {});
  return Object.values(all).sort(
    (a, b) =>
      (a.order_index ?? 0) - (b.order_index ?? 0) ||
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
}

export function createWorldSettingTemplate(data: { title: string; content?: string }): WorldSettingTemplate {
  const all = readTemplateFile<Record<string, WorldSettingTemplate>>('world_templates', {});
  const order = Object.values(all).length;
  const now = nowISO();
  const row: WorldSettingTemplate = {
    id: uuid4(),
    title: data.title,
    content: data.content || '',
    order_index: order,
    created_at: now,
    updated_at: now,
  } as any;
  all[row.id] = row;
  writeTemplateFile('world_templates', all);
  return row;
}

export function updateWorldSettingTemplate(id: string, patch: Partial<{ title: string; content: string; order_index: number }>): WorldSettingTemplate | undefined {
  const all = readTemplateFile<Record<string, WorldSettingTemplate>>('world_templates', {});
  if (!all[id]) return undefined;
  all[id] = { ...all[id], ...patch, updated_at: nowISO() } as WorldSettingTemplate;
  writeTemplateFile('world_templates', all);
  return all[id];
}

export function deleteWorldSettingTemplate(id: string): void {
  const all = readTemplateFile<Record<string, WorldSettingTemplate>>('world_templates', {});
  if (!all[id]) return;
  delete all[id];
  writeTemplateFile('world_templates', all);
}

export function reorderWorldSettingTemplates(orderedIds: string[]): void {
  const all = readTemplateFile<Record<string, WorldSettingTemplate>>('world_templates', {});
  orderedIds.forEach((id, i) => {
    if (all[id]) all[id] = { ...all[id], order_index: i, updated_at: nowISO() } as WorldSettingTemplate;
  });
  writeTemplateFile('world_templates', all);
}

export function listCharacterTemplates(): CharacterTemplate[] {
  const all = readTemplateFile<Record<string, any>>('character_templates', {});
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
  const all = readTemplateFile<Record<string, any>>('character_templates', {});
  const order = Object.values(all).length;
  const now = nowISO();
  const row: any = {
    id: uuid4(),
    name: data.name,
    avatar: data.avatar || '',
    personality: data.personality || '',
    attributes: serializeJSON(data.attributes || {}),
    notes: data.notes || '',
    variants: serializeJSON(data.variants || []),
    order_index: order,
    created_at: now,
    updated_at: now,
  };
  all[row.id] = row;
  writeTemplateFile('character_templates', all);
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
  const all = readTemplateFile<Record<string, any>>('character_templates', {});
  if (!all[id]) return undefined;
  const dbPatch: any = {};
  if ('name' in patch) dbPatch.name = patch.name;
  if ('avatar' in patch) dbPatch.avatar = patch.avatar;
  if ('personality' in patch) dbPatch.personality = patch.personality;
  if ('notes' in patch) dbPatch.notes = patch.notes;
  if ('attributes' in patch) dbPatch.attributes = serializeJSON(patch.attributes);
  if ('variants' in patch) dbPatch.variants = serializeJSON(patch.variants);
  if ('order_index' in patch) dbPatch.order_index = patch.order_index;
  all[id] = { ...all[id], ...dbPatch, updated_at: nowISO() };
  writeTemplateFile('character_templates', all);
  const row = all[id];
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
  const all = readTemplateFile<Record<string, any>>('character_templates', {});
  if (!all[id]) return;
  delete all[id];
  writeTemplateFile('character_templates', all);
}

export function reorderCharacterTemplates(orderedIds: string[]): void {
  const all = readTemplateFile<Record<string, any>>('character_templates', {});
  orderedIds.forEach((id, i) => {
    if (all[id]) all[id] = { ...all[id], order_index: i, updated_at: nowISO() };
  });
  writeTemplateFile('character_templates', all);
}

// —— 聚合查询 —— //

export function getStoryWithAll(storyId: string): any {
  const bundle = readStoryFile(storyId);
  if (!bundle) return undefined;
  const story = bundle.story;
  return {
    ...story,
    world_settings: bundle.world_settings,
    characters: bundle.characters.map((r) => ({
      ...r,
      attributes: parseJSON<Record<string, string | number>>(r.attributes, {}),
      variants: parseJSON<CharacterVariantRow[]>(r.variants, []),
    })),
    character_relations: bundle.character_relations,
    outlines: bundle.outlines,
    volumes: bundle.volumes,
    chapters: bundle.chapters.map((ch) => ({
      ...ch,
      sections: bundle.sections.filter((s) => s.chapter_id === ch.id),
    })),
    sections: bundle.sections,
    dice_history: bundle.dice_history || [],
  };
}

export function getDataDirectory(): string {
  return getDataDir();
}

// —— 收藏夹 —— //

export function listFavorites(): FavoriteRow[] {
  const all = loadGlobalJSON<Record<string, FavoriteRow>>('favorites', {});
  return Object.values(all).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

export function createFavorite(data: { name: string }): FavoriteRow {
  if (!data.name || !data.name.trim()) {
    throw new Error('收藏夹名称不能为空');
  }
  const all = loadGlobalJSON<Record<string, FavoriteRow>>('favorites', {});
  const now = nowISO();
  const row: FavoriteRow = {
    id: uuid4(),
    name: data.name.trim(),
    created_at: now,
    updated_at: now,
  };
  all[row.id] = row;
  saveGlobalJSON('favorites', all);
  return row;
}

export function renameFavorite(id: string, name: string): FavoriteRow | null {
  if (!name || !name.trim()) {
    throw new Error('收藏夹名称不能为空');
  }
  const all = loadGlobalJSON<Record<string, FavoriteRow>>('favorites', {});
  if (!all[id]) return null;
  all[id] = { ...all[id], name: name.trim(), updated_at: nowISO() };
  saveGlobalJSON('favorites', all);
  return all[id];
}

export function getFavoriteStoryCount(favoriteId: string): number {
  const assocs = loadGlobalJSON<Record<string, StoryFavoriteRow>>('story_favorites', {});
  let count = 0;
  for (const _id in assocs) {
    if (assocs[_id].favorite_id === favoriteId) count++;
  }
  return count;
}

export function deleteFavoriteIfEmpty(id: string): { ok: boolean; error?: string } {
  const count = getFavoriteStoryCount(id);
  if (count > 0) {
    return {
      ok: false,
      error: `收藏夹内还有 ${count} 个作品，请先移出再删除`,
    };
  }
  const all = loadGlobalJSON<Record<string, FavoriteRow>>('favorites', {});
  if (!all[id]) return { ok: false, error: '收藏夹不存在' };
  delete all[id];
  saveGlobalJSON('favorites', all);
  return { ok: true };
}

export function addStoryToFavorite(storyId: string, favoriteId: string): boolean {
  const all = loadGlobalJSON<Record<string, StoryFavoriteRow>>('story_favorites', {});
  for (const _id in all) {
    if (all[_id].story_id === storyId && all[_id].favorite_id === favoriteId) {
      return false;
    }
  }
  const favs = loadGlobalJSON<Record<string, FavoriteRow>>('favorites', {});
  if (!favs[favoriteId]) return false;
  // 故事存在校验：检查 per-story 文件
  if (!fs.existsSync(storyFilePath(storyId))) return false;
  const row: StoryFavoriteRow = {
    story_id: storyId,
    favorite_id: favoriteId,
    added_at: nowISO(),
  };
  const newId = `${storyId}__${favoriteId}`;
  all[newId] = row;
  saveGlobalJSON('story_favorites', all);
  return true;
}

export function removeStoryFromFavorite(storyId: string, favoriteId: string): boolean {
  const all = loadGlobalJSON<Record<string, StoryFavoriteRow>>('story_favorites', {});
  let changed = false;
  for (const _id in all) {
    if (all[_id].story_id === storyId && all[_id].favorite_id === favoriteId) {
      delete all[_id];
      changed = true;
    }
  }
  if (changed) saveGlobalJSON('story_favorites', all);
  return changed;
}

export function getFavoritesForStory(storyId: string): FavoriteRow[] {
  const assocs = loadGlobalJSON<Record<string, StoryFavoriteRow>>('story_favorites', {});
  const favs = loadGlobalJSON<Record<string, FavoriteRow>>('favorites', {});
  const result: FavoriteRow[] = [];
  for (const _id in assocs) {
    if (assocs[_id].story_id === storyId && favs[assocs[_id].favorite_id]) {
      result.push(favs[assocs[_id].favorite_id]);
    }
  }
  return result;
}

export function getStoryIdsInFavorite(favoriteId: string): string[] {
  const assocs = loadGlobalJSON<Record<string, StoryFavoriteRow>>('story_favorites', {});
  const result: string[] = [];
  for (const _id in assocs) {
    if (assocs[_id].favorite_id === favoriteId) {
      result.push(assocs[_id].story_id);
    }
  }
  return result;
}

export function cleanupStoryFromFavorites(storyId: string): void {
  const all = loadGlobalJSON<Record<string, StoryFavoriteRow>>('story_favorites', {});
  let changed = false;
  for (const _id in all) {
    if (all[_id].story_id === storyId) {
      delete all[_id];
      changed = true;
    }
  }
  if (changed) saveGlobalJSON('story_favorites', all);
}

// —— 图片库 —— //
type ImageLibraryFolderRow = {
  id: string;
  name: string;
  parentId: string | null;
  created_at: string;
  updated_at: string;
};

type ImageLibraryItemRow = {
  id: string;
  folderId: string | null;
  url: string;
  filename: string;
  source: 'local' | 'url';
  created_at: string;
};

type ImageLibraryData = {
  folders: Record<string, ImageLibraryFolderRow>;
  items: Record<string, ImageLibraryItemRow>;
};

function loadImageLibrary(): ImageLibraryData {
  return loadGlobalJSON<ImageLibraryData>('image_library', { folders: {}, items: {} });
}

function saveImageLibrary(data: ImageLibraryData): void {
  saveGlobalJSON('image_library', data);
}

export function listImageLibraryFolders(parentId?: string | null): ImageLibraryFolderRow[] {
  const data = loadImageLibrary();
  let folders = Object.values(data.folders);
  if (parentId !== undefined) {
    folders = folders.filter((f) => f.parentId === parentId);
  }
  return folders.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export function createImageLibraryFolder(folderData: { name: string; parentId: string | null }): ImageLibraryFolderRow {
  if (!folderData.name || !folderData.name.trim()) {
    throw new Error('文件夹名称不能为空');
  }
  const data = loadImageLibrary();
  const now = nowISO();
  const row: ImageLibraryFolderRow = {
    id: uuid4(),
    name: folderData.name.trim(),
    parentId: folderData.parentId,
    created_at: now,
    updated_at: now,
  };
  data.folders[row.id] = row;
  saveImageLibrary(data);
  return row;
}

export function renameImageLibraryFolder(id: string, name: string): ImageLibraryFolderRow | null {
  const data = loadImageLibrary();
  if (!data.folders[id]) return null;
  data.folders[id].name = name.trim();
  data.folders[id].updated_at = nowISO();
  saveImageLibrary(data);
  return data.folders[id];
}

export function deleteImageLibraryFolder(id: string): { ok: boolean; error?: string } {
  const data = loadImageLibrary();
  if (!data.folders[id]) return { ok: false, error: '文件夹不存在' };
  // 级联删除子文件夹和子项
  const toDeleteFolderIds = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const fid in data.folders) {
      if (data.folders[fid].parentId && toDeleteFolderIds.has(data.folders[fid].parentId!)) {
        if (!toDeleteFolderIds.has(fid)) {
          toDeleteFolderIds.add(fid);
          changed = true;
        }
      }
    }
  }
  for (const fid of toDeleteFolderIds) {
    delete data.folders[fid];
  }
  // 删除这些文件夹下的所有图片
  for (const itemId in data.items) {
    if (data.items[itemId].folderId && toDeleteFolderIds.has(data.items[itemId].folderId!)) {
      delete data.items[itemId];
    }
  }
  saveImageLibrary(data);
  return { ok: true };
}

export function listImageLibraryItems(folderId?: string | null): ImageLibraryItemRow[] {
  const data = loadImageLibrary();
  let items = Object.values(data.items);
  if (folderId !== undefined) {
    items = items.filter((it) => it.folderId === folderId);
  }
  return items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function addImageLibraryItem(itemData: { folderId: string | null; url: string; filename: string; source: 'local' | 'url' }): ImageLibraryItemRow {
  const data = loadImageLibrary();
  const row: ImageLibraryItemRow = {
    id: uuid4(),
    folderId: itemData.folderId,
    url: itemData.url,
    filename: itemData.filename,
    source: itemData.source,
    created_at: nowISO(),
  };
  data.items[row.id] = row;
  saveImageLibrary(data);
  return row;
}

export function deleteImageLibraryItem(id: string): { ok: boolean; error?: string } {
  const data = loadImageLibrary();
  if (!data.items[id]) return { ok: false, error: '图片不存在' };
  delete data.items[id];
  saveImageLibrary(data);
  return { ok: true };
}

export function moveImageLibraryItem(id: string, folderId: string | null): ImageLibraryItemRow | null {
  const data = loadImageLibrary();
  if (!data.items[id]) return null;
  data.items[id].folderId = folderId;
  saveImageLibrary(data);
  return data.items[id];
}
