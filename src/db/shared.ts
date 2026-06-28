// ============================================================
// 数据库内部工具（共享给所有 facade 文件）
//
// - uuid4 / nowISO: ID 和时间戳
// - parseJSON / stringifyJSON: attributes 等 JSON 字段的序列化
// - runSQL / allSQL / getSQL: 内存模式下的简化 SQL 实现
// - autoOrder / doUpdate: 新增/更新的辅助逻辑
// - 内存表初始化 + 启动入口 initDatabase
//
// **不导出业务函数**，仅供同目录其他文件使用
// ============================================================

import type { Entity, Story } from '../types'
import { BROWSER_DB, isBrowserDBAvailable, initBrowserDB } from './browserIndexedDB'

// 实体自动字段：创建对象时不需要调用方提供
type EntityFields = keyof Entity // 'id' | 'created_at' | 'updated_at'

// ------------------------------------------------------------
// 启动入口（保持原 initDatabase 行为）
// ------------------------------------------------------------
export function initDatabase(): void {
  // Electron 主进程：主进程自处理数据库初始化
  if (window.dbAPI) {
    return
  }
  // 移动端 (Capacitor) / 浏览器：使用 IndexedDB 持久化
  if (isBrowserDBAvailable()) {
    void initBrowserDB()
    return
  }
  // 内存模式兜底（无预置模板 seed）
  initMemory()
}

// ------------------------------------------------------------
// 内存实现（无 window.dbAPI 时的降级）
// ------------------------------------------------------------
interface Table {
  [id: string]: Record<string, unknown>
}

let memoryTables: Record<string, Table> = {}
let memoryInitialized = false

function initMemory(): void {
  if (memoryInitialized) return
  memoryTables = {
    stories: {},
    world_settings: {},
    characters: {},
    outlines: {},
    chapters: {},
    sections: {},
    character_variants: {},
    world_setting_templates: {},
    character_templates: {},
    character_relations: {},
  }
  memoryInitialized = true
}

// ------------------------------------------------------------
// 工具函数
// ------------------------------------------------------------
export function nowISO(): string {
  return new Date().toISOString()
}

export function uuid4(): string {
  const cryptoLike = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoLike?.randomUUID) {
    return String(cryptoLike.randomUUID())
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function parseJSON<T>(raw: unknown): T | undefined {
  if (raw == null) return undefined
  try {
    return typeof raw === 'string' ? (JSON.parse(raw) as T) : (raw as T)
  } catch {
    return undefined
  }
}

export function stringifyJSON(obj: unknown): string {
  return JSON.stringify(obj)
}

export function runSQL(sql: string, ...args: unknown[]): { changes: number } {
  return memoryRun(sql, args)
}

export function getSQL<T>(sql: string, ...args: unknown[]): T | undefined {
  return memoryGet<T>(sql, args)
}

export function allSQL<T>(sql: string, ...args: unknown[]): T[] {
  return memoryAll<T>(sql, args)
}

function memoryParseTable(sql: string): string | null {
  const insert = sql.match(/^INSERT\s+INTO\s+(\w+)/i)
  if (insert) return insert[1]
  const update = sql.match(/^UPDATE\s+(\w+)/i)
  if (update) return update[1]
  const del = sql.match(/^DELETE\s+FROM\s+(\w+)/i)
  if (del) return del[1]
  const select = sql.match(/^SELECT[\s\S]*?\bFROM\s+(\w+)/i)
  if (select) return select[1]
  return null
}

function memoryParseWhereKeys(sql: string): string[] | null {
  const m = sql.match(/\bWHERE\s+([\s\S]+?)(?:\sORDER\s+|\sLIMIT\s|$)/i)
  if (!m) return null
  const parts = m[1].split(/\s+AND\s+/i)
  return parts.map((p) => {
    const k = p.trim().match(/^(\w+)\s*=\s*\?$/)
    return k ? k[1] : p.trim()
  })
}

function memoryMatches(row: Record<string, unknown>, keys: string[] | null, args: unknown[]): boolean {
  if (!keys) return true
  if (keys.length !== args.length) return false
  for (let i = 0; i < keys.length; i++) {
    if (String(row[keys[i]]) !== String(args[i])) return false
  }
  return true
}

function memoryRun(sql: string, args: unknown[]): { changes: number } {
  const trimmed = sql.trim().replace(/;?\s*$/, '')
  const table = memoryParseTable(trimmed)
  if (!table) return { changes: 0 }
  initMemory()
  if (!memoryTables[table]) memoryTables[table] = {}
  let changes = 0

  if (/^INSERT\s+/i.test(trimmed)) {
    const colsMatch = trimmed.match(/\(([^)]+)\)\s*VALUES/i)
    if (!colsMatch) return { changes: 0 }
    const cols = colsMatch[1].split(',').map((c) => c.trim())
    const id = String(args[cols.indexOf('id') >= 0 ? cols.indexOf('id') : 0])
    const row: Record<string, unknown> = {}
    cols.forEach((c, i) => (row[c] = args[i]))
    memoryTables[table][id] = row
    changes = 1
  } else if (/^UPDATE\s+/i.test(trimmed)) {
    const setMatch = trimmed.match(/\bSET\s+([\s\S]+?)\s+WHERE\b/i)
    const whereKeys = memoryParseWhereKeys(trimmed)
    if (setMatch) {
      const setPairs = setMatch[1]
        .split(',')
        .map((p) => p.trim().match(/^(\w+)\s*=\s*\?$/)) as (RegExpMatchArray | null)[]
      const setValues: unknown[] = args.slice(0, setPairs.length)
      const whereValues: unknown[] = args.slice(setPairs.length)
      Object.values(memoryTables[table]).forEach((row) => {
        if (memoryMatches(row, whereKeys, whereValues)) {
          setPairs.forEach((pair, i) => {
            if (pair) row[pair[1]] = setValues[i]
          })
          changes++
        }
      })
    }
  } else if (/^DELETE\s+/i.test(trimmed)) {
    const whereKeys = memoryParseWhereKeys(trimmed)
    const whereValues = args
    const ids = Object.keys(memoryTables[table]).filter((id) =>
      memoryMatches(memoryTables[table][id], whereKeys, whereValues),
    )
    ids.forEach((id) => delete memoryTables[table][id])
    changes = ids.length
  }

  return { changes }
}

