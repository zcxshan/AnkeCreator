// ============================================================
// 安科作者助手 - 浏览器端 IndexedDB 实现
//
// 作用：在没有 Electron 主进程（window.dbAPI 不存在）时，提供与 Electron
//       db-main.ts 相同语义的 Promise 数据访问 API。供 Capacitor（Android / iOS）
//       和纯 Web 环境使用。
//
// 数据模型：每个表对应一个 IndexedDB object store，主键为 id。
// 索引：常用查询字段建立索引（updated_at、is_deleted、story_id 等）。
// JSON 字段：attributes / payload 等在读写时自动 JSON.parse / stringify，
//            与现有 memory 实现保持一致。
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
  SectionMeta,
  StoryWithAll,
  Entity,
} from '../types';

const DB_NAME = 'anke-creator';
// v2: 删除旧版 content_blocks store（已切换到新版富文本，不再使用）
const DB_VERSION = 2;

type StoreName =
  | 'stories'
  | 'world_settings'
  | 'characters'
  | 'outlines'
  | 'volumes'
  | 'chapters'
  | 'sections'
  | 'character_variants'
  | 'world_setting_templates'
  | 'character_templates'
  | 'character_relations';

const STORES: StoreName[] = [
  'stories',
  'world_settings',
  'characters',
  'outlines',
  'volumes',
  'chapters',
  'sections',
  'character_variants',
  'world_setting_templates',
  'character_templates',
  'character_relations',
];

// 每个 store 的索引定义：keyPath 必须是 store 内已有的字段
const INDEX_DEFS: Record<StoreName, { name: string; keyPath: string; unique?: boolean }[]> = {
  stories: [
    { name: 'updated_at', keyPath: 'updated_at' },
    { name: 'is_deleted', keyPath: 'is_deleted' },
    { name: 'order_index', keyPath: 'order_index' },
  ],
  world_settings: [
    { name: 'story_id', keyPath: 'story_id' },
    { name: 'order_index', keyPath: 'order_index' },
  ],
  characters: [
    { name: 'story_id', keyPath: 'story_id' },
    { name: 'order_index', keyPath: 'order_index' },
  ],
  outlines: [
    { name: 'story_id', keyPath: 'story_id' },
    { name: 'order_index', keyPath: 'order_index' },
  ],
  volumes: [
    { name: 'story_id', keyPath: 'story_id' },
    { name: 'order_index', keyPath: 'order_index' },
  ],
  chapters: [
    { name: 'story_id', keyPath: 'story_id' },
    { name: 'volume_id', keyPath: 'volume_id' },
    { name: 'order_index', keyPath: 'order_index' },
  ],
  sections: [
    { name: 'chapter_id', keyPath: 'chapter_id' },
    { name: 'order_index', keyPath: 'order_index' },
  ],
  character_variants: [
    { name: 'character_id', keyPath: 'character_id' },
    { name: 'order_index', keyPath: 'order_index' },
  ],
  world_setting_templates: [{ name: 'order_index', keyPath: 'order_index' }],
  character_templates: [{ name: 'order_index', keyPath: 'order_index' }],
  character_relations: [
    { name: 'story_id', keyPath: 'story_id' },
    { name: 'source_id', keyPath: 'source_id' },
    { name: 'target_id', keyPath: 'target_id' },
    { name: 'order_index', keyPath: 'order_index' },
  ],
};

// JSON 字段：读写时自动 parse/stringify
const JSON_FIELDS: Partial<Record<StoreName, string[]>> = {
  characters: ['attributes'],
  character_templates: ['attributes', 'variants'],
};

let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

export function isBrowserDBAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function initBrowserDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion; // 0 = 全新, 1 = 旧版有 content_blocks

      // v1：创建所有 store（不包含 content_blocks，新装用户也走这条）
      if (oldVersion < 1) {
        for (const storeName of STORES) {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: 'id' });
            for (const idx of INDEX_DEFS[storeName]) {
              store.createIndex(idx.name, idx.keyPath, { unique: !!idx.unique });
            }
          }
        }
      }

      // v2：删除旧版 content_blocks store（已切到新版富文本，不再使用）
      if (oldVersion < 2) {
        if (db.objectStoreNames.contains('content_blocks')) {
          db.deleteObjectStore('content_blocks');
        }
      }
    };
    req.onsuccess = () => {
      dbInstance = req.result;
      resolve(dbInstance);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function nowISO(): string {
  return new Date().toISOString();
}

function uuid4(): string {
  const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return String(c.randomUUID());
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function parseJSON<T>(raw: unknown): T | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }
  return raw as T;
}

