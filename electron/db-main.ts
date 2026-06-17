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

// —— 预置模板 —— //

type PresetWorldTemplate = { id: string; title: string; content: string; is_preset: number; created_at: string; updated_at: string };
type PresetCharTemplate = {
  id: string;
  name: string;
  avatar?: string;
  personality?: string;
  attributes?: Record<string, string | number>;
  notes?: string;
  variants?: { id: string; name: string; url: string }[];
  is_preset: number;
  created_at: string;
  updated_at: string;
};

function seedPresetWorldTemplates(existing: Record<string, PresetWorldTemplate>): Record<string, PresetWorldTemplate> {
  const preset: { title: string; content: string }[] = [
    {
      title: '现代都市背景',
      content: '【背景】\n繁华都市，表面光鲜的现代社会。人们过着看似正常的生活，实则暗流涌动。\n\n【时间线】\n故事发生于 21 世纪初的一座虚构大城市。\n\n【关键地点】\n• 市中心商业区\n• 城市边缘的老城区\n• 港口/码头\n• 大学/研究所\n\n【社会设定】\n经济相对发达，科技水平接近现实，社会主流价值观为现代都市风格。',
    },
    {
      title: '奇幻异世界背景',
      content: '【背景】\n一个剑与魔法并存的中世纪风格奇幻世界。\n\n【世界观】\n• 存在多个国家/王国\n• 魔法是被承认和使用的力量\n• 存在冒险者公会等组织\n• 有各种非人种族（精灵、矮人、兽人等）\n\n【时间线】\n故事起始于王国历某一年。\n\n【关键地点】\n• 王都\n• 边境小镇\n• 魔法学院',
    },
    {
      title: '校园背景',
      content: '【背景】\n一所规模中等的学校，故事以校园为主要舞台。\n\n【关键地点】\n• 教学楼\n• 学生宿舍\n• 操场/体育馆\n• 社团活动室\n• 图书馆\n• 学校附近的商店街\n\n【学年设定】\n日本式三学期制或美式两学期制可选。\n\n【社团】\n学生会、各类兴趣社团均存在。',
    },
    {
      title: '末世/废土背景',
      content: '【背景】\n一场灾难后的世界，资源匮乏，秩序崩坏。\n\n【时间线】\n灾难发生多年后，幸存者在废墟中挣扎求存。\n\n【社会设定】\n• 小型聚居点/避难所\n• 物资匮乏\n• 以物易物或特殊代币作为货币\n• 危险的外部区域（变异生物/残留辐射/敌对组织）\n\n【关键地点】\n• 避难所/聚居点\n• 废墟城市\n• 旧世界遗迹',
    },
    {
      title: '东方古风背景',
      content: '【背景】\n古代东方风格的虚构王朝。\n\n【社会设定】\n• 皇帝/王室为最高权力\n• 文官武将系统\n• 江湖/武林存在\n• 宗教/神秘学\n\n【关键地点】\n• 京城/帝都\n• 江湖门派\n• 各地州府\n• 名山大川',
    },
  ];

  const result: Record<string, PresetWorldTemplate> = { ...existing };
  const existingTitles = new Set(Object.values(result).filter((t) => t.is_preset === 1).map((t) => t.title));
  for (const t of preset) {
    if (!existingTitles.has(t.title)) {
      const id = uuid4();
      result[id] = {
        id,
        title: t.title,
        content: t.content,
        is_preset: 1,
        created_at: nowISO(),
        updated_at: nowISO(),
      };
    }
  }
  return result;
}

function seedPresetCharacterTemplates(existing: Record<string, PresetCharTemplate>): Record<string, PresetCharTemplate> {
  const preset: { name: string; personality: string }[] = [
    { name: '主角（普通青年）', personality: '性格开朗，有正义感，但有时会犹豫。普通学生/上班族，卷入事件中。' },
    { name: '冷酷神秘的少女', personality: '外表冷淡、寡言，内心有自己的坚持。拥有某种特殊能力或背景。' },
    { name: '元气活泼的朋友', personality: '充满活力、乐观开朗，是主角的挚友/损友，常出谋划策或引发麻烦。' },
    { name: '温柔大姐姐型', personality: '稳重温柔，擅长照顾人，是团队中的心理支柱与调和者。' },
    { name: '高傲强势的大小姐', personality: '出身豪门，性格高傲强势，但内心有柔弱一面，与主角存在复杂关系。' },
    { name: '神秘魔法师/术士', personality: '掌握强大力量，行事神秘莫测，真实目的不明。' },
    { name: '可靠的兄长/前辈', personality: '经验丰富，沉着冷静，常常在关键时刻给予主角指引与帮助。' },
    { name: '元气幼驯染', personality: '与主角一起长大，性格开朗，对主角了如指掌。' },
  ];

  const result: Record<string, PresetCharTemplate> = { ...existing };
  const existingNames = new Set(Object.values(result).filter((t) => t.is_preset === 1).map((t) => t.name));
  for (const p of preset) {
    if (!existingNames.has(p.name)) {
      const id = uuid4();
      result[id] = {
        id,
        name: p.name,
        avatar: '',
        personality: p.personality,
        attributes: {},
        notes: '',
        variants: [],
        is_preset: 1,
        created_at: nowISO(),
        updated_at: nowISO(),
      };
    }
  }
  return result;
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

  // —— 模板文件 + 预置模板 —— //
  const worldTplPath = filePath('world_templates.json');
  if (!fs.existsSync(worldTplPath)) {
    saveJSON('world_templates.json', seedPresetWorldTemplates({}));
  } else {
    const w = loadJSON<Record<string, PresetWorldTemplate>>('world_templates.json', {});
    const seeded = seedPresetWorldTemplates(w);
    saveJSON('world_templates.json', seeded);
  }

  const charTplPath = filePath('character_templates.json');
  if (!fs.existsSync(charTplPath)) {
    saveJSON('character_templates.json', seedPresetCharacterTemplates({}));
  } else {
    const c = loadJSON<Record<string, PresetCharTemplate>>('character_templates.json', {});
    const seeded = seedPresetCharacterTemplates(c);
    saveJSON('character_templates.json', seeded);
  }

  initialized = true;
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
  created_at: string;
  updated_at: string;
};

