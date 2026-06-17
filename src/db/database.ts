// ============================================================
// 安科作者助手 - 数据库 CRUD 封装
//
// 优先通过 window.dbAPI 与 Electron 主进程的 JSON 文件数据库通信，
// 否则自动降级为内存实现，方便在 web 预览中调试。
//
// 所有 JSON 字段（content_blocks.payload、characters.attributes）
// 在读写时自动进行 JSON.parse/JSON.stringify。
// ============================================================

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

// 实体自动字段：创建对象时不需要调用方提供
type EntityFields = keyof Entity; // 'id' | 'created_at' | 'updated_at'

// ------------------------------------------------------------
// 内存实现（无 window.dbAPI 时的降级）
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
    character_relations: {},
  };
  memoryInitialized = true;
}

// ------------------------------------------------------------
// 工具
// ------------------------------------------------------------

export function initDatabase(): void {
  // 内存模式下初始化（无预置模板 seed）
  if (!window.dbAPI) {
    initMemory();
  }
  // 如果有 window.dbAPI，主进程会自行处理数据库初始化
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
  return memoryRun(sql, args);
}

function getSQL<T>(sql: string, ...args: unknown[]): T | undefined {
  return memoryGet<T>(sql, args);
}

function allSQL<T>(sql: string, ...args: unknown[]): T[] {
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

export async function listStories(): Promise<Story[]> {
  if (window.dbAPI) {
    return window.dbAPI.listStories();
  }
  return Promise.resolve(allSQL<any>('SELECT * FROM stories ORDER BY updated_at DESC').map(rowToStory));
}

export async function getStory(id: string): Promise<Story | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.getStory(id);
  }
  const r = getSQL<any>('SELECT * FROM stories WHERE id = ?', id);
  return Promise.resolve(r ? rowToStory(r) : undefined);
}

export async function createStory(data: { title: string; description?: string; category?: string }): Promise<Story> {
  if (window.dbAPI) {
    return window.dbAPI.createStory(data);
  }
  const now = nowISO();
  const stories = allSQL<any>('SELECT * FROM stories');
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
  return Promise.resolve(story);
}

type StoryPatch = Partial<{
  title: string;
  description: string;
  category: string;
  order_index: number;
  is_starred: boolean;
  is_pinned: boolean;
}>;

export async function updateStory(id: string, patch: StoryPatch): Promise<Story | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateStory(id, patch as Record<string, unknown>);
  }
  const dbPatch: Record<string, any> = { ...patch };
  if (patch.is_starred !== undefined) dbPatch.is_starred = patch.is_starred ? 1 : 0;
  if (patch.is_pinned !== undefined) dbPatch.is_pinned = patch.is_pinned ? 1 : 0;
  doUpdate('stories', id, dbPatch);
  return Promise.resolve(getStoryInMem(id));
}

export async function deleteStory(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteStory(id);
    return;
  }
  runSQL('DELETE FROM stories WHERE id = ?', id);
  return Promise.resolve();
}

// —— 回收站：软删除/恢复/永久删除 ——

export async function softDeleteStory(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.softDeleteStory(id);
    return;
  }
  const now = nowISO();
  runSQL('UPDATE stories SET is_deleted = ?, deleted_at = ?, updated_at = ? WHERE id = ?', 1, now, now, id);
  return Promise.resolve();
}

export async function restoreStory(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.restoreStory(id);
    return;
  }
  const now = nowISO();
  runSQL('UPDATE stories SET is_deleted = NULL, deleted_at = NULL, updated_at = ? WHERE id = ?', now, id);
  return Promise.resolve();
}

export async function permanentlyDeleteStory(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.permanentlyDeleteStory(id);
    return;
  }
  runSQL('DELETE FROM stories WHERE id = ?', id);
  // 级联：删除关联数据
  runSQL('DELETE FROM world_settings WHERE story_id = ?', id);
  runSQL('DELETE FROM characters WHERE story_id = ?', id);
  runSQL('DELETE FROM character_relations WHERE story_id = ?', id);
  runSQL('DELETE FROM outlines WHERE story_id = ?', id);
  const chapters = allSQL<any>('SELECT id FROM chapters WHERE story_id = ?', id);
  for (const ch of chapters) {
    runSQL('DELETE FROM sections WHERE chapter_id = ?', ch.id);
  }
  runSQL('DELETE FROM chapters WHERE story_id = ?', id);
  runSQL('DELETE FROM volumes WHERE story_id = ?', id);
  return Promise.resolve();
}

