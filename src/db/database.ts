// ============================================================
// 安科作者助手 - 数据库 CRUD 封装
//
// 优先使用 better-sqlite3（需 Electron 主进程 / Node 原生），
// 否则自动降级为内存实现，方便在 web 预览中调试。
//
// 所有 JSON 字段（content_blocks.payload、characters.attributes）
// 在读写时自动进行 JSON.parse/JSON.stringify。
// ============================================================

import fs from 'fs';
import path from 'path';
import type {
  Story,
  WorldSetting,
  Character,
  CharacterVariant,
  WorldSettingTemplate,
  CharacterTemplate,
  Outline,
  Volume,
  Chapter,
  Section,
  AnyContentBlock,
  TextBlockPayload,
  ImageBlockPayload,
  DiceBlockPayload,
  DiceBlockPayloadV2,
  StoryWithAll,
  Entity,
} from '../types';
import { getPresetWorldTemplates, getPresetCharacterTemplates } from './presetTemplates';

const SCHEMA_SQL: string = `
CREATE TABLE IF NOT EXISTS app_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    schema_version INTEGER NOT NULL DEFAULT 1,
    last_opened_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    is_starred INTEGER NOT NULL DEFAULT 0,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
-- 确保旧数据库升级时新字段也存在
ALTER TABLE stories ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS order_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS is_starred INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stories ADD COLUMN IF NOT EXISTS is_pinned INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS world_settings (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    avatar TEXT,
    personality TEXT,
    attributes TEXT,
    notes TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outlines (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS volumes (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chapters (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    volume_id TEXT REFERENCES volumes(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    content TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS content_blocks (
    id TEXT PRIMARY KEY,
    section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('text', 'image', 'dice')),
    order_index INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS character_variants (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_character_variants_character_id ON character_variants(character_id);
CREATE TABLE IF NOT EXISTS world_setting_templates (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT,
    is_preset INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS character_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    avatar TEXT,
    personality TEXT,
    attributes TEXT,
    notes TEXT,
    variants TEXT,
    is_preset INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
-- 升级：添加 is_preset 字段
ALTER TABLE world_setting_templates ADD COLUMN IF NOT EXISTS is_preset INTEGER NOT NULL DEFAULT 0;
ALTER TABLE character_templates ADD COLUMN IF NOT EXISTS is_preset INTEGER NOT NULL DEFAULT 0;
-- 人物关系表
CREATE TABLE IF NOT EXISTS character_relations (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    note TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_character_relations_story_id ON character_relations(story_id);
`;

// 实体自动字段：创建对象时不需要调用方提供
type EntityFields = keyof Entity; // 'id' | 'created_at' | 'updated_at'

// ------------------------------------------------------------
// 原生数据库（better-sqlite3）
// ------------------------------------------------------------

type NativeDb = {
  exec: (sql: string) => void;
  prepare: (sql: string) => NativeStmt;
  close: () => void;
};

interface NativeStmt {
  run: (...args: unknown[]) => { changes: number };
  get: (...args: unknown[]) => Record<string, unknown> | undefined;
  all: (...args: unknown[]) => Record<string, unknown>[];
}

let nativeDb: NativeDb | null = null;
let dbInitialized = false;

function tryLoadBetterSqlite(): NativeDb | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const dbPath = resolveDbPath();
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA_SQL);
    // 为旧库补充 content 列（schema 升级：v1 → v2）
    try {
      db.exec('ALTER TABLE sections ADD COLUMN content TEXT');
    } catch {
      // 列已存在 → 忽略
    }
    // 为旧库补充 character_variants 表（schema 升级：v2 → v3）
    try {
      db.exec(SCHEMA_SQL);
    } catch {
      // 已存在 → 忽略
    }
    // v3 → v4：增加 world_setting_templates / character_templates
    try {
      db.exec(SCHEMA_SQL);
    } catch {
      // 已存在 → 忽略
    }
    // v4 → v5：为 character_templates 补充 variants 列
    try {
      db.exec('ALTER TABLE character_templates ADD COLUMN variants TEXT');
    } catch {
      // 列已存在 → 忽略
    }
    return db;
  } catch (err) {
    console.warn('[db] better-sqlite3 不可用，降级到内存实现:', err);
    return null;
  }
}

function resolveDbPath(): string {
  // 用全局 process 以便在 Node/Electron 环境下正常工作
  const env = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env || {};
  const appData =
    env.APPDATA ||
    (env.HOME ? path.join(env.HOME, 'Library', 'Application Support') : './');
  const dir = path.join(String(appData), 'AnkeCreator');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'anke-creator.db');
}

// ------------------------------------------------------------
// 内存实现（无 better-sqlite3 时的降级）
// ------------------------------------------------------------

interface Table {
  [id: string]: Record<string, unknown>;
}

let memoryTables: Record<string, Table> = {};
let memoryInitialized = false;

function initMemory(): void {
  if (memoryInitialized) return;
  memoryTables = {
    stories: {},
    world_settings: {},
    characters: {},
    outlines: {},
    chapters: {},
    sections: {},
    content_blocks: {},
    character_variants: {},
    world_setting_templates: {},
    character_templates: {},
  };
  memoryInitialized = true;
}

// ------------------------------------------------------------
// 工具
// ------------------------------------------------------------

export function initDatabase(): void {
  if (dbInitialized) return;
  nativeDb = tryLoadBetterSqlite();
  if (!nativeDb) {
    initMemory();
  }
  seedPresetTemplates();
  dbInitialized = true;
}

