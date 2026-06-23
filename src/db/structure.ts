// ============================================================
// 卷/章/节 facade（structure: volume + chapter + section）
// + 聚合查询 getStoryWithAll
// ============================================================

import type { Chapter, Section, StoryWithAll, Volume } from '../types'
import { BROWSER_DB, isBrowserDBAvailable } from './browserIndexedDB'
import {
  allSQL,
  autoOrder,
  deleteChapterMem,
  deleteSectionMem,
  doUpdate,
  getSQL,
  getStoryInMem,
  nowISO,
  runSQL,
  uuid4,
} from './shared'
import { listCharacters } from './character'

type NewChapter = Omit<Chapter, 'id' | 'created_at' | 'updated_at' | 'order_index'> & {
  order_index?: number
}

type NewVolume = Omit<Volume, 'id' | 'created_at' | 'updated_at' | 'order_index'> & {
  order_index?: number
}

type NewSection = Omit<Section, 'id' | 'created_at' | 'updated_at' | 'order_index'> & {
  order_index?: number
}

// ---- Chapter ----

export async function listChapters(storyId: string): Promise<Chapter[]> {
  if (window.dbAPI) {
    return window.dbAPI.listChapters(storyId)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.listChapters(storyId)
  }
  return Promise.resolve(
    allSQL<Chapter>('SELECT * FROM chapters WHERE story_id = ? ORDER BY order_index', storyId),
  )
}

export async function listChaptersByVolume(volumeId: string): Promise<Chapter[]> {
  if (window.dbAPI) {
    return window.dbAPI.listChaptersByVolume(volumeId)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.listChaptersByVolume(volumeId)
  }
  return Promise.resolve(
    allSQL<Chapter>(
      'SELECT * FROM chapters WHERE volume_id = ? ORDER BY order_index',
      volumeId,
    ),
  )
}

export async function createChapter(data: NewChapter): Promise<Chapter> {
  if (window.dbAPI) {
    return window.dbAPI.createChapter(data as Record<string, unknown>)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.createChapter(data as Record<string, unknown>)
  }
  const now = nowISO()
  const idx = autoOrder('chapters', 'story_id', data.story_id, data.order_index)
  const row: Chapter = {
    id: uuid4(),
    story_id: data.story_id,
    volume_id: data.volume_id ?? null,
    title: data.title,
    order_index: idx,
    created_at: now,
    updated_at: now,
  }
  runSQL(
    'INSERT INTO chapters (id, story_id, volume_id, title, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    row.id,
    row.story_id,
    row.volume_id,
    row.title,
    row.order_index,
    row.created_at,
    row.updated_at,
  )
  return Promise.resolve(row)
}

export async function updateChapter(
  id: string,
  patch: Partial<Pick<Chapter, 'title' | 'order_index' | 'volume_id'>>,
): Promise<Chapter | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateChapter(id, patch as Record<string, unknown>)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.updateChapter(id, patch as Record<string, unknown>)
  }
  doUpdate('chapters', id, patch)
  return Promise.resolve(getSQL<Chapter>('SELECT * FROM chapters WHERE id = ?', id))
}

export async function deleteChapter(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteChapter(id)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.deleteChapter(id)
    return
  }
  const sectionsToDelete = allSQL<{ id: string }>(
    'SELECT id FROM sections WHERE chapter_id = ?',
    id,
  )
  sectionsToDelete.forEach((sec) => deleteSectionMem(sec.id))
  runSQL('DELETE FROM chapters WHERE id = ?', id)
  return Promise.resolve()
}

export async function reorderChapters(storyId: string, orderedIds: string[]): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.reorderChapters(storyId, orderedIds)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.reorderChapters(storyId, orderedIds)
    return
  }
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE chapters SET order_index = ?, updated_at = ? WHERE id = ? AND story_id = ?',
      i,
      nowISO(),
      id,
      storyId,
    )
  })
  return Promise.resolve()
}