export async function listTrashedStories(): Promise<Story[]> {
  if (window.dbAPI) {
    return window.dbAPI.listTrashedStories();
  }
  return Promise.resolve(
    allSQL<any>('SELECT * FROM stories WHERE is_deleted = 1 ORDER BY deleted_at DESC').map(rowToStory),
  );
}

export async function cleanupOldTrashed(days: number): Promise<number> {
  if (window.dbAPI) {
    return window.dbAPI.cleanupOldTrashed(days);
  }
  const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const old = allSQL<any>('SELECT id FROM stories WHERE is_deleted = 1 AND deleted_at < ?', threshold);
  for (const r of old) {
    runSQL('DELETE FROM stories WHERE id = ?', r.id);
  }
  return Promise.resolve(old.length);
}

// 内存模式下的 getStory 辅助（避免循环引用）
function getStoryInMem(id: string): Story | undefined {
  const r = getSQL<any>('SELECT * FROM stories WHERE id = ?', id);
  return r ? rowToStory(r) : undefined;
}

// ------------------------------------------------------------
// WorldSetting
// ------------------------------------------------------------

type NewWorldSetting = Omit<WorldSetting, EntityFields | 'order_index'> & {
  order_index?: number;
};

export async function listWorldSettings(storyId: string): Promise<WorldSetting[]> {
  if (window.dbAPI) {
    return window.dbAPI.listWorldSettings(storyId);
  }
  return Promise.resolve(
    allSQL<WorldSetting>(
      'SELECT * FROM world_settings WHERE story_id = ? ORDER BY order_index',
      storyId,
    ),
  );
}

export async function createWorldSetting(data: NewWorldSetting): Promise<WorldSetting> {
  if (window.dbAPI) {
    return window.dbAPI.createWorldSetting(data as Record<string, unknown>);
  }
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
  return Promise.resolve(row);
}

export async function updateWorldSetting(
  id: string,
  patch: Partial<Pick<WorldSetting, 'title' | 'content' | 'order_index'>>,
): Promise<WorldSetting | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateWorldSetting(id, patch as Record<string, unknown>);
  }
  doUpdate('world_settings', id, patch);
  return Promise.resolve(getSQL<WorldSetting>('SELECT * FROM world_settings WHERE id = ?', id));
}

export async function deleteWorldSetting(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteWorldSetting(id);
    return;
  }
  runSQL('DELETE FROM world_settings WHERE id = ?', id);
  return Promise.resolve();
}

/** 重新排序某作品下的所有世界观（按 orderedIds 顺序写入 order_index） */
export async function reorderWorldSettings(storyId: string, orderedIds: string[]): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.reorderWorldSettings(storyId, orderedIds);
    return;
  }
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE world_settings SET order_index = ?, updated_at = ? WHERE id = ? AND story_id = ?',
      i,
      nowISO(),
      id,
      storyId,
    );
  });
  return Promise.resolve();
}

// ------------------------------------------------------------
// Character
// ------------------------------------------------------------

type NewCharacter = Omit<Character, EntityFields | 'order_index'> & {
  order_index?: number;
};

export async function listCharacters(storyId: string): Promise<Character[]> {
  if (window.dbAPI) {
    return window.dbAPI.listCharacters(storyId);
  }
  const rows = allSQL<Character>(
    'SELECT * FROM characters WHERE story_id = ? ORDER BY order_index',
    storyId,
  );
  if (rows.length === 0) return Promise.resolve([]);
  const variantsByCharId = listAllVariantsGroupedByCharacterIdMem(
    rows.map((r) => r.id),
  );
  return Promise.resolve(
    rows.map((c) => ({
      ...c,
      attributes: parseJSON<Record<string, string | number>>(c.attributes),
      variants: variantsByCharId[c.id] ?? [],
    })),
  );
}

