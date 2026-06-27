// ============================================================
// 作品 facade（list / get / create / update / delete / trash）
// ============================================================

import type { Story } from '../types'
import { BROWSER_DB, isBrowserDBAvailable } from './browserIndexedDB'
import {
  allSQL,
  doUpdate,
  getStoryInMem,
  getSQL,
  nowISO,
  rowToStory,
  runSQL,
  stringifyJSON,
  uuid4,
} from './shared'
import { useDiceHistoryStore } from '../store/diceHistoryStore'

type StoryPatch = Partial<{
  title: string
  description: string
  category: string
  order_index: number
  is_starred: boolean
  is_pinned: boolean
}>

export async function listStories(): Promise<Story[]> {
  if (window.dbAPI) {
    return window.dbAPI.listStories()
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.listStories()
  }
  return Promise.resolve(
    allSQL<Story>('SELECT * FROM stories ORDER BY updated_at DESC').map(rowToStory),
  )
}

/**
 * 一次性返回所有作品 + 统计数据（wordCount/sectionCount/chapterCount）。
 * 替代前端双层 N+1 循环，桌面端走主进程聚合（3 次文件读 vs N×M 次）。
 * 浏览器/内存降级：返回 listStories 结果，统计字段为 0（前端按需回退）。
 */
export async function listStoriesWithStats(): Promise<any[]> {
  if (window.dbAPI) {
    return window.dbAPI.listStoriesWithStats()
  }
  // 浏览器/内存模式降级：返回基础 story，统计字段置 0
  const stories = await listStories()
  return stories.map((s) => ({ ...s, wordCount: 0, sectionCount: 0, chapterCount: 0 }))
}

export async function getStory(id: string): Promise<Story | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.getStory(id)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.getStory(id)
  }
  const r = getSQL<Story>('SELECT * FROM stories WHERE id = ?', id)
  return Promise.resolve(r ? rowToStory(r) : undefined)
}

export async function createStory(data: {
  title: string
  description?: string
  category?: string
}): Promise<Story> {
  if (window.dbAPI) {
    return window.dbAPI.createStory(data)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.createStory(data)
  }
  const now = nowISO()
  const stories = allSQL<Story>('SELECT * FROM stories')
  const maxIdx = stories.reduce((m, s) => Math.max(m, s.order_index ?? 0), 0)
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
  }
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
  )
  return Promise.resolve(story)
}

export async function updateStory(id: string, patch: StoryPatch): Promise<Story | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateStory(id, patch as Record<string, unknown>)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.updateStory(id, patch as Record<string, unknown>)
  }
  const dbPatch: Record<string, unknown> = { ...patch }
  if (patch.is_starred !== undefined) dbPatch.is_starred = patch.is_starred ? 1 : 0
  if (patch.is_pinned !== undefined) dbPatch.is_pinned = patch.is_pinned ? 1 : 0
  doUpdate('stories', id, dbPatch)
  return Promise.resolve(getStoryInMem(id))
}

export async function deleteStory(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteStory(id)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.deleteStory(id)
    return
  }
  runSQL('DELETE FROM stories WHERE id = ?', id)
  return Promise.resolve()
}

// —— 回收站：软删除/恢复/永久删除 ——

export async function softDeleteStory(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.softDeleteStory(id)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.softDeleteStory(id)
    return
  }
  const now = nowISO()
  runSQL(
    'UPDATE stories SET is_deleted = ?, deleted_at = ?, updated_at = ? WHERE id = ?',
    1,
    now,
    now,
    id,
  )
  return Promise.resolve()
}

export async function restoreStory(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.restoreStory(id)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.restoreStory(id)
    return
  }
  const now = nowISO()
  runSQL(
    'UPDATE stories SET is_deleted = NULL, deleted_at = NULL, updated_at = ? WHERE id = ?',
    now,
    id,
  )
  return Promise.resolve()
}

export async function permanentlyDeleteStory(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.permanentlyDeleteStory(id)
    useDiceHistoryStore.getState().clearByStory(id)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.permanentlyDeleteStory(id)
    useDiceHistoryStore.getState().clearByStory(id)
    return
  }
  runSQL('DELETE FROM stories WHERE id = ?', id)
  // 级联：删除关联数据
  runSQL('DELETE FROM world_settings WHERE story_id = ?', id)
  runSQL('DELETE FROM characters WHERE story_id = ?', id)
  runSQL('DELETE FROM character_relations WHERE story_id = ?', id)
  runSQL('DELETE FROM outlines WHERE story_id = ?', id)
  const chapters = allSQL<{ id: string }>('SELECT id FROM chapters WHERE story_id = ?', id)
  for (const ch of chapters) {
    runSQL('DELETE FROM sections WHERE chapter_id = ?', ch.id)
  }
  runSQL('DELETE FROM chapters WHERE story_id = ?', id)
  runSQL('DELETE FROM volumes WHERE story_id = ?', id)
  // 级联清理骰子记录（store 在 localStorage，不在 DB）
  useDiceHistoryStore.getState().clearByStory(id)
  return Promise.resolve()
}

export async function listTrashedStories(): Promise<Story[]> {
  if (window.dbAPI) {
    return window.dbAPI.listTrashedStories()
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.listTrashedStories()
  }
  return Promise.resolve(
    allSQL<Story>('SELECT * FROM stories WHERE is_deleted = 1 ORDER BY deleted_at DESC').map(
      rowToStory,
    ),
  )
}

export async function cleanupOldTrashed(days: number): Promise<number> {
  if (window.dbAPI) {
    return window.dbAPI.cleanupOldTrashed(days)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.cleanupOldTrashed(days)
  }
  const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const old = allSQL<{ id: string }>(
    'SELECT id FROM stories WHERE is_deleted = 1 AND deleted_at < ?',
    threshold,
  )
  for (const r of old) {
    runSQL('DELETE FROM stories WHERE id = ?', r.id)
  }
  return Promise.resolve(old.length)
}