export function closeDatabase(): void {
  nativeDb?.close();
  nativeDb = null;
  memoryInitialized = false;
  memoryTables = {};
  dbInitialized = false;
}

function nowISO(): string {
  return new Date().toISOString();
}

function uuid4(): string {
  const cryptoLike =
    (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoLike?.randomUUID) {
    return String(cryptoLike.randomUUID());
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function parseJSON<T>(raw: unknown): T | undefined {
  if (raw == null) return undefined;
  try {
    return typeof raw === 'string' ? (JSON.parse(raw) as T) : (raw as T);
  } catch {
    return undefined;
  }
}

function stringifyJSON(obj: unknown): string {
  return JSON.stringify(obj);
}

function runSQL(sql: string, ...args: unknown[]): { changes: number } {
  if (nativeDb) {
    return nativeDb.prepare(sql).run(...args);
  }
  return memoryRun(sql, args);
}

function getSQL<T>(sql: string, ...args: unknown[]): T | undefined {
  if (nativeDb) {
    return nativeDb.prepare(sql).get(...args) as T | undefined;
  }
  return memoryGet<T>(sql, args);
}

function allSQL<T>(sql: string, ...args: unknown[]): T[] {
  if (nativeDb) {
    return nativeDb.prepare(sql).all(...args) as T[];
  }
  return memoryAll<T>(sql, args);
}

function memoryParseTable(sql: string): string | null {
  const insert = sql.match(/^INSERT\s+INTO\s+(\w+)/i);
  if (insert) return insert[1];
  const update = sql.match(/^UPDATE\s+(\w+)/i);
  if (update) return update[1];
  const del = sql.match(/^DELETE\s+FROM\s+(\w+)/i);
  if (del) return del[1];
  const select = sql.match(/^SELECT[\s\S]*?\bFROM\s+(\w+)/i);
  if (select) return select[1];
  return null;
}

function memoryParseWhereKeys(sql: string): string[] | null {
  const m = sql.match(/\bWHERE\s+([\s\S]+?)(?:\sORDER\s+|\sLIMIT\s|$)/i);
  if (!m) return null;
  const parts = m[1].split(/\s+AND\s+/i);
  return parts.map((p) => {
    const k = p.trim().match(/^(\w+)\s*=\s*\?$/);
    return k ? k[1] : p.trim();
  });
}

function memoryMatches(
  row: Record<string, unknown>,
  keys: string[] | null,
  args: unknown[],
): boolean {
  if (!keys) return true;
  if (keys.length !== args.length) return false;
  for (let i = 0; i < keys.length; i++) {
    if (String(row[keys[i]]) !== String(args[i])) return false;
  }
  return true;
}

function memoryRun(sql: string, args: unknown[]): { changes: number } {
  const trimmed = sql.trim().replace(/;?\s*$/, '');
  const table = memoryParseTable(trimmed);
  if (!table) return { changes: 0 };
  initMemory();
  if (!memoryTables[table]) memoryTables[table] = {};
  let changes = 0;

  if (/^INSERT\s+/i.test(trimmed)) {
    const colsMatch = trimmed.match(/\(([^)]+)\)\s*VALUES/i);
    if (!colsMatch) return { changes: 0 };
    const cols = colsMatch[1].split(',').map((c) => c.trim());
    const id = String(args[cols.indexOf('id') >= 0 ? cols.indexOf('id') : 0]);
    const row: Record<string, unknown> = {};
    cols.forEach((c, i) => (row[c] = args[i]));
    memoryTables[table][id] = row;
    changes = 1;
  } else if (/^UPDATE\s+/i.test(trimmed)) {
    const setMatch = trimmed.match(/\bSET\s+([\s\S]+?)\s+WHERE\b/i);
    const whereKeys = memoryParseWhereKeys(trimmed);
    if (setMatch) {
      const setPairs = setMatch[1]
        .split(',')
        .map((p) => p.trim().match(/^(\w+)\s*=\s*\?$/)) as (RegExpMatchArray | null)[];
      const setValues: unknown[] = args.slice(0, setPairs.length);
      const whereValues: unknown[] = args.slice(setPairs.length);
      Object.values(memoryTables[table]).forEach((row) => {
        if (memoryMatches(row, whereKeys, whereValues)) {
          setPairs.forEach((pair, i) => {
            if (pair) row[pair[1]] = setValues[i];
          });
          changes++;
        }
      });
    }
  } else if (/^DELETE\s+/i.test(trimmed)) {
    const whereKeys = memoryParseWhereKeys(trimmed);
    const whereValues = args;
    const ids = Object.keys(memoryTables[table]).filter((id) =>
      memoryMatches(memoryTables[table][id], whereKeys, whereValues),
    );
    ids.forEach((id) => delete memoryTables[table][id]);
    changes = ids.length;
  }

  return { changes };
}

function memoryGet<T>(sql: string, args: unknown[]): T | undefined {
  const rows = memoryAll<T>(sql, args);
  return rows[0];
}

function memoryAll<T>(sql: string, args: unknown[]): T[] {
  const table = memoryParseTable(sql);
  if (!table) return [];
  const whereKeys = memoryParseWhereKeys(sql);
  initMemory();
  const rows = Object.values(memoryTables[table] || {})
    .filter((row) => memoryMatches(row, whereKeys, args))
    .map((row) => ({ ...row }) as T);
  const orderMatch = sql.match(/\bORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?/i);
  if (orderMatch) {
    const col = orderMatch[1];
    const desc = (orderMatch[2] || '').toUpperCase() === 'DESC';
    rows.sort((a: unknown, b: unknown) => {
      const av = String((a as Record<string, unknown>)[col]);
      const bv = String((b as Record<string, unknown>)[col]);
      if (av === bv) return 0;
      return (av < bv ? -1 : 1) * (desc ? -1 : 1);
    });
  }
  const limitMatch = sql.match(/\bLIMIT\s+(\d+)/i);
  if (limitMatch) {
    return rows.slice(0, parseInt(limitMatch[1], 10));
  }
  return rows;
}

// ------------------------------------------------------------
// 通用新增/更新辅助
// ------------------------------------------------------------

function autoOrder(
  table: string,
  parentCol: string,
  parentId: string,
  explicitOrder?: number,
): number {
  if (typeof explicitOrder === 'number') return explicitOrder;
  if (nativeDb) {
    const rows = allSQL<{ max_idx: number }>(
      `SELECT COALESCE(MAX(order_index), -1) AS max_idx FROM ${table} WHERE ${parentCol} = ?`,
      parentId,
    );
    return Number(rows[0]?.max_idx ?? -1) + 1;
  }
  const all = allSQL<Record<string, unknown>>(
    `SELECT order_index FROM ${table} WHERE ${parentCol} = ?`,
    parentId,
  );
  if (all.length === 0) return 0;
  return Math.max(...all.map((r) => Number(r.order_index) || 0)) + 1;
}

function doUpdate(
  table: string,
  id: string,
  patch: Record<string, unknown>,
): void {
  const now = nowISO();
  const fields: string[] = [];
  const values: unknown[] = [];
  Object.entries(patch).forEach(([k, v]) => {
    if (v !== undefined) {
      fields.push(`${k} = ?`);
      values.push(v);
    }
  });
  fields.push('updated_at = ?');
  values.push(now);
  values.push(id);
  runSQL(`UPDATE ${table} SET ${fields.join(', ')} WHERE id = ?`, ...values);
}

// ------------------------------------------------------------
// Story
// ------------------------------------------------------------

function rowToStory(r: any): Story {
  return {
    ...r,
    is_starred: !!r.is_starred,
    is_pinned: !!r.is_pinned,
  };
}

export function listStories(): Story[] {
  return allSQL<any>('SELECT * FROM stories ORDER BY updated_at DESC').map(rowToStory);
}

export function getStory(id: string): Story | undefined {
  const r = getSQL<any>('SELECT * FROM stories WHERE id = ?', id);
  return r ? rowToStory(r) : undefined;
}

export function createStory(data: { title: string; description?: string; category?: string }): Story {
  const now = nowISO();
  const stories = listStories();
  const maxIdx = stories.reduce((m, s) => Math.max(m, s.order_index ?? 0), 0);
  const story: Story = {
    id: uuid4(),
    title: data.title,
    description: data.description || '',
    category: data.category || '',
    order_index: maxIdx + 1,
    is_starred: false,
    is_pinned: false,
    created_at: now,
    updated_at: now,
  };
  runSQL(
    'INSERT INTO stories (id, title, description, category, order_index, is_starred, is_pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    story.id,
    story.title,
    story.description,
    story.category,
    story.order_index,
    story.is_starred ? 1 : 0,
    story.is_pinned ? 1 : 0,
    story.created_at,
    story.updated_at,
  );
  return story;
}

type StoryPatch = Partial<{
  title: string;
  description: string;
  category: string;
  order_index: number;
  is_starred: boolean;
  is_pinned: boolean;
}>;

export function updateStory(id: string, patch: StoryPatch): Story | undefined {
  const dbPatch: Record<string, any> = { ...patch };
  if (patch.is_starred !== undefined) dbPatch.is_starred = patch.is_starred ? 1 : 0;
  if (patch.is_pinned !== undefined) dbPatch.is_pinned = patch.is_pinned ? 1 : 0;
  doUpdate('stories', id, dbPatch);
  return getStory(id);
}

export function deleteStory(id: string): void {
  runSQL('DELETE FROM stories WHERE id = ?', id);
}

// ------------------------------------------------------------
// WorldSetting
// ------------------------------------------------------------

type NewWorldSetting = Omit<WorldSetting, EntityFields | 'order_index'> & {
  order_index?: number;
};

export function listWorldSettings(storyId: string): WorldSetting[] {
  return allSQL<WorldSetting>(
    'SELECT * FROM world_settings WHERE story_id = ? ORDER BY order_index',
    storyId,
  );
}

export function createWorldSetting(data: NewWorldSetting): WorldSetting {
  const now = nowISO();
  const idx = autoOrder('world_settings', 'story_id', data.story_id, data.order_index);
  const row: WorldSetting = {
    id: uuid4(),
    story_id: data.story_id,
    title: data.title,
    content: data.content || '',
    order_index: idx,
    created_at: now,
    updated_at: now,
  };
  runSQL(
    'INSERT INTO world_settings (id, story_id, title, content, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    row.id,
    row.story_id,
    row.title,
    row.content,
    row.order_index,
    row.created_at,
    row.updated_at,
  );
  return row;
}

export function updateWorldSetting(
  id: string,
  patch: Partial<Pick<WorldSetting, 'title' | 'content' | 'order_index'>>,
): WorldSetting | undefined {
  doUpdate('world_settings', id, patch);
  return getSQL<WorldSetting>('SELECT * FROM world_settings WHERE id = ?', id);
}

export function deleteWorldSetting(id: string): void {
  runSQL('DELETE FROM world_settings WHERE id = ?', id);
}

// ------------------------------------------------------------
// Character
// ------------------------------------------------------------

type NewCharacter = Omit<Character, EntityFields | 'order_index'> & {
  order_index?: number;
};

export function listCharacters(storyId: string): Character[] {
  const rows = allSQL<Character>(
    'SELECT * FROM characters WHERE story_id = ? ORDER BY order_index',
    storyId,
  );
  if (rows.length === 0) return [];
  // 一次性加载全部 variants，按 character_id 分组
  const variantsByCharId = listAllVariantsGroupedByCharacterId(
    rows.map((r) => r.id),
  );
  return rows.map((c) => ({
    ...c,
    attributes: parseJSON<Record<string, string | number>>(c.attributes),
    variants: variantsByCharId[c.id] ?? [],
  }));
}

export function createCharacter(data: NewCharacter): Character {
  const now = nowISO();
  const idx = autoOrder('characters', 'story_id', data.story_id, data.order_index);
  const row: Character = {
    id: uuid4(),
    story_id: data.story_id,
    name: data.name,
    avatar: data.avatar || '',
    personality: data.personality || '',
    attributes: data.attributes,
    notes: data.notes || '',
    order_index: idx,
    created_at: now,
    updated_at: now,
  };
  runSQL(
    'INSERT INTO characters (id, story_id, name, avatar, personality, attributes, notes, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    row.id,
    row.story_id,
    row.name,
    row.avatar,
    row.personality,
    stringifyJSON(row.attributes || null),
    row.notes,
    row.order_index,
    row.created_at,
    row.updated_at,
  );
  return { ...row, variants: [] };
}

export function updateCharacter(
  id: string,
  patch: Partial<
    Pick<Character, 'name' | 'avatar' | 'personality' | 'attributes' | 'notes' | 'order_index'>
  >,
): Character | undefined {
  const now = nowISO();
  const fields: string[] = [];
  const values: unknown[] = [];
  (['name', 'avatar', 'personality', 'notes', 'order_index'] as const).forEach((k) => {
    if ((patch as Record<string, unknown>)[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push((patch as Record<string, unknown>)[k]);
    }
  });
  if (patch.attributes !== undefined) {
    fields.push('attributes = ?');
    values.push(stringifyJSON(patch.attributes));
  }
  fields.push('updated_at = ?');
  values.push(now);
  values.push(id);
  runSQL(`UPDATE characters SET ${fields.join(', ')} WHERE id = ?`, ...values);
  // 读取更新后的完整行（包含已解析的 attributes JSON）
  const row = getSQL<Character & { attributes_json?: string }>(
    'SELECT * FROM characters WHERE id = ?',
    id,
  );
  if (!row) return undefined;
  return {
    ...row,
    attributes: parseJSON<Record<string, string | number>>(row.attributes),
  } as Character;
}

export function deleteCharacter(id: string): void {
  runSQL('DELETE FROM characters WHERE id = ?', id);
}

// ------------------------------------------------------------
// CharacterVariant
// ------------------------------------------------------------

type NewCharacterVariant = Omit<CharacterVariant, EntityFields | 'order_index'> & {
  order_index?: number;
};

export function listCharacterVariants(characterId: string): CharacterVariant[] {
  return allSQL<CharacterVariant>(
    'SELECT * FROM character_variants WHERE character_id = ? ORDER BY order_index',
    characterId,
  );
}

export function listAllVariantsByStory(storyId: string): CharacterVariant[] {
  return allSQL<CharacterVariant>(
    `SELECT cv.* FROM character_variants cv
     INNER JOIN characters c ON c.id = cv.character_id
     WHERE c.story_id = ?
     ORDER BY cv.character_id, cv.order_index`,
    storyId,
  );
}

export function listAllVariantsGroupedByCharacterId(
  characterIds: string[],
): Record<string, CharacterVariant[]> {
  if (characterIds.length === 0) return {};
  // 用 IN (?, ?, ...) 拼 SQL
  const placeholders = characterIds.map(() => '?').join(',');
  const rows = allSQL<CharacterVariant>(
    `SELECT * FROM character_variants WHERE character_id IN (${placeholders}) ORDER BY character_id, order_index`,
    ...characterIds,
  );
  const grouped: Record<string, CharacterVariant[]> = {};
  characterIds.forEach((id) => (grouped[id] = []));
  rows.forEach((v) => {
    if (!grouped[v.character_id]) grouped[v.character_id] = [];
    grouped[v.character_id].push(v);
  });
  return grouped;
}

export function getCharacterVariant(id: string): CharacterVariant | undefined {
  return getSQL<CharacterVariant>(
    'SELECT * FROM character_variants WHERE id = ?',
    id,
  );
}

export function createCharacterVariant(data: NewCharacterVariant): CharacterVariant {
  const now = nowISO();
  const idx = autoOrder('character_variants', 'character_id', data.character_id, data.order_index);
  const row: CharacterVariant = {
    id: uuid4(),
    character_id: data.character_id,
    name: data.name,
    url: data.url,
    order_index: idx,
    created_at: now,
    updated_at: now,
  };
  runSQL(
    'INSERT INTO character_variants (id, character_id, name, url, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    row.id,
    row.character_id,
    row.name,
    row.url,
    row.order_index,
    row.created_at,
    row.updated_at,
  );
  return row;
}

export function updateCharacterVariant(
  id: string,
  patch: Partial<Pick<CharacterVariant, 'name' | 'url' | 'order_index'>>,
): CharacterVariant | undefined {
  doUpdate('character_variants', id, patch);
  return getCharacterVariant(id);
}

export function deleteCharacterVariant(id: string): void {
  runSQL('DELETE FROM character_variants WHERE id = ?', id);
}

// ------------------------------------------------------------
// WorldSettingTemplate (世界观设定模板，独立表，不含 story_id)
// ------------------------------------------------------------

type NewWorldSettingTemplate = Omit<WorldSettingTemplate, EntityFields>;

export function listWorldSettingTemplates(): WorldSettingTemplate[] {
  return allSQL<WorldSettingTemplate>(
    'SELECT * FROM world_setting_templates ORDER BY updated_at DESC',
  ).map((t) => ({ ...t }));
}

export function getWorldSettingTemplate(id: string): WorldSettingTemplate | undefined {
  return getSQL<WorldSettingTemplate>(
    'SELECT * FROM world_setting_templates WHERE id = ?',
    id,
  );
}

export function createWorldSettingTemplate(
  data: NewWorldSettingTemplate,
): WorldSettingTemplate {
  const now = nowISO();
  const row: WorldSettingTemplate = {
    id: uuid4(),
    title: data.title,
    content: data.content || '',
    is_preset: data.is_preset ?? 0,
    created_at: now,
    updated_at: now,
  };
  runSQL(
    'INSERT INTO world_setting_templates (id, title, content, is_preset, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    row.id,
    row.title,
    row.content,
    row.is_preset,
    row.created_at,
    row.updated_at,
  );
  return row;
}

export function updateWorldSettingTemplate(
  id: string,
  patch: Partial<Pick<WorldSettingTemplate, 'title' | 'content'>>,
): WorldSettingTemplate | undefined {
  // 预置模板不可修改
  const existing = getWorldSettingTemplate(id);
  if (existing?.is_preset) return existing;
  doUpdate('world_setting_templates', id, patch);
  return getWorldSettingTemplate(id);
}

export function deleteWorldSettingTemplate(id: string): void {
  // 预置模板不可删除
  const existing = getWorldSettingTemplate(id);
  if (existing?.is_preset) return;
  runSQL('DELETE FROM world_setting_templates WHERE id = ?', id);
}

// ------------------------------------------------------------
// CharacterTemplate (人物模板，独立表，不含 story_id / order_index / variants)
// ------------------------------------------------------------

type NewCharacterTemplate = Omit<CharacterTemplate, EntityFields>;

export function listCharacterTemplates(): CharacterTemplate[] {
  return allSQL<CharacterTemplate>(
    'SELECT * FROM character_templates ORDER BY updated_at DESC',
  ).map((c) => ({
    ...c,
    attributes: parseJSON<Record<string, string | number>>(c.attributes),
    variants: parseJSON<CharacterVariant[]>(c.variants),
  }));
}

export function getCharacterTemplate(id: string): CharacterTemplate | undefined {
  const row = getSQL<CharacterTemplate>(
    'SELECT * FROM character_templates WHERE id = ?',
    id,
  );
  if (!row) return undefined;
  return {
    ...row,
    attributes: parseJSON<Record<string, string | number>>(row.attributes),
    variants: parseJSON<CharacterVariant[]>(row.variants),
  };
}

export function createCharacterTemplate(
  data: NewCharacterTemplate,
): CharacterTemplate {
  const now = nowISO();
  const row: CharacterTemplate = {
    id: uuid4(),
    name: data.name,
    avatar: data.avatar || '',
    personality: data.personality || '',
    attributes: data.attributes,
    notes: data.notes || '',
    variants: data.variants,
    is_preset: data.is_preset ?? 0,
    created_at: now,
    updated_at: now,
  };
  runSQL(
    'INSERT INTO character_templates (id, name, avatar, personality, attributes, notes, variants, is_preset, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    row.id,
    row.name,
    row.avatar,
    row.personality,
    stringifyJSON(row.attributes || null),
    row.notes,
    stringifyJSON(row.variants || null),
    row.is_preset,
    row.created_at,
    row.updated_at,
  );
  return { ...row };
}

export function updateCharacterTemplate(
  id: string,
  patch: Partial<
    Pick<
      CharacterTemplate,
      'name' | 'avatar' | 'personality' | 'attributes' | 'notes' | 'variants'
    >
  >,
): CharacterTemplate | undefined {
  // 预置模板不可修改
  const existing = getCharacterTemplate(id);
  if (existing?.is_preset) return existing;
  const now = nowISO();
  const fields: string[] = [];
  const values: unknown[] = [];
  (['name', 'avatar', 'personality', 'notes'] as const).forEach((k) => {
    if ((patch as Record<string, unknown>)[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push((patch as Record<string, unknown>)[k]);
    }
  });
  if (patch.attributes !== undefined) {
    fields.push('attributes = ?');
    values.push(stringifyJSON(patch.attributes));
  }
  if (patch.variants !== undefined) {
    fields.push('variants = ?');
    values.push(stringifyJSON(patch.variants));
  }
  fields.push('updated_at = ?');
  values.push(now);
  values.push(id);
  if (fields.length > 1) {
    runSQL(`UPDATE character_templates SET ${fields.join(', ')} WHERE id = ?`, ...values);
  }
  return getCharacterTemplate(id);
}

export function deleteCharacterTemplate(id: string): void {
  // 预置模板不可删除
  const existing = getCharacterTemplate(id);
  if (existing?.is_preset) return;
  runSQL('DELETE FROM character_templates WHERE id = ?', id);
}

export function reorderCharacterVariants(
  characterId: string,
  orderedIds: string[],
): void {
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE character_variants SET order_index = ?, updated_at = ? WHERE id = ? AND character_id = ?',
      i,
      nowISO(),
      id,
      characterId,
    );
  });
}

