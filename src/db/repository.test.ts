import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { StoryRepository } from './repository'
import {
  createBrowserRepository,
  createElectronRepository,
  createMemoryRepository,
} from './repository'
import { BROWSER_DB } from './browserIndexedDB'

function makeFakeDbApi() {
  let seq = 0
  const nextId = (prefix: string) => `${prefix}-${++seq}`
  const stories = new Map<string, any>()
  const volumes = new Map<string, any>()
  const chapters = new Map<string, any>()
  const sections = new Map<string, any>()
  const contents = new Map<string, string>()
  const emptyStory = (id: string) => ({
    id,
    title: stories.get(id)?.title ?? '',
    volumes: [] as any[],
    chapters: [] as any[],
    sections: [] as any[],
    characters: [],
    character_relations: [],
    outlines: [],
    dice_history: [],
  })
  return {
    createStory: async (data: any) => {
      const row = { id: nextId('s'), word_count: 0, ...data }
      stories.set(row.id, row)
      return row
    },
    updateStory: async (id: string, patch: any) => {
      const row = stories.get(id)
      if (!row) return undefined
      Object.assign(row, patch)
      return row
    },
    getStoryWithAll: async (id: string) => {
      if (!stories.has(id)) return undefined
      return {
        ...emptyStory(id),
        volumes: [...volumes.values()].filter((v) => v.story_id === id),
        chapters: [...chapters.values()].filter((c) => c.story_id === id),
        sections: [...sections.values()].filter((s) => {
          const chapter = chapters.get(s.chapter_id)
          return chapter?.story_id === id
        }),
      }
    },
    listStoriesWithStats: async () => [...stories.values()].map((s) => ({ ...s, stats: { word_count: s.word_count } })),
    createVolume: async (data: any) => {
      const row = { id: nextId('v'), ...data }
      volumes.set(row.id, row)
      return row
    },
    updateVolume: async (id: string, patch: any) => {
      const row = volumes.get(id)
      if (!row) return undefined
      Object.assign(row, patch)
      return row
    },
    deleteVolume: async (id: string) => volumes.delete(id),
    createChapter: async (data: any) => {
      const row = { id: nextId('c'), ...data }
      chapters.set(row.id, row)
      return row
    },
    updateChapter: async (id: string, patch: any) => {
      const row = chapters.get(id)
      if (!row) return undefined
      Object.assign(row, patch)
      return row
    },
    deleteChapter: async (id: string) => chapters.delete(id),
    createSection: async (data: any) => {
      const row = { id: nextId('sec'), ...data }
      sections.set(row.id, row)
      return row
    },
    updateSection: async (id: string, patch: any) => {
      const row = sections.get(id)
      if (!row) return undefined
      Object.assign(row, patch)
      return row
    },
    deleteSection: async (id: string) => {
      contents.delete(id)
      return sections.delete(id)
    },
    listSectionMetadata: async (chapterId: string) => [...sections.values()]
      .filter((s) => s.chapter_id === chapterId)
      .map(({ content, bbcode, ...meta }) => meta),
    getSectionContent: async (id: string) => contents.get(id) ?? null,
    setSectionContent: async (id: string, content: string | null) => {
      contents.set(id, content ?? '')
    },
    createCharacter: async (data: any) => ({ id: nextId('ch'), ...data }),
    updateCharacter: async (_id: string, patch: any) => patch,
  }
}

const factories: Array<[string, () => StoryRepository]> = [
  ['electron', () => createElectronRepository(makeFakeDbApi() as never)],
  ['indexeddb', () => createBrowserRepository(BROWSER_DB as never)],
  ['memory', () => createMemoryRepository()],
]

describe.each(factories)('%s 仓储', (_name, factory) => {
  let repo: StoryRepository

  beforeEach(() => {
    repo = factory()
  })

  it('建作品、写结构、写正文后聚合读取一致', async () => {
    const story = await repo.createStory({ title: '一致性作品' })
    await repo.saveStructure(story.id, {
      volumes: [{ id: 'v1', story_id: story.id, title: '第一卷', order_index: 0 } as any],
      chapters: [{ id: 'c1', story_id: story.id, volume_id: 'v1', title: '第一章', order_index: 0 } as any],
      sections: [{ id: 'sec1', chapter_id: 'c1', title: '第1节', order_index: 0, content: null } as any],
    })
    await repo.saveWorld(story.id, { settings: [], relations: [], outlines: [] })
    await repo.saveCharacters(story.id, [])

    const full = await repo.getStoryWithAll(story.id)
    expect(full?.volumes.map((v) => v.title)).toEqual(['第一卷'])
    expect(full?.chapters.map((c) => c.title)).toEqual(['第一章'])

    // 浏览器后端会生成自己的 row id，因此正文读写使用聚合读到的真实节 id
    const chapter = full!.chapters[0]
    const sectionId = chapter.sections[0].id
    await repo.saveSectionContent(sectionId, '<p>正文</p>')

    const reread = await repo.getStoryWithAll(story.id)
    expect(reread?.chapters[0].sections.map((s) => s.id)).toEqual([sectionId])
    expect(await repo.getSectionContent(sectionId)).toBe('<p>正文</p>')
    expect((await repo.listSectionMetadata(chapter.id)).map((s) => s.id)).toEqual([sectionId])

    const listed = await repo.listStoriesWithStats()
    expect(listed.some((s) => s.id === story.id)).toBe(true)
  })
})
