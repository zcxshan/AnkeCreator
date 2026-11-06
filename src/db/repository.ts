// ============================================================
// 统一仓储接口与三后端适配器
//
// Electron（window.dbAPI）、浏览器 IndexedDB（BROWSER_DB）、内存
// 三种数据后端都通过 StoryRepository 暴露同一套读写语义，
// 便于 UI / 导入导出逻辑只依赖抽象接口，并用一致性测试验证。
// ============================================================

import type { Story, StoryWithAll, Volume, Chapter, Section, SectionMeta } from '../types/story'
import type {
  Character,
  CharacterRelation,
  Outline,
} from '../types'
import { BROWSER_DB } from './browserIndexedDB'

export interface StructureInput {
  volumes: Volume[]
  chapters: Chapter[]
  sections: Section[]
}

export interface WorldInput {
  relations: CharacterRelation[]
  outlines: Outline[]
}

export interface StoryRepository {
  getStoryWithAll(storyId: string): Promise<StoryWithAll | undefined>
  createStory(data: Partial<Story> & { title: string }): Promise<Story>
  saveStoryMeta(storyId: string, patch: Partial<Story>): Promise<Story | undefined>
  saveStructure(storyId: string, input: StructureInput): Promise<void>
  saveWorld(storyId: string, input: WorldInput): Promise<void>
  saveCharacters(storyId: string, characters: Character[]): Promise<void>
  getSectionContent(sectionId: string): Promise<string | null>
  saveSectionContent(sectionId: string, html: string, bbcode?: string | null): Promise<void>
  listSectionMetadata(chapterId: string): Promise<SectionMeta[]>
  listStoriesWithStats(): Promise<Array<Story & { stats: { word_count: number } }>>
}

type DbApi = NonNullable<Window['dbAPI']>

// 聚合读取的兼容形状：Electron 同时返回顶层 sections / character_relations，
// 浏览器后端只把 sections 挂在 chapters 下，这里统一补齐。
type Aggregate = StoryWithAll & {
  sections?: Section[]
  character_relations?: CharacterRelation[]
}

function normalizeStoryWithAll(full: Aggregate | undefined): Aggregate | undefined {
  if (!full) return undefined
  const flatSections = full.sections ?? full.chapters.flatMap((chapter) => chapter.sections ?? [])
  const chapters = full.chapters.map((chapter) => ({
    ...chapter,
    sections: chapter.sections && chapter.sections.length > 0
      ? chapter.sections
      : flatSections.filter((section) => section.chapter_id === chapter.id),
  }))
  return { ...full, chapters } as StoryWithAll
}

function aggregateSections(full: Aggregate): Section[] {
  return full.sections ?? full.chapters.flatMap((chapter) => chapter.sections ?? [])
}

function toRow(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>
}

interface StructureApi {
  createVolume(data: Record<string, unknown>): Promise<{ id: string }>
  updateVolume(id: string, data: Record<string, unknown>): Promise<unknown>
  deleteVolume(id: string): Promise<unknown>
  createChapter(data: Record<string, unknown>): Promise<{ id: string }>
  updateChapter(id: string, data: Record<string, unknown>): Promise<unknown>
  deleteChapter(id: string): Promise<unknown>
  createSection(data: Record<string, unknown>): Promise<{ id: string }>
  updateSection(id: string, data: Record<string, unknown>): Promise<unknown>
  deleteSection(id: string): Promise<unknown>
}

/**
 * 结构整体保存。Electron / IndexedDB 后端的 create* 会自行生成 row id，
 * 因此新建行时要把父级 id 映射到后端真实 id，避免章的 volume_id、
 * 节的 chapter_id 指向调用方临时 id 而断链。
 */
async function applyStructure(
  api: StructureApi,
  existing: StructureInput,
  input: StructureInput,
): Promise<void> {
  const volumeIds = new Map<string, string>()
  const keptVolumes = new Set(input.volumes.map((row) => row.id))
  for (const row of input.volumes) {
    if (existing.volumes.some((item) => item.id === row.id)) await api.updateVolume(row.id, toRow(row))
    else {
      const created = await api.createVolume(toRow(row))
      volumeIds.set(row.id, created.id)
    }
  }
  for (const row of existing.volumes) {
    if (!keptVolumes.has(row.id)) await api.deleteVolume(row.id)
  }

  const chapterIds = new Map<string, string>()
  const keptChapters = new Set(input.chapters.map((row) => row.id))
  for (const row of input.chapters) {
    const data = {
      ...row,
      volume_id: row.volume_id ? volumeIds.get(row.volume_id) ?? row.volume_id : null,
    }
    if (existing.chapters.some((item) => item.id === row.id)) await api.updateChapter(row.id, toRow(data))
    else {
      const created = await api.createChapter(toRow(data))
      chapterIds.set(row.id, created.id)
    }
  }
  for (const row of existing.chapters) {
    if (!keptChapters.has(row.id)) await api.deleteChapter(row.id)
  }

  const keptSections = new Set(input.sections.map((row) => row.id))
  for (const row of input.sections) {
    const data = { ...row, chapter_id: chapterIds.get(row.chapter_id) ?? row.chapter_id }
    if (existing.sections.some((item) => item.id === row.id)) await api.updateSection(row.id, toRow(data))
    else await api.createSection(toRow(data))
  }
  for (const row of existing.sections) {
    if (!keptSections.has(row.id)) await api.deleteSection(row.id)
  }
}

