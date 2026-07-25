// ============================================================
// 图片 IPC
//
// - image:select: 弹系统选图对话框，返回 base64 + filename + mimeType + filePath
// - image:saveLocal: 把图片写入 <dataRoot>/images/，返回 local://xxx 协议 URL
//   （打包 = <安装路径>/data/images/，dev = <项目根>/data/images/）
// - image:openFolder: 用系统文件管理器打开本地图片目录
//
// **不**写 base64 data URL 到数据库（确保图片 URL 一定可访问）
// ============================================================

import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { getImagesDir } from './paths'
import { appendUrlRecord } from '../src/utils/urlRecordStore'
import { buildFolderDiskPath, reconcileImageLibrary, syncDiskToDb } from './db-main'
// v10 抽函数:扫描逻辑提到 src/utils/scanImageDirectory.ts,纯逻辑可单测
// 这里 import 是给本文件内部用(IPC handler 调用),export 是给外部测试/调用
import { scanImageDirectory, sanitizeFolderName, computeSaveLocalTarget } from '../src/utils/scanImageDirectory'
export { scanImageDirectory, sanitizeFolderName, computeSaveLocalTarget } from '../src/utils/scanImageDirectory'
import { validateLocalUrlForFileOp } from '../src/utils/parseLocalUrl'

/** 把文件名清理为可作为文件名的安全字符串：剔除路径分隔符与 Windows 非法字符，
 *  防止 a/b.exe、../../../etc/passwd 等路径穿越。 */
