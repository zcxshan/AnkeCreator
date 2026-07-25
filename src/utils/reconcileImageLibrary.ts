// ============================================================
// reconcileImageLibrary:修复资源库 DB 与磁盘的不一致
//
// 背景: v13 发现 handleLocalUpload 的 folders.find bug 导致数据污染
// - 物理文件在根目录 (data/images/8.png)
// - DB 标为子目录 001 (folderId: 'e0bc8e31...', url: 'local://8.png')
// - 根目录扫描时,8.png 物理在根 → 显示 → 用户看到"根目录显示子目录图片"
//
// 修复:本函数对每个 item 比对"URL 对应的物理路径"与"folderId 对应的期望物理路径"
// - 一致 → 不变
// - 不一致 → 以磁盘实际位置为准,修正 folderId
// - URL 图片 (http://) 跳过
//
// 调用:UI refresh() 在 listImageLibraryItems 返回后跑一遍 reconcile
//      然后调用 updateImageLibraryItem 持久化修正后的 folderId
// ============================================================

import path from 'path'

export interface ReconcileItem {
  /** DB 当前 folderId */
  folderId: string | null
  /** DB 当前 url */
  url: string
}

export interface ReconcileResult {
  /** 修正后的 folderId */
  folderId: string | null
  /** 修正后的 url (本函数不改 url) */
  url: string
  /** 是否做了修正 */
  changed: boolean
  /** 修正原因 (changed=true 时) */
  reason?: 'moved-from-root-to-folder' | 'moved-from-folder-to-root' | 'folder-changed'
}

/**
 * 修正单个 item 的 folderId,使其与磁盘实际位置一致
 *
 * @param item 待修正的 item
 * @param imagesDir 根目录 (data/images/)
 * @param buildFolderDiskPath 把 folderId 解析为磁盘路径的函数 (从 db-main 注入)
 * @returns 修正后的 folderId + url + 是否变化 + 原因
 */
export function reconcileImageLibraryItem(
  item: ReconcileItem,
  imagesDir: string,
  buildFolderDiskPath: (folderId: string) => string | null,
): ReconcileResult {
  // 跳过 URL 图片 (无磁盘文件)
  if (!item.url.startsWith('local://')) {
    return { folderId: item.folderId, url: item.url, changed: false }
  }

  // 1. 解析 URL 对应的物理路径
  const urlPath = item.url.replace(/^local:\/\//, '')
  const actualPath = path.join(imagesDir, urlPath)

  // 2. 解析 folderId 对应的期望物理路径
  let expectedPath: string
  if (item.folderId) {
    const nestedPath = buildFolderDiskPath(item.folderId)
    if (!nestedPath) {
      // folderId 无效 (找不到对应文件夹) → 回退根目录
      return {
        folderId: null,
        url: item.url,
        changed: true,
        reason: 'moved-from-folder-to-root',
      }
    }
    expectedPath = nestedPath
  } else {
    expectedPath = imagesDir
  }

  // 3. 比较物理路径的父目录
  const actualDir = path.dirname(actualPath)
  if (normalizePath(actualDir) === normalizePath(expectedPath)) {
    // 一致 → 不变
    return { folderId: item.folderId, url: item.url, changed: false }
  }

  // 4. 不一致 → 以磁盘实际位置为准
  // 文件实际在根目录 → folderId 应该是 null
  if (normalizePath(actualDir) === normalizePath(imagesDir)) {
    return {
      folderId: null,
      url: item.url,
      changed: true,
      reason: 'moved-from-folder-to-root',
    }
  }

  // 文件实际在某个子目录,但 folderId 不对
  // 这里我们只把 folderId 设为 null (根目录归属),因为反向解析 folderId 太复杂
  // 用户可以手动拖到正确位置
  return {
    folderId: null,
    url: item.url,
    changed: true,
    reason: 'folder-changed',
  }
}

/**
 * 批量 reconcile:对 items 数组逐个跑 reconcile
 * 只返回有变化的 item (减少 DB 写操作)
 */
export function reconcileImageLibraryItems<T extends ReconcileItem>(
  items: T[],
  imagesDir: string,
  buildFolderDiskPath: (folderId: string) => string | null,
): Array<{ id: string; newFolderId: string | null; reason: string }> {
  const changes: Array<{ id: string; newFolderId: string | null; reason: string }> = []
  for (const item of items) {
    const result = reconcileImageLibraryItem(item, imagesDir, buildFolderDiskPath)
    if (result.changed) {
      changes.push({
        id: (item as T & { id: string }).id,
        newFolderId: result.folderId,
        reason: result.reason || 'unknown',
      })
    }
  }
  return changes
}

/** 规范化路径用于比较 (处理分隔符差异) */
function normalizePath(p: string): string {
  return path.normalize(p).replace(/\\/g, '/')
}
