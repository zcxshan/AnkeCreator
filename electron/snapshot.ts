// ============================================================
// 本地自动快照（数据安全网）
//
// 设计：
//   - 每日启动时对 stories/ + sections/（以及 templates/、wheels.json）做一次快照
//   - 快照使用真实文件副本（不共享 inode），保证任何写入方式都不会污染历史快照
//   - 只保留最近 7 份，超出自动清理
//   - 恢复前先把「当前数据」完整备份到 backup/pre-restore-<时间戳>/，再覆盖
//
// 为什么不用硬链接：应用里仍有少量非原子的直接写（如回收站移动），
// 硬链接会让这类写入同时改坏历史快照。正文侧车拆分后文本量很小，
// 每天一份副本的成本可以接受，安全性优先。
// ============================================================

import * as fs from 'fs'
import * as path from 'path'

const SNAPSHOT_DIR = 'snapshots'
const SNAPSHOT_ENTRIES = ['stories', 'sections', 'templates', 'wheels.json'] as const

export interface SnapshotInfo {
  /** 快照目录名（YYYY-MM-DD 或 YYYY-MM-DD-HHMMSS） */
  name: string
  createdAt: string
  storyFiles: number
  sectionFiles: number
  totalBytes: number
}

export interface RestoreResult {
  name: string
  /** 恢复前当前数据的备份目录（绝对路径） */
  safetyBackup: string
  restoredEntries: string[]
}

