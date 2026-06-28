// ============================================================
// 世界观 facade
// ============================================================

import type { WorldSetting } from '../types'
import { BROWSER_DB, isBrowserDBAvailable } from './browserIndexedDB'
import { allSQL, autoOrder, doUpdate, getSQL, nowISO, runSQL, uuid4 } from './shared'

type NewWorldSetting = Omit<WorldSetting, 'id' | 'created_at' | 'updated_at' | 'order_index'> & {
  order_index?: number
}

export async function listWorldSettings(storyId: string): Promise<WorldSetting[]> {
  if (window.dbAPI) {
    return window.dbAPI.listWorldSettings(storyId)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.listWorldSettings(storyId)
  }
  return Promise.resolve(
    allSQL<WorldSetting>(
      'SELECT * FROM world_settings WHERE story_id = ? ORDER BY order_index',
      storyId,
    ),
  )
}

export async function createWorldSetting(data: NewWorldSetting): Promise<WorldSetting> {
  if (window.dbAPI) {
    return window.dbAPI.createWorldSetting(data as Record<string, unknown>)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.createWorldSetting(data as Record<string, unknown>)
  }
  const now = nowISO()
  const idx = autoOrder('world_settings', 'story_id', data.story_id, data.order_index)
  const row: WorldSetting = {
    id: uuid4(),
    story_id: data.story_id,
    title: data.title,
    content: data.content || '',
    order_index: idx,
    created_at: now,
    updated_at: now,
  }
  runSQL(
    'INSERT INTO world_settings (id, story_id, title, content, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    row.id,
    row.story_id,
    row.title,
    row.content,
    row.order_index,
    row.created_at,
    row.updated_at,
  )
  return Promise.resolve(row)
}

export async function updateWorldSetting(
  id: string,
  patch: Partial<Pick<WorldSetting, 'title' | 'content' | 'order_index'>>,
): Promise<WorldSetting | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateWorldSetting(id, patch as Record<string, unknown>)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.updateWorldSetting(id, patch as Record<string, unknown>)
  }
  doUpdate('world_settings', id, patch)
  return Promise.resolve(getSQL<WorldSetting>('SELECT * FROM world_settings WHERE id = ?', id))
}

export async function deleteWorldSetting(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteWorldSetting(id)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.deleteWorldSetting(id)
    return
  }
  runSQL('DELETE FROM world_settings WHERE id = ?', id)
  return Promise.resolve()
}

/** 重新排序某作品下的所有世界观（按 orderedIds 顺序写入 order_index） */
export async function reorderWorldSettings(storyId: string, orderedIds: string[]): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.reorderWorldSettings(storyId, orderedIds)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.reorderWorldSettings(storyId, orderedIds)
    return
  }
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE world_settings SET order_index = ?, updated_at = ? WHERE id = ? AND story_id = ?',
      i,
      nowISO(),
      id,
      storyId,
    )
  })
  return Promise.resolve()
}
