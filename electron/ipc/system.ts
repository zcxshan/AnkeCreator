// ============================================================
// 系统 IPC（窗口控制 + 数据目录）
// ============================================================

import { BrowserWindow, ipcMain, shell } from 'electron'
import fs from 'fs'
import * as db from '../db-main'

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
}
