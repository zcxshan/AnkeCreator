// v14：一次性数据迁移，修复 v13 引入的"根目录"子目录污染
//
// 背景：v13 修复了 handleLocalUpload 的 folders.find bug，但副作用是
//       根目录上传时把 folderName='根目录' 传给 saveImageLocal，
//       导致 computeSaveLocalTarget 创建了 data/images/根目录/ 子目录
//       并把文件写入其中，DB 标 root
//
// 触发条件：item.url 以 'local://根目录/' 开头
// 处理：
//   1. 物理文件：data/images/根目录/<rest> → data/images/<rest>
//   2. url：'local://根目录/<rest>' → 'local://<rest>'
//   3. 删除空的 data/images/根目录/ 目录
//
// 调用时机：initMainDatabase 启动时自动调用（幂等）

import path from 'path'
import fs from 'fs'

export interface ImageLibraryMigrateItem {
  id: string
  url: string
  folderId: string | null
}

export interface MigrateChange {
  id: string
  oldUrl: string
  newUrl: string
  reason: string
}

export interface MigrateResult {
  changes: MigrateChange[]
  deletedRootDir: boolean
}

const ROOT_FOLDER_PREFIX = 'local://根目录/'

/**
 * 迁移函数：移动物理文件 + 修正 url + 删空目录
 *
 * @param items - 资源库 item 列表（id/url/folderId 即可）
 * @param imagesDir - data/images 目录的绝对路径
 * @returns 变更列表 + 是否删除了空的"根目录"子目录
 */
export function migrateV13RootFolderBug(
  items: ImageLibraryMigrateItem[],
  imagesDir: string,
): MigrateResult {
  const changes: MigrateChange[] = []
  for (const item of items) {
    if (!item.url.startsWith(ROOT_FOLDER_PREFIX)) continue
    const rest = item.url.replace(ROOT_FOLDER_PREFIX, '')
    const oldPath = path.join(imagesDir, '根目录', rest)
    const newPath = path.join(imagesDir, rest)
    // 移动物理文件（如果存在）
    if (fs.existsSync(oldPath)) {
      try {
        // 跨驱动器的情况用 stream 拷贝 + 删源,这里简单走 renameSync
        fs.renameSync(oldPath, newPath)
      } catch (e) {
        console.warn(`[migrate] 移动 ${oldPath} → ${newPath} 失败:`, e)
        // 仍然记录 url 变更（DB 改对了，文件后面手动处理）
      }
    }
    const newUrl = `local:///${rest}`
    item.url = newUrl
    changes.push({
      id: item.id,
      oldUrl: `${ROOT_FOLDER_PREFIX}${rest}`,
      newUrl,
      reason: 'v13-root-folder-pollution',
    })
  }
  // 删空目录
  let deletedRootDir = false
  const rootDir = path.join(imagesDir, '根目录')
  if (fs.existsSync(rootDir)) {
    try {
      const entries = fs.readdirSync(rootDir)
      if (entries.length === 0) {
        fs.rmdirSync(rootDir)
        deletedRootDir = true
        console.log('[migrate] 删除空目录:', rootDir)
      }
    } catch {
      // ignore
    }
  }
  return { changes, deletedRootDir }
}
