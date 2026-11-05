// ============================================================
// 数据目录迁移（纯文件操作，便于单元测试）
//
// 约束：
//   - 目标目录必须为空或不存在（避免覆盖用户已有文件）
//   - 复制前做写权限预检
//   - 失败时清理目标目录中已写入的内容
//   - 不复制 electron-data（Chromium 会话缓存，重启后重建）
// ============================================================

import * as fs from 'fs'
import * as path from 'path'

export interface MigrateDataDirResult {
  ok: boolean
  error?: string
  targetDir?: string
  copiedEntries?: number
}

const SKIP_ENTRIES = new Set(['electron-data', '.restore-request.json'])

export function migrateDataDir(
  currentDir: string,
  targetDirRaw: string,
  options?: { beforeCopy?: () => void },
): MigrateDataDirResult {
  const current = path.resolve(currentDir)
  const target = path.resolve(String(targetDirRaw || ''))
  if (!targetDirRaw) return { ok: false, error: '未指定目标目录' }
  if (target === current) return { ok: false, error: '目标目录与当前数据目录相同' }
  if (!fs.existsSync(current)) return { ok: false, error: '当前数据目录不存在' }

  try {
    if (fs.existsSync(target)) {
      if (fs.readdirSync(target).length > 0) {
        return { ok: false, error: '目标目录必须为空，请选择空目录或新建一个目录' }
      }
    } else {
      fs.mkdirSync(target, { recursive: true })
    }

    // 写权限预检
    const probe = path.join(target, '.write-probe')
    fs.writeFileSync(probe, 'ok', 'utf-8')
    fs.unlinkSync(probe)

    // 迁移前回调（例如创建安全快照）
    options?.beforeCopy?.()

    let copiedEntries = 0
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (SKIP_ENTRIES.has(entry.name)) continue
      fs.cpSync(path.join(current, entry.name), path.join(target, entry.name), { recursive: true })
      copiedEntries++
    }

    return { ok: true, targetDir: target, copiedEntries }
  } catch (e) {
    // 目标目录已被校验为空目录，失败时清理半成品是安全的
    try {
      for (const name of fs.readdirSync(target)) {
        fs.rmSync(path.join(target, name), { recursive: true, force: true })
      }
    } catch {
      /* noop */
    }
    return { ok: false, error: (e as Error).message || '迁移数据目录失败' }
  }
}