export async function createCharacter(data: NewCharacter): Promise<Character> {
  if (window.dbAPI) {
    return window.dbAPI.createCharacter(data as Record<string, unknown>);
  }
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
  return Promise.resolve({ ...row, variants: [] });
}

export async function updateCharacter(
  id: string,
  patch: Partial<
    Pick<Character, 'name' | 'avatar' | 'personality' | 'attributes' | 'notes' | 'order_index'>
  >,
): Promise<Character | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateCharacter(id, patch as Record<string, unknown>);
  }
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
  const row = getSQL<Character & { attributes_json?: string }>(
    'SELECT * FROM characters WHERE id = ?',
    id,
  );
  if (!row) return Promise.resolve(undefined);
  return Promise.resolve({
    ...row,
    attributes: parseJSON<Record<string, string | number>>(row.attributes),
  } as Character);
}

export async function deleteCharacter(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteCharacter(id);
    return;
  }
  runSQL('DELETE FROM characters WHERE id = ?', id);
  return Promise.resolve();
}

/** 重新排序某作品下的所有人物 */
export async function reorderCharacters(storyId: string, orderedIds: string[]): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.reorderCharacters(storyId, orderedIds);
    return;
  }
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE characters SET order_index = ?, updated_at = ? WHERE id = ? AND story_id = ?',
      i,
      nowISO(),
      id,
      storyId,
    );
  });
  return Promise.resolve();
}

// ------------------------------------------------------------
// CharacterVariant
// ------------------------------------------------------------

type NewCharacterVariant = Omit<CharacterVariant, EntityFields | 'order_index'> & {
  order_index?: number;
};

export async function listCharacterVariants(characterId: string): Promise<CharacterVariant[]> {
  if (window.dbAPI) {
    return window.dbAPI.listCharacterVariants(characterId);
  }
  return Promise.resolve(
    allSQL<CharacterVariant>(
      'SELECT * FROM character_variants WHERE character_id = ? ORDER BY order_index',
      characterId,
    ),
  );
}

function listAllVariantsGroupedByCharacterIdMem(
  characterIds: string[],
): Record<string, CharacterVariant[]> {
  if (characterIds.length === 0) return {};
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

export async function createCharacterVariant(data: NewCharacterVariant): Promise<CharacterVariant> {
  if (window.dbAPI) {
    return window.dbAPI.createCharacterVariant(data as Record<string, unknown>);
  }
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
  return Promise.resolve(row);
}

export async function createCharacterVariantsBatch(
  characterId: string,
  items: { name?: string; url: string }[],
): Promise<CharacterVariant[]> {
  if (window.dbAPI) {
    return window.dbAPI.createCharacterVariantsBatch(characterId, items);
  }
  const now = nowISO();
  const existing = allSQL<CharacterVariant>(
    'SELECT * FROM character_variants WHERE character_id = ? ORDER BY order_index',
    characterId,
  );
  let order = existing.length;
  const created: CharacterVariant[] = [];
  for (const it of items) {
    const row: CharacterVariant = {
      id: uuid4(),
      character_id: characterId,
      name: (it.name || '差分').trim(),
      url: it.url || '',
      order_index: order++,
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
    created.push(row);
  }
  return Promise.resolve(created);
}

export async function updateCharacterVariant(
  id: string,
  patch: Partial<Pick<CharacterVariant, 'name' | 'url' | 'order_index'>>,
): Promise<CharacterVariant | undefined> {
  if (window.dbAPI) {
    // IPC 层返回 boolean，无法直接获取更新后的数据，使用内存实现
    await window.dbAPI.updateCharacterVariant(id, patch as Record<string, unknown>);
  }
  // 始终使用内存表查询结果（IPC 路径下也同步更新内存表以保证一致性）
  doUpdate('character_variants', id, patch);
  return Promise.resolve(getSQL<CharacterVariant>('SELECT * FROM character_variants WHERE id = ?', id));
}

export async function deleteCharacterVariant(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteCharacterVariant(id);
    return;
  }
  runSQL('DELETE FROM character_variants WHERE id = ?', id);
  return Promise.resolve();
}

export async function reorderCharacterVariants(
  characterId: string,
  orderedIds: string[],
): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.reorderCharacterVariants(characterId, orderedIds);
    return;
  }
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE character_variants SET order_index = ?, updated_at = ? WHERE id = ? AND character_id = ?',
      i,
      nowISO(),
      id,
      characterId,
    );
  });
  return Promise.resolve();
}