function stringifyJSON(obj: unknown): string {
  return JSON.stringify(obj ?? null);
}

function decodeRow<T extends Record<string, unknown>>(store: StoreName, row: T): T {
  const fields = JSON_FIELDS[store];
  if (!fields) return row;
  const out: Record<string, unknown> = { ...row };
  for (const f of fields) {
    if (out[f] != null) {
      out[f] = parseJSON(out[f] as unknown);
    }
  }
  return out as T;
}

function encodeRow<T extends Record<string, unknown>>(store: StoreName, row: T): T {
  const fields = JSON_FIELDS[store];
  if (!fields) return row;
  const out: Record<string, unknown> = { ...row };
  for (const f of fields) {
    if (out[f] !== undefined) {
      out[f] = stringifyJSON(out[f]);
    }
  }
  return out as T;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => Promise<T> | T): Promise<T> {
  return initBrowserDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const objectStore = transaction.objectStore(store);
        let result: T;
        Promise.resolve(fn(objectStore))
          .then((r) => {
            result = r;
          })
          .catch(reject);
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      }),
  );
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAll<T>(store: StoreName, indexName?: string, query?: IDBValidKey | IDBKeyRange): Promise<T[]> {
  return tx<T[]>(store, 'readonly', (s) => {
    const source: IDBObjectStore | IDBIndex = indexName ? s.index(indexName) : s;
    const req = source.getAll(query as IDBValidKey | IDBKeyRange | undefined);
    return reqToPromise(req);
  }).then((rows) => (rows as Record<string, unknown>[]).map((r) => decodeRow(store, r)) as T[]);
}

async function getOne<T>(store: StoreName, id: string): Promise<T | undefined> {
  return tx<T | undefined>(store, 'readonly', (s) => {
    const req = s.get(id);
    return reqToPromise(req);
  }).then((row) => (row ? (decodeRow(store, row as Record<string, unknown>) as T) : undefined));
}

async function putOne<T>(store: StoreName, row: T): Promise<T> {
  const encoded = encodeRow(store, row as Record<string, unknown>) as T;
  await tx<undefined>(store, 'readwrite', (s) => {
    s.put(encoded);
    return undefined;
  });
  return row;
}

async function deleteOne(store: StoreName, id: string): Promise<boolean> {
  return tx<boolean>(store, 'readwrite', (s) => {
    return new Promise<boolean>((resolve, reject) => {
      const req = s.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  });
}

async function deleteWhere(store: StoreName, indexName: string, value: IDBValidKey): Promise<number> {
  return tx<number>(store, 'readwrite', (s) => {
    return new Promise<number>((resolve, reject) => {
      const idx = s.index(indexName);
      const req = idx.openCursor(IDBKeyRange.only(value));
      let count = 0;
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          count++;
          cursor.continue();
        } else {
          resolve(count);
        }
      };
      req.onerror = () => reject(req.error);
    });
  });
}

async function autoOrderIndex(store: StoreName, indexName: string, value: IDBValidKey, explicit?: number): Promise<number> {
  if (typeof explicit === 'number') return explicit;
  const rows = await getAll<Record<string, unknown>>(store, indexName, IDBKeyRange.only(value));
  if (rows.length === 0) return 0;
  return Math.max(...rows.map((r) => Number(r.order_index) || 0)) + 1;
}

// 实体自动字段
type _EntityFields = keyof Entity; // 'id' | 'created_at' | 'updated_at'

// ============================================================
// Story
// ============================================================

function rowToStory(r: Record<string, unknown>): Story {
  return {
    ...(r as unknown as Story),
    is_starred: !!r.is_starred,
    is_pinned: !!r.is_pinned,
  } as Story;
}

async function listStories(): Promise<Story[]> {
  const rows = await getAll<Record<string, unknown>>('stories');
  // 按 updated_at DESC 排序（与原 SQL 行为一致）
  rows.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  return rows.map(rowToStory);
}

async function getStory(id: string): Promise<Story | undefined> {
  const row = await getOne<Record<string, unknown>>('stories', id);
  return row ? rowToStory(row) : undefined;
}

async function createStory(data: { title: string; description?: string; category?: string }): Promise<Story> {
  const now = nowISO();
  const all = await getAll<Record<string, unknown>>('stories');
  const maxIdx = all.reduce((m, s) => Math.max(m, Number(s.order_index) || 0), 0);
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
  await putOne('stories', story as unknown as Record<string, unknown>);
  return story;
}

