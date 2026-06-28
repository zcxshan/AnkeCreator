// ============================================================
// 模板 facade（世界观模板 + 人物模板，独立表）
// ============================================================

import type { CharacterTemplate, CharacterVariant, WorldSettingTemplate } from '../types'
import { BROWSER_DB, isBrowserDBAvailable } from './browserIndexedDB'
import { allSQL, doUpdate, getSQL, nowISO, parseJSON, runSQL, stringifyJSON, uuid4 } from './shared'

type NewWorldSettingTemplate = Omit<
  WorldSettingTemplate,
  'id' | 'created_at' | 'updated_at' | 'order_index'
> & {
  order_index?: number
}

type NewCharacterTemplate = Omit<
  CharacterTemplate,
  'id' | 'created_at' | 'updated_at' | 'order_index'
> & {
  order_index?: number
}

// ---- World templates ----

export async function listWorldSettingTemplates(): Promise<WorldSettingTemplate[]> {
  if (window.dbAPI) {
    return window.dbAPI.listWorldSettingTemplates()
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.listWorldSettingTemplates()
  }
  return Promise.resolve(
    allSQL<WorldSettingTemplate>(
      'SELECT * FROM world_setting_templates ORDER BY order_index, updated_at DESC',
    ).map((t) => ({ ...t })),
  )
}

export async function createWorldSettingTemplate(
  data: NewWorldSettingTemplate,
): Promise<WorldSettingTemplate> {
  if (window.dbAPI) {
    return window.dbAPI.createWorldSettingTemplate(data as Record<string, unknown>)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.createWorldSettingTemplate(data as Record<string, unknown>)
  }
  const now = nowISO()
  const existing = allSQL<{ id: string }>('SELECT id FROM world_setting_templates')
  const order = existing.length
  const row: WorldSettingTemplate = {
    id: uuid4(),
    title: data.title,
    content: data.content || '',
    order_index: order,
    created_at: now,
    updated_at: now,
  }
  runSQL(
    'INSERT INTO world_setting_templates (id, title, content, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    row.id,
    row.title,
    row.content,
    row.order_index,
    row.created_at,
    row.updated_at,
  )
  return Promise.resolve(row)
}

export async function updateWorldSettingTemplate(
  id: string,
  patch: Partial<Pick<WorldSettingTemplate, 'title' | 'content' | 'order_index'>>,
): Promise<WorldSettingTemplate | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateWorldSettingTemplate(id, patch as Record<string, unknown>)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.updateWorldSettingTemplate(id, patch as Record<string, unknown>)
  }
  doUpdate('world_setting_templates', id, patch)
  return Promise.resolve(
    getSQL<WorldSettingTemplate>('SELECT * FROM world_setting_templates WHERE id = ?', id),
  )
}

export async function deleteWorldSettingTemplate(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteWorldSettingTemplate(id)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.deleteWorldSettingTemplate(id)
    return
  }
  runSQL('DELETE FROM world_setting_templates WHERE id = ?', id)
  return Promise.resolve()
}

/** 重新排序所有世界观模板 */
export async function reorderWorldSettingTemplates(orderedIds: string[]): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.reorderWorldSettingTemplates(orderedIds)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.reorderWorldSettingTemplates(orderedIds)
    return
  }
  orderedIds.forEach((id, i) => {
    runSQL('UPDATE world_setting_templates SET order_index = ? WHERE id = ?', i, id)
  })
  return Promise.resolve()
}

// ---- Character templates ----

export async function listCharacterTemplates(): Promise<CharacterTemplate[]> {
  if (window.dbAPI) {
    return window.dbAPI.listCharacterTemplates()
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.listCharacterTemplates()
  }
  return Promise.resolve(
    allSQL<CharacterTemplate>(
      'SELECT * FROM character_templates ORDER BY order_index, updated_at DESC',
    ).map((c) => ({
      ...c,
      order_index: c.order_index ?? 0,
      attributes: parseJSON<Record<string, string | number>>(c.attributes),
      variants: parseJSON<CharacterVariant[]>(c.variants),
    })),
  )
}

export async function createCharacterTemplate(
  data: NewCharacterTemplate,
): Promise<CharacterTemplate> {
  if (window.dbAPI) {
    return window.dbAPI.createCharacterTemplate(data as Record<string, unknown>)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.createCharacterTemplate(data as Record<string, unknown>)
  }
  const now = nowISO()
  const existing = allSQL<{ id: string }>('SELECT id FROM character_templates')
  const order = existing.length
  const row: CharacterTemplate = {
    id: uuid4(),
    name: data.name,
    avatar: data.avatar || '',
    personality: data.personality || '',
    attributes: data.attributes,
    notes: data.notes || '',
    variants: data.variants,
    order_index: order,
    created_at: now,
    updated_at: now,
  }
  runSQL(
    'INSERT INTO character_templates (id, name, avatar, personality, attributes, notes, variants, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    row.id,
    row.name,
    row.avatar,
    row.personality,
    stringifyJSON(row.attributes || null),
    row.notes,
    stringifyJSON(row.variants || null),
    row.order_index,
    row.created_at,
    row.updated_at,
  )
  return Promise.resolve({ ...row })
}

export async function updateCharacterTemplate(
  id: string,
  patch: Partial<
    Pick<
      CharacterTemplate,
      'name' | 'avatar' | 'personality' | 'attributes' | 'notes' | 'variants' | 'order_index'
    >
  >,
): Promise<CharacterTemplate | undefined> {
  if (window.dbAPI) {
    return window.dbAPI.updateCharacterTemplate(id, patch as Record<string, unknown>)
  } else if (isBrowserDBAvailable()) {
    return BROWSER_DB.updateCharacterTemplate(id, patch as Record<string, unknown>)
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
  if (patch.variants !== undefined) {
    fields.push('variants = ?')
    values.push(stringifyJSON(patch.variants))
  }
  fields.push('updated_at = ?')
  values.push(now)
  values.push(id)
  if (fields.length > 1) {
    runSQL(`UPDATE character_templates SET ${fields.join(', ')} WHERE id = ?`, ...values)
  }
  return Promise.resolve(getCharacterTemplateInMem(id))
}

/** 重新排序所有人物模板 */
export async function reorderCharacterTemplates(orderedIds: string[]): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.reorderCharacterTemplates(orderedIds)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.reorderCharacterTemplates(orderedIds)
    return
  }
  orderedIds.forEach((id, i) => {
    runSQL('UPDATE character_templates SET order_index = ? WHERE id = ?', i, id)
  })
  return Promise.resolve()
}

function getCharacterTemplateInMem(id: string): CharacterTemplate | undefined {
  const row = getSQL<CharacterTemplate>('SELECT * FROM character_templates WHERE id = ?', id)
  if (!row) return undefined
  return {
    ...row,
    attributes: parseJSON<Record<string, string | number>>(row.attributes),
    variants: parseJSON<CharacterVariant[]>(row.variants),
  }
}

export async function deleteCharacterTemplate(id: string): Promise<void> {
  if (window.dbAPI) {
    await window.dbAPI.deleteCharacterTemplate(id)
    return
  } else if (isBrowserDBAvailable()) {
    await BROWSER_DB.deleteCharacterTemplate(id)
    return
  }
  runSQL('DELETE FROM character_templates WHERE id = ?', id)
  return Promise.resolve()
}