// ------------------------------------------------------------
// WorldSettingTemplate (世界观设定模板，独立表，不含 story_id)
// ------------------------------------------------------------

type NewWorldSettingTemplate = Omit<WorldSettingTemplate, EntityFields | 'order_index'> & {
  order_index?: number;
};

export async function listWorldSettingTemplates(): Promise<WorldSettingTemplate[]> {
  if (window.dbAPI) {
    return window.dbAPI.listWorldSettingTemplates();
  }
  return Promise.resolve(
    allSQL<WorldSettingTemplate>(
      'SELECT * FROM world_setting_templates ORDER BY order_index, updated_at DESC',
    ).map((t) => ({ ...t })),
  );
}

export async function createWorldSettingTemplate(
  data: NewWorldSettingTemplate,
): Promise<WorldSettingTemplate> {
  if (window.dbAPI) {
    return window.dbAPI.createWorldSettingTemplate(data as Record<string, unknown>);
  }
  const now = nowISO();
  const existing = allSQL<{ id: string }>('SELECT id FROM world_setting_templates');
  const order = existing.length;
  const row: WorldSettingTemplate = {
    id: uuid4(),
    title: data.title,
    content: data.content || '',
    order_index: order,
    created_at: now,
    updated_at: now,
  };
  runSQL(
    'INSERT INTO world_setting_templates (id, title, content, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    row.id,
    row.title,
    row.content,
    row.order_index,
    row.created_at,
    row.updated_at,
  );
  return Promise.resolve(row);
}

export async function updateWorldSettingTemplate(
  id: string,
  patch: Partial<Pick<WorldSettingTemplate, 'title' | 'content' | 'order_index'>>,
): Promise<WorldSettingTemplate | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateWorldSettingTemplate(id, patch as Record<string, unknown>);
  }
  doUpdate('world_setting_templates', id, patch);
  return Promise.resolve(
    getSQL<WorldSettingTemplate>('SELECT * FROM world_setting_templates WHERE id = ?', id),
  );
}

export async function deleteWorldSettingTemplate(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteWorldSettingTemplate(id);
    return;
  }
  runSQL('DELETE FROM world_setting_templates WHERE id = ?', id);
  return Promise.resolve();
}

/** 重新排序所有世界观模板 */
export async function reorderWorldSettingTemplates(orderedIds: string[]): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.reorderWorldSettingTemplates(orderedIds);
    return;
  }
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE world_setting_templates SET order_index = ? WHERE id = ?',
      i,
      id,
    );
  });
  return Promise.resolve();
}

// ------------------------------------------------------------
// CharacterTemplate (人物模板，独立表，不含 story_id / order_index / variants)
// ------------------------------------------------------------

type NewCharacterTemplate = Omit<CharacterTemplate, EntityFields | 'order_index'> & {
  order_index?: number;
};

export async function listCharacterTemplates(): Promise<CharacterTemplate[]> {
  if (window.dbAPI) {
    return window.dbAPI.listCharacterTemplates();
  }
  return Promise.resolve(
    allSQL<CharacterTemplate>(
      'SELECT * FROM character_templates ORDER BY order_index, updated_at DESC',
    ).map((c) => ({
      ...c,
      order_index: c.order_index ?? 0,
      attributes: parseJSON<Record<string, string | number>>(c.attributes),
      variants: parseJSON<CharacterVariant[]>(c.variants),
    })),
  );
}