async function updateStory(id: string, patch: Record<string, unknown>): Promise<Story | undefined> {
  const cur = await getStory(id);
  if (!cur) return undefined;
  const dbPatch: Record<string, unknown> = { ...patch };
  if (patch.is_starred !== undefined) dbPatch.is_starred = patch.is_starred ? 1 : 0;
  if (patch.is_pinned !== undefined) dbPatch.is_pinned = patch.is_pinned ? 1 : 0;
  const next = { ...cur, ...dbPatch, updated_at: nowISO() } as unknown as Record<string, unknown>;
  await putOne('stories', next);
  return getStory(id);
}

async function deleteStory(id: string): Promise<boolean> {
  return deleteOne('stories', id);
}

async function softDeleteStory(id: string): Promise<boolean> {
  const now = nowISO();
  const cur = await getStory(id);
  if (!cur) return false;
  const next = { ...cur, is_deleted: 1, deleted_at: now, updated_at: now } as unknown as Record<string, unknown>;
  await putOne('stories', next);
  return true;
}

async function restoreStory(id: string): Promise<boolean> {
  const now = nowISO();
  const cur = await getStory(id);
  if (!cur) return false;
  const next = { ...cur, is_deleted: null, deleted_at: null, updated_at: now } as unknown as Record<string, unknown>;
  await putOne('stories', next);
  return true;
}

async function permanentlyDeleteStory(id: string): Promise<boolean> {
  // 级联删除
  await deleteWhere('world_settings', 'story_id', id);
  await deleteWhere('characters', 'story_id', id);
  await deleteWhere('character_relations', 'story_id', id);
  await deleteWhere('outlines', 'story_id', id);
  await deleteWhere('volumes', 'story_id', id);

  // chapters -> sections
  const chapters = await getAll<Record<string, unknown>>('chapters', 'story_id', IDBKeyRange.only(id));
  for (const ch of chapters) {
    const sections = await getAll<Record<string, unknown>>('sections', 'chapter_id', IDBKeyRange.only(ch.id as string));
    for (const sec of sections) {
      await deleteOne('sections', sec.id as string);
    }
    await deleteOne('chapters', ch.id as string);
  }
  return deleteOne('stories', id);
}

async function listTrashedStories(): Promise<Story[]> {
  const rows = await getAll<Record<string, unknown>>('stories', 'is_deleted', IDBKeyRange.only(1));
  rows.sort((a, b) => String(b.deleted_at || '').localeCompare(String(a.deleted_at || '')));
  return rows.map(rowToStory);
}

async function cleanupOldTrashed(days: number): Promise<number> {
  const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = await getAll<Record<string, unknown>>('stories', 'is_deleted', IDBKeyRange.only(1));
  let count = 0;
  for (const r of rows) {
    if (r.deleted_at && String(r.deleted_at) < threshold) {
      await permanentlyDeleteStory(r.id as string);
      count++;
    }
  }
  return count;
}

// ============================================================
// WorldSetting
// ============================================================

async function listWorldSettings(storyId: string): Promise<WorldSetting[]> {
  const rows = await getAll<WorldSetting>('world_settings', 'story_id', IDBKeyRange.only(storyId));
  rows.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  return rows;
}

async function createWorldSetting(data: Record<string, unknown>): Promise<WorldSetting> {
  const now = nowISO();
  const idx = await autoOrderIndex('world_settings', 'story_id', data.story_id as string, data.order_index as number | undefined);
  const row: WorldSetting = {
    id: uuid4(),
    story_id: data.story_id as string,
    title: (data.title as string) || '',
    content: (data.content as string) || '',
    order_index: idx,
    created_at: now,
    updated_at: now,
  };
  await putOne('world_settings', row as unknown as Record<string, unknown>);
  return row;
}

async function updateWorldSetting(id: string, patch: Record<string, unknown>): Promise<WorldSetting | undefined> {
  const cur = await getOne<WorldSetting>('world_settings', id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch, updated_at: nowISO() };
  await putOne('world_settings', next as unknown as Record<string, unknown>);
  return getOne<WorldSetting>('world_settings', id);
}

async function deleteWorldSetting(id: string): Promise<boolean> {
  return deleteOne('world_settings', id);
}

