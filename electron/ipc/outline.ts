// ============================================================
// 大纲 IPC
// ============================================================

import { ipcMain } from 'electron'
import * as db from '../db-main'

/** 注册大纲相关 IPC handler */
export function registerOutlineIpc(): void {
  ipcMain.handle('db:list-outlines', (_e, storyId: string) => db.listOutlines(storyId))
  ipcMain.handle('db:create-outline', (_e, data: any) => db.createOutline(data))
  ipcMain.handle('db:update-outline', (_e, id: string, patch: any) => db.updateOutline(id, patch))
  ipcMain.handle('db:delete-outline', (_e, id: string) => {
    db.deleteOutline(id)
    return true
  })
}