function snapshotRoot(dataDir: string): string {
  return path.join(dataDir, SNAPSHOT_DIR)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function dateStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function timeStamp(d: Date): string {
  return `${dateStamp(d)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function isSafeSnapshotName(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(-\d{6})?$/.test(name)
}

/** 递归复制目录（真实副本，不与源文件共享 inode） */
function cloneTree(src: string, dest: string): void {
  let stat: fs.Stats
  try {
    stat = fs.statSync(src)
  } catch {
    return
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      cloneTree(path.join(src, entry.name), path.join(dest, entry.name))
    }
    return
  }
  if (!stat.isFile()) return
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
}

function countFiles(dir: string, ext: string): number {
  if (!fs.existsSync(dir)) return 0
  let count = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) count += countFiles(full, ext)
    else if (entry.name.endsWith(ext)) count++
  }
  return count
}

function dirSize(dir: string): number {
  if (!fs.existsSync(dir)) return 0
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += dirSize(full)
    else {
      try {
        total += fs.statSync(full).size
      } catch {
        /* 跳过无法读取的文件 */
      }
    }
  }
  return total
}

function buildInfo(snapDir: string, name: string): SnapshotInfo {
  let createdAt = ''
  try {
    createdAt = fs.statSync(snapDir).birthtime.toISOString()
  } catch {
    createdAt = new Date().toISOString()
  }
  return {
    name,
    createdAt,
    storyFiles: countFiles(path.join(snapDir, 'stories'), '.json'),
    sectionFiles: countFiles(path.join(snapDir, 'sections'), '.json'),
    totalBytes: dirSize(snapDir),
  }
}

/** 删除超过 keep 份的旧快照（按名字倒序，名字即时间） */
export function pruneSnapshots(dataDir: string, keep = 7): string[] {
  const root = snapshotRoot(dataDir)
  if (!fs.existsSync(root)) return []
  const names = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isSafeSnapshotName(e.name))
    .map((e) => e.name)
    .sort()
    .reverse()
  const removed: string[] = []
  for (const name of names.slice(keep)) {
    try {
      fs.rmSync(path.join(root, name), { recursive: true, force: true })
      removed.push(name)
    } catch (e) {
      console.warn('[snapshot] 清理旧快照失败:', name, e)
    }
  }
  return removed
}

/** 创建一份快照；同名快照已存在时直接返回其信息（幂等） */
export function createSnapshot(
  dataDir: string,
  name: string,
): SnapshotInfo | null {
  if (!isSafeSnapshotName(name)) throw new Error(`非法快照名称：${name}`)
  const root = snapshotRoot(dataDir)
  const snapDir = path.join(root, name)
  if (fs.existsSync(snapDir)) {
    const info = buildInfo(snapDir, name)
    return info.storyFiles + info.sectionFiles === 0 ? null : info
  }
  fs.mkdirSync(root, { recursive: true })
  const tmpDir = path.join(root, `.tmp-${name}-${process.pid}`)
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.mkdirSync(tmpDir, { recursive: true })
    let copied = 0
    for (const entry of SNAPSHOT_ENTRIES) {
      const src = path.join(dataDir, entry)
      if (!fs.existsSync(src)) continue
      cloneTree(src, path.join(tmpDir, entry))
      copied++
    }
    if (copied === 0) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      return null
    }
    // 原子生效：避免把写了一半的快照当作可用快照
    fs.renameSync(tmpDir, snapDir)
  } catch (e) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* noop */
    }
    throw e
  }
  return buildInfo(snapDir, name)
}

/** 每日快照（同一天只建一次）；返回本次新建或已存在的信息 */
export function ensureDailySnapshot(dataDir: string, now = new Date()): SnapshotInfo | null {
  const info = createSnapshot(dataDir, dateStamp(now))
  if (info) pruneSnapshots(dataDir, 7)
  return info
}

/** 手动快照（精确到秒，允许一天多次） */
export function createManualSnapshot(dataDir: string, now = new Date()): SnapshotInfo | null {
  const info = createSnapshot(dataDir, timeStamp(now))
  if (info) pruneSnapshots(dataDir, 7)
  return info
}

/** 列出全部快照（最新在前） */
export function listSnapshots(dataDir: string): SnapshotInfo[] {
  const root = snapshotRoot(dataDir)
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isSafeSnapshotName(e.name))
    .map((e) => buildInfo(path.join(root, e.name), e.name))
    .sort((a, b) => b.name.localeCompare(a.name))
}

/**
 * 恢复指定快照。
 * 安全保证：先把当前数据完整复制到 backup/pre-restore-<时间戳>/，
 * 再删除并重建 stories/、sections/ 等条目（复制而非硬链接，避免与快照共享 inode）。
 */
export function restoreSnapshot(dataDir: string, name: string): RestoreResult {
  if (!isSafeSnapshotName(name)) throw new Error(`非法快照名称：${name}`)
  const snapDir = path.join(snapshotRoot(dataDir), name)
  if (!fs.existsSync(snapDir)) throw new Error(`快照不存在：${name}`)

  const safetyBackup = path.join(dataDir, 'backup', `pre-restore-${timeStamp(new Date())}`)
  fs.mkdirSync(safetyBackup, { recursive: true })
  const restoredEntries: string[] = []

  // 1) 备份当前数据
  for (const entry of SNAPSHOT_ENTRIES) {
    const src = path.join(dataDir, entry)
    if (!fs.existsSync(src)) continue
    cloneTree(src, path.join(safetyBackup, entry))
  }

  // 2) 用快照覆盖
  for (const entry of SNAPSHOT_ENTRIES) {
    const src = path.join(snapDir, entry)
    if (!fs.existsSync(src)) continue
    const dest = path.join(dataDir, entry)
    fs.rmSync(dest, { recursive: true, force: true })
    cloneTree(src, dest)
    restoredEntries.push(entry)
  }

  return { name, safetyBackup, restoredEntries }
}

// ============================================================
// 恢复请求：写入标记，重启后在下一次启动、数据库初始化之前执行
//
// 这样恢复时不会与应用运行中的写入竞争，且恢复前能完整备份「重启前状态」。
// ============================================================

const RESTORE_MARKER = '.restore-request.json'

export function requestRestore(dataDir: string, name: string): void {
  if (!isSafeSnapshotName(name)) throw new Error(`非法快照名称：${name}`)
  const snapDir = path.join(snapshotRoot(dataDir), name)
  if (!fs.existsSync(snapDir)) throw new Error(`快照不存在：${name}`)
  const marker = path.join(dataDir, RESTORE_MARKER)
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(marker, JSON.stringify({ name, requestedAt: new Date().toISOString() }), 'utf-8')
}

/** 启动时消费恢复请求；没有请求返回 null */
export function consumeRestoreRequest(dataDir: string): RestoreResult | null {
  const marker = path.join(dataDir, RESTORE_MARKER)
  if (!fs.existsSync(marker)) return null
  let name = ''
  try {
    const raw = JSON.parse(fs.readFileSync(marker, 'utf-8'))
    name = String(raw?.name ?? '')
  } catch {
    name = ''
  }
  try {
    if (!name || !isSafeSnapshotName(name)) throw new Error('恢复请求中的快照名非法')
    const result = restoreSnapshot(dataDir, name)
    fs.rmSync(marker, { force: true })
    return result
  } catch (e) {
    // 标记损坏或快照丢失：删除标记避免每次启动重复失败，并保留当前数据不动
    console.error('[snapshot] 恢复请求执行失败:', e)
    try {
      fs.rmSync(marker, { force: true })
    } catch {
      /* noop */
    }
    return null
  }
}
