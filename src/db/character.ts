// ============================================================
// 角色 facade（character + variant）
// ============================================================

import type { Character, CharacterVariant } from '../types'
import { BROWSER_DB, isBrowserDBAvailable } from './browserIndexedDB'
import {
  allSQL,
  autoOrder,
  doUpdate,
  getSQL,
  nowISO,
  parseJSON,
  runSQL,
  stringifyJSON,
  uuid4,
} from './shared'

type NewCharacter = Omit<Character, 'id' | 'created_at' | 'updated_at' | 'order_index'> & {
  order_index?: number
}

type NewCharacterVariant = Omit<CharacterVariant, 'id' | 'created_at' | 'updated_at' | 'order_index'> & {
  order_index?: number
}

// ---- Character ----

export async function listCharacters(storyId: string): Promise<Character[]> {
  if (window.dbAPI) {
    return window.dbAPI.listCharacters(storyId)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.listCharacters(storyId)
  }
  const rows = allSQL<Character>(
    'SELECT * FROM characters WHERE story_id = ? ORDER BY order_index',
    storyId,
  )
  if (rows.length === 0) return Promise.resolve([])
  const variantsByCharId = listAllVariantsGroupedByCharacterIdMem(
    rows.map((r) => r.id),
  )
  return Promise.resolve(
    rows.map((c) => ({
      ...c,
      attributes: parseJSON<Record<string, string | number>>(c.attributes),
      variants: variantsByCharId[c.id] ?? [],
    })),
  )
}

export async function createCharacter(data: NewCharacter): Promise<Character> {
  if (window.dbAPI) {
    return window.dbAPI.createCharacter(data as Record<string, unknown>)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.createCharacter(data as Record<string, unknown>)
  }
  const now = nowISO()
  const idx = autoOrder('characters', 'story_id', data.story_id, data.order_index)
  const row: Character = {
    id: uuid4(),
    story_id: data.story_id,
    name: data.name,
    avatar: data.avatar || '',
    personality: data.personality || '',
    attributes: data.attributes,
    notes: data.notes || '',
    order_index: idx,
    created_at: now,
    updated_at: now,
  }
  runSQL(
    'INSERT INTO characters (id, story_id, name, avatar, personality, attributes, notes, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    row.id,
    row.story_id,
    row.name,
    row.avatar,
    row.personality,
    stringifyJSON(row.attributes || null),
    row.notes,
    row.order_index,
    row.created_at,
    row.updated_at,
  )
  return Promise.resolve({ ...row, variants: [] })
}

export async function updateCharacter(
  id: string,
  patch: Partial<
    Pick<Character, 'name' | 'avatar' | 'personality' | 'attributes' | 'notes' | 'order_index'>
  >,
): Promise<Character | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateCharacter(id, patch as Record<string, unknown>)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.updateCharacter(id, patch as Record<string, unknown>)
  }
  const now = nowISO()
  const fields: string[] = []
  const values: unknown[] = []
  ;(['name', 'avatar', 'personality', 'notes', 'order_index'] as const).forEach((k) => {
    if ((patch as Record<string, unknown>)[k] !== undefined) {
      fields.push(`${k} = ?`)
      values.push((patch as Record<string, unknown>)[k])
    }
  })
  if (patch.attributes !== undefined) {
    fields.push('attributes = ?')
    values.push(stringifyJSON(patch.attributes))
  }
  fields.push('updated_at = ?')
  values.push(now)
  values.push(id)
  runSQL(`UPDATE characters SET ${fields.join(', ')} WHERE id = ?`, ...values)
  const row = getSQL<Character & { attributes_json?: string }>(
    'SELECT * FROM characters WHERE id = ?',
    id,
  )
  if (!row) return Promise.resolve(undefined)
  return Promise.resolve({
    ...row,
    attributes: parseJSON<Record<string, string | number>>(row.attributes),
  } as Character)
}

export async function deleteCharacter(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteCharacter(id)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.deleteCharacter(id)
    return
  }
  runSQL('DELETE FROM characters WHERE id = ?', id)
  return Promise.resolve()
}

/** 重新排序某作品下的所有人物 */
export async function reorderCharacters(storyId: string, orderedIds: string[]): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.reorderCharacters(storyId, orderedIds)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.reorderCharacters(storyId, orderedIds)
    return
  }
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE characters SET order_index = ?, updated_at = ? WHERE id = ? AND story_id = ?',
      i,
      nowISO(),
      id,
      storyId,
    )
  })
  return Promise.resolve()
}

