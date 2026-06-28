// ============================================================
// 人物关系 facade
// ============================================================

import { BROWSER_DB, isBrowserDBAvailable } from './browserIndexedDB'
import { allSQL, autoOrder, getSQL, nowISO, runSQL, uuid4 } from './shared'

type NewCharacterRelation = {
  story_id: string
  source_id: string
  target_id: string
  relation: string
  note?: string
  order_index?: number
}

export interface CharacterRelationRow {
  id: string
  story_id: string
  source_id: string
  target_id: string
  relation: string
  note: string | null
  order_index: number
  created_at: string
  updated_at: string
}

export async function listCharacterRelations(storyId: string): Promise<CharacterRelationRow[]> {
  if (window.dbAPI) {
    return window.dbAPI.listCharacterRelations(storyId)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.listCharacterRelations(storyId)
  }
  return Promise.resolve(
    allSQL<CharacterRelationRow>(
      'SELECT * FROM character_relations WHERE story_id = ? ORDER BY order_index, created_at',
      storyId,
    ),
  )
}

export async function createCharacterRelation(
  data: NewCharacterRelation,
): Promise<CharacterRelationRow> {
  if (window.dbAPI) {
    return window.dbAPI.createCharacterRelation(data as Record<string, unknown>)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.createCharacterRelation(data as Record<string, unknown>)
  }
  const now = nowISO()
  const idx = autoOrder('character_relations', 'story_id', data.story_id, data.order_index)
  const row: CharacterRelationRow = {
    id: uuid4(),
    story_id: data.story_id,
    source_id: data.source_id,
    target_id: data.target_id,
    relation: data.relation,
    note: data.note ?? null,
    order_index: idx,
    created_at: now,
    updated_at: now,
  }
  runSQL(
    'INSERT INTO character_relations (id, story_id, source_id, target_id, relation, note, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    row.id,
    row.story_id,
    row.source_id,
    row.target_id,
    row.relation,
    row.note,
    row.order_index,
    row.created_at,
    row.updated_at,
  )
  return Promise.resolve(row)
}

export async function updateCharacterRelation(
  id: string,
  patch: Partial<
    Pick<CharacterRelationRow, 'source_id' | 'target_id' | 'relation' | 'note' | 'order_index'>
  >,
): Promise<CharacterRelationRow | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateCharacterRelation(id, patch as Record<string, unknown>)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.updateCharacterRelation(id, patch as Record<string, unknown>)
  }
  const now = nowISO()
  const fields: string[] = []
  const values: unknown[] = []
  ;(['source_id', 'target_id', 'relation', 'note', 'order_index'] as const).forEach((k) => {
    if ((patch as Record<string, unknown>)[k] !== undefined) {
      fields.push(`${k} = ?`)
      values.push((patch as Record<string, unknown>)[k])
    }
  })
  if (fields.length === 0)
    return Promise.resolve(
      getSQL<CharacterRelationRow>('SELECT * FROM character_relations WHERE id = ?', id),
    )
  fields.push('updated_at = ?')
  values.push(now)
  values.push(id)
  runSQL(`UPDATE character_relations SET ${fields.join(', ')} WHERE id = ?`, ...values)
  return Promise.resolve(
    getSQL<CharacterRelationRow>('SELECT * FROM character_relations WHERE id = ?', id),
  )
}

export async function deleteCharacterRelation(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteCharacterRelation(id)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.deleteCharacterRelation(id)
    return
  }
  runSQL('DELETE FROM character_relations WHERE id = ?', id)
  return Promise.resolve()
}
