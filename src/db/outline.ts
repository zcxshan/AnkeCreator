// ============================================================
// 大纲 facade
// ============================================================

import type { Outline } from '../types'
import { BROWSER_DB, isBrowserDBAvailable } from './browserIndexedDB'
import { allSQL, autoOrder, doUpdate, getSQL, nowISO, runSQL, uuid4 } from './shared'

type NewOutline = Omit<Outline, 'id' | 'created_at' | 'updated_at' | 'order_index'> & {
  order_index?: number
}

export async function listOutlines(storyId: string): Promise<Outline[]> {
  if (window.dbAPI) {
    return window.dbAPI.listOutlines(storyId)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.listOutlines(storyId)
  }
  return Promise.resolve(
    allSQL<Outline>('SELECT * FROM outlines WHERE story_id = ? ORDER BY order_index', storyId),
  )
}

export async function createOutline(data: NewOutline): Promise<Outline> {
  if (window.dbAPI) {
    return window.dbAPI.createOutline(data as Record<string, unknown>)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.createOutline(data as Record<string, unknown>)
  }
  const now = nowISO()
  const idx = autoOrder('outlines', 'story_id', data.story_id, data.order_index)
  const row: Outline = {
    id: uuid4(),
    story_id: data.story_id,
    content: data.content,
    order_index: idx,
    created_at: now,
    updated_at: now,
  }
  runSQL(
    'INSERT INTO outlines (id, story_id, content, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    row.id,
    row.story_id,
    row.content,
    row.order_index,
    row.created_at,
    row.updated_at,
  )
  return Promise.resolve(row)
}

export async function updateOutline(
  id: string,
  patch: Partial<Pick<Outline, 'content' | 'order_index'>>,
): Promise<Outline | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateOutline(id, patch as Record<string, unknown>)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.updateOutline(id, patch as Record<string, unknown>)
  }
  doUpdate('outlines', id, patch)
  return Promise.resolve(getSQL<Outline>('SELECT * FROM outlines WHERE id = ?', id))
}

export async function deleteOutline(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteOutline(id)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.deleteOutline(id)
    return
  }
  runSQL('DELETE FROM outlines WHERE id = ?', id)
  return Promise.resolve()
}
