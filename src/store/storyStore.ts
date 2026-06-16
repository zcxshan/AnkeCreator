// ============================================================
// 故事状态管理 - storyStore
//
// 负责：
//  - 加载/缓存当前故事的所有关联数据（章节/节/块）
//  - 故事 CRUD
//  - 章/节 CRUD 与重排
//  - 当前选中的章/节
//
// 所有数据变更都会同步到 database。
// ============================================================

import { create } from 'zustand';
import type { Story, Volume, Chapter, Section, AnyContentBlock, Outline, OutlinePayload, OutlineTargetType } from '../types';
import { parseOutlineContent, stringifyOutlinePayload } from '../types';
import * as db from '../db/database';

interface StoryState {
  stories: Story[];
  activeStoryId: string | null;

  volumes: Volume[];
  chapters: Chapter[];
  sections: Section[];

  activeChapterId: string | null;
  activeSectionId: string | null;

  // ---------- Outline ----------
  outlines: Outline[];
  activeOutlineId: string | null;

  expandedVolumeIds: Record<string, boolean>;
  expandedChapterIds: Record<string, boolean>;

  loadStories: () => void;
  createStory: (title: string, description?: string, category?: string) => string;
  renameStory: (id: string, title: string) => void;
  updateStoryDescription: (id: string, description: string) => void;
  updateStoryCategory: (id: string, category: string) => void;
  deleteStory: (id: string) => void;
  setStoryOrder: (id: string, order_index: number) => void;
  toggleStarred: (id: string) => void;
  togglePinned: (id: string) => void;
  setActiveStory: (id: string | null) => void;

  createVolume: (storyId: string, title: string) => string;
  renameVolume: (volumeId: string, title: string) => void;
  deleteVolume: (volumeId: string) => void;
  toggleVolume: (volumeId: string) => void;
  reorderVolumes: (orderedIds: string[]) => void;

  createChapter: (storyId: string, title: string, volumeId?: string | null) => string;
  renameChapter: (chapterId: string, title: string) => void;
  deleteChapter: (chapterId: string) => void;
  toggleChapter: (chapterId: string) => void;
  setActiveChapter: (id: string | null) => void;
  reorderChapters: (orderedIds: string[]) => void;

  createSection: (chapterId: string, title: string) => string;
  renameSection: (sectionId: string, title: string) => void;
  deleteSection: (sectionId: string) => void;
  setActiveSection: (id: string) => void;
  reorderSections: (chapterId: string, orderedIds: string[]) => void;

  // ---------- Outline 操作 ----------
  loadOutlines: (storyId: string) => void;
  createOutline: (payload: {
    title: string;
    target_type: OutlineTargetType;
    target_id: string;
    parent_outline_id?: string | null;
    body?: string;
  }) => string;
  updateOutline: (id: string, patch: Partial<OutlinePayload>) => void;
  renameOutline: (id: string, title: string) => void;
  deleteOutline: (id: string) => void;
  setActiveOutline: (id: string | null) => void;
  getOrCreateVolumeOutline: (volumeId: string, volumeTitle: string) => string;
  getOrCreateChapterOutline: (chapterId: string, chapterTitle: string) => string;
  /** 在大纲侧独立创建卷（不依赖目录结构） */
  createOutlineVolume: (title: string) => string;
  /** 在大纲侧独立创建章（属于某个大纲卷） */
  createOutlineChapter: (parentOutlineId: string, title: string) => string;
}

// 加载指定故事的卷/章节/节/大纲数据
function loadStoryData(set: (patch: Partial<StoryState>) => void, storyId: string) {
  const volumes = db.listVolumes(storyId);
  const chapters = db.listChapters(storyId);
  const sections: Section[] = chapters.flatMap((ch) => db.listSections(ch.id));
  const outlines = db.listOutlines(storyId);
  const expandedVolumes: Record<string, boolean> = {};
  const expandedChapters: Record<string, boolean> = {};
  volumes.forEach((v) => (expandedVolumes[v.id] = true));
  chapters.forEach((ch) => (expandedChapters[ch.id] = true));
  set({
    volumes,
    chapters,
    sections,
    outlines,
    expandedVolumeIds: expandedVolumes,
    expandedChapterIds: expandedChapters,
    activeChapterId: chapters.length > 0 ? chapters[0].id : null,
    activeSectionId: sections.length > 0 ? sections[0].id : null,
    activeOutlineId: outlines.length > 0 ? outlines[0].id : null,
  });
}