// 跨卷拖动：同时更新 chapter.volume_id 和 order_index
export async function moveChapters(
  storyId: string,
  targetVolumeId: string | null,
  orderedIds: string[],
): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.moveChapters(storyId, targetVolumeId, orderedIds)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.moveChapters(storyId, targetVolumeId, orderedIds)
    return
  }
  const now = nowISO()
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE chapters SET volume_id = ?, order_index = ?, updated_at = ? WHERE id = ? AND story_id = ?',
      targetVolumeId,
      i,
      now,
      id,
      storyId,
    )
  })
  return Promise.resolve()
}

// ---- Volume ----

export async function listVolumes(storyId: string): Promise<Volume[]> {
  if (window.dbAPI) {
    return window.dbAPI.listVolumes(storyId)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.listVolumes(storyId)
  }
  return Promise.resolve(
    allSQL<Volume>('SELECT * FROM volumes WHERE story_id = ? ORDER BY order_index', storyId),
  )
}

export async function createVolume(data: NewVolume): Promise<Volume> {
  if (window.dbAPI) {
    return window.dbAPI.createVolume(data as Record<string, unknown>)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.createVolume(data as Record<string, unknown>)
  }
  const now = nowISO()
  const idx = autoOrder('volumes', 'story_id', data.story_id, data.order_index)
  const row: Volume = {
    id: uuid4(),
    story_id: data.story_id,
    title: data.title,
    order_index: idx,
    created_at: now,
    updated_at: now,
  }
  runSQL(
    'INSERT INTO volumes (id, story_id, title, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    row.id,
    row.story_id,
    row.title,
    row.order_index,
    row.created_at,
    row.updated_at,
  )
  return Promise.resolve(row)
}

export async function updateVolume(
  id: string,
  patch: Partial<Pick<Volume, 'title' | 'order_index'>>,
): Promise<Volume | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateVolume(id, patch as Record<string, unknown>)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.updateVolume(id, patch as Record<string, unknown>)
  }
  doUpdate('volumes', id, patch)
  return Promise.resolve(getSQL<Volume>('SELECT * FROM volumes WHERE id = ?', id))
}

export async function deleteVolume(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteVolume(id)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.deleteVolume(id)
    return
  }
  const chaptersToDelete = allSQL<{ id: string }>(
    'SELECT id FROM chapters WHERE volume_id = ?',
    id,
  )
  chaptersToDelete.forEach((ch) => deleteChapterMem(ch.id))
  runSQL('DELETE FROM volumes WHERE id = ?', id)
  return Promise.resolve()
}

export async function reorderVolumes(storyId: string, orderedIds: string[]): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.reorderVolumes(storyId, orderedIds)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.reorderVolumes(storyId, orderedIds)
    return
  }
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE volumes SET order_index = ?, updated_at = ? WHERE id = ? AND story_id = ?',
      i,
      nowISO(),
      id,
      storyId,
    )
  })
  return Promise.resolve()
}

// ---- Section ----

export async function listSections(chapterId: string): Promise<Section[]> {
  if (window.dbAPI) {
    return window.dbAPI.listSections(chapterId)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.listSections(chapterId)
  }
  return Promise.resolve(
    allSQL<Section>(
      'SELECT * FROM sections WHERE chapter_id = ? ORDER BY order_index',
      chapterId,
    ),
  )
}

export async function createSection(data: NewSection & { content?: string }): Promise<Section> {
  if (window.dbAPI) {
    return window.dbAPI.createSection(data as Record<string, unknown>)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.createSection(data as Record<string, unknown>)
  }
  const now = nowISO()
  const idx = autoOrder('sections', 'chapter_id', data.chapter_id, data.order_index)
  const row: Section = {
    id: uuid4(),
    chapter_id: data.chapter_id,
    title: data.title,
    order_index: idx,
    content: data.content,
    created_at: now,
    updated_at: now,
  }
  runSQL(
    'INSERT INTO sections (id, chapter_id, title, order_index, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    row.id,
    row.chapter_id,
    row.title,
    row.order_index,
    row.content || null,
    row.created_at,
    row.updated_at,
  )
  return Promise.resolve(row)
}