async function reorderWorldSettings(storyId: string, orderedIds: string[]): Promise<boolean> {
  const now = nowISO();
  for (let i = 0; i < orderedIds.length; i++) {
    const cur = await getOne<Record<string, unknown>>('world_settings', orderedIds[i]);
    if (cur && cur.story_id === storyId) {
      await putOne('world_settings', { ...cur, order_index: i, updated_at: now } as Record<string, unknown>);
    }
  }
  return true;
}

// ============================================================
// Character
// ============================================================

async function listCharacters(storyId: string): Promise<Character[]> {
  const rows = await getAll<Character>('characters', 'story_id', IDBKeyRange.only(storyId));
  rows.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

  // 关联查询 variants
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids; // IDBKeyRange.only 仅支持单个 key；逐个查
  const variantsByChar: Record<string, CharacterVariant[]> = {};
  for (const cid of placeholders) {
    const vs = await getAll<CharacterVariant>('character_variants', 'character_id', IDBKeyRange.only(cid));
    vs.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    variantsByChar[cid] = vs;
  }

  return rows.map((c) => ({
    ...c,
    variants: variantsByChar[c.id] ?? [],
  }));
}

async function createCharacter(data: Record<string, unknown>): Promise<Character> {
  const now = nowISO();
  const idx = await autoOrderIndex('characters', 'story_id', data.story_id as string, data.order_index as number | undefined);
  const row: Character = {
    id: uuid4(),
    story_id: data.story_id as string,
    name: (data.name as string) || '',
    avatar: (data.avatar as string) || '',
    personality: (data.personality as string) || '',
    attributes: data.attributes as Record<string, string | number> | undefined,
    notes: (data.notes as string) || '',
    order_index: idx,
    created_at: now,
    updated_at: now,
  };
  await putOne('characters', row as unknown as Record<string, unknown>);
  return { ...row, variants: [] };
}

async function updateCharacter(id: string, patch: Record<string, unknown>): Promise<Character | undefined> {
  const cur = await getOne<Character>('characters', id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch, updated_at: nowISO() };
  await putOne('characters', next as unknown as Record<string, unknown>);
  return getOne<Character>('characters', id);
}

async function deleteCharacter(id: string): Promise<boolean> {
  return deleteOne('characters', id);
}

async function reorderCharacters(storyId: string, orderedIds: string[]): Promise<boolean> {
  const now = nowISO();
  for (let i = 0; i < orderedIds.length; i++) {
    const cur = await getOne<Record<string, unknown>>('characters', orderedIds[i]);
    if (cur && cur.story_id === storyId) {
      await putOne('characters', { ...cur, order_index: i, updated_at: now } as Record<string, unknown>);
    }
  }
  return true;
}

// ============================================================
// CharacterVariant
// ============================================================

async function listCharacterVariants(characterId: string): Promise<CharacterVariant[]> {
  const rows = await getAll<CharacterVariant>('character_variants', 'character_id', IDBKeyRange.only(characterId));
  rows.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  return rows;
}

async function createCharacterVariant(data: Record<string, unknown>): Promise<CharacterVariant> {
  const now = nowISO();
  const idx = await autoOrderIndex(
    'character_variants',
    'character_id',
    data.character_id as string,
    data.order_index as number | undefined,
  );
  const row: CharacterVariant = {
    id: uuid4(),
    character_id: data.character_id as string,
    name: (data.name as string) || '',
    url: (data.url as string) || '',
    order_index: idx,
    created_at: now,
    updated_at: now,
  };
  await putOne('character_variants', row as unknown as Record<string, unknown>);
  return row;
}

async function createCharacterVariantsBatch(
  characterId: string,
  items: { name?: string; url: string }[],
): Promise<CharacterVariant[]> {
  const now = nowISO();
  const existing = await getAll<CharacterVariant>('character_variants', 'character_id', IDBKeyRange.only(characterId));
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
    await putOne('character_variants', row as unknown as Record<string, unknown>);
    created.push(row);
  }
  return created;
}

async function updateCharacterVariant(id: string, patch: Record<string, unknown>): Promise<boolean> {
  const cur = await getOne<CharacterVariant>('character_variants', id);
  if (!cur) return false;
  const next = { ...cur, ...patch, updated_at: nowISO() };
  await putOne('character_variants', next as unknown as Record<string, unknown>);
  return true;
}

async function deleteCharacterVariant(id: string): Promise<boolean> {
  return deleteOne('character_variants', id);
}

