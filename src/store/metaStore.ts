// ============================================================
// 元数据状态管理 - metaStore
//
// 负责：世界观设定、人物角色、剧情大纲
//
// 设计：
//  - 世界观设定：数组 + 当前编辑项 id
//  - 角色：数组 + 当前编辑角色 id（弹窗/面板切换）
//  - 大纲：字符串数组（每一条存储为纯文本，支持多级缩进）
//  - 全部数据变更同步到 database，读/写方式与 storyStore 一致
// ============================================================

import { create } from 'zustand';
import type {
  WorldSetting,
  Character,
  CharacterVariant,
  CharacterRelation,
  WorldSettingTemplate,
  CharacterTemplate,
  Outline,
} from '../types';
import * as db from '../db/index';

/** 左侧栏"元数据"分类下的视图切换 */
export type MetaView = 'world' | 'character' | 'outline' | null;

interface MetaState {
  // 当前视图（左侧栏点击触发）
  activeView: MetaView;

  // 世界观设定
  worldSettings: WorldSetting[];
  editingWorldId: string | null;

  // 角色
  characters: Character[];
  editingCharacterId: string | null;
  showCharacterEditor: boolean;

  // 人物关系
  relations: CharacterRelation[];

  // 大纲
  outlines: Outline[];

  // —— 模板（独立表，不依赖 story）——
  worldSettingTemplates: WorldSettingTemplate[];
  characterTemplates: CharacterTemplate[];


  // —— 视图 ——
  setActiveView: (view: MetaView) => void;

  // —— 加载（在故事切换时调用）——
  loadMetaForStory: (storyId: string) => Promise<void>;
  clearMeta: () => void;

  // —— 世界观设定 ——
  createWorldSetting: (storyId: string, title?: string, content?: string) => Promise<string>;
  updateWorldSetting: (id: string, patch: Partial<Pick<WorldSetting, 'title' | 'content'>>) => Promise<void>;
  deleteWorldSetting: (id: string) => Promise<void>;
  setEditingWorldId: (id: string | null) => void;
  reorderWorldSettings: (storyId: string, orderedIds: string[]) => Promise<void>;

  // —— 角色 ——
  createCharacter: (storyId: string, name?: string, skipEditor?: boolean) => Promise<string>;
  updateCharacter: (
    id: string,
    patch: Partial<Pick<Character, 'name' | 'avatar' | 'personality' | 'attributes' | 'notes'>>,
  ) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
  setEditingCharacter: (id: string | null) => void;
  toggleCharacterEditor: (show: boolean) => void;
  reorderCharacters: (storyId: string, orderedIds: string[]) => Promise<void>;

  // —— 角色差分 ——
  addCharacterVariant: (
    characterId: string,
    data: { name: string; url: string },
  ) => Promise<string>;
  updateCharacterVariant: (
    id: string,
    patch: Partial<Pick<CharacterVariant, 'name' | 'url'>>,
  ) => Promise<void>;
  deleteCharacterVariant: (id: string) => Promise<void>;
  reorderCharacterVariants: (characterId: string, orderedIds: string[]) => Promise<void>;

  // —— 人物关系 ——
  loadRelations: (storyId: string) => Promise<void>;
  createRelation: (data: {
    story_id: string;
    source_id: string;
    target_id: string;
    relation: string;
    note?: string;
  }) => Promise<string>;
  updateRelation: (
    id: string,
    patch: Partial<Pick<CharacterRelation, 'source_id' | 'target_id' | 'relation' | 'note' | 'order_index'>>,
  ) => Promise<void>;
  deleteRelation: (id: string) => Promise<void>;

  // —— 大纲 ——
  createOutline: (storyId: string, content?: string) => Promise<string>;
  updateOutline: (id: string, patch: Partial<Pick<Outline, 'content'>>) => Promise<void>;
  deleteOutline: (id: string) => Promise<void>;
  reorderOutlines: (orderedIds: string[]) => Promise<void>;