export async function updateSection(
  id: string,
  patch: Partial<Pick<Section, 'title' | 'order_index' | 'content'>>,
): Promise<Section | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateSection(id, patch as Record<string, unknown>)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.updateSection(id, patch as Record<string, unknown>)
  }
  const now = nowISO()
  const updates: Record<string, unknown> = { ...patch, updated_at: now }
  doUpdate('sections', id, updates)
  return Promise.resolve(getSQL<Section>('SELECT * FROM sections WHERE id = ?', id))
}

export async function getSectionContent(sectionId: string): Promise<string | null> {
  if (window.dbAPI) {
    return window.dbAPI.getSectionContent(sectionId)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.getSectionContent(sectionId)
  }
  const row = getSQL<{ content: string | null }>(
    'SELECT content FROM sections WHERE id = ?',
    sectionId,
  )
  return Promise.resolve(row ? row.content || null : null)
}

export async function setSectionContent(sectionId: string, content: string | null): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.setSectionContent(sectionId, content)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.setSectionContent(sectionId, content)
    return
  }
  const now = nowISO()
  runSQL('UPDATE sections SET content = ?, updated_at = ? WHERE id = ?', content, now, sectionId)
  return Promise.resolve()
}

export async function deleteSection(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteSection(id)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.deleteSection(id)
    return
  }
  deleteSectionMem(id)
  return Promise.resolve()
}

export async function reorderSections(chapterId: string, orderedIds: string[]): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.reorderSections(chapterId, orderedIds)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.reorderSections(chapterId, orderedIds)
    return
  }
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE sections SET order_index = ?, updated_at = ? WHERE id = ? AND chapter_id = ?',
      i,
      nowISO(),
      id,
      chapterId,
    )
  })
  return Promise.resolve()
}

// 跨章拖动：同时更新 section.chapter_id 和 order_index
export async function moveSections(
  targetChapterId: string | null,
  orderedIds: string[],
): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.moveSections(targetChapterId, orderedIds)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.moveSections(targetChapterId, orderedIds)
    return
  }
  const now = nowISO()
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE sections SET chapter_id = ?, order_index = ?, updated_at = ? WHERE id = ?',
      targetChapterId,
      i,
      now,
      id,
    )
  })
  return Promise.resolve()
}

// ---- 聚合查询：一次取出一个故事的全部内容（给导出器用） ----

export async function getStoryWithAll(storyId: string): Promise<StoryWithAll | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.getStoryWithAll(storyId)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.getStoryWithAll(storyId)
  }
  const story = getStoryInMem(storyId)
  if (!story) return Promise.resolve(undefined)
  const worldSettings = allSQL<any>(
    'SELECT * FROM world_settings WHERE story_id = ? ORDER BY order_index',
    storyId,
  )
  const characters = await listCharacters(storyId)
  const outlines = allSQL<any>(
    'SELECT * FROM outlines WHERE story_id = ? ORDER BY order_index',
    storyId,
  )
  const volumes = allSQL<Volume>('SELECT * FROM volumes WHERE story_id = ? ORDER BY order_index', storyId)
  const chapters = allSQL<Chapter>(
    'SELECT * FROM chapters WHERE story_id = ? ORDER BY order_index',
    storyId,
  ).map((c) => ({
    ...c,
    sections: allSQL<Section>(
      'SELECT * FROM sections WHERE chapter_id = ? ORDER BY order_index',
      c.id,
    ),
  }))
  return Promise.resolve({
    ...story,
    world_settings: worldSettings,
    characters,
    outlines,
    volumes,
    chapters,
  })
}