// ------------------------------------------------------------
// 预置模板种子数据
// ------------------------------------------------------------

function seedPresetTemplates(): void {
  // 1. 清理重复预置模板（应用层过滤，不依赖 WHERE is_preset = 1）
  try {
    const allWorlds = allSQL<{ id: string; title: string; is_preset: number }>(
      "SELECT id, title, is_preset FROM world_setting_templates ORDER BY created_at",
    );
    const presetWorlds = allWorlds.filter((r) => Number(r.is_preset) === 1);
    const seenTitles = new Set<string>();
    for (const row of presetWorlds) {
      if (seenTitles.has(row.title)) {
        runSQL("DELETE FROM world_setting_templates WHERE id = ?", row.id);
      } else {
        seenTitles.add(row.title);
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const allChars = allSQL<{ id: string; name: string; is_preset: number }>(
      "SELECT id, name, is_preset FROM character_templates ORDER BY created_at",
    );
    const presetChars = allChars.filter((r) => Number(r.is_preset) === 1);
    const seenNames = new Set<string>();
    for (const row of presetChars) {
      if (seenNames.has(row.name)) {
        runSQL("DELETE FROM character_templates WHERE id = ?", row.id);
      } else {
        seenNames.add(row.name);
      }
    }
  } catch {
    /* ignore */
  }

  // 2. 插入缺失的预置模板（应用层检查，不依赖 WHERE is_preset = 1）
  try {
    const allWorlds = allSQL<{ title: string; is_preset: number }>(
      "SELECT title, is_preset FROM world_setting_templates",
    );
    const presetTitles = new Set(
      allWorlds.filter((r) => Number(r.is_preset) === 1).map((r) => r.title),
    );
    for (const tpl of getPresetWorldTemplates()) {
      if (!presetTitles.has(tpl.title)) {
        createWorldSettingTemplate(tpl);
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const allChars = allSQL<{ name: string; is_preset: number }>(
      "SELECT name, is_preset FROM character_templates",
    );
    const presetNames = new Set(
      allChars.filter((r) => Number(r.is_preset) === 1).map((r) => r.name),
    );
    for (const tpl of getPresetCharacterTemplates()) {
      if (!presetNames.has(tpl.name)) {
        createCharacterTemplate(tpl);
      }
    }
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------
// CharacterRelation (人物关系，独立表，按 story 关联)
// ------------------------------------------------------------

type NewCharacterRelation = {
  story_id: string;
  source_id: string;
  target_id: string;
  relation: string;
  note?: string;
  order_index?: number;
};

export interface CharacterRelationRow {
  id: string;
  story_id: string;
  source_id: string;
  target_id: string;
  relation: string;
  note: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export function listCharacterRelations(storyId: string): CharacterRelationRow[] {
  return allSQL<CharacterRelationRow>(
    'SELECT * FROM character_relations WHERE story_id = ? ORDER BY order_index, created_at',
    storyId,
  );
}

export function createCharacterRelation(data: NewCharacterRelation): CharacterRelationRow {
  const now = nowISO();
  const idx = autoOrder('character_relations', 'story_id', data.story_id, data.order_index);
  const row: CharacterRelationRow = {
    id: uuid4(),
    story_id: data.story_id,
    source_id: data.source_id,
    target_id: data.target_id,
    relation: data.relation,
    note: data.note ?? null,
    order_index: idx,
    created_at: now,
    updated_at: now,
  };
  runSQL(
    'INSERT INTO character_relations (id, story_id, source_id, target_id, relation, note, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    row.id,
    row.story_id,
    row.source_id,
    row.target_id,
    row.relation,
    row.note,
    row.order_index,
    row.created_at,
    row.updated_at,
  );
  return row;
}

export function updateCharacterRelation(
  id: string,
  patch: Partial<Pick<CharacterRelationRow, 'source_id' | 'target_id' | 'relation' | 'note' | 'order_index'>>,
): CharacterRelationRow | undefined {
  const now = nowISO();
  const fields: string[] = [];
  const values: unknown[] = [];
  (['source_id', 'target_id', 'relation', 'note', 'order_index'] as const).forEach((k) => {
    if ((patch as Record<string, unknown>)[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push((patch as Record<string, unknown>)[k]);
    }
  });
  if (fields.length === 0) return getSQL<CharacterRelationRow>('SELECT * FROM character_relations WHERE id = ?', id);
  fields.push('updated_at = ?');
  values.push(now);
  values.push(id);
  runSQL(`UPDATE character_relations SET ${fields.join(', ')} WHERE id = ?`, ...values);
  return getSQL<CharacterRelationRow>('SELECT * FROM character_relations WHERE id = ?', id);
}

export function deleteCharacterRelation(id: string): void {
  runSQL('DELETE FROM character_relations WHERE id = ?', id);
}

// ------------------------------------------------------------
// Outline
// ------------------------------------------------------------

type NewOutline = Omit<Outline, EntityFields | 'order_index'> & {
  order_index?: number;
};

export function listOutlines(storyId: string): Outline[] {
  return allSQL<Outline>(
    'SELECT * FROM outlines WHERE story_id = ? ORDER BY order_index',
    storyId,
  );
}

export function createOutline(data: NewOutline): Outline {
  const now = nowISO();
  const idx = autoOrder('outlines', 'story_id', data.story_id, data.order_index);
  const row: Outline = {
    id: uuid4(),
    story_id: data.story_id,
    content: data.content,
    order_index: idx,
    created_at: now,
    updated_at: now,
  };
  runSQL(
    'INSERT INTO outlines (id, story_id, content, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    row.id,
    row.story_id,
    row.content,
    row.order_index,
    row.created_at,
    row.updated_at,
  );
  return row;
}

export function updateOutline(
  id: string,
  patch: Partial<Pick<Outline, 'content' | 'order_index'>>,
): Outline | undefined {
  doUpdate('outlines', id, patch);
  return getSQL<Outline>('SELECT * FROM outlines WHERE id = ?', id);
}

export function deleteOutline(id: string): void {
  runSQL('DELETE FROM outlines WHERE id = ?', id);
}

// ------------------------------------------------------------
// Chapter
// ------------------------------------------------------------

type NewChapter = Omit<Chapter, EntityFields | 'order_index'> & {
  order_index?: number;
};

export function listChapters(storyId: string): Chapter[] {
  return allSQL<Chapter>(
    'SELECT * FROM chapters WHERE story_id = ? ORDER BY order_index',
    storyId,
  );
}

export function listChaptersByVolume(volumeId: string): Chapter[] {
  return allSQL<Chapter>(
    'SELECT * FROM chapters WHERE volume_id = ? ORDER BY order_index',
    volumeId,
  );
}

export function createChapter(data: NewChapter): Chapter {
  const now = nowISO();
  const idx = autoOrder('chapters', 'story_id', data.story_id, data.order_index);
  const row: Chapter = {
    id: uuid4(),
    story_id: data.story_id,
    volume_id: data.volume_id ?? null,
    title: data.title,
    order_index: idx,
    created_at: now,
    updated_at: now,
  };
  runSQL(
    'INSERT INTO chapters (id, story_id, volume_id, title, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    row.id,
    row.story_id,
    row.volume_id,
    row.title,
    row.order_index,
    row.created_at,
    row.updated_at,
  );
  return row;
}

export function updateChapter(
  id: string,
  patch: Partial<Pick<Chapter, 'title' | 'order_index' | 'volume_id'>>,
): Chapter | undefined {
  doUpdate('chapters', id, patch);
  return getSQL<Chapter>('SELECT * FROM chapters WHERE id = ?', id);
}

export function deleteChapter(id: string): void {
  // 先删除该章下的所有节（节删除会级联删除内容块）
  const sectionsToDelete = allSQL<{ id: string }>(
    'SELECT id FROM sections WHERE chapter_id = ?',
    id,
  );
  sectionsToDelete.forEach((sec) => deleteSection(sec.id));
  // 再删除章本身
  runSQL('DELETE FROM chapters WHERE id = ?', id);
}

export function reorderChapters(storyId: string, orderedIds: string[]): void {
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE chapters SET order_index = ?, updated_at = ? WHERE id = ? AND story_id = ?',
      i,
      nowISO(),
      id,
      storyId,
    );
  });
}

// ------------------------------------------------------------
// Volume
// ------------------------------------------------------------

type NewVolume = Omit<Volume, EntityFields | 'order_index'> & {
  order_index?: number;
};

export function listVolumes(storyId: string): Volume[] {
  return allSQL<Volume>(
    'SELECT * FROM volumes WHERE story_id = ? ORDER BY order_index',
    storyId,
  );
}

export function createVolume(data: NewVolume): Volume {
  const now = nowISO();
  const idx = autoOrder('volumes', 'story_id', data.story_id, data.order_index);
  const row: Volume = {
    id: uuid4(),
    story_id: data.story_id,
    title: data.title,
    order_index: idx,
    created_at: now,
    updated_at: now,
  };
  runSQL(
    'INSERT INTO volumes (id, story_id, title, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    row.id,
    row.story_id,
    row.title,
    row.order_index,
    row.created_at,
    row.updated_at,
  );
  return row;
}

export function updateVolume(
  id: string,
  patch: Partial<Pick<Volume, 'title' | 'order_index'>>,
): Volume | undefined {
  doUpdate('volumes', id, patch);
  return getSQL<Volume>('SELECT * FROM volumes WHERE id = ?', id);
}

export function deleteVolume(id: string): void {
  // 先删除该卷下的所有章节（章节删除会级联删除节和内容块）
  const chaptersToDelete = allSQL<{ id: string }>(
    'SELECT id FROM chapters WHERE volume_id = ?',
    id,
  );
  chaptersToDelete.forEach((ch) => deleteChapter(ch.id));
  // 再删除卷本身
  runSQL('DELETE FROM volumes WHERE id = ?', id);
}

export function reorderVolumes(storyId: string, orderedIds: string[]): void {
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE volumes SET order_index = ?, updated_at = ? WHERE id = ? AND story_id = ?',
      i,
      nowISO(),
      id,
      storyId,
    );
  });
}

export function reorderSections(chapterId: string, orderedIds: string[]): void {
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE sections SET order_index = ?, updated_at = ? WHERE id = ? AND chapter_id = ?',
      i,
      nowISO(),
      id,
      chapterId,
    );
  });
}