export const useStoryStore = create<StoryState>((set, get) => ({
  stories: [],
  activeStoryId: null,
  volumes: [],
  chapters: [],
  sections: [],
  activeChapterId: null,
  activeSectionId: null,
  outlines: [],
  activeOutlineId: null,
  expandedVolumeIds: {},
  expandedChapterIds: {},

  loadStories: () => {
    const stories = db.listStories();
    set({ stories });
    if (stories.length > 0 && !get().activeStoryId) {
      const first = stories[0];
      set({ activeStoryId: first.id });
      loadStoryData(set, first.id);
    }
  },

  createStory: (title, description, category) => {
    const story = db.createStory({ title, description: description || '', category: category || '' });
    set((state) => ({
      stories: [...state.stories, story],
      activeStoryId: story.id,
      chapters: [],
      sections: [],
      activeChapterId: null,
      activeSectionId: null,
      expandedChapterIds: {},
    }));
    return story.id;
  },

  renameStory: (id, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    db.updateStory(id, { title: trimmed });
    set((state) => ({
      stories: state.stories.map((s) => (s.id === id ? { ...s, title: trimmed } : s)),
    }));
  },

  updateStoryDescription: (id, description) => {
    db.updateStory(id, { description });
    set((state) => ({
      stories: state.stories.map((s) => (s.id === id ? { ...s, description } : s)),
    }));
  },

  updateStoryCategory: (id, category) => {
    const trimmed = (category || '').trim();
    db.updateStory(id, { category: trimmed });
    set((state) => ({
      stories: state.stories.map((s) => (s.id === id ? { ...s, category: trimmed } : s)),
    }));
  },

  setStoryOrder: (id, order_index) => {
    db.updateStory(id, { order_index });
    set((state) => ({
      stories: state.stories.map((s) => (s.id === id ? { ...s, order_index } : s)),
    }));
  },

  toggleStarred: (id) => {
    const current = get().stories.find((s) => s.id === id);
    const next = !(current?.is_starred ?? false);
    db.updateStory(id, { is_starred: next });
    set((state) => ({
      stories: state.stories.map((s) => (s.id === id ? { ...s, is_starred: next } : s)),
    }));
  },

  togglePinned: (id) => {
    const current = get().stories.find((s) => s.id === id);
    const next = !(current?.is_pinned ?? false);
    db.updateStory(id, { is_pinned: next });
    set((state) => ({
      stories: state.stories.map((s) => (s.id === id ? { ...s, is_pinned: next } : s)),
    }));
  },

  deleteStory: (id) => {
    db.deleteStory(id);
    set((state) => {
      const remaining = state.stories.filter((s) => s.id !== id);
      const nextActive =
        state.activeStoryId === id
          ? remaining.length > 0
            ? remaining[0].id
            : null
          : state.activeStoryId;
      const next: Partial<StoryState> = {
        stories: remaining,
        activeStoryId: nextActive,
      };
      if (state.activeStoryId === id) {
        next.chapters = [];
        next.sections = [];
        next.activeChapterId = null;
        next.activeSectionId = null;
      }
      return next;
    });
  },

  setActiveStory: (id) => {
    if (!id) {
      set({
        activeStoryId: null,
        chapters: [],
        sections: [],
        activeChapterId: null,
        activeSectionId: null,
      });
      return;
    }
    set({ activeStoryId: id });
    loadStoryData(set, id);
  },

  createVolume: (storyId, title) => {
    const v = db.createVolume({ story_id: storyId, title });
    set((state) => ({
      volumes: [...state.volumes, v].sort((a, b) => a.order_index - b.order_index),
      expandedVolumeIds: { ...state.expandedVolumeIds, [v.id]: true },
    }));
    return v.id;
  },

  renameVolume: (volumeId, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    db.updateVolume(volumeId, { title: trimmed });
    set((state) => ({
      volumes: state.volumes.map((v) =>
        v.id === volumeId ? { ...v, title: trimmed } : v,
      ),
    }));
  },

  reorderVolumes: (orderedIds) => {
    const storyId = get().activeStoryId;
    if (!storyId) return;
    db.reorderVolumes(storyId, orderedIds);
    set((state) => {
      const orderMap: Record<string, number> = {};
      orderedIds.forEach((id, i) => (orderMap[id] = i));
      return {
        volumes: state.volumes
          .slice()
          .sort((a, b) => (orderMap[a.id] ?? 0) - (orderMap[b.id] ?? 0))
          .map((v, i) => ({ ...v, order_index: i })),
      };
    });
  },

  deleteVolume: (volumeId) => {
    db.deleteVolume(volumeId);
    set((state) => {
      const newVolumes = state.volumes.filter((v) => v.id !== volumeId);
      // 获取该卷下所有章节的 ID
      const deletedChapterIds = state.chapters
        .filter((c) => c.volume_id === volumeId)
        .map((c) => c.id);
      const newChapters = state.chapters.filter((c) => c.volume_id !== volumeId);
      const newSections = state.sections.filter(
        (s) => !deletedChapterIds.includes(s.chapter_id),
      );
      const newActiveChapter =
        state.activeChapterId && deletedChapterIds.includes(state.activeChapterId)
          ? newChapters.length > 0
            ? newChapters[0].id
            : null
          : state.activeChapterId;
      const newActiveSection =
        state.activeSectionId &&
        state.sections.find(
          (s) => s.id === state.activeSectionId && deletedChapterIds.includes(s.chapter_id),
        )
          ? newSections.length > 0
            ? newSections[0].id
            : null
          : state.activeSectionId;
      return {
        volumes: newVolumes,
        chapters: newChapters,
        sections: newSections,
        activeChapterId: newActiveChapter,
        activeSectionId: newActiveSection,
      };
    });
  },

  toggleVolume: (volumeId) => {
    set((state) => ({
      expandedVolumeIds: {
        ...state.expandedVolumeIds,
        [volumeId]: !state.expandedVolumeIds[volumeId],
      },
    }));
  },

  createChapter: (storyId, title, volumeId = null) => {
    const ch = db.createChapter({ story_id: storyId, title, volume_id: volumeId ?? null });
    set((state) => ({
      chapters: [...state.chapters, ch].sort((a, b) => a.order_index - b.order_index),
      activeChapterId: ch.id,
      expandedChapterIds: { ...state.expandedChapterIds, [ch.id]: true },
    }));
    return ch.id;
  },

  renameChapter: (chapterId, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    db.updateChapter(chapterId, { title: trimmed });
    set((state) => ({
      chapters: state.chapters.map((c) =>
        c.id === chapterId ? { ...c, title: trimmed } : c,
      ),
    }));
  },

  reorderChapters: (orderedIds) => {
    const storyId = get().activeStoryId;
    if (!storyId) return;
    db.reorderChapters(storyId, orderedIds);
    set((state) => {
      const orderMap: Record<string, number> = {};
      orderedIds.forEach((id, i) => (orderMap[id] = i));
      return {
        chapters: state.chapters
          .slice()
          .sort((a, b) => (orderMap[a.id] ?? 0) - (orderMap[b.id] ?? 0))
          .map((c, i) => ({ ...c, order_index: i })),
      };
    });
  },

  deleteChapter: (chapterId) => {
    db.deleteChapter(chapterId);
    set((state) => {
      const newChapters = state.chapters.filter((c) => c.id !== chapterId);
      const newSections = state.sections.filter((s) => s.chapter_id !== chapterId);
      const newActiveChapter =
        state.activeChapterId === chapterId
          ? newChapters.length > 0
            ? newChapters[0].id
            : null
          : state.activeChapterId;
      const newActiveSection =
        state.activeSectionId &&
        state.sections.find((s) => s.id === state.activeSectionId && s.chapter_id === chapterId)
          ? newSections.length > 0
            ? newSections[0].id
            : null
          : state.activeSectionId;
      return {
        chapters: newChapters,
        sections: newSections,
        activeChapterId: newActiveChapter,
        activeSectionId: newActiveSection,
      };
    });
  },

  toggleChapter: (chapterId) => {
    set((state) => ({
      expandedChapterIds: {
        ...state.expandedChapterIds,
        [chapterId]: !state.expandedChapterIds[chapterId],
      },
    }));
  },

  setActiveChapter: (id) => set({ activeChapterId: id }),

  createSection: (chapterId, title) => {
    const sec = db.createSection({ chapter_id: chapterId, title });
    set((state) => ({
      sections: [...state.sections, sec].sort((a, b) => a.order_index - b.order_index),
      activeChapterId: chapterId,
      activeSectionId: sec.id,
    }));
    return sec.id;
  },

  renameSection: (sectionId, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    db.updateSection(sectionId, { title: trimmed });
    set((state) => ({
      sections: state.sections.map((s) =>
        s.id === sectionId ? { ...s, title: trimmed } : s,
      ),
    }));
  },

  reorderSections: (chapterId, orderedIds) => {
    db.reorderSections(chapterId, orderedIds);
    set((state) => {
      const orderMap: Record<string, number> = {};
      orderedIds.forEach((id, i) => (orderMap[id] = i));
      return {
        sections: state.sections
          .slice()
          .sort((a, b) => {
            const ai = orderMap[a.id];
            const bi = orderMap[b.id];
            if (ai !== undefined && bi !== undefined) return ai - bi;
            if (ai !== undefined) return -1;
            if (bi !== undefined) return 1;
            return a.order_index - b.order_index;
          })
          .map((s) => ({
            ...s,
            order_index: orderMap[s.id] ?? s.order_index,
          })),
      };
    });
  },

  deleteSection: (sectionId) => {
    db.deleteSection(sectionId);
    set((state) => {
      const newSections = state.sections.filter((s) => s.id !== sectionId);
      const newActive =
        state.activeSectionId === sectionId
          ? newSections.length > 0
            ? newSections[0].id
            : null
          : state.activeSectionId;
      return { sections: newSections, activeSectionId: newActive };
    });
  },

  setActiveSection: (id) => {
    const state = get();
    const sec = state.sections.find((s) => s.id === id);
    set({ activeSectionId: id, activeChapterId: sec ? sec.chapter_id : state.activeChapterId });
  },

  // ---------- Outline 操作实现 ----------
  loadOutlines: (storyId) => {
    const rows = db.listOutlines(storyId);
    set({ outlines: rows, activeOutlineId: rows.length > 0 ? rows[0].id : null });
  },

  createOutline: ({ title, target_type, target_id, parent_outline_id, body }) => {
    const storyId = get().activeStoryId;
    if (!storyId) return '';
    const payload: OutlinePayload = {
      title,
      target_type,
      target_id,
      parent_outline_id: parent_outline_id ?? null,
      body: body ?? '',
    };
    const row = db.createOutline({
      story_id: storyId,
      content: stringifyOutlinePayload(payload),
    });
    set((state) => ({
      outlines: [...state.outlines, row].sort((a, b) => a.order_index - b.order_index),
      activeOutlineId: row.id,
    }));
    return row.id;
  },

  updateOutline: (id, patch) => {
    const state = get();
    const row = state.outlines.find((o) => o.id === id);
    if (!row) return;
    const existing: OutlinePayload = parseOutlineContent(row.content);
    const next: OutlinePayload = {
      title: patch.title !== undefined ? patch.title : existing.title,
      target_type: patch.target_type !== undefined ? patch.target_type : existing.target_type,
      target_id: patch.target_id !== undefined ? patch.target_id : existing.target_id,
      parent_outline_id:
        patch.parent_outline_id !== undefined
          ? patch.parent_outline_id
          : existing.parent_outline_id,
      body: patch.body !== undefined ? patch.body : existing.body,
    };
    db.updateOutline(id, { content: stringifyOutlinePayload(next) });
    set((s) => ({
      outlines: s.outlines.map((o) =>
        o.id === id
          ? {
              ...o,
              content: stringifyOutlinePayload(next),
              updated_at: new Date().toISOString(),
            }
          : o,
      ),
    }));
  },

  renameOutline: (id, title) => {
    get().updateOutline(id, { title });
  },

  deleteOutline: (id) => {
    db.deleteOutline(id);
    set((state) => {
      const remaining = state.outlines.filter((o) => o.id !== id);
      const nextActive =
        state.activeOutlineId === id
          ? remaining.length > 0
            ? remaining[0].id
            : null
          : state.activeOutlineId;
      return { outlines: remaining, activeOutlineId: nextActive };
    });
  },

  setActiveOutline: (id) => set({ activeOutlineId: id }),

  getOrCreateVolumeOutline: (volumeId, volumeTitle) => {
    const state = get();
    const found = state.outlines.find((o) => {
      const p: OutlinePayload = parseOutlineContent(o.content);
      return p.target_type === 'volume' && p.target_id === volumeId;
    });
    if (found) {
      set({ activeOutlineId: found.id });
      return found.id;
    }
    return get().createOutline({
      title: `${volumeTitle} · 卷纲`,
      target_type: 'volume',
      target_id: volumeId,
      body: '',
    });
  },

  getOrCreateChapterOutline: (chapterId, chapterTitle) => {
    const state = get();
    const found = state.outlines.find((o) => {
      const p: OutlinePayload = parseOutlineContent(o.content);
      return p.target_type === 'chapter' && p.target_id === chapterId;
    });
    if (found) {
      set({ activeOutlineId: found.id });
      return found.id;
    }
    return get().createOutline({
      title: `${chapterTitle} · 章纲`,
      target_type: 'chapter',
      target_id: chapterId,
      parent_outline_id: null,
      body: '',
    });
  },

  createOutlineVolume: (title) => {
    const storyId = get().activeStoryId;
    if (!storyId) return '';
    const payload: OutlinePayload = {
      title,
      target_type: 'volume',
      target_id: '',
      parent_outline_id: null,
      body: '',
    };
    const row = db.createOutline({
      story_id: storyId,
      content: stringifyOutlinePayload(payload),
    });
    set((state) => ({
      outlines: [...state.outlines, row].sort((a, b) => a.order_index - b.order_index),
      activeOutlineId: row.id,
    }));
    return row.id;
  },

  createOutlineChapter: (parentOutlineId, title) => {
    const storyId = get().activeStoryId;
    if (!storyId) return '';
    const payload: OutlinePayload = {
      title,
      target_type: 'chapter',
      target_id: '',
      parent_outline_id: parentOutlineId,
      body: '',
    };
    const row = db.createOutline({
      story_id: storyId,
      content: stringifyOutlinePayload(payload),
    });
    set((state) => ({
      outlines: [...state.outlines, row].sort((a, b) => a.order_index - b.order_index),
      activeOutlineId: row.id,
    }));
    return row.id;
  },
}));

// 启动时自动加载故事列表
useStoryStore.getState().loadStories();

// ============================================================
// 工具: 选择器
// ============================================================
export function selectChapterTree(chapters: Chapter[], sections: Section[]) {
  return chapters
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
    .map((ch) => ({
      ...ch,
      sections: sections
        .filter((s) => s.chapter_id === ch.id)
        .sort((a, b) => a.order_index - b.order_index)
        .map((sec) => ({ ...sec, blocks: [] as AnyContentBlock[] })),
    }));
}

export function selectSectionsOfChapter(sections: Section[], chapterId: string) {
  return sections
    .filter((s) => s.chapter_id === chapterId)
    .sort((a, b) => a.order_index - b.order_index);
}