export async function createCharacterTemplate(
  data: NewCharacterTemplate,
): Promise<CharacterTemplate> {
  if (window.dbAPI) {
    return window.dbAPI.createCharacterTemplate(data as Record<string, unknown>);
  }
  const now = nowISO();
  const existing = allSQL<{ id: string }>('SELECT id FROM character_templates');
  const order = existing.length;
  const row: CharacterTemplate = {
    id: uuid4(),
    name: data.name,
    avatar: data.avatar || '',
    personality: data.personality || '',
    attributes: data.attributes,
    notes: data.notes || '',
    variants: data.variants,
    order_index: order,
    created_at: now,
    updated_at: now,
  };
  runSQL(
    'INSERT INTO character_templates (id, name, avatar, personality, attributes, notes, variants, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    row.id,
    row.name,
    row.avatar,
    row.personality,
    stringifyJSON(row.attributes || null),
    row.notes,
    stringifyJSON(row.variants || null),
    row.order_index,
    row.created_at,
    row.updated_at,
  );
  return Promise.resolve({ ...row });
}

export async function updateCharacterTemplate(
  id: string,
  patch: Partial<
    Pick<
      CharacterTemplate,
      'name' | 'avatar' | 'personality' | 'attributes' | 'notes' | 'variants' | 'order_index'
    >
  >,
): Promise<CharacterTemplate | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateCharacterTemplate(id, patch as Record<string, unknown>);
  }
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
  return Promise.resolve(getCharacterTemplateInMem(id));
}

/** 重新排序所有人物模板 */
export async function reorderCharacterTemplates(orderedIds: string[]): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.reorderCharacterTemplates(orderedIds);
    return;
  }
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE character_templates SET order_index = ? WHERE id = ?',
      i,
      id,
    );
  });
  return Promise.resolve();
}

function getCharacterTemplateInMem(id: string): CharacterTemplate | undefined {
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

export async function deleteCharacterTemplate(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteCharacterTemplate(id);
    return;
  }
  runSQL('DELETE FROM character_templates WHERE id = ?', id);
  return Promise.resolve();
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

export async function listCharacterRelations(storyId: string): Promise<CharacterRelationRow[]> {
  if (window.dbAPI) {
    return window.dbAPI.listCharacterRelations(storyId);
  }
  return Promise.resolve(
    allSQL<CharacterRelationRow>(
      'SELECT * FROM character_relations WHERE story_id = ? ORDER BY order_index, created_at',
      storyId,
    ),
  );
}

export async function createCharacterRelation(data: NewCharacterRelation): Promise<CharacterRelationRow> {
  if (window.dbAPI) {
    return window.dbAPI.createCharacterRelation(data as Record<string, unknown>);
  }
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
  return Promise.resolve(row);
}

export async function updateCharacterRelation(
  id: string,
  patch: Partial<Pick<CharacterRelationRow, 'source_id' | 'target_id' | 'relation' | 'note' | 'order_index'>>,
): Promise<CharacterRelationRow | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateCharacterRelation(id, patch as Record<string, unknown>);
  }
  const now = nowISO();
  const fields: string[] = [];
  const values: unknown[] = [];
  (['source_id', 'target_id', 'relation', 'note', 'order_index'] as const).forEach((k) => {
    if ((patch as Record<string, unknown>)[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push((patch as Record<string, unknown>)[k]);
    }
  });
  if (fields.length === 0)
    return Promise.resolve(
      getSQL<CharacterRelationRow>('SELECT * FROM character_relations WHERE id = ?', id),
    );
  fields.push('updated_at = ?');
  values.push(now);
  values.push(id);
  runSQL(`UPDATE character_relations SET ${fields.join(', ')} WHERE id = ?`, ...values);
  return Promise.resolve(
    getSQL<CharacterRelationRow>('SELECT * FROM character_relations WHERE id = ?', id),
  );
}

export async function deleteCharacterRelation(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteCharacterRelation(id);
    return;
  }
  runSQL('DELETE FROM character_relations WHERE id = ?', id);
  return Promise.resolve();
}

// ------------------------------------------------------------
// Outline
// ------------------------------------------------------------

type NewOutline = Omit<Outline, EntityFields | 'order_index'> & {
  order_index?: number;
};