// ------------------------------------------------------------
// Section
// ------------------------------------------------------------

type NewSection = Omit<Section, EntityFields | 'order_index'> & {
  order_index?: number;
};

export function listSections(chapterId: string): Section[] {
  return allSQL<Section>(
    'SELECT * FROM sections WHERE chapter_id = ? ORDER BY order_index',
    chapterId,
  );
}

export function createSection(data: NewSection & { content?: string }): Section {
  const now = nowISO();
  const idx = autoOrder('sections', 'chapter_id', data.chapter_id, data.order_index);
  const row: Section = {
    id: uuid4(),
    chapter_id: data.chapter_id,
    title: data.title,
    order_index: idx,
    content: data.content,
    created_at: now,
    updated_at: now,
  };
  runSQL(
    'INSERT INTO sections (id, chapter_id, title, order_index, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    row.id,
    row.chapter_id,
    row.title,
    row.order_index,
    row.content || null,
    row.created_at,
    row.updated_at,
  );
  return row;
}

export function updateSection(
  id: string,
  patch: Partial<Pick<Section, 'title' | 'order_index' | 'content'>>,
): Section | undefined {
  const now = nowISO();
  const updates: Record<string, unknown> = { ...patch, updated_at: now };
  doUpdate('sections', id, updates);
  return getSQL<Section>('SELECT * FROM sections WHERE id = ?', id);
}