// ---- CharacterVariant ----

export async function listCharacterVariants(characterId: string): Promise<CharacterVariant[]> {
  if (window.dbAPI) {
    return window.dbAPI.listCharacterVariants(characterId)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.listCharacterVariants(characterId)
  }
  return Promise.resolve(
    allSQL<CharacterVariant>(
      'SELECT * FROM character_variants WHERE character_id = ? ORDER BY order_index',
      characterId,
    ),
  )
}

function listAllVariantsGroupedByCharacterIdMem(
  characterIds: string[],
): Record<string, CharacterVariant[]> {
  if (characterIds.length === 0) return {}
  const placeholders = characterIds.map(() => '?').join(',')
  const rows = allSQL<CharacterVariant>(
    `SELECT * FROM character_variants WHERE character_id IN (${placeholders}) ORDER BY character_id, order_index`,
    ...characterIds,
  )
  const grouped: Record<string, CharacterVariant[]> = {}
  characterIds.forEach((id) => (grouped[id] = []))
  rows.forEach((v) => {
    if (!grouped[v.character_id]) grouped[v.character_id] = []
    grouped[v.character_id].push(v)
  })
  return grouped
}

export async function createCharacterVariant(data: NewCharacterVariant): Promise<CharacterVariant> {
  if (window.dbAPI) {
    return window.dbAPI.createCharacterVariant(data as Record<string, unknown>)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.createCharacterVariant(data as Record<string, unknown>)
  }
  const now = nowISO()
  const idx = autoOrder('character_variants', 'character_id', data.character_id, data.order_index)
  const row: CharacterVariant = {
    id: uuid4(),
    character_id: data.character_id,
    name: data.name,
    url: data.url,
    order_index: idx,
    created_at: now,
    updated_at: now,
  }
  runSQL(
    'INSERT INTO character_variants (id, character_id, name, url, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    row.id,
    row.character_id,
    row.name,
    row.url,
    row.order_index,
    row.created_at,
    row.updated_at,
  )
  return Promise.resolve(row)
}

export async function createCharacterVariantsBatch(
  characterId: string,
  items: { name?: string; url: string }[],
): Promise<CharacterVariant[]> {
  if (window.dbAPI) {
    return window.dbAPI.createCharacterVariantsBatch(characterId, items)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.createCharacterVariantsBatch(characterId, items)
  }
  const now = nowISO()
  const existing = allSQL<CharacterVariant>(
    'SELECT * FROM character_variants WHERE character_id = ? ORDER BY order_index',
    characterId,
  )
  let order = existing.length
  const created: CharacterVariant[] = []
  for (const it of items) {
    const row: CharacterVariant = {
      id: uuid4(),
      character_id: characterId,
      name: (it.name || '差分').trim(),
      url: it.url || '',
      order_index: order++,
      created_at: now,
      updated_at: now,
    }
    runSQL(
      'INSERT INTO character_variants (id, character_id, name, url, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      row.id,
      row.character_id,
      row.name,
      row.url,
      row.order_index,
      row.created_at,
      row.updated_at,
    )
    created.push(row)
  }
  return Promise.resolve(created)
}

export async function updateCharacterVariant(
  id: string,
  patch: Partial<Pick<CharacterVariant, 'name' | 'url' | 'order_index'>>,
): Promise<CharacterVariant | undefined> {
  if (window.dbAPI) {
    // IPC 层返回 boolean，无法直接获取更新后的数据，使用内存实现
    await window.dbAPI.updateCharacterVariant(id, patch as Record<string, unknown>)
  }
  // 始终使用内存表查询结果（IPC 路径下也同步更新内存表以保证一致性）
  doUpdate('character_variants', id, patch)
  return Promise.resolve(
    getSQL<CharacterVariant>('SELECT * FROM character_variants WHERE id = ?', id),
  )
}

export async function deleteCharacterVariant(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteCharacterVariant(id)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.deleteCharacterVariant(id)
    return
  }
  runSQL('DELETE FROM character_variants WHERE id = ?', id)
  return Promise.resolve()
}

export async function reorderCharacterVariants(
  characterId: string,
  orderedIds: string[],
): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.reorderCharacterVariants(characterId, orderedIds)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.reorderCharacterVariants(characterId, orderedIds)
    return
  }
  orderedIds.forEach((id, i) => {
    runSQL(
      'UPDATE character_variants SET order_index = ?, updated_at = ? WHERE id = ? AND character_id = ?',
      i,
      nowISO(),
      id,
      characterId,
    )
  })
  return Promise.resolve()
}