function sanitizeFilename(name: string): string {
  if (!name) return ''
  // 统一路径分隔符
  let base = String(name).replace(/\\/g, '/')
  // 取最后一个 / 后部分（防止 a/b 形式）
  const parts = base.split('/').filter(Boolean)
  base = parts[parts.length - 1] || ''
  // 清理 Windows 非法字符
  base = base.replace(/[\\/:*?"<>|]/g, '_')
  // 剔除控制字符
  base = base.replace(/[\x00-\x1f\x7f]/g, '')
  // 截断过长
  base = base.trim().slice(0, 200)
  if (!base || base === '.' || base === '..') return ''
  return base
}

/** 在目标目录下找一个不冲突的文件路径：
 *  若 <dir>/<base>.<ext> 不存在则直接返回；
 *  否则尝试 <dir>/<base> (1).<ext>、<dir>/<base> (2).<ext>，... */
function ensureUniqueFilePath(dir: string, baseName: string, ext: string): string {
  const fs = require('fs')
  const path = require('path')
  // 分离 basename 与 ext（baseName 可能含扩展名）
  const m = baseName.match(/^(.*?)(\.[^.]+)?$/)
  const stem = (m && m[1]) ? m[1] : baseName
  const finalExt = (m && m[2]) ? m[2] : ext
  const first = path.join(dir, `${stem}${finalExt}`)
  if (!fs.existsSync(first)) return first
  let i = 1
  // 上限 9999 防死循环
  while (i < 10000) {
    const candidate = path.join(dir, `${stem} (${i})${finalExt}`)
    if (!fs.existsSync(candidate)) return candidate
    i++
  }
  return first
}

/** 注册所有图片相关 IPC handler */
export function registerImageIpc(getWindow: () => BrowserWindow | null): void {
  // image:select：弹系统选图对话框，直接读文件返回 base64+filename+mimeType+filePath
  // 改动 6：支持批量选择（多选）
  // payload.multiple=true 时返回数组，单选时返回单个对象（兼容旧 API）
  ipcMain.handle(
    'image:select',
    async (
      _e,
      payload?: { multiple?: boolean },
    ): Promise<
      | { buffer: string; filename: string; mimeType: string; filePath?: string }
      | Array<{ buffer: string; filename: string; mimeType: string; filePath?: string }>
      | null
    > => {
      const win = getWindow()
      if (!win) return null
      const multiple = !!payload?.multiple
      const result = await dialog.showOpenDialog(win, {
        title: multiple ? '选择图片（可多选）' : '选择图片',
        properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
        filters: [
          { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
        ],
      })
      if (result.canceled || result.filePaths.length === 0) return null
      const buildEntry = (p: string) => {
        const data = fs.readFileSync(p)
        const extRaw = path.extname(p).toLowerCase().replace(/^\./, '') || 'png'
        const ext = extRaw === 'jpg' ? 'jpeg' : extRaw
        return {
          buffer: data.toString('base64'),
          filename: path.basename(p),
          mimeType: `image/${ext}`,
          filePath: p,
        }
      }
      try {
        if (multiple) {
          return result.filePaths.map(buildEntry)
        }
        return buildEntry(result.filePaths[0])
      } catch (e) {
        console.error('读取图片失败:', e)
        return null
      }
    },
  )

  // image:saveLocal：把图片写入 <dataRoot>/images/[<folderName>/]<safeName>，返回 local://xxx 协议 URL
  // 改动 7：支持 folderId + folderName，写入对应子目录
  // 改动 v3：磁盘文件 = 用户原始 filename（清理路径穿越 + 重复时 (1)(2)... 后缀），不再用 sha256 哈希
  // - 旧格式：local://<hash>.<ext>            （无 folder，存到 images/ 根目录）
  // - 新格式：local://<folderName>/<safeName>.<ext> （有 folder，存到 images/<folderName>/）
  // - 新格式：local://<safeName>.<ext>        （无 folder，存到 images/ 根目录）
  ipcMain.handle(
    'image:saveLocal',
    async (
      _e,
      payload: {
        buffer: string
        filename: string
        mimeType: string
        folderId?: string | null
        folderName?: string
      },
    ): Promise<{ ok: boolean; url?: string; error?: string }> => {
      try {
        const buf = Buffer.from(payload.buffer, 'base64')
        // 解析文件名 → 清理 + 推断扩展名
        const safeName = sanitizeFilename(payload.filename)
        if (!safeName) {
          return { ok: false, error: '文件名无效' }
        }
        // 从 mimeType 推断扩展名（fallback）
        const mime = (payload.mimeType || '').toLowerCase()
        let mimeExt = ''
        if (mime.includes('png')) mimeExt = '.png'
        else if (mime.includes('jpeg') || mime.includes('jpg')) mimeExt = '.jpg'
        else if (mime.includes('gif')) mimeExt = '.gif'
        else if (mime.includes('webp')) mimeExt = '.webp'
        else if (mime.includes('bmp')) mimeExt = '.bmp'
        else if (mime.includes('svg')) mimeExt = '.svg'
        // 从 safeName 提取扩展名（优先）
        const nameExt = (safeName.match(/\.[^.]+$/) || [''])[0].toLowerCase()
        const ext = nameExt || mimeExt || '.png'

        // 计算目标子目录
        // v6 修复：用 folderId + buildFolderDiskPath 支持多级嵌套子目录
        // v11 修复：抽成纯函数 computeSaveLocalTarget,便于单元测试
        const { destDir, urlPrefix } = computeSaveLocalTarget({
          imagesDir: getImagesDir(),
          folderId: payload.folderId ?? null,
          folderName: payload.folderName,
          resolveFolderPath: (folderId) => buildFolderDiskPath(folderId),
        })
        if (destDir !== getImagesDir() && !fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true })
        }

        // 找一个不冲突的最终路径
        const finalPath = ensureUniqueFilePath(destDir, safeName, ext)
        const urlFile = path.basename(finalPath)
        const finalUrl = urlPrefix + urlFile

        if (!fs.existsSync(finalPath)) {
          fs.writeFileSync(finalPath, buf)
        }
        return { ok: true, url: finalUrl }
      } catch (e) {
        console.error('[image:saveLocal] 写入失败:', e)
        return { ok: false, error: (e as Error).message || '本地保存失败' }
      }
    },
  )

  // image:scanFiles：扫描 <dataRoot>/images/ 下所有图片（只到顶级，不递归）
  // 改动 8：让资源库能识别手动保存的图片
  // 改动 v3.1：扫描只到顶级
  // - 如果传 folderId，则只扫 <imagesDir>/<嵌套路径>/ 顶级
  // - 如果不传，则只扫 <imagesDir>/ 顶级（不递归到子目录）
  // 子目录被视为独立项（用户可点入），其文件不在父级显示
  // v6 修复：用 folderId + buildFolderDiskPath 支持多级嵌套
  // v10 修复：抽成纯函数 export 出来以便测试
  ipcMain.handle(
    'image:scanFiles',
    async (
      _e,
      payload?: { folderId?: string; folderName?: string },
    ): Promise<{
      files: Array<{ path: string; filename: string; url: string; mtime: number; size: number; folder?: string }>
    }> => {
      const result = scanImageDirectory({
        imagesDir: getImagesDir(),
        folderId: payload?.folderId,
        folderName: payload?.folderName,
        resolveFolderPath: (folderId) => buildFolderDiskPath(folderId),
      })
      console.log('[image:scanFiles] 扫描目录:', result.scanDir, '找到', result.files.length, '个文件（非递归）')
      return { files: result.files }
    },
  )

  // image:openFolder：用系统文件管理器打开本地图片目录
  // 修复 #4：先确保目录存在（未启用本地上传时目录可能不存在）
  ipcMain.handle(
    'image:openFolder',
    async (): Promise<{ ok: boolean; error?: string }> => {
      try {
        const dir = getImagesDir()
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        const res = await shell.openPath(dir)
        if (res) {
          return { ok: false, error: res }
        }
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },
  )

  // image:deleteLocal：删除本地图片文件（按 local:// URL）
  // 修复资源库图片"删除不了"——之前 db.deleteImageLibraryItem 只删 DB 记录，
  // 磁盘文件残留 → 刷新时磁盘扫描又把它显示出来，看起来"删除不了"。
  // url 格式：local://xxx.ext（旧）或 local://<folderName>/xxx.ext（新）
  ipcMain.handle(
    'image:deleteLocal',
    async (
      _e,
      payload: { url: string },
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        // v25 修复：用 validateLocalUrlForFileOp 替代 buggy 的正则解析
        // 修复前：imageUploader 内部用 replace(/^local:\/\//, '') + 手动安全检查
        //   - 拒绝 v22 后的 local:/// 三斜杠格式（带前导 / 触发 startsWith('/')）
        // 修复后：复用 parseLocalUrl.ts 的纯函数，URL API 正确处理双格式
        const parsed = validateLocalUrlForFileOp(payload?.url || '')
        if (!parsed.ok) {
          return { ok: false, error: parsed.error }
        }
        const fullPath = path.join(getImagesDir(), parsed.relPath)
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath)
        }
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message || '删除失败' }
      }
    },
  )

  // image:renameLocal：重命名本地图片文件（按 local:// URL → 新文件名）
  // 改动 v3：用户重命名 UI 上的 filename 时，同步改磁盘文件（仅 local:// 图片）。
  // 改动 v3.1：始终用旧扩展名——剥离 newFilename 中的扩展名片段，由磁盘文件决定扩展名。
  // payload: { oldUrl: string, newFilename: string }
  // 返回：{ ok, newUrl, error? }  失败时 newUrl 不返回
  ipcMain.handle(
    'image:renameLocal',
    async (
      _e,
      payload: { oldUrl: string; newFilename: string },
    ): Promise<{ ok: boolean; newUrl?: string; error?: string }> => {
      try {
        // v25 修复：同 image:deleteLocal，用 validateLocalUrlForFileOp
        const parsed = validateLocalUrlForFileOp(payload?.oldUrl || '')
        if (!parsed.ok) {
          return { ok: false, error: parsed.error }
        }
        const safeName = sanitizeFilename(payload.newFilename)
        if (!safeName) {
          return { ok: false, error: '新文件名无效' }
        }
        const oldFullPath = path.join(getImagesDir(), parsed.relPath)
        if (!fs.existsSync(oldFullPath)) {
          return { ok: false, error: '源文件不存在' }
        }
        // 修复：剥离扩展名（如果用户输入包含 .xxx，去掉最后一段）
        // 扩展名由磁盘文件决定，用户不能改
        const dotIdx = safeName.lastIndexOf('.')
        const stemOnly = dotIdx > 0 ? safeName.slice(0, dotIdx) : safeName
        if (!stemOnly) {
          return { ok: false, error: '新文件名无效' }
        }
        const oldExt = path.extname(oldFullPath).toLowerCase()
        const ext = oldExt || '.png'
        // 目标目录 = 旧文件所在目录
        const destDir = path.dirname(oldFullPath)
        // 找一个不冲突的最终路径
        const finalPath = ensureUniqueFilePath(destDir, stemOnly, ext)
        // 重命名
        fs.renameSync(oldFullPath, finalPath)
        // 构造新 url：保持原 urlPrefix（local:// 或 local://<folder>/）
        const urlPrefix = payload.oldUrl.replace(/\/[^/]*$/, '/')  // 保留到最后一个 / 之前
        const newUrl = urlPrefix + path.basename(finalPath)
        return { ok: true, newUrl }
      } catch (e) {
        return { ok: false, error: (e as Error).message || '重命名失败' }
      }
    },
  )

  // image:appendUrlRecord：把 URL 上传记录追加到 <imagesDir>/[<folderName>/].urls.json
  // 改动 v5：每个文件夹（根 + 子）维护自己的 .urls.json，记录该目录下所有 URL 上传图片
  // 改动 v11：同时支持 folderId 和 folderName，folderId 优先（解决嵌套子目录 URL 记录错位问题）
  // - folderId 优先：用 buildFolderDiskPath 解析到精确磁盘路径
  // - 退一步用 folderName：拼接到 images/<folderName>/
  // - 都不传 → 根目录
  // payload: { folderId?: string, folderName?: string, record: { url, filename, created_at } }
  // 返回：{ ok, count }
  ipcMain.handle(
    'image:appendUrlRecord',
    async (
      _e,
      payload: {
        folderId?: string | null
        folderName?: string
        record: { url: string; filename: string; created_at: string }
      },
    ): Promise<{ ok: boolean; count?: number; error?: string }> => {
      // v11 修复：用 computeSaveLocalTarget 统一解析目标 dir,避免嵌套场景写错
      const { destDir } = computeSaveLocalTarget({
        imagesDir: getImagesDir(),
        folderId: payload.folderId ?? null,
        folderName: payload.folderName,
        resolveFolderPath: (folderId) => buildFolderDiskPath(folderId),
      })
      const result = appendUrlRecord({ dir: destDir, record: payload.record })
      return { ok: result.ok, count: result.count, error: result.error }
    },
  )

  // v13：资源库 reconcile
  // 调用 db-main 的 reconcileImageLibrary(),把 DB 中 folderId 与磁盘不一致的 item 修正
  // - 文件实际在根目录但 DB folderId 是某个子目录 → folderId 设为 null
  // - folderId 指向已删除的文件夹 → folderId 设为 null
  // - URL 图片 (http://) 跳过
  // 返回: 修正的 item 列表 (id, newFolderId, reason)
  ipcMain.handle(
    'image:reconcile',
    async (): Promise<{
      ok: boolean
      changes: Array<{ id: string; newFolderId: string | null; reason: string }>
      error?: string
    }> => {
      try {
        const changes = reconcileImageLibrary()
        return { ok: true, changes }
      } catch (e) {
        console.error('[image:reconcile] 失败:', e)
        return { ok: false, changes: [], error: (e as Error).message || 'reconcile 失败' }
      }
    },
  )

  // 全量同步磁盘 data/images → DB（folders + items 一次性完成）
  // 调用 db-main 的 syncDiskToDb()：
  // - 磁盘子目录递归识别为 DB folder（同名同父级复用）
  // - 磁盘有但 DB 没有 → 新增 local item
  // - DB 有但磁盘没有且 source='local' → 删除（source='url' 不动）
  // 返回：{ ok, foldersCreated, foldersReused, itemsAdded, itemsDeleted, error? }
  ipcMain.handle(
    'image:syncDiskToDb',
    async (): Promise<{
      ok: boolean
      foldersCreated: number
      foldersReused: number
      itemsAdded: number
      itemsDeleted: number
      error?: string
    }> => {
      try {
        const result = syncDiskToDb()
        return { ok: true, ...result }
      } catch (e) {
        console.error('[image:syncDiskToDb] 失败:', e)
        return {
          ok: false,
          foldersCreated: 0,
          foldersReused: 0,
          itemsAdded: 0,
          itemsDeleted: 0,
          error: (e as Error).message || 'syncDiskToDb 失败',
        }
      }
    },
  )

  // v19: IPC 兜底 — 当 local:// 协议加载失败时，通过 IPC 读取图片为 data URL
  // 用于 ImageLibraryPage 的 onError 回退
  ipcMain.handle(
    'image:readAsDataUrl',
    async (
      _e,
      payload: { url: string },
    ): Promise<{ ok: boolean; dataUrl?: string; error?: string }> => {
      try {
        if (!payload?.url || !payload.url.startsWith('local://')) {
          return { ok: false, error: '非本地 URL' }
        }
        const { parseLocalUrlToFileName } = await import('../src/utils/parseLocalUrl')
        const fileName = parseLocalUrlToFileName(payload.url)
        const imagesDir = getImagesDir()
        const filePath = path.join(imagesDir, fileName)
        const normalized = path.normalize(filePath)
        // 防路径穿越
        if (
          !normalized.startsWith(path.normalize(imagesDir) + path.sep) &&
          normalized !== path.normalize(imagesDir)
        ) {
          return { ok: false, error: '非法路径' }
        }
        if (!fs.existsSync(normalized)) {
          return { ok: false, error: '文件不存在' }
        }
        const data = fs.readFileSync(normalized)
        const ext = path.extname(normalized).toLowerCase()
        const mime =
          ext === '.png' ? 'image/png' :
          ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
          ext === '.gif' ? 'image/gif' :
          ext === '.webp' ? 'image/webp' :
          ext === '.bmp' ? 'image/bmp' :
          ext === '.svg' ? 'image/svg+xml' :
          'application/octet-stream'
        const dataUrl = `data:${mime};base64,${data.toString('base64')}`
        return { ok: true, dataUrl }
      } catch (e) {
        return { ok: false, error: (e as Error).message || '读取失败' }
      }
    },
  )
}