export function getSectionContent(sectionId: string): string | null {
  const row = getSQL<{ content: string | null }>(
    'SELECT content FROM sections WHERE id = ?',
    sectionId,
  );
  return row ? row.content || null : null;
}

export function setSectionContent(sectionId: string, content: string | null): void {
  const now = nowISO();
  runSQL(
    'UPDATE sections SET content = ?, updated_at = ? WHERE id = ?',
    content,
    now,
    sectionId,
  );
}

export function deleteSection(id: string): void {
  // 先删除该节下的所有内容块
  runSQL('DELETE FROM content_blocks WHERE section_id = ?', id);
  // 再删除节本身
  runSQL('DELETE FROM sections WHERE id = ?', id);
}

// ------------------------------------------------------------
// ContentBlock
// ------------------------------------------------------------

export function listBlocks(sectionId: string): AnyContentBlock[] {
  return allSQL<AnyContentBlock & { payload: string }>(
    'SELECT * FROM content_blocks WHERE section_id = ? ORDER BY order_index',
    sectionId,
  ).map((row) => decodeBlock(row));
}

function decodeBlock(row: AnyContentBlock & { payload: string }): AnyContentBlock {
  const parsed = JSON.parse(row.payload as string);
  return {
    id: row.id,
    section_id: row.section_id,
    type: row.type,
    order_index: row.order_index,
    created_at: row.created_at,
    updated_at: row.updated_at,
    payload: parsed,
  } as AnyContentBlock;
}

