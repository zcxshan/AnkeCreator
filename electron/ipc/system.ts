// ============================================================
// 系统 IPC（窗口控制 + 数据目录）
// ============================================================

import { BrowserWindow, ipcMain, shell } from 'electron'
import fs from 'fs'
import * as db from '../db-main'
import { getSoundsDir } from '../paths'

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

  // ---- 骰子音效：扫描可用 mp3 文件 ----
  ipcMain.handle('system:list-sounds', (): string[] => {
    try {
      const dir = getSoundsDir()
      if (!fs.existsSync(dir)) return ['dice-roll.mp3']
      const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mp3'))
      // 确保 dice-roll.mp3 始终在列表中（即使文件夹为空也返回默认）
      if (!files.includes('dice-roll.mp3')) files.unshift('dice-roll.mp3')
      return files
    } catch (e) {
      console.error('扫描音效目录失败:', e)
      return ['dice-roll.mp3']
    }
  })
}