  // —— 模板 ——
  loadTemplates: () => Promise<void>;
  clearTemplates: () => void;
  // 世界观模板
  createWorldSettingTemplate: (
    data: { title: string; content?: string },
  ) => Promise<string>;
  updateWorldSettingTemplate: (
    id: string,
    patch: Partial<Pick<WorldSettingTemplate, 'title' | 'content'>>,
  ) => Promise<void>;
  deleteWorldSettingTemplate: (id: string) => Promise<void>;
  batchDeleteWorldSettingTemplates: (ids: string[]) => Promise<{ deleted: number }>;
  reorderWorldSettingTemplates: (orderedIds: string[]) => Promise<void>;
  // 人物模板
  createCharacterTemplate: (data: {
    name: string;
    avatar?: string;
    personality?: string;
    attributes?: Record<string, string | number>;
    notes?: string;
    variants?: CharacterVariant[];
  }) => Promise<string>;
  updateCharacterTemplate: (
    id: string,
    patch: Partial<
      Pick<
        CharacterTemplate,
        'name' | 'avatar' | 'personality' | 'attributes' | 'notes' | 'variants'
      >
    >,
  ) => Promise<void>;
  deleteCharacterTemplate: (id: string) => Promise<void>;
  batchDeleteCharacterTemplates: (ids: string[]) => Promise<{ deleted: number }>;
  reorderCharacterTemplates: (orderedIds: string[]) => Promise<void>;

  // —— 模板导入导出 ——
  /** 导入模板数据（从 JSON 文件批量创建） */
  importTemplates: (data: {
    version?: number;
    worldSettingTemplates?: Array<Partial<WorldSettingTemplate> & { title: string }>;
    characterTemplates?: Array<Partial<CharacterTemplate> & { name: string }>;
  }) => Promise<{ worldCount: number; charCount: number; failed: number }>;
}

function nowOrder() {
  return Math.floor(Date.now() / 1000);
}

function defaultWorldTitle(existing: WorldSetting[]): string {
  const n = existing.length + 1;
  return `世界观设定 ${n}`;
}

function defaultCharacterName(existing: Character[]): string {
  const n = existing.length + 1;
  return `角色 ${n}`;
}