export function createTextBlock(
  sectionId: string,
  payload: TextBlockPayload,
  orderIndex?: number,
): AnyContentBlock {
  return insertBlock('text', sectionId, payload, orderIndex);
}

export function createImageBlock(
  sectionId: string,
  payload: ImageBlockPayload,
  orderIndex?: number,
): AnyContentBlock {
  return insertBlock('image', sectionId, payload, orderIndex);
}

export function createDiceBlock(
  sectionId: string,
  payload: DiceBlockPayload | DiceBlockPayloadV2,
  orderIndex?: number,
): AnyContentBlock {
  return insertBlock('dice', sectionId, payload, orderIndex);
}

function insertBlock(
  type: 'text' | 'image' | 'dice',
  sectionId: string,
  payload: unknown,
  orderIndex?: number,
): AnyContentBlock {
  const now = nowISO();
  const idx = autoOrder('content_blocks', 'section_id', sectionId, orderIndex);
  const id = uuid4();
  const payloadStr = stringifyJSON(payload);
  runSQL(
    'INSERT INTO content_blocks (id, section_id, type, order_index, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    sectionId,
    type,
    idx,
    payloadStr,
    now,
    now,
  );
  return {
    id,
    section_id: sectionId,
    type,
    order_index: idx,
    created_at: now,
    updated_at: now,
    payload: payload as TextBlockPayload,
  } as AnyContentBlock;
}

