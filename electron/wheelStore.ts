// ============================================================
// 玩转盘 - 主进程数据存储
//
// 存储位置：<dataDir>/wheels.json（由 getWheelsFile() 决定）
// 数据结构：{ format, version, schemes, history }
//
// 写入策略：tmp + rename + .bak 兜底（与 db-main.ts 的 saveJSONWithBackup 一致）
// 读取策略：失败时返回空结构，不抛错（避免阻塞 IPC）
//
// 历史记录保留最近 100 条（FIFO，超过自动丢弃最旧的）
// ============================================================

import * as fs from 'fs'
import { getWheelsFile } from './paths'
import type { WheelScheme, DrawHistory } from '../src/types/wheel'

const HISTORY_LIMIT = 100

interface WheelsBundle {
  format: 'anke-creator-wheels-v1'
  version: '1.0'
  schemes: WheelScheme[]
  history: DrawHistory[]
}

const EMPTY_BUNDLE: WheelsBundle = {
  format: 'anke-creator-wheels-v1',
  version: '1.0',
  schemes: [],
  history: [],
}

/**
 * 生成唯一 ID
 * 复用 diceEngine 的 newId 风格：随机串 + 时间戳
 */
function generateId(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36).slice(-4) +
    Math.random().toString(36).slice(2, 6)
  )
}

/**
 * 读取整个 wheels.json
 * - 文件不存在 → 返回空结构
 * - 解析失败 → 返回空结构 + console.error
 * - 数据格式不完整 → 兜底补全 schemes/history 字段
 */
function readBundle(): WheelsBundle {
  const filePath = getWheelsFile()
  try {
    if (!fs.existsSync(filePath)) {
      return { ...EMPTY_BUNDLE }
    }
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      console.error('[wheelStore] wheels.json 不是有效 JSON 对象，返回空结构')
      return { ...EMPTY_BUNDLE }
    }
    return {
      format: 'anke-creator-wheels-v1',
      version: '1.0',
      schemes: Array.isArray(parsed.schemes) ? parsed.schemes : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
    }
  } catch (e) {
    console.error('[wheelStore] 读取 wheels.json 失败:', e)
    return { ...EMPTY_BUNDLE }
  }
}

/**
 * 原子写入 wheels.json
 * 1. 若主文件存在 → 复制到 .bak
 * 2. 写入 .tmp
 * 3. rename → 主文件（原子替换）
 */
function writeBundle(bundle: WheelsBundle): void {
  const filePath = getWheelsFile()
  const bakPath = filePath + '.bak'
  try {
    // 1. 备份
    if (fs.existsSync(filePath)) {
      try {
        fs.copyFileSync(filePath, bakPath)
      } catch (e) {
        console.warn('[wheelStore] 备份 .bak 失败（不影响写入）:', e)
      }
    }
    // 2. 写 .tmp
    const tmp = filePath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(bundle, null, 2), 'utf-8')
    // 3. rename
    fs.renameSync(tmp, filePath)
  } catch (e) {
    console.error('[wheelStore] 写入 wheels.json 失败:', e)
    throw e
  }
}

// ============================================================
// 方案 CRUD
// ============================================================

export function listSchemes(): WheelScheme[] {
  return readBundle().schemes
}

export function getScheme(id: string): WheelScheme | null {
  const bundle = readBundle()
  return bundle.schemes.find((s) => s.id === id) || null
}

export function createScheme(data: Omit<WheelScheme, 'id' | 'created_at' | 'updated_at'>): WheelScheme {
  const bundle = readBundle()
  const now = new Date().toISOString()
  const scheme: WheelScheme = {
    ...data,
    id: generateId(),
    created_at: now,
    updated_at: now,
  }
  bundle.schemes.push(scheme)
  writeBundle(bundle)
  return scheme
}

export function updateScheme(id: string, patch: Partial<WheelScheme>): WheelScheme | null {
  const bundle = readBundle()
  const idx = bundle.schemes.findIndex((s) => s.id === id)
  if (idx < 0) return null
  const now = new Date().toISOString()
  bundle.schemes[idx] = {
    ...bundle.schemes[idx],
    ...patch,
    id, // 不允许改 id
    updated_at: now,
  }
  writeBundle(bundle)
  return bundle.schemes[idx]
}

export function deleteScheme(id: string): boolean {
  const bundle = readBundle()
  const before = bundle.schemes.length
  bundle.schemes = bundle.schemes.filter((s) => s.id !== id)
  // 同时删除该方案的历史记录
  bundle.history = bundle.history.filter((h) => h.schemeId !== id)
  if (bundle.schemes.length === before) return false
  writeBundle(bundle)
  return true
}

// ============================================================
// 历史记录
// ============================================================

export function addDrawHistory(record: DrawHistory): void {
  const bundle = readBundle()
  bundle.history.unshift(record) // 最新的放最前
  // 超过上限 → 丢弃最旧的
  if (bundle.history.length > HISTORY_LIMIT) {
    bundle.history = bundle.history.slice(0, HISTORY_LIMIT)
  }
  writeBundle(bundle)
}

export function listDrawHistory(limit?: number): DrawHistory[] {
  const bundle = readBundle()
  if (limit && limit > 0) {
    return bundle.history.slice(0, limit)
  }
  return bundle.history
}

export function clearDrawHistory(): void {
  const bundle = readBundle()
  bundle.history = []
  writeBundle(bundle)
}
