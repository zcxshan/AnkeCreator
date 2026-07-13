// ============================================================
// 图片上传 IPC
//
// - image:select: 弹系统选图对话框，返回 base64 + filename + mimeType + filePath
// - image:upload: 把 base64 buffer 上传到 sm.ms 图床，返回 URL
// - image:saveLocal: 把图片写入 <dataRoot>/images/，返回 local://xxx 协议 URL
//   （打包 = <安装路径>/data/images/，dev = %APPDATA%\\...\\images\）
// - image:openFolder: 用系统文件管理器打开本地图片目录
//
// **不**写 base64 data URL 到数据库（确保图片 URL 一定可访问）
// ============================================================

import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { getImagesDir } from './paths'

/** 把文件夹名清理为可作为目录名的安全字符串（剔除 \ / : * ? " < > | 等非法字符） */
function sanitizeFolderName(name: string): string {
  return (name || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100)
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

  // image:upload：把 base64 buffer 上传到 sm.ms 图床，返回 URL
  ipcMain.handle(
    'image:upload',
    async (
      _e,
      payload: { buffer: string; filename: string; mimeType: string },
    ): Promise<{ ok: boolean; url?: string; error?: string; host?: string }> => {
      try {
        const buf = Buffer.from(payload.buffer, 'base64')
        const { uploadImage } = await import('./imageHosting')
        const res = await uploadImage({
          buffer: buf,
          filename: payload.filename,
          mimeType: payload.mimeType,
        })
        if (res.ok) {
          console.log(
            `[image:upload] 上传成功 (${(res as any).host || 'unknown'}):`,
            res.url,
          )
        } else {
          console.warn('[image:upload] 所有图床失败:', res.error)
        }
        return res
      } catch (e) {
        return { ok: false, error: (e as Error).message || '上传失败' }
      }
    },
  )

  // image:saveLocal：把图片写入 <dataRoot>/images/[<folderName>/]，返回 local://xxx 协议 URL
  // 改动 7：支持 folderId + folderName，写入对应子目录
  // - 旧格式：local://<hash>.<ext>            （无 folder，存到 images/ 根目录）
  // - 新格式：local://<folderName>/<hash>.<ext> （有 folder，存到 images/<folderName>/）
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
        // sha256[:16] 做文件名（保证唯一 + 防止路径穿越）
        const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
        const m = payload.filename.match(/\.[^.]+$/)
        const ext = m ? m[0].toLowerCase() : '.png'
        const localName = `${hash}${ext}`

        // 计算目标子目录
        let destDir = getImagesDir()
        let urlPrefix = 'local://'
        if (payload.folderId && payload.folderName) {
          const safeFolder = sanitizeFolderName(payload.folderName)
          if (safeFolder) {
            destDir = path.join(getImagesDir(), safeFolder)
            urlPrefix = `local://${safeFolder}/`
            if (!fs.existsSync(destDir)) {
              fs.mkdirSync(destDir, { recursive: true })
            }
          }
        }

        const localPath = path.join(destDir, localName)
        // 已存在则跳过写入（相同图片不重复写盘）
        if (!fs.existsSync(localPath)) {
          fs.writeFileSync(localPath, buf)
        }
        return { ok: true, url: `${urlPrefix}${localName}` }
      } catch (e) {
        console.error('[image:saveLocal] 写入失败:', e)
        return { ok: false, error: (e as Error).message || '本地保存失败' }
      }
    },
  )

  // image:scanFiles：扫描 <dataRoot>/images/ 下所有图片（含子目录），返回文件列表
  // 改动 8：让资源库能识别手动保存的图片
  // - 如果传 folderName，则只扫 <imagesDir>/<folderName>/
  // - 如果不传，则递归扫描 <imagesDir>/ 下所有文件和子目录
  ipcMain.handle(
    'image:scanFiles',
    async (
      _e,
      payload?: { folderName?: string },
    ): Promise<{
      files: Array<{ path: string; filename: string; url: string; mtime: number; size: number; folder?: string }>
    }> => {
      const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])
      const baseDir = payload?.folderName
        ? path.join(getImagesDir(), sanitizeFolderName(payload.folderName))
        : getImagesDir()
      const result: Array<{ path: string; filename: string; url: string; mtime: number; size: number; folder?: string }> = []
      try {
        if (!fs.existsSync(baseDir)) {
          return { files: [] }
        }
        const walk = (dir: string, rel: string) => {
          for (const name of fs.readdirSync(dir)) {
            const full = path.join(dir, name)
            const stat = fs.statSync(full)
            if (stat.isDirectory()) {
              walk(full, rel ? `${rel}/${name}` : name)
            } else {
              const ext = path.extname(name).toLowerCase()
              if (!IMAGE_EXTS.has(ext)) continue
              // 跳过 .write-probe 等隐藏文件
              if (name.startsWith('.')) continue
              const urlFolder = rel || ''
              const url = urlFolder ? `local://${urlFolder}/${name}` : `local://${name}`
              result.push({
                path: full,
                filename: name,
                url,
                mtime: stat.mtimeMs,
                size: stat.size,
                folder: urlFolder || undefined,
              })
            }
          }
        }
        walk(baseDir, payload?.folderName ? sanitizeFolderName(payload.folderName) : '')
        // 改动 4-6：增加日志，方便调试磁盘扫描识别
        console.log('[image:scanFiles] 扫描目录:', baseDir, '找到', result.length, '个文件')
        return { files: result }
      } catch (e) {
        console.error('[image:scanFiles] 扫描失败:', e)
        return { files: [] }
      }
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
}
