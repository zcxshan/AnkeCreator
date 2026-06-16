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
import * as db from '../db/database';

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
  loadMetaForStory: (storyId: string) => void;
  clearMeta: () => void;

  // —— 世界观设定 ——
  createWorldSetting: (storyId: string, title?: string, content?: string) => string;
  updateWorldSetting: (id: string, patch: Partial<Pick<WorldSetting, 'title' | 'content'>>) => void;
  deleteWorldSetting: (id: string) => void;
  setEditingWorldId: (id: string | null) => void;
  reorderWorldSettings: (orderedIds: string[]) => void;

  // —— 角色 ——
  createCharacter: (storyId: string, name?: string, skipEditor?: boolean) => string;
  updateCharacter: (
    id: string,
    patch: Partial<Pick<Character, 'name' | 'avatar' | 'personality' | 'attributes' | 'notes'>>,
  ) => void;
  deleteCharacter: (id: string) => void;
  setEditingCharacter: (id: string | null) => void;
  toggleCharacterEditor: (show: boolean) => void;
  reorderCharacters: (orderedIds: string[]) => void;

  // —— 角色差分 ——
  addCharacterVariant: (
    characterId: string,
    data: { name: string; url: string },
  ) => string;
  updateCharacterVariant: (
    id: string,
    patch: Partial<Pick<CharacterVariant, 'name' | 'url'>>,
  ) => void;
  deleteCharacterVariant: (id: string) => void;
  reorderCharacterVariants: (characterId: string, orderedIds: string[]) => void;

  // —— 人物关系 ——
  loadRelations: (storyId: string) => void;
  createRelation: (data: {
    story_id: string;
    source_id: string;
    target_id: string;
    relation: string;
    note?: string;
  }) => string;
  updateRelation: (
    id: string,
    patch: Partial<Pick<CharacterRelation, 'source_id' | 'target_id' | 'relation' | 'note' | 'order_index'>>,
  ) => void;
  deleteRelation: (id: string) => void;

  // —— 大纲 ——
  createOutline: (storyId: string, content?: string) => string;
  updateOutline: (id: string, patch: Partial<Pick<Outline, 'content'>>) => void;
  deleteOutline: (id: string) => void;
  reorderOutlines: (orderedIds: string[]) => void;

  // —— 模板 ——
  loadTemplates: () => void;
  clearTemplates: () => void;
  // 世界观模板
  createWorldSettingTemplate: (
    data: { title: string; content?: string },
  ) => string;
  updateWorldSettingTemplate: (
    id: string,
    patch: Partial<Pick<WorldSettingTemplate, 'title' | 'content'>>,
  ) => void;
  deleteWorldSettingTemplate: (id: string) => void;
  // 人物模板
  createCharacterTemplate: (data: {
    name: string;
    avatar?: string;
    personality?: string;
    attributes?: Record<string, string | number>;
    notes?: string;
    variants?: CharacterVariant[];
  }) => string;
  updateCharacterTemplate: (
    id: string,
    patch: Partial<
      Pick<
        CharacterTemplate,
        'name' | 'avatar' | 'personality' | 'attributes' | 'notes' | 'variants'
      >
    >,
  ) => void;
  deleteCharacterTemplate: (id: string) => void;
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
  loadMetaForStory: (storyId) => {
    if (!storyId) {
      get().clearMeta();
      return;
    }
    const worldSettings = db.listWorldSettings(storyId);
    const characters = db.listCharacters(storyId);
    const outlines = db.listOutlines(storyId);
    const relations = db.listCharacterRelations(storyId).map(rowToRelation);
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
  createWorldSetting: (storyId, title, content) => {
    const t = title?.trim() || defaultWorldTitle(get().worldSettings);
    const row = db.createWorldSetting({
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

  updateWorldSetting: (id, patch) => {
    db.updateWorldSetting(id, patch);
    set((state) => ({
      worldSettings: state.worldSettings.map((w) =>
        w.id === id ? { ...w, ...patch } : w,
      ),
    }));
  },

  deleteWorldSetting: (id) => {
    db.deleteWorldSetting(id);
    set((state) => ({
      worldSettings: state.worldSettings.filter((w) => w.id !== id),
      editingWorldId: state.editingWorldId === id ? null : state.editingWorldId,
    }));
  },

  setEditingWorldId: (id) => set({ editingWorldId: id }),

  reorderWorldSettings: (orderedIds) => {
    orderedIds.forEach((id, i) => {
      db.updateWorldSetting(id, { order_index: i });
    });
    set((state) => {
      const orderMap: Record<string, number> = {};
      orderedIds.forEach((id, i) => (orderMap[id] = i));
      return {
        worldSettings: state.worldSettings
          .slice()
          .sort((a, b) => (orderMap[a.id] ?? nowOrder()) - (orderMap[b.id] ?? nowOrder())),
      };
    });
  },

  // —— 角色 ——
  createCharacter: (storyId, name, skipEditor) => {
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
    const row = db.createCharacter({
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

  updateCharacter: (id, patch) => {
    db.updateCharacter(id, patch);
    set((state) => ({
      characters: state.characters.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    }));
  },

  deleteCharacter: (id) => {
    db.deleteCharacter(id);
    set((state) => ({
      characters: state.characters.filter((c) => c.id !== id),
      editingCharacterId: state.editingCharacterId === id ? null : state.editingCharacterId,
    }));
  },

  setEditingCharacter: (id) => set({ editingCharacterId: id, showCharacterEditor: id !== null }),

  toggleCharacterEditor: (show) => set({ showCharacterEditor: show }),

  reorderCharacters: (orderedIds) => {
    orderedIds.forEach((id, i) => {
      db.updateCharacter(id, { order_index: i });
    });
    set((state) => {
      const orderMap: Record<string, number> = {};
      orderedIds.forEach((id, i) => (orderMap[id] = i));
      return {
        characters: state.characters
          .slice()
          .sort((a, b) => (orderMap[a.id] ?? nowOrder()) - (orderMap[b.id] ?? nowOrder())),
      };
    });
  },

  // —— 角色差分 ——
  addCharacterVariant: (characterId, data) => {
    const name = (data.name || '').trim() || '差分';
    const url = data.url || '';
    const row = db.createCharacterVariant({ character_id: characterId, name, url });
    set((state) => ({
      characters: state.characters.map((c) =>
        c.id === characterId
          ? { ...c, variants: [...(c.variants || []), row] }
          : c,
      ),
    }));
    return row.id;
  },

  updateCharacterVariant: (id, patch) => {
    db.updateCharacterVariant(id, patch);
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

  deleteCharacterVariant: (id) => {
    db.deleteCharacterVariant(id);
    set((state) => ({
      characters: state.characters.map((c) => {
        if (!c.variants) return c;
        return { ...c, variants: c.variants.filter((v) => v.id !== id) };
      }),
    }));
  },

  reorderCharacterVariants: (characterId, orderedIds) => {
    db.reorderCharacterVariants(characterId, orderedIds);
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
  createOutline: (storyId, content) => {
    const row = db.createOutline({
      story_id: storyId,
      content: content || '',
    });
    set((state) => ({
      outlines: [...state.outlines, row].sort((a, b) => a.order_index - b.order_index),
    }));
    return row.id;
  },

  // —— 人物关系 ——
  loadRelations: (storyId) => {
    set({ relations: db.listCharacterRelations(storyId).map(rowToRelation) });
  },
  createRelation: (data) => {
    const row = db.createCharacterRelation({
      story_id: data.story_id,
      source_id: data.source_id,
      target_id: data.target_id,
      relation: data.relation?.trim() || '未知',
      note: data.note,
    });
    set((state) => ({ relations: [...state.relations, rowToRelation(row)] }));
    return row.id;
  },
  updateRelation: (id, patch) => {
    db.updateCharacterRelation(id, patch);
    set((state) => ({
      relations: state.relations.map((r) =>
        r.id === id ? { ...r, ...patch, updated_at: new Date().toISOString() } : r,
      ),
    }));
  },
  deleteRelation: (id) => {
    db.deleteCharacterRelation(id);
    set((state) => ({ relations: state.relations.filter((r) => r.id !== id) }));
  },

  updateOutline: (id, patch) => {
    db.updateOutline(id, patch);
    set((state) => ({
      outlines: state.outlines.map((o) =>
        o.id === id ? { ...o, ...patch } : o,
      ),
    }));
  },

  deleteOutline: (id) => {
    db.deleteOutline(id);
    set((state) => ({
      outlines: state.outlines.filter((o) => o.id !== id),
    }));
  },

  reorderOutlines: (orderedIds) => {
    orderedIds.forEach((id, i) => {
      db.updateOutline(id, { order_index: i });
    });
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
  loadTemplates: () => {
    const worldSettingTemplates = db.listWorldSettingTemplates();
    const characterTemplates = db.listCharacterTemplates();
    set({ worldSettingTemplates, characterTemplates });
  },
  clearTemplates: () =>
    set({ worldSettingTemplates: [], characterTemplates: [] }),

  // 世界观模板
  createWorldSettingTemplate: (data) => {
    const row = db.createWorldSettingTemplate({
      title: data.title?.trim() || '未命名模板',
      content: data.content || '',
    });
    set((state) => ({
      worldSettingTemplates: [row, ...state.worldSettingTemplates],
    }));
    return row.id;
  },
  updateWorldSettingTemplate: (id, patch) => {
    db.updateWorldSettingTemplate(id, patch);
    set((state) => ({
      worldSettingTemplates: state.worldSettingTemplates.map((t) =>
        t.id === id ? { ...t, ...patch, updated_at: new Date().toISOString() } : t,
      ),
    }));
  },
  deleteWorldSettingTemplate: (id) => {
    db.deleteWorldSettingTemplate(id);
    set((state) => ({
      worldSettingTemplates: state.worldSettingTemplates.filter((t) => t.id !== id),
    }));
  },

  // 人物模板
  createCharacterTemplate: (data) => {
    const row = db.createCharacterTemplate({
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
  updateCharacterTemplate: (id, patch) => {
    db.updateCharacterTemplate(id, patch);
    set((state) => ({
      characterTemplates: state.characterTemplates.map((t) =>
        t.id === id ? { ...t, ...patch, updated_at: new Date().toISOString() } : t,
      ),
    }));
  },
  deleteCharacterTemplate: (id) => {
    db.deleteCharacterTemplate(id);
    set((state) => ({
      characterTemplates: state.characterTemplates.filter((t) => t.id !== id),
    }));
  },
}));

// ============================================================
// 工具：占位符替换（给编辑器"插入角色" & 导出器使用）
// ============================================================

/** 文本中的角色占位符：{{角色名}} */
export const CHARACTER_PLACEHOLDER_RE = /\{\{([^{}]+?)\}\}/g;

/** 给某角色名生成一个占位符字符串 */
export function makeCharacterPlaceholder(name: string): string {
  return `{{${name}}}`;
}


/** 在文本中查找全部占位符中的角色名 */
export function extractCharacterNames(text: string): string[] {
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(CHARACTER_PLACEHOLDER_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    names.add(m[1].trim());
  }
  return Array.from(names);
}

/** 默认角色颜色循环（NGA 风格） */
export const DEFAULT_CHARACTER_COLORS: string[] = [
  'red',
  'blue',
  'green',
  'orange',
  'purple',
  'skyblue',
  'pink',
  'yellow',
];

/** 把一段文本中的 {{角色名}} 替换为带颜色的 NGA 标签 [color=xxx]角色名[/color] */
export function replaceCharacterPlaceholders(
  text: string,
  characters: Character[],
): string {
  const nameToColor: Record<string, string> = {};
  characters.forEach((c, i) => {
    nameToColor[c.name] = DEFAULT_CHARACTER_COLORS[i % DEFAULT_CHARACTER_COLORS.length];
  });
  return text.replace(CHARACTER_PLACEHOLDER_RE, (_, name: string) => {
    const trimmed = name.trim();
    const color = nameToColor[trimmed] ?? DEFAULT_CHARACTER_COLORS[0];
    return `[color=${color}]${trimmed}[/color]`;
  });
}