export function listStories(): StoryRow[] {
  const all = readTable<StoryRow>('stories');
  return Object.values(all).sort((a, b) => {
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

export function listWorldSettingTemplates(): PresetWorldTemplate[] {
  const all = readTable<PresetWorldTemplate>('world_templates');
  return Object.values(all).sort((a, b) => {
    if (a.is_preset !== b.is_preset) return b.is_preset - a.is_preset;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

export function createWorldSettingTemplate(data: { title: string; content?: string; is_preset?: number }): PresetWorldTemplate {
  return createRow<PresetWorldTemplate>('world_templates', {
    title: data.title,
    content: data.content || '',
    is_preset: data.is_preset || 0,
  } as any);
}

export function updateWorldSettingTemplate(id: string, patch: Partial<{ title: string; content: string }>): PresetWorldTemplate | undefined {
  const all = readTable<PresetWorldTemplate>('world_templates');
  if (all[id]?.is_preset === 1) return all[id]; // 预置模板不可修改
  return updateRow<PresetWorldTemplate>('world_templates', id, patch as any) || undefined;
}

export function deleteWorldSettingTemplate(id: string): void {
  const all = readTable<PresetWorldTemplate>('world_templates');
  if (all[id]?.is_preset === 1) return; // 预置模板不可删除
  deleteRow('world_templates', id);
}

export function listCharacterTemplates(): any[] {
  const all = readTable<PresetCharTemplate>('character_templates');
  return Object.values(all)
    .sort((a, b) => {
      if (a.is_preset !== b.is_preset) return b.is_preset - a.is_preset;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    })
    .map((r) => ({
      id: r.id,
      name: r.name,
      avatar: r.avatar || '',
      personality: r.personality || '',
      attributes: parseJSON<Record<string, string | number>>(r.attributes, {}),
      notes: r.notes || '',
      variants: parseJSON<CharacterVariantRow[]>(r.variants, []),
      is_preset: r.is_preset,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
}

export function createCharacterTemplate(data: {
  name: string;
  avatar?: string;
  personality?: string;
  attributes?: Record<string, string | number>;
  notes?: string;
  variants?: CharacterVariantRow[];
  is_preset?: number;
}): any {
  const row = createRow<PresetCharTemplate>('character_templates', {
    name: data.name,
    avatar: data.avatar || '',
    personality: data.personality || '',
    attributes: serializeJSON(data.attributes || {}),
    notes: data.notes || '',
    variants: serializeJSON(data.variants || []),
    is_preset: data.is_preset || 0,
  } as any);
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    personality: row.personality,
    attributes: parseJSON(row.attributes, {}),
    notes: row.notes,
    variants: parseJSON<CharacterVariantRow[]>(row.variants, []),
    is_preset: row.is_preset,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function updateCharacterTemplate(
  id: string,
  patch: Partial<{
    name: string;
    avatar: string;
    personality: string;
    attributes: Record<string, string | number>;
    notes: string;
    variants: CharacterVariantRow[];
  }>,
): any | undefined {
  const all = readTable<PresetCharTemplate>('character_templates');
  if (all[id]?.is_preset === 1) return all[id];
  const dbPatch: any = {};
  if ('name' in patch) dbPatch.name = patch.name;
  if ('avatar' in patch) dbPatch.avatar = patch.avatar;
  if ('personality' in patch) dbPatch.personality = patch.personality;
  if ('notes' in patch) dbPatch.notes = patch.notes;
  if ('attributes' in patch) dbPatch.attributes = serializeJSON(patch.attributes);
  if ('variants' in patch) dbPatch.variants = serializeJSON(patch.variants);
  const row = updateRow<PresetCharTemplate>('character_templates', id, dbPatch);
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    personality: row.personality,
    attributes: parseJSON(row.attributes, {}),
    notes: row.notes,
    variants: parseJSON<CharacterVariantRow[]>(row.variants, []),
    is_preset: row.is_preset,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function deleteCharacterTemplate(id: string): void {
  const all = readTable<PresetCharTemplate>('character_templates');
  if (all[id]?.is_preset === 1) return;
  deleteRow('character_templates', id);
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