export async function listOutlines(storyId: string): Promise<Outline[]> {
  if (window.dbAPI) {
    return window.dbAPI.listOutlines(storyId);
  }
  return Promise.resolve(
    allSQL<Outline>('SELECT * FROM outlines WHERE story_id = ? ORDER BY order_index', storyId),
  );
}

export async function createOutline(data: NewOutline): Promise<Outline> {
  if (window.dbAPI) {
    return window.dbAPI.createOutline(data as Record<string, unknown>);
  }
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
  return Promise.resolve(row);
}

export async function updateOutline(
  id: string,
  patch: Partial<Pick<Outline, 'content' | 'order_index'>>,
): Promise<Outline | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateOutline(id, patch as Record<string, unknown>);
  }
  doUpdate('outlines', id, patch);
  return Promise.resolve(getSQL<Outline>('SELECT * FROM outlines WHERE id = ?', id));
}

export async function deleteOutline(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteOutline(id);
    return;
  }
  runSQL('DELETE FROM outlines WHERE id = ?', id);
  return Promise.resolve();
}

// ------------------------------------------------------------
// Chapter
// ------------------------------------------------------------

type NewChapter = Omit<Chapter, EntityFields | 'order_index'> & {
  order_index?: number;
};

export async function listChapters(storyId: string): Promise<Chapter[]> {
  if (window.dbAPI) {
    return window.dbAPI.listChapters(storyId);
  }
  return Promise.resolve(
    allSQL<Chapter>('SELECT * FROM chapters WHERE story_id = ? ORDER BY order_index', storyId),
  );
}

export async function listChaptersByVolume(volumeId: string): Promise<Chapter[]> {
  if (window.dbAPI) {
    return window.dbAPI.listChaptersByVolume(volumeId);
  }
  return Promise.resolve(
    allSQL<Chapter>('SELECT * FROM chapters WHERE volume_id = ? ORDER BY order_index', volumeId),
  );
}

export async function createChapter(data: NewChapter): Promise<Chapter> {
  if (window.dbAPI) {
    return window.dbAPI.createChapter(data as Record<string, unknown>);
  }
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
  return Promise.resolve(row);
}

export async function updateChapter(
  id: string,
  patch: Partial<Pick<Chapter, 'title' | 'order_index' | 'volume_id'>>,
): Promise<Chapter | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateChapter(id, patch as Record<string, unknown>);
  }
  doUpdate('chapters', id, patch);
  return Promise.resolve(getSQL<Chapter>('SELECT * FROM chapters WHERE id = ?', id));
}

export async function deleteChapter(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteChapter(id);
    return;
  }
  const sectionsToDelete = allSQL<{ id: string }>(
    'SELECT id FROM sections WHERE chapter_id = ?',
    id,
  );
  sectionsToDelete.forEach((sec) => deleteSectionMem(sec.id));
  runSQL('DELETE FROM chapters WHERE id = ?', id);
  return Promise.resolve();
}

function deleteSectionMem(id: string): void {
  runSQL('DELETE FROM content_blocks WHERE section_id = ?', id);
  runSQL('DELETE FROM sections WHERE id = ?', id);
}

export async function reorderChapters(storyId: string, orderedIds: string[]): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.reorderChapters(storyId, orderedIds);
    return;
  }
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE chapters SET order_index = ?, updated_at = ? WHERE id = ? AND story_id = ?',
      i,
      nowISO(),
      id,
      storyId,
    );
  });
  return Promise.resolve();
}

// ------------------------------------------------------------
// Volume
// ------------------------------------------------------------

type NewVolume = Omit<Volume, EntityFields | 'order_index'> & {
  order_index?: number;
};

export async function listVolumes(storyId: string): Promise<Volume[]> {
  if (window.dbAPI) {
    return window.dbAPI.listVolumes(storyId);
  }
  return Promise.resolve(
    allSQL<Volume>('SELECT * FROM volumes WHERE story_id = ? ORDER BY order_index', storyId),
  );
}