export function updateBlockPayload(
  id: string,
  payload: unknown,
): AnyContentBlock | undefined {
  runSQL(
    'UPDATE content_blocks SET payload = ?, updated_at = ? WHERE id = ?',
    stringifyJSON(payload),
    nowISO(),
    id,
  );
  const raw = getSQL<{
    id: string;
    section_id: string;
    type: string;
    order_index: number;
    created_at: string;
    updated_at: string;
    payload: string;
  }>('SELECT * FROM content_blocks WHERE id = ?', id);
  if (!raw) return undefined;
  return decodeBlock(raw as AnyContentBlock & { payload: string });
}

export function reorderBlocks(sectionId: string, orderedIds: string[]): void {
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE content_blocks SET order_index = ?, updated_at = ? WHERE id = ? AND section_id = ?',
      i,
      nowISO(),
      id,
      sectionId,
    );
  });
}

export function deleteBlock(id: string): void {
  runSQL('DELETE FROM content_blocks WHERE id = ?', id);
}

// ------------------------------------------------------------
// 聚合查询：一次取出一个故事的全部内容（给导出器用）
// ------------------------------------------------------------

export function getStoryWithAll(storyId: string): StoryWithAll | undefined {
  const story = getStory(storyId);
  if (!story) return undefined;
  const worldSettings = listWorldSettings(storyId);
  const characters = listCharacters(storyId);
  const outlines = listOutlines(storyId);
  const volumes = listVolumes(storyId);
  const chapters = listChapters(storyId).map((c) => ({
    ...c,
    sections: listSections(c.id).map((sec) => ({
      ...sec,
      blocks: listBlocks(sec.id),
    })),
  }));
  return {
    ...story,
    world_settings: worldSettings,
    characters,
    outlines,
    volumes,
    chapters,
  };
}

// 让 EntityFields 在编译期被使用，避免未使用类型警告
export type _EntityKeys = EntityFields;
