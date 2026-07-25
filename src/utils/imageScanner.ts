// ============================================================
// 图片目录扫描（pure logic，可被 renderer/electron 共享测试）
//
// 行为：扫描指定目录的图片文件，**只到顶级，不递归**
// - 跳过隐藏文件（.xxx）
// - 跳过非图片扩展名
// - 跳过子目录（isFile() 检查）
//
// 提取此函数的原因：
// 1. 单元可测（imageUploader.test.ts）
// 2. electron 主进程和未来 renderer 都可复用
// ============================================================

import path from 'path'

export const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
])

export interface ScannedImage {
  path: string
  filename: string
  url: string
  mtime: number
  size: number
  folder?: string
}

export interface ScanOptions {
  baseDir: string
  folderName?: string
}

/**
 * 扫描指定目录的图片文件，**只到顶级，不递归**。
 *
 * @param opts.baseDir     物理根目录（如 `<dataRoot>/images`）
 * @param opts.folderName  可选：扫描 baseDir 下的子目录（如 `001`）
 * @returns 文件列表；如果目录不存在返回空数组
 */
export function scanImageDir(opts: ScanOptions): ScannedImage[] {
  // 延迟依赖：fs 在测试时可被 mock；用 require 而非 import 以避免 ESM 问题
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs')

  const folderName = opts.folderName
  const baseDir = folderName
    ? path.join(opts.baseDir, folderName)
    : opts.baseDir

  if (!fs.existsSync(baseDir)) return []

  // 修复 v3.1：只扫描顶级文件，不递归
  // - 不传 folderName：只看 baseDir 顶级
  // - 传 folderName：只看 baseDir/<folderName> 顶级
  // 子目录视为独立项，不递归进它们的内部
  // v7 修复：用 path.relative 计算完整相对路径，支持多级嵌套子目录
  const urlPrefix = folderName
    ? `local://${path.relative(opts.baseDir, baseDir).replace(/\\/g, '/')}/`
    : 'local://'
  const result: ScannedImage[] = []

  for (const name of fs.readdirSync(baseDir)) {
    if (name.startsWith('.')) continue
    const full = path.join(baseDir, name)
    const stat = fs.statSync(full)
    if (!stat.isFile()) continue
    const ext = path.extname(name).toLowerCase()
    if (!IMAGE_EXTS.has(ext)) continue
    result.push({
      path: full,
      filename: name,
      url: urlPrefix + name,
      mtime: stat.mtimeMs,
      size: stat.size,
      folder: folderName || undefined,
    })
  }
  return result
}