async function syncRows<T extends { id: string }>(
  rows: T[],
  existing: T[],
  create: (row: T) => Promise<unknown>,
  update: (id: string, row: T) => Promise<unknown>,
  remove: (id: string) => Promise<unknown>,
): Promise<void> {
  const keep = new Set(rows.map((row) => row.id))
  for (const row of rows) {
    if (existing.some((item) => item.id === row.id)) await update(row.id, row)
    else await create(row)
  }
  for (const row of existing) {
    if (!keep.has(row.id)) await remove(row.id)
  }
}

export function createElectronRepository(api: DbApi): StoryRepository {
  const readAll = async (storyId: string) => normalizeStoryWithAll(await api.getStoryWithAll(storyId))
  const structureApi: StructureApi = {
    createVolume: (data) => api.createVolume(data),
    updateVolume: (id, data) => api.updateVolume(id, data),
    deleteVolume: (id) => api.deleteVolume(id),
    createChapter: (data) => api.createChapter(data),
    updateChapter: (id, data) => api.updateChapter(id, data),
    deleteChapter: (id) => api.deleteChapter(id),
    createSection: (data) => api.createSection(data),
    updateSection: (id, data) => api.updateSection(id, data),
    deleteSection: (id) => api.deleteSection(id),
  }
  return {
    getStoryWithAll: (storyId) => readAll(storyId),
    createStory: (data) => api.createStory(data as Record<string, unknown>),
    saveStoryMeta: (storyId, patch) => api.updateStory(storyId, patch),
    async saveStructure(storyId, input) {
      const current = await readAll(storyId)
      if (!current) throw new Error(`作品不存在：${storyId}`)
      await applyStructure(structureApi, {
        volumes: current.volumes,
        chapters: current.chapters,
        sections: aggregateSections(current),
      }, input)
    },
    async saveWorld(storyId, input) {
      const current = await readAll(storyId)
      if (!current) throw new Error(`作品不存在：${storyId}`)
      const relations = current.character_relations ?? []
      await syncRows(input.relations, relations, (row) => api.createCharacterRelation(row), (id, row) => api.updateCharacterRelation(id, row), (id) => api.deleteCharacterRelation(id))
      await syncRows(input.outlines, current.outlines, (row) => api.createOutline(row), (id, row) => api.updateOutline(id, row), (id) => api.deleteOutline(id))
    },
    async saveCharacters(storyId, characters) {
      const current = await readAll(storyId)
      if (!current) throw new Error(`作品不存在：${storyId}`)
      await syncRows(characters, current.characters, (row) => api.createCharacter(row), (id, row) => api.updateCharacter(id, row), (id) => api.deleteCharacter(id))
    },
    getSectionContent: (sectionId) => api.getSectionContent(sectionId),
    async saveSectionContent(sectionId, html, bbcode) {
      await api.setSectionContent(sectionId, html, bbcode ?? null)
    },
    listSectionMetadata: (chapterId) => api.listSectionMetadata(chapterId),
    listStoriesWithStats: () => api.listStoriesWithStats(),
  }
}