async function reorderCharacterVariants(characterId: string, orderedIds: string[]): Promise<boolean> {
  const now = nowISO();
  for (let i = 0; i < orderedIds.length; i++) {
    const cur = await getOne<Record<string, unknown>>('character_variants', orderedIds[i]);
    if (cur && cur.character_id === characterId) {
      await putOne('character_variants', { ...cur, order_index: i, updated_at: now } as Record<string, unknown>);
    }
  }
  return true;
}

// ============================================================
// CharacterRelation
// ============================================================

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

async function listCharacterRelations(storyId: string): Promise<CharacterRelationRow[]> {
  const rows = await getAll<CharacterRelationRow>('character_relations', 'story_id', IDBKeyRange.only(storyId));
  rows.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  return rows;
}

async function createCharacterRelation(data: Record<string, unknown>): Promise<CharacterRelationRow> {
  const now = nowISO();
  const idx = await autoOrderIndex(
    'character_relations',
    'story_id',
    data.story_id as string,
    data.order_index as number | undefined,
  );
  const row: CharacterRelationRow = {
    id: uuid4(),
    story_id: data.story_id as string,
    source_id: data.source_id as string,
    target_id: data.target_id as string,
    relation: (data.relation as string) || '',
    note: (data.note as string) ?? null,
    order_index: idx,
    created_at: now,
    updated_at: now,
  };
  await putOne('character_relations', row as unknown as Record<string, unknown>);
  return row;
}

async function updateCharacterRelation(
  id: string,
  patch: Record<string, unknown>,
): Promise<CharacterRelationRow | undefined> {
  const cur = await getOne<CharacterRelationRow>('character_relations', id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch, updated_at: nowISO() };
  await putOne('character_relations', next as unknown as Record<string, unknown>);
  return getOne<CharacterRelationRow>('character_relations', id);
}

async function deleteCharacterRelation(id: string): Promise<boolean> {
  return deleteOne('character_relations', id);
}

// ============================================================
// Outline
// ============================================================

async function listOutlines(storyId: string): Promise<Outline[]> {
  const rows = await getAll<Outline>('outlines', 'story_id', IDBKeyRange.only(storyId));
  rows.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  return rows;
}

async function createOutline(data: Record<string, unknown>): Promise<Outline> {
  const now = nowISO();
  const idx = await autoOrderIndex('outlines', 'story_id', data.story_id as string, data.order_index as number | undefined);
  const row: Outline = {
    id: uuid4(),
    story_id: data.story_id as string,
    content: (data.content as string) || '',
    order_index: idx,
    created_at: now,
    updated_at: now,
  };
  await putOne('outlines', row as unknown as Record<string, unknown>);
  return row;
}

async function updateOutline(id: string, patch: Record<string, unknown>): Promise<Outline | undefined> {
  const cur = await getOne<Outline>('outlines', id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch, updated_at: nowISO() };
  await putOne('outlines', next as unknown as Record<string, unknown>);
  return getOne<Outline>('outlines', id);
}

async function deleteOutline(id: string): Promise<boolean> {
  return deleteOne('outlines', id);
}

// ============================================================
// Volume
// ============================================================

async function listVolumes(storyId: string): Promise<Volume[]> {
  const rows = await getAll<Volume>('volumes', 'story_id', IDBKeyRange.only(storyId));
  rows.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  return rows;
}

async function createVolume(data: Record<string, unknown>): Promise<Volume> {
  const now = nowISO();
  const idx = await autoOrderIndex('volumes', 'story_id', data.story_id as string, data.order_index as number | undefined);
  const row: Volume = {
    id: uuid4(),
    story_id: data.story_id as string,
    title: (data.title as string) || '',
    order_index: idx,
    created_at: now,
    updated_at: now,
  };
  await putOne('volumes', row as unknown as Record<string, unknown>);
  return row;
}

async function updateVolume(id: string, patch: Record<string, unknown>): Promise<Volume | undefined> {
  const cur = await getOne<Volume>('volumes', id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch, updated_at: nowISO() };
  await putOne('volumes', next as unknown as Record<string, unknown>);
  return getOne<Volume>('volumes', id);
}

async function deleteVolume(id: string): Promise<boolean> {
  // 级联：删除其下 chapters -> sections
  const chapters = await getAll<Record<string, unknown>>('chapters', 'volume_id', IDBKeyRange.only(id));
  for (const ch of chapters) {
    const sections = await getAll<Record<string, unknown>>('sections', 'chapter_id', IDBKeyRange.only(ch.id as string));
    for (const sec of sections) {
      await deleteOne('sections', sec.id as string);
    }
    await deleteOne('chapters', ch.id as string);
  }
  return deleteOne('volumes', id);
}