function rowToRelation(row: db.CharacterRelationRow): CharacterRelation {
  return {
    id: row.id,
    story_id: row.story_id,
    source_id: row.source_id,
    target_id: row.target_id,
    relation: row.relation,
    note: row.note ?? undefined,
    order_index: row.order_index,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const useMetaStore = create<MetaState>((set, get) => ({
  activeView: null,

  worldSettings: [],
  editingWorldId: null,

  characters: [],
  editingCharacterId: null,
  showCharacterEditor: false,

  relations: [],

  outlines: [],

  worldSettingTemplates: [],
  characterTemplates: [],

  // —— 视图 ——
  setActiveView: (view) => set({ activeView: view }),

  // —— 加载 ——
  loadMetaForStory: async (storyId) => {
    if (!storyId) {
      get().clearMeta();
      return;
    }
    const worldSettings = await db.listWorldSettings(storyId);
    const characters = await db.listCharacters(storyId);
    const outlines = await db.listOutlines(storyId);
    const relations = (await db.listCharacterRelations(storyId)).map(rowToRelation);
    set({
      worldSettings,
      characters,
      outlines,
      relations,
      editingWorldId: null,
      editingCharacterId: null,
      showCharacterEditor: false,
    });
  },

  clearMeta: () =>
    set({
      worldSettings: [],
      characters: [],
      outlines: [],
      relations: [],
      editingWorldId: null,
      editingCharacterId: null,
      showCharacterEditor: false,
    }),

  // —— 世界观设定 ——
  createWorldSetting: async (storyId, title, content) => {
    const t = title?.trim() || defaultWorldTitle(get().worldSettings);
    const row = await db.createWorldSetting({
      story_id: storyId,
      title: t,
      content: content || '',
    });
    set((state) => ({
      worldSettings: [...state.worldSettings, row].sort((a, b) => a.order_index - b.order_index),
      editingWorldId: row.id,
    }));
    return row.id;
  },

  updateWorldSetting: async (id, patch) => {
    await db.updateWorldSetting(id, patch);
    set((state) => ({
      worldSettings: state.worldSettings.map((w) =>
        w.id === id ? { ...w, ...patch } : w,
      ),
    }));
  },

  deleteWorldSetting: async (id) => {
    await db.deleteWorldSetting(id);
    set((state) => ({
      worldSettings: state.worldSettings.filter((w) => w.id !== id),
      editingWorldId: state.editingWorldId === id ? null : state.editingWorldId,
    }));
  },

  setEditingWorldId: (id) => set({ editingWorldId: id }),

  reorderWorldSettings: async (storyId, orderedIds) => {
    await db.reorderWorldSettings(storyId, orderedIds);
    const orderMap: Record<string, number> = {};
    orderedIds.forEach((id, i) => (orderMap[id] = i));
    set((state) => ({
      worldSettings: state.worldSettings
        .filter((w) => w.story_id === storyId)
        .map((w) => ({ ...w, order_index: orderMap[w.id] ?? w.order_index ?? 0 }))
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0)),
    }));
  },

  // —— 角色 ——
  createCharacter: async (storyId, name, skipEditor) => {
    const n = name?.trim() || defaultCharacterName(get().characters);
    // 检查名称唯一性
    const existing = get().characters.find(
      (c) => c.name.toLowerCase() === n.toLowerCase(),
    );
    if (existing) {
      // 已有同名角色，返回已有角色 id 并切换到编辑
      set({ editingCharacterId: skipEditor ? null : existing.id, showCharacterEditor: !skipEditor });
      return existing.id;
    }
    const row = await db.createCharacter({
      story_id: storyId,
      name: n,
      avatar: '',
      personality: '',
      attributes: {},
      notes: '',
    });
    set((state) => ({
      characters: [...state.characters, row].sort((a, b) => a.order_index - b.order_index),
      editingCharacterId: skipEditor ? null : row.id,
      showCharacterEditor: !skipEditor,
    }));
    return row.id;
  },

  updateCharacter: async (id, patch) => {
    await db.updateCharacter(id, patch);
    set((state) => ({
      characters: state.characters.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    }));
  },

  deleteCharacter: async (id) => {
    await db.deleteCharacter(id);
    set((state) => ({
      characters: state.characters.filter((c) => c.id !== id),
      editingCharacterId: state.editingCharacterId === id ? null : state.editingCharacterId,
    }));
  },

  setEditingCharacter: (id) => set({ editingCharacterId: id, showCharacterEditor: id !== null }),

  toggleCharacterEditor: (show) => set({ showCharacterEditor: show }),

  reorderCharacters: async (storyId, orderedIds) => {
    await db.reorderCharacters(storyId, orderedIds);
    const orderMap: Record<string, number> = {};
    orderedIds.forEach((id, i) => (orderMap[id] = i));
    set((state) => ({
      characters: state.characters
        .map((c) =>
          c.story_id === storyId
            ? { ...c, order_index: orderMap[c.id] ?? c.order_index ?? 0 }
            : c,
        )
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0)),
    }));
  },

  // —— 角色差分 ——
  addCharacterVariant: async (characterId, data) => {
    const name = (data.name || '').trim() || '差分';
    const url = data.url || '';
    const row = await db.createCharacterVariant({ character_id: characterId, name, url });
    set((state) => ({
      characters: state.characters.map((c) =>
        c.id === characterId
          ? { ...c, variants: [...(c.variants || []), row] }
          : c,
      ),
    }));
    return row.id;
  },

  updateCharacterVariant: async (id, patch) => {
    await db.updateCharacterVariant(id, patch);
    set((state) => ({
      characters: state.characters.map((c) => {
        if (!c.variants) return c;
        return {
          ...c,
          variants: c.variants.map((v) =>
            v.id === id ? { ...v, ...patch, updated_at: new Date().toISOString() } : v,
          ),
        };
      }),
    }));
  },

  deleteCharacterVariant: async (id) => {
    await db.deleteCharacterVariant(id);
    set((state) => ({
      characters: state.characters.map((c) => {
        if (!c.variants) return c;
        return { ...c, variants: c.variants.filter((v) => v.id !== id) };
      }),
    }));
  },

  reorderCharacterVariants: async (characterId, orderedIds) => {
    await db.reorderCharacterVariants(characterId, orderedIds);
    set((state) => ({
      characters: state.characters.map((c) => {
        if (c.id !== characterId || !c.variants) return c;
        const orderMap: Record<string, number> = {};
        orderedIds.forEach((id, i) => (orderMap[id] = i));
        return {
          ...c,
          variants: c.variants
            .slice()
            .sort(
              (a, b) =>
                (orderMap[a.id] ?? nowOrder()) - (orderMap[b.id] ?? nowOrder()),
            ),
        };
      }),
    }));
  },

  // —— 大纲 ——
  createOutline: async (storyId, content) => {
    const row = await db.createOutline({
      story_id: storyId,
      content: content || '',
    });
    set((state) => ({
      outlines: [...state.outlines, row].sort((a, b) => a.order_index - b.order_index),
    }));
    return row.id;
  },

  // —— 人物关系 ——
  loadRelations: async (storyId) => {
    set({ relations: (await db.listCharacterRelations(storyId)).map(rowToRelation) });
  },
  createRelation: async (data) => {
    const row = await db.createCharacterRelation({
      story_id: data.story_id,
      source_id: data.source_id,
      target_id: data.target_id,
      relation: data.relation?.trim() || '未知',
      note: data.note,
    });
    set((state) => ({ relations: [...state.relations, rowToRelation(row)] }));
    return row.id;
  },
  updateRelation: async (id, patch) => {
    await db.updateCharacterRelation(id, patch);
    set((state) => ({
      relations: state.relations.map((r) =>
        r.id === id ? { ...r, ...patch, updated_at: new Date().toISOString() } : r,
      ),
    }));
  },
  deleteRelation: async (id) => {
    await db.deleteCharacterRelation(id);
    set((state) => ({ relations: state.relations.filter((r) => r.id !== id) }));
  },

  updateOutline: async (id, patch) => {
    await db.updateOutline(id, patch);
    set((state) => ({
      outlines: state.outlines.map((o) =>
        o.id === id ? { ...o, ...patch } : o,
      ),
    }));
  },

  deleteOutline: async (id) => {
    await db.deleteOutline(id);
    set((state) => ({
      outlines: state.outlines.filter((o) => o.id !== id),
    }));
  },

  reorderOutlines: async (orderedIds) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.updateOutline(orderedIds[i], { order_index: i });
    }
    set((state) => {
      const orderMap: Record<string, number> = {};
      orderedIds.forEach((id, i) => (orderMap[id] = i));
      return {
        outlines: state.outlines
          .slice()
          .sort((a, b) => (orderMap[a.id] ?? nowOrder()) - (orderMap[b.id] ?? nowOrder())),
      };
    });
  },

  // —— 模板 ——
  loadTemplates: async () => {
    const worldSettingTemplates = await db.listWorldSettingTemplates();
    const characterTemplates = await db.listCharacterTemplates();
    set({ worldSettingTemplates, characterTemplates });
  },
  clearTemplates: () =>
    set({ worldSettingTemplates: [], characterTemplates: [] }),

  // 世界观模板
  createWorldSettingTemplate: async (data) => {
    const row = await db.createWorldSettingTemplate({
      title: data.title?.trim() || '未命名模板',
      content: data.content || '',
    });
    set((state) => ({
      worldSettingTemplates: [row, ...state.worldSettingTemplates],
    }));
    return row.id;
  },
  updateWorldSettingTemplate: async (id, patch) => {
    await db.updateWorldSettingTemplate(id, patch);
    set((state) => ({
      worldSettingTemplates: state.worldSettingTemplates.map((t) =>
        t.id === id ? { ...t, ...patch, updated_at: new Date().toISOString() } : t,
      ),
    }));
  },
  batchDeleteWorldSettingTemplates: async (ids) => {
    for (const id of ids) {
      await db.deleteWorldSettingTemplate(id);
    }
    const deletedSet = new Set(ids);
    set((state) => ({
      worldSettingTemplates: state.worldSettingTemplates.filter((t) => !deletedSet.has(t.id)),
    }));
    return { deleted: ids.length };
  },
  deleteWorldSettingTemplate: async (id) => {
    await db.deleteWorldSettingTemplate(id);
    set((state) => ({
      worldSettingTemplates: state.worldSettingTemplates.filter((t) => t.id !== id),
    }));
  },
  reorderWorldSettingTemplates: async (orderedIds) => {
    await db.reorderWorldSettingTemplates(orderedIds);
    const orderMap: Record<string, number> = {};
    orderedIds.forEach((id, i) => (orderMap[id] = i));
    set((state) => ({
      worldSettingTemplates: state.worldSettingTemplates
        .slice()
        .sort(
          (a, b) =>
            (orderMap[a.id] ?? a.order_index ?? 0) -
            (orderMap[b.id] ?? b.order_index ?? 0),
        ),
    }));
  },

  // 人物模板
  createCharacterTemplate: async (data) => {
    const row = await db.createCharacterTemplate({
      name: data.name?.trim() || '未命名人物模板',
      avatar: data.avatar || '',
      personality: data.personality || '',
      attributes: data.attributes,
      notes: data.notes || '',
      variants: data.variants,
    });
    set((state) => ({
      characterTemplates: [row, ...state.characterTemplates],
    }));
    return row.id;
  },
  updateCharacterTemplate: async (id, patch) => {
    await db.updateCharacterTemplate(id, patch);
    set((state) => ({
      characterTemplates: state.characterTemplates.map((t) =>
        t.id === id ? { ...t, ...patch, updated_at: new Date().toISOString() } : t,
      ),
    }));
  },
  deleteCharacterTemplate: async (id) => {
    await db.deleteCharacterTemplate(id);
    set((state) => ({
      characterTemplates: state.characterTemplates.filter((t) => t.id !== id),
    }));
  },
  batchDeleteCharacterTemplates: async (ids) => {
    for (const id of ids) {
      await db.deleteCharacterTemplate(id);
    }
    const deletedSet = new Set(ids);
    set((state) => ({
      characterTemplates: state.characterTemplates.filter((t) => !deletedSet.has(t.id)),
    }));
    return { deleted: ids.length };
  },
  reorderCharacterTemplates: async (orderedIds) => {
    await db.reorderCharacterTemplates(orderedIds);
    const orderMap: Record<string, number> = {};
    orderedIds.forEach((id, i) => (orderMap[id] = i));
    set((state) => ({
      characterTemplates: state.characterTemplates
        .slice()
        .sort(
          (a, b) =>
            (orderMap[a.id] ?? a.order_index ?? nowOrder()) -
            (orderMap[b.id] ?? b.order_index ?? nowOrder()),
        ),
    }));
  },

  // —— 模板导入 ——
  importTemplates: async (data) => {
    let worldCount = 0;
    let charCount = 0;
    let failed = 0;

    // 导入世界观模板
    if (Array.isArray(data.worldSettingTemplates)) {
      for (const t of data.worldSettingTemplates) {
        try {
          await db.createWorldSettingTemplate({
            title: (t.title || '').trim() || '导入的模板',
            content: t.content || '',
          });
          worldCount++;
        } catch {
          failed++;
        }
      }
    }

    // 导入人物模板
    if (Array.isArray(data.characterTemplates)) {
      for (const c of data.characterTemplates) {
        try {
          await db.createCharacterTemplate({
            name: (c.name || '').trim() || '导入的人物模板',
            avatar: c.avatar || '',
            personality: c.personality || '',
            attributes: c.attributes,
            notes: c.notes || '',
            variants: c.variants,
          });
          charCount++;
        } catch {
          failed++;
        }
      }
    }

    // 刷新模板列表
    await get().loadTemplates();

    return { worldCount, charCount, failed };
  },
}));