export function createBrowserRepository(db: typeof BROWSER_DB = BROWSER_DB): StoryRepository {
  const readAll = async (storyId: string) =>
    normalizeStoryWithAll((await db.getStoryWithAll(storyId)) as Aggregate | undefined)
  const structureApi: StructureApi = {
    createVolume: (data) => db.createVolume(data),
    updateVolume: (id, data) => db.updateVolume(id, data),
    deleteVolume: (id) => db.deleteVolume(id),
    createChapter: (data) => db.createChapter(data),
    updateChapter: (id, data) => db.updateChapter(id, data),
    deleteChapter: (id) => db.deleteChapter(id),
    createSection: (data) => db.createSection(data),
    updateSection: (id, data) => db.updateSection(id, data),
    deleteSection: (id) => db.deleteSection(id),
  }
  return {
    getStoryWithAll: (storyId) => readAll(storyId),
    createStory: (data) => db.createStory(data),
    saveStoryMeta: (storyId, patch) => db.updateStory(storyId, toRow(patch)),
    async saveStructure(storyId, input) {
      const current = await readAll(storyId)
      if (!current) throw new Error(`作品不存在：${storyId}`)
      await applyStructure(structureApi, {
        volumes: current.volumes,
        chapters: current.chapters,
        sections: aggregateSections(current),
      }, input)
    },
    async saveWorld(storyId, input) {
      const current = await readAll(storyId)
      if (!current) throw new Error(`作品不存在：${storyId}`)
      const relations = current.character_relations ?? []
      await syncRows(input.relations, relations, (row) => db.createCharacterRelation(toRow(row)), (id, row) => db.updateCharacterRelation(id, toRow(row)), (id) => db.deleteCharacterRelation(id))
      await syncRows(input.outlines, current.outlines, (row) => db.createOutline(toRow(row)), (id, row) => db.updateOutline(id, toRow(row)), (id) => db.deleteOutline(id))
    },
    async saveCharacters(storyId, characters) {
      const current = await readAll(storyId)
      if (!current) throw new Error(`作品不存在：${storyId}`)
      await syncRows(characters, current.characters, (row) => db.createCharacter(toRow(row)), (id, row) => db.updateCharacter(id, toRow(row)), (id) => db.deleteCharacter(id))
    },
    getSectionContent: async (sectionId) => db.getSectionContent(sectionId),
    async saveSectionContent(sectionId, html, bbcode) {
      await db.setSectionContent(sectionId, html, bbcode ?? null)
    },
    listSectionMetadata: (chapterId) => db.listSectionMetadata(chapterId),
    async listStoriesWithStats() {
      const stories = await db.listStories()
      return stories.map((story) => ({
        ...story,
        stats: { word_count: (story as Story & { word_count?: number }).word_count ?? 0 },
      }))
    },
  }
}

export function createMemoryRepository(): StoryRepository {
  type StoredStory = Story & { stats: { word_count: number } }
  const state = {
    stories: [] as StoredStory[],
    volumes: [] as Volume[],
    chapters: [] as Chapter[],
    sections: [] as Section[],
    characters: [] as Character[],
    relations: [] as CharacterRelation[],
    outlines: [] as Outline[],
    contents: new Map<string, string>(),
  }
  const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  return {
    async getStoryWithAll(storyId) {
      const story = state.stories.find((item) => item.id === storyId)
      if (!story) return undefined
      const chapters = state.chapters
        .filter((chapter) => chapter.story_id === storyId)
        .map((chapter) => ({
          ...chapter,
          sections: state.sections
            .filter((section) => section.chapter_id === chapter.id)
            .map((section) => ({ ...section, content: state.contents.get(section.id) ?? section.content })),
        }))
      return {
        ...story,
        volumes: state.volumes.filter((volume) => volume.story_id === storyId),
        chapters,
        characters: state.characters.filter((row) => row.story_id === storyId),
        outlines: state.outlines.filter((row) => row.story_id === storyId),
      } as StoryWithAll
    },
    async createStory(data) {
      const row = { id: id('story'), word_count: 0, ...data } as Story
      state.stories.push({ ...row, stats: { word_count: 0 } })
      return row
    },
    async saveStoryMeta(storyId, patch) {
      const row = state.stories.find((item) => item.id === storyId)
      if (!row) return undefined
      Object.assign(row, patch)
      return row
    },
    async saveStructure(storyId, input) {
      state.volumes = state.volumes.filter((row) => row.story_id !== storyId).concat(input.volumes)
      state.chapters = state.chapters.filter((row) => row.story_id !== storyId).concat(input.chapters)
      const chapterIds = input.chapters.map((row) => row.id)
      state.sections = state.sections.filter((row) => !chapterIds.includes(row.chapter_id)).concat(input.sections)
    },
    async saveWorld(storyId, input) {
      state.relations = state.relations.filter((row) => row.story_id !== storyId).concat(input.relations)
      state.outlines = state.outlines.filter((row) => row.story_id !== storyId).concat(input.outlines)
    },
    async saveCharacters(storyId, characters) {
      state.characters = state.characters.filter((row) => row.story_id !== storyId).concat(characters)
    },
    async getSectionContent(sectionId) {
      return state.contents.get(sectionId) ?? null
    },
    async saveSectionContent(sectionId, html) {
      state.contents.set(sectionId, html)
    },
    async listSectionMetadata(chapterId) {
      return state.sections.filter((row) => row.chapter_id === chapterId)
    },
    async listStoriesWithStats() {
      return state.stories
    },
  }
}