export async function createVolume(data: NewVolume): Promise<Volume> {
  if (window.dbAPI) {
    return window.dbAPI.createVolume(data as Record<string, unknown>);
  }
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
  return Promise.resolve(row);
}

export async function updateVolume(
  id: string,
  patch: Partial<Pick<Volume, 'title' | 'order_index'>>,
): Promise<Volume | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateVolume(id, patch as Record<string, unknown>);
  }
  doUpdate('volumes', id, patch);
  return Promise.resolve(getSQL<Volume>('SELECT * FROM volumes WHERE id = ?', id));
}

export async function deleteVolume(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteVolume(id);
    return;
  }
  const chaptersToDelete = allSQL<{ id: string }>(
    'SELECT id FROM chapters WHERE volume_id = ?',
    id,
  );
  chaptersToDelete.forEach((ch) => deleteChapterMem(ch.id));
  runSQL('DELETE FROM volumes WHERE id = ?', id);
  return Promise.resolve();
}

function deleteChapterMem(id: string): void {
  const sectionsToDelete = allSQL<{ id: string }>(
    'SELECT id FROM sections WHERE chapter_id = ?',
    id,
  );
  sectionsToDelete.forEach((sec) => deleteSectionMem(sec.id));
  runSQL('DELETE FROM chapters WHERE id = ?', id);
}

export async function reorderVolumes(storyId: string, orderedIds: string[]): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.reorderVolumes(storyId, orderedIds);
    return;
  }
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE volumes SET order_index = ?, updated_at = ? WHERE id = ? AND story_id = ?',
      i,
      nowISO(),
      id,
      storyId,
    );
  });
  return Promise.resolve();
}

// ------------------------------------------------------------
// Section
// ------------------------------------------------------------

type NewSection = Omit<Section, EntityFields | 'order_index'> & {
  order_index?: number;
};

export async function listSections(chapterId: string): Promise<Section[]> {
  if (window.dbAPI) {
    return window.dbAPI.listSections(chapterId);
  }
  return Promise.resolve(
    allSQL<Section>('SELECT * FROM sections WHERE chapter_id = ? ORDER BY order_index', chapterId),
  );
}

export async function createSection(data: NewSection & { content?: string }): Promise<Section> {
  if (window.dbAPI) {
    return window.dbAPI.createSection(data as Record<string, unknown>);
  }
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
  return Promise.resolve(row);
}

export async function updateSection(
  id: string,
  patch: Partial<Pick<Section, 'title' | 'order_index' | 'content'>>,
): Promise<Section | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateSection(id, patch as Record<string, unknown>);
  }
  const now = nowISO();
  const updates: Record<string, unknown> = { ...patch, updated_at: now };
  doUpdate('sections', id, updates);
  return Promise.resolve(getSQL<Section>('SELECT * FROM sections WHERE id = ?', id));
}

export async function getSectionContent(sectionId: string): Promise<string | null> {
  if (window.dbAPI) {
    return window.dbAPI.getSectionContent(sectionId);
  }
  const row = getSQL<{ content: string | null }>(
    'SELECT content FROM sections WHERE id = ?',
    sectionId,
  );
  return Promise.resolve(row ? row.content || null : null);
}

export async function setSectionContent(sectionId: string, content: string | null): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.setSectionContent(sectionId, content);
    return;
  }
  const now = nowISO();
  runSQL('UPDATE sections SET content = ?, updated_at = ? WHERE id = ?', content, now, sectionId);
  return Promise.resolve();
}

export async function deleteSection(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteSection(id);
    return;
  }
  deleteSectionMem(id);
  return Promise.resolve();
}

export async function reorderSections(chapterId: string, orderedIds: string[]): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.reorderSections(chapterId, orderedIds);
    return;
  }
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE sections SET order_index = ?, updated_at = ? WHERE id = ? AND chapter_id = ?',
      i,
      nowISO(),
      id,
      chapterId,
    );
  });
  return Promise.resolve();
}

// ------------------------------------------------------------
// ContentBlock
// ------------------------------------------------------------