async function reorderVolumes(storyId: string, orderedIds: string[]): Promise<boolean> {
  const now = nowISO();
  for (let i = 0; i < orderedIds.length; i++) {
    const cur = await getOne<Record<string, unknown>>('volumes', orderedIds[i]);
    if (cur && cur.story_id === storyId) {
      await putOne('volumes', { ...cur, order_index: i, updated_at: now } as Record<string, unknown>);
    }
  }
  return true;
}

// ============================================================
// Chapter
// ============================================================

async function listChapters(storyId: string): Promise<Chapter[]> {
  const rows = await getAll<Chapter>('chapters', 'story_id', IDBKeyRange.only(storyId));
  rows.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  return rows;
}

async function listChaptersByVolume(volumeId: string): Promise<Chapter[]> {
  const rows = await getAll<Chapter>('chapters', 'volume_id', IDBKeyRange.only(volumeId));
  rows.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  return rows;
}

async function createChapter(data: Record<string, unknown>): Promise<Chapter> {
  const now = nowISO();
  const idx = await autoOrderIndex('chapters', 'story_id', data.story_id as string, data.order_index as number | undefined);
  const row: Chapter = {
    id: uuid4(),
    story_id: data.story_id as string,
    volume_id: (data.volume_id as string) ?? null,
    title: (data.title as string) || '',
    order_index: idx,
    created_at: now,
    updated_at: now,
  };
  await putOne('chapters', row as unknown as Record<string, unknown>);
  return row;
}

async function updateChapter(id: string, patch: Record<string, unknown>): Promise<Chapter | undefined> {
  const cur = await getOne<Chapter>('chapters', id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch, updated_at: nowISO() };
  await putOne('chapters', next as unknown as Record<string, unknown>);
  return getOne<Chapter>('chapters', id);
}

async function deleteChapter(id: string): Promise<boolean> {
  const sections = await getAll<Record<string, unknown>>('sections', 'chapter_id', IDBKeyRange.only(id));
  for (const sec of sections) {
    await deleteOne('sections', sec.id as string);
  }
  return deleteOne('chapters', id);
}

async function reorderChapters(storyId: string, orderedIds: string[]): Promise<boolean> {
  const now = nowISO();
  for (let i = 0; i < orderedIds.length; i++) {
    const cur = await getOne<Record<string, unknown>>('chapters', orderedIds[i]);
    if (cur && cur.story_id === storyId) {
      await putOne('chapters', { ...cur, order_index: i, updated_at: now } as Record<string, unknown>);
    }
  }
  return true;
}

