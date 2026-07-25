// ============================================================
// scanImageDirectory 纯函数（pure logic）
//
// 行为：扫描指定目录的图片文件，**只到顶级，不递归**。
// - 跳过隐藏文件（.xxx）
// - 跳过非图片扩展名
// - 跳过子目录（isFile() 检查）
//
// 提取到 src/utils/ 的原因：
// 1. 单元可测（electron/imageUploader.test.ts 可直接测，无需 mock electron）
// 2. electron 主进程和未来 renderer 都可复用
// 3. 与 src/utils/urlRecordStore.ts 等 pure logic 单元同处一地
//
// 修复 v6 背景：image:scanFiles 旧版忽略 folderId + 递归扫描导致
// "资源库子目录泄漏根目录图片"bug。本函数用 folderId + 注入的
// resolveFolderPath 解析嵌套路径，从根本上避免泄漏。
// ============================================================

import path from 'path'
import fs from 'fs'

/** 支持的图片扩展名 */
export const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
])

/** 把文件夹名清理为可作为目录名的安全字符串（剔除 \ / : * ? " < > | 等非法字符） */
export function sanitizeFolderName(name: string): string {
  return (name || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100)
}

export interface ScannedFile {
  path: string
  filename: string
  url: string
  mtime: number
  size: number
  folder?: string
}

export interface ScanImageDirectoryOptions {
  /** 根目录（<dataRoot>/images/） */
  imagesDir: string
  /** 资源库文件夹 ID（优先，支持多级嵌套如 '001/002'） */
  folderId?: string
  /** 旧版兼容：文件夹名（单级） */
  folderName?: string
  /** 把 folderId 解析为磁盘路径的函数（从 db-main.buildFolderDiskPath 注入） */
  resolveFolderPath: (folderId: string) => string | null
}

export interface ScanImageDirectoryResult {
  files: ScannedFile[]
  /** 实际扫描的目录（用于日志/debug） */
  scanDir: string
}

/**
 * 扫描指定目录的图片文件，**只到顶级，不递归**。
 *
 * 行为：
 * - 不传 folderId/folderName → 扫 imagesDir 顶级
 * - 传 folderId → 用 resolveFolderPath 解析为磁盘路径，扫该路径顶级
 *   - resolveFolderPath 返回 null → 回退扫 imagesDir 顶级（防错）
 * - 传 folderName（旧版兼容）→ 扫 imagesDir/<folderName> 顶级
 *
 * @returns files 列表 + scanDir 实际扫描的目录
 */
export function scanImageDirectory(opts: ScanImageDirectoryOptions): ScanImageDirectoryResult {
  const { imagesDir, folderId, folderName, resolveFolderPath } = opts
  // 解析目标子目录
  let baseDir = imagesDir
  let urlPrefix = 'local:///'
  if (folderId) {
    const nestedDir = resolveFolderPath(folderId)
    if (nestedDir) {
      baseDir = nestedDir
      const rel = path.relative(imagesDir, nestedDir).replace(/\\/g, '/')
      urlPrefix = `local:///${rel}/`
    }
  } else if (folderName) {
    baseDir = path.join(imagesDir, sanitizeFolderName(folderName))
    urlPrefix = `local:///${sanitizeFolderName(folderName)}/`
  }
  const result: ScannedFile[] = []
  try {
    if (!fs.existsSync(baseDir)) {
      return { files: [], scanDir: baseDir }
    }
    // v3.1 修复：只扫描顶级文件，不递归
    // - 不传 folderId/folderName：只看 imagesDir 顶级
    // - 传 folderId：只看 imagesDir/<嵌套路径> 顶级
    // 子目录视为独立项，不递归进它们的内部
    for (const name of fs.readdirSync(baseDir)) {
      if (name.startsWith('.')) continue
      const full = path.join(baseDir, name)
      const stat = fs.statSync(full)
      if (!stat.isFile()) continue  // ← 阻止递归到子目录
      const ext = path.extname(name).toLowerCase()
      if (!IMAGE_EXTS.has(ext)) continue
      const url = urlPrefix + name
      result.push({
        path: full,
        filename: name,
        url,
        mtime: stat.mtimeMs,
        size: stat.size,
      })
    }
    return { files: result, scanDir: baseDir }
  } catch {
    return { files: [], scanDir: baseDir }
  }
}

/**
 * 解析 image:saveLocal 的目标子目录 + URL 前缀（纯函数,便于单测）
 * - 优先用 folderId 解析到嵌套目录
 * - 退一步用 folderName 拼接到单层子目录（v5 兼容）
 * - 都不传 → 根目录
 *
 * v11 抽函数,用于单元测试 saveLocal 是否正确写入嵌套子目录
 */
export interface ComputeSaveLocalTargetOptions {
  /** 根目录 imagesDir */
  imagesDir: string
  /** 资源库文件夹 ID(优先,支持多级) */
  folderId?: string | null
  /** 资源库文件夹名(旧版兼容) */
  folderName?: string
  /** 把 folderId 解析为磁盘路径的函数 */
  resolveFolderPath: (folderId: string) => string | null
}

export interface SaveLocalTarget {
  destDir: string
  urlPrefix: string
}

export function computeSaveLocalTarget(
  opts: ComputeSaveLocalTargetOptions,
): SaveLocalTarget {
  const { imagesDir, folderId, folderName, resolveFolderPath } = opts
  // 默认根目录
  let destDir = imagesDir
  let urlPrefix = 'local:///'
  if (folderId) {
    const nestedDir = resolveFolderPath(folderId)
    if (nestedDir) {
      destDir = nestedDir
      const rel = path.relative(imagesDir, nestedDir).replace(/\\/g, '/')
      urlPrefix = `local:///${rel}/`
    }
  } else if (folderName) {
    destDir = path.join(imagesDir, sanitizeFolderName(folderName))
    urlPrefix = `local:///${sanitizeFolderName(folderName)}/`
  }
  return { destDir, urlPrefix }
}