export async function listBlocks(sectionId: string): Promise<AnyContentBlock[]> {
  if (window.dbAPI) {
    return window.dbAPI.listBlocks(sectionId);
  }
  return Promise.resolve(
    allSQL<AnyContentBlock & { payload: string }>(
      'SELECT * FROM content_blocks WHERE section_id = ? ORDER BY order_index',
      sectionId,
    ).map((row) => decodeBlock(row)),
  );
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

export async function createTextBlock(
  sectionId: string,
  payload: TextBlockPayload,
  orderIndex?: number,
): Promise<AnyContentBlock> {
  if (window.dbAPI) {
    return window.dbAPI.createTextBlock(sectionId, payload, orderIndex);
  }
  return Promise.resolve(insertBlock('text', sectionId, payload, orderIndex));
}

export async function createImageBlock(
  sectionId: string,
  payload: ImageBlockPayload,
  orderIndex?: number,
): Promise<AnyContentBlock> {
  if (window.dbAPI) {
    return window.dbAPI.createImageBlock(sectionId, payload, orderIndex);
  }
  return Promise.resolve(insertBlock('image', sectionId, payload, orderIndex));
}

export async function createDiceBlock(
  sectionId: string,
  payload: DiceBlockPayload | DiceBlockPayloadV2,
  orderIndex?: number,
): Promise<AnyContentBlock> {
  if (window.dbAPI) {
    return window.dbAPI.createDiceBlock(sectionId, payload, orderIndex);
  }
  return Promise.resolve(insertBlock('dice', sectionId, payload, orderIndex));
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

export async function updateBlockPayload(
  id: string,
  payload: unknown,
): Promise<AnyContentBlock | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateBlockPayload(id, payload);
  }
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
  if (!raw) return Promise.resolve(undefined);
  return Promise.resolve(decodeBlock(raw as AnyContentBlock & { payload: string }));
}

export async function reorderBlocks(sectionId: string, orderedIds: string[]): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.reorderBlocks(sectionId, orderedIds);
    return;
  }
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE content_blocks SET order_index = ?, updated_at = ? WHERE id = ? AND section_id = ?',
      i,
      nowISO(),
      id,
      sectionId,
    );
  });
  return Promise.resolve();
}

export async function deleteBlock(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteBlock(id);
    return;
  }
  runSQL('DELETE FROM content_blocks WHERE id = ?', id);
  return Promise.resolve();
}

// ------------------------------------------------------------
// 聚合查询：一次取出一个故事的全部内容（给导出器用）
// ------------------------------------------------------------

export async function getStoryWithAll(storyId: string): Promise<StoryWithAll | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.getStoryWithAll(storyId);
  }
  const story = getStoryInMem(storyId);
  if (!story) return Promise.resolve(undefined);
  const worldSettings = allSQL<WorldSetting>(
    'SELECT * FROM world_settings WHERE story_id = ? ORDER BY order_index',
    storyId,
  );
  const characters = await listCharacters(storyId);
  const outlines = allSQL<Outline>(
    'SELECT * FROM outlines WHERE story_id = ? ORDER BY order_index',
    storyId,
  );
  const volumes = allSQL<Volume>(
    'SELECT * FROM volumes WHERE story_id = ? ORDER BY order_index',
    storyId,
  );
  const chapters = allSQL<Chapter>(
    'SELECT * FROM chapters WHERE story_id = ? ORDER BY order_index',
    storyId,
  ).map((c) => ({
    ...c,
    sections: allSQL<Section>(
      'SELECT * FROM sections WHERE chapter_id = ? ORDER BY order_index',
      c.id,
    ).map((sec) => ({
      ...sec,
      blocks: allSQL<AnyContentBlock & { payload: string }>(
        'SELECT * FROM content_blocks WHERE section_id = ? ORDER BY order_index',
        sec.id,
      ).map((row) => decodeBlock(row)),
    })),
  }));
  return Promise.resolve({
    ...story,
    world_settings: worldSettings,
    characters,
    outlines,
    volumes,
    chapters,
  });
}

// 让 EntityFields 在编译期被使用，避免未使用类型警告
export type _EntityKeys = EntityFields;