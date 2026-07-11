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

/** 注册所有图片相关 IPC handler */
export function registerImageIpc(getWindow: () => BrowserWindow | null): void {
  // image:select：弹系统选图对话框，直接读文件返回 base64+filename+mimeType+filePath
  ipcMain.handle(
    'image:select',
    async (): Promise<{ buffer: string; filename: string; mimeType: string; filePath?: string } | null> => {
      const win = getWindow()
      if (!win) return null
      const result = await dialog.showOpenDialog(win, {
        title: '选择图片',
        properties: ['openFile'],
        filters: [
          { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
        ],
      })
      if (result.canceled || !result.filePaths[0]) return null
      const p = result.filePaths[0]
      try {
        const data = fs.readFileSync(p)
        const extRaw = path.extname(p).toLowerCase().replace(/^\./, '') || 'png'
        const ext = extRaw === 'jpg' ? 'jpeg' : extRaw
        return {
          buffer: data.toString('base64'),
          filename: path.basename(p),
          mimeType: `image/${ext}`,
          filePath: p,
        }
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

  // image:saveLocal：把图片写入 <dataRoot>/images/，返回 local://xxx 协议 URL
  // （打包 = <安装路径>/data/images/，dev = %APPDATA%\\...\\images\）
  ipcMain.handle(
    'image:saveLocal',
    async (
      _e,
      payload: { buffer: string; filename: string; mimeType: string },
    ): Promise<{ ok: boolean; url?: string; error?: string }> => {
      try {
        const buf = Buffer.from(payload.buffer, 'base64')
        // sha256[:16] 做文件名（保证唯一 + 防止路径穿越）
        const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
        const m = payload.filename.match(/\.[^.]+$/)
        const ext = m ? m[0].toLowerCase() : '.png'
        const localName = `${hash}${ext}`
        const localPath = path.join(getImagesDir(), localName)
        // 已存在则跳过写入（相同图片不重复写盘）
        if (!fs.existsSync(localPath)) {
          fs.writeFileSync(localPath, buf)
        }
        return { ok: true, url: `local://${localName}` }
      } catch (e) {
        console.error('[image:saveLocal] 写入失败:', e)
        return { ok: false, error: (e as Error).message || '本地保存失败' }
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
