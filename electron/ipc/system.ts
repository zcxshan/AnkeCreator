// ============================================================
// 系统 IPC（窗口控制 + 数据目录）
// ============================================================

import { BrowserWindow, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import * as db from '../db-main'
import { getSoundsDir, getUserSoundsDir } from '../paths'

/** 注册系统相关 IPC handler */
export function registerSystemIpc(getWindow: () => BrowserWindow | null): void {
  // ---- 窗口控制 ----
  ipcMain.on('window:minimize', () => {
    getWindow()?.minimize()
  })
  ipcMain.on('window:toggle-maximize', () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on('window:close', () => {
    getWindow()?.close()
  })

  // ---- 数据目录 ----
  ipcMain.handle('db:get-data-directory', () => db.getDataDirectory())

  // ---- 显示本地目录（供用户打开保存位置） ----
  ipcMain.handle('app:open-data-directory', async (): Promise<boolean> => {
    try {
      const dir = db.getDataDirectory()
      await (fs.promises as any).mkdir(dir, { recursive: true })
      shell.openPath(dir)
      return true
    } catch (e) {
      console.error('打开数据目录失败:', e)
      return false
    }
  })

  // ---- 骰子音效：合并内置 + 用户上传 ----
  ipcMain.handle('system:list-sounds', (): string[] => {
    try {
      const builtin = listMp3InDir(getSoundsDir())
      const user = listMp3InDir(getUserSoundsDir())
      // 内置去重（防止用户上传同名 dice-roll.mp3 时内置 + 用户并列）
      // 规则：内置在前，用户在后；同名用户文件覆盖内置
      const builtinNames = new Set(builtin)
      const merged = [...builtin]
      for (const f of user) {
        if (!builtinNames.has(f)) merged.push(f)
      }
      // 确保 dice-roll.mp3 始终在第一位（兜底）
      if (!merged.includes('dice-roll.mp3')) merged.unshift('dice-roll.mp3')
      return merged
    } catch (e) {
      console.error('扫描音效目录失败:', e)
      return ['dice-roll.mp3']
    }
  })

  // ---- 骰子音效：上传 mp3 ----
  ipcMain.handle(
    'system:upload-sound',
    async (
      _e,
      payload: { filename: string; buffer: string /* base64 */; mimeType?: string },
    ): Promise<{ ok: boolean; name?: string; error?: string }> => {
      try {
        if (!payload?.filename || !payload?.buffer) {
          return { ok: false, error: '参数缺失' }
        }
        // 文件名校验：只允许 mp3 后缀、纯文件名（无路径）
        const safeName = path.basename(payload.filename)
        if (!/\.mp3$/i.test(safeName)) {
          return { ok: false, error: '仅支持 .mp3 格式' }
        }
        // 禁止覆盖内置 dice-roll.mp3
        if (safeName.toLowerCase() === 'dice-roll.mp3') {
          return { ok: false, error: '"dice-roll.mp3" 是内置音效，不允许覆盖' }
        }
        const buf = Buffer.from(payload.buffer, 'base64')
        if (buf.length > MAX_SOUND_SIZE) {
          return {
            ok: false,
            error: `文件过大（限制 ${MAX_SOUND_SIZE / 1024 / 1024}MB，当前 ${(buf.length / 1024 / 1024).toFixed(2)}MB）`,
          }
        }
        if (buf.length === 0) {
          return { ok: false, error: '文件为空' }
        }
        const dest = path.join(getUserSoundsDir(), safeName)
        // 防止路径穿越：dest 必须在 userSoundsDir 内
        const userDir = path.resolve(getUserSoundsDir())
        if (!path.resolve(dest).startsWith(userDir + path.sep)) {
          return { ok: false, error: '非法文件名' }
        }
        fs.writeFileSync(dest, buf)
        return { ok: true, name: safeName }
      } catch (e) {
        return { ok: false, error: (e as Error).message || '上传失败' }
      }
    },
  )

  // ---- 骰子音效：删除用户上传的 mp3（禁止删除内置） ----
  ipcMain.handle(
    'system:delete-sound',
    (_e, filename: string): { ok: boolean; error?: string } => {
      try {
        const safeName = path.basename(filename)
        if (!safeName || !/\.mp3$/i.test(safeName)) {
          return { ok: false, error: '非法文件名' }
        }
        if (safeName.toLowerCase() === 'dice-roll.mp3') {
          return { ok: false, error: '"dice-roll.mp3" 是内置音效，不允许删除' }
        }
        const userDir = path.resolve(getUserSoundsDir())
        const target = path.resolve(userDir, safeName)
        if (!target.startsWith(userDir + path.sep)) {
          return { ok: false, error: '非法路径' }
        }
        if (!fs.existsSync(target)) {
          return { ok: false, error: '文件不存在' }
        }
        fs.unlinkSync(target)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message || '删除失败' }
      }
    },
  )

  // ---- 骰子音效：读取用户上传 mp3 为 base64 data URL ----
  ipcMain.handle(
    'system:get-sound-data-url',
    async (
      _e,
      filename: string,
    ): Promise<{ ok: boolean; dataUrl?: string; error?: string }> => {
      try {
        const safeName = path.basename(filename)
        if (!safeName || !/\.mp3$/i.test(safeName)) {
          return { ok: false, error: '非法文件名' }
        }
        const userDir = path.resolve(getUserSoundsDir())
        const target = path.resolve(userDir, safeName)
        if (!target.startsWith(userDir + path.sep)) {
          return { ok: false, error: '非法路径' }
        }
        if (!fs.existsSync(target)) {
          return { ok: false, error: '文件不存在' }
        }
        const buf = fs.readFileSync(target)
        const dataUrl = `data:audio/mpeg;base64,${buf.toString('base64')}`
        return { ok: true, dataUrl }
      } catch (e) {
        return { ok: false, error: (e as Error).message || '读取失败' }
      }
    },
  )
}

const MAX_SOUND_SIZE = 5 * 1024 * 1024 // 5MB

function listMp3InDir(dir: string): string[] {
  try {
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mp3'))
  } catch {
    return []
  }
}