// 跨卷拖动：同时更新 chapter.volume_id 和 order_index
async function moveChapters(
  storyId: string,
  targetVolumeId: string | null,
  orderedIds: string[],
): Promise<boolean> {
  const now = nowISO();
  for (let i = 0; i < orderedIds.length; i++) {
    const cur = await getOne<Record<string, unknown>>('chapters', orderedIds[i]);
    if (cur && cur.story_id === storyId) {
      await putOne('chapters', {
        ...cur,
        volume_id: targetVolumeId,
        order_index: i,
        updated_at: now,
      } as Record<string, unknown>);
    }
  }
  return true;
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

// ============================================================
// Section
// ============================================================

async function listSections(chapterId: string): Promise<Section[]> {
  const rows = await getAll<Section>('sections', 'chapter_id', IDBKeyRange.only(chapterId));
  rows.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  return rows;
}

async function listSectionMetadata(chapterId: string): Promise<SectionMeta[]> {
  const rows = await getAll<Section & { word_count?: number }>('sections', 'chapter_id', IDBKeyRange.only(chapterId));
  rows.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  return rows.map((r) => ({
    id: r.id,
    chapter_id: r.chapter_id,
    title: r.title,
    order_index: r.order_index,
    word_count: r.word_count || 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

async function createSection(data: Record<string, unknown>): Promise<Section> {
  const now = nowISO();
  const idx = await autoOrderIndex('sections', 'chapter_id', data.chapter_id as string, data.order_index as number | undefined);
  const wc = countWordsInHtml(data.content as string | null | undefined);
  const row: Section = {
    id: uuid4(),
    chapter_id: data.chapter_id as string,
    title: (data.title as string) || '',
    order_index: idx,
    content: (data.content as string) || undefined,
    bbcode: (data.bbcode as string) || undefined,
    word_count: wc,
    created_at: now,
    updated_at: now,
  };
  await putOne('sections', row as unknown as Record<string, unknown>);
  return row;
}

async function updateSection(id: string, patch: Record<string, unknown>): Promise<Section | undefined> {
  const cur = await getOne<Section>('sections', id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch, updated_at: nowISO() };
  await putOne('sections', next as unknown as Record<string, unknown>);
  return getOne<Section>('sections', id);
}

async function deleteSection(id: string): Promise<boolean> {
  return deleteOne('sections', id);
}

async function reorderSections(chapterId: string, orderedIds: string[]): Promise<boolean> {
  const now = nowISO();
  for (let i = 0; i < orderedIds.length; i++) {
    const cur = await getOne<Record<string, unknown>>('sections', orderedIds[i]);
    if (cur && cur.chapter_id === chapterId) {
      await putOne('sections', { ...cur, order_index: i, updated_at: now } as Record<string, unknown>);
    }
  }
  return true;
}

// 跨章拖动：同时更新 section.chapter_id 和 order_index
async function moveSections(
  targetChapterId: string | null,
  orderedIds: string[],
): Promise<boolean> {
  const now = nowISO();
  for (let i = 0; i < orderedIds.length; i++) {
    const cur = await getOne<Record<string, unknown>>('sections', orderedIds[i]);
    if (cur) {
      await putOne('sections', {
        ...cur,
        chapter_id: targetChapterId,
        order_index: i,
        updated_at: now,
      } as Record<string, unknown>);
    }
  }
  return true;
}

async function getSectionContent(sectionId: string): Promise<string | null> {
  const row = await getOne<Section>('sections', sectionId);
  return row ? row.content || null : null;
}

async function setSectionContent(sectionId: string, content: string | null): Promise<boolean> {
  const cur = await getOne<Section>('sections', sectionId);
  if (!cur) return false;
  const wc = countWordsInHtml(content);
  const next = { ...cur, content: content ?? undefined, word_count: wc, updated_at: nowISO() };
  await putOne('sections', next as unknown as Record<string, unknown>);
  return true;
}

async function setSectionBBCode(sectionId: string, bbcode: string | null): Promise<boolean> {
  const cur = await getOne<Section>('sections', sectionId);
  if (!cur) return false;
  const next = { ...cur, bbcode: bbcode ?? undefined, updated_at: nowISO() };
  await putOne('sections', next as unknown as Record<string, unknown>);
  return true;
}

// ============================================================
// Templates
// ============================================================

async function listWorldSettingTemplates(): Promise<WorldSettingTemplate[]> {
  const rows = await getAll<WorldSettingTemplate>('world_setting_templates');
  rows.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  return rows;
}

async function createWorldSettingTemplate(data: Record<string, unknown>): Promise<WorldSettingTemplate> {
  const now = nowISO();
  const all = await getAll<Record<string, unknown>>('world_setting_templates');
  const order = all.length;
  const row: WorldSettingTemplate = {
    id: uuid4(),
    title: (data.title as string) || '',
    content: (data.content as string) || '',
    order_index: order,
    created_at: now,
    updated_at: now,
  };
  await putOne('world_setting_templates', row as unknown as Record<string, unknown>);
  return row;
}

async function updateWorldSettingTemplate(
  id: string,
  patch: Record<string, unknown>,
): Promise<WorldSettingTemplate | undefined> {
  const cur = await getOne<WorldSettingTemplate>('world_setting_templates', id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch, updated_at: nowISO() };
  await putOne('world_setting_templates', next as unknown as Record<string, unknown>);
  return getOne<WorldSettingTemplate>('world_setting_templates', id);
}

async function deleteWorldSettingTemplate(id: string): Promise<boolean> {
  return deleteOne('world_setting_templates', id);
}

async function reorderWorldSettingTemplates(orderedIds: string[]): Promise<boolean> {
  for (let i = 0; i < orderedIds.length; i++) {
    const cur = await getOne<Record<string, unknown>>('world_setting_templates', orderedIds[i]);
    if (cur) {
      await putOne('world_setting_templates', { ...cur, order_index: i } as Record<string, unknown>);
    }
  }
  return true;
}

async function listCharacterTemplates(): Promise<CharacterTemplate[]> {
  const rows = await getAll<CharacterTemplate>('character_templates');
  rows.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  return rows;
}

async function createCharacterTemplate(data: Record<string, unknown>): Promise<CharacterTemplate> {
  const now = nowISO();
  const all = await getAll<Record<string, unknown>>('character_templates');
  const order = all.length;
  const row: CharacterTemplate = {
    id: uuid4(),
    name: (data.name as string) || '',
    avatar: (data.avatar as string) || '',
    personality: (data.personality as string) || '',
    attributes: data.attributes as Record<string, string | number> | undefined,
    notes: (data.notes as string) || '',
    variants: data.variants as CharacterVariant[] | undefined,
    order_index: order,
    created_at: now,
    updated_at: now,
  };
  await putOne('character_templates', row as unknown as Record<string, unknown>);
  return row;
}

async function updateCharacterTemplate(
  id: string,
  patch: Record<string, unknown>,
): Promise<CharacterTemplate | undefined> {
  const cur = await getOne<CharacterTemplate>('character_templates', id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch, updated_at: nowISO() };
  await putOne('character_templates', next as unknown as Record<string, unknown>);
  return getOne<CharacterTemplate>('character_templates', id);
}

async function deleteCharacterTemplate(id: string): Promise<boolean> {
  return deleteOne('character_templates', id);
}

async function reorderCharacterTemplates(orderedIds: string[]): Promise<boolean> {
  for (let i = 0; i < orderedIds.length; i++) {
    const cur = await getOne<Record<string, unknown>>('character_templates', orderedIds[i]);
    if (cur) {
      await putOne('character_templates', { ...cur, order_index: i } as Record<string, unknown>);
    }
  }
  return true;
}

// ============================================================
// Aggregate: getStoryWithAll
// ============================================================

async function getStoryWithAll(storyId: string): Promise<StoryWithAll | undefined> {
  const story = await getStory(storyId);
  if (!story) return undefined;

  const [worldSettings, characters, outlines, volumes, chapters] = await Promise.all([
    listWorldSettings(storyId),
    listCharacters(storyId),
    listOutlines(storyId),
    listVolumes(storyId),
    listChapters(storyId),
  ]);

  // 为每个 chapter 加载 sections
  const chaptersWithSections = await Promise.all(
    chapters.map(async (ch) => {
      const sections = await listSections(ch.id);
      return { ...ch, sections };
    }),
  );

  return {
    ...story,
    world_settings: worldSettings,
    characters,
    outlines,
    volumes,
    chapters: chaptersWithSections,
  };
}

// ============================================================
// 公开 API
// ============================================================

export const BROWSER_DB = {
  // Story
  listStories,
  getStory,
  createStory,
  updateStory,
  deleteStory,
  softDeleteStory,
  restoreStory,
  permanentlyDeleteStory,
  listTrashedStories,
  cleanupOldTrashed,
  // WorldSettings
  listWorldSettings,
  createWorldSetting,
  updateWorldSetting,
  deleteWorldSetting,
  reorderWorldSettings,
  // Characters
  listCharacters,
  createCharacter,
  updateCharacter,
  deleteCharacter,
  reorderCharacters,
  // Character Variants
  listCharacterVariants,
  createCharacterVariant,
  createCharacterVariantsBatch,
  updateCharacterVariant,
  deleteCharacterVariant,
  reorderCharacterVariants,
  // Character Relations
  listCharacterRelations,
  createCharacterRelation,
  updateCharacterRelation,
  deleteCharacterRelation,
  // Outlines
  listOutlines,
  createOutline,
  updateOutline,
  deleteOutline,
  // Volumes
  listVolumes,
  createVolume,
  updateVolume,
  deleteVolume,
  reorderVolumes,
  // Chapters
  listChapters,
  listChaptersByVolume,
  createChapter,
  updateChapter,
  deleteChapter,
  reorderChapters,
  moveChapters,
  // Sections
  listSections,
  listSectionMetadata,
  createSection,
  updateSection,
  deleteSection,
  reorderSections,
  moveSections,
  getSectionContent,
  setSectionContent,
  setSectionBBCode,
  // Templates
  listWorldSettingTemplates,
  createWorldSettingTemplate,
  updateWorldSettingTemplate,
  deleteWorldSettingTemplate,
  reorderWorldSettingTemplates,
  listCharacterTemplates,
  createCharacterTemplate,
  updateCharacterTemplate,
  deleteCharacterTemplate,
  reorderCharacterTemplates,
  // Aggregate
  getStoryWithAll,
};

// 让 EntityFields 在编译期被使用，避免未使用类型警告
export type _EntityKeys = _EntityFields;