function memoryGet<T>(sql: string, args: unknown[]): T | undefined {
  const rows = memoryAll<T>(sql, args)
  return rows[0]
}

function memoryAll<T>(sql: string, args: unknown[]): T[] {
  const table = memoryParseTable(sql)
  if (!table) return []
  const whereKeys = memoryParseWhereKeys(sql)
  initMemory()
  const rows = Object.values(memoryTables[table] || {})
    .filter((row) => memoryMatches(row, whereKeys, args))
    .map((row) => ({ ...row }) as T)
  const orderMatch = sql.match(/\bORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?/i)
  if (orderMatch) {
    const col = orderMatch[1]
    const desc = (orderMatch[2] || '').toUpperCase() === 'DESC'
    rows.sort((a: unknown, b: unknown) => {
      const av = String((a as Record<string, unknown>)[col])
      const bv = String((b as Record<string, unknown>)[col])
      if (av === bv) return 0
      return (av < bv ? -1 : 1) * (desc ? -1 : 1)
    })
  }
  const limitMatch = sql.match(/\bLIMIT\s+(\d+)/i)
  if (limitMatch) {
    return rows.slice(0, parseInt(limitMatch[1], 10))
  }
  return rows
}

// ------------------------------------------------------------
// 通用新增/更新辅助
// ------------------------------------------------------------
export function autoOrder(
  table: string,
  parentCol: string,
  parentId: string,
  explicitOrder?: number,
): number {
  if (typeof explicitOrder === 'number') return explicitOrder
  const all = allSQL<Record<string, unknown>>(
    `SELECT order_index FROM ${table} WHERE ${parentCol} = ?`,
    parentId,
  )
  if (all.length === 0) return 0
  return Math.max(...all.map((r) => Number(r.order_index) || 0)) + 1
}

export function doUpdate(
  table: string,
  id: string,
  patch: Record<string, unknown>,
): void {
  const now = nowISO()
  const fields: string[] = []
  const values: unknown[] = []
  Object.entries(patch).forEach(([k, v]) => {
    if (v !== undefined) {
      fields.push(`${k} = ?`)
      values.push(v)
    }
  })
  fields.push('updated_at = ?')
  values.push(now)
  values.push(id)
  runSQL(`UPDATE ${table} SET ${fields.join(', ')} WHERE id = ?`, ...values)
}

// ------------------------------------------------------------
// 内部使用的内存辅助函数
// ------------------------------------------------------------

/** 内存模式下的 getStory 辅助（避免循环引用） */
export function getStoryInMem(id: string): Story | undefined {
  const r = getSQL<Story>('SELECT * FROM stories WHERE id = ?', id)
  return r ? rowToStory(r) : undefined
}

/** 删除节（内存模式） */
export function deleteSectionMem(id: string): void {
  runSQL('DELETE FROM sections WHERE id = ?', id)
}

/** 删除章（内存模式，连带 sections） */
export function deleteChapterMem(id: string): void {
  const sectionsToDelete = allSQL<{ id: string }>(
    'SELECT id FROM sections WHERE chapter_id = ?',
    id,
  )
  sectionsToDelete.forEach((sec) => deleteSectionMem(sec.id))
  runSQL('DELETE FROM chapters WHERE id = ?', id)
}

/** Story 行转换为带 boolean 标志的对象 */
export function rowToStory(r: Story): Story {
  return {
    ...r,
    is_starred: !!r.is_starred,
    is_pinned: !!r.is_pinned,
  }
}

/** 让 EntityFields 在编译期被使用，避免未使用类型警告 */
export type _EntityKeys = EntityFields

// 防止 BROWSER_DB 未使用警告
void BROWSER_DB
