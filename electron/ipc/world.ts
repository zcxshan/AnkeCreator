// ============================================================
// 世界观 IPC
// ============================================================

import { ipcMain } from 'electron'
import * as db from '../db-main'

/** 注册世界观相关 IPC handler */
export function registerWorldIpc(): void {
  ipcMain.handle('db:list-world-settings', (_e, storyId: string) =>
    db.listWorldSettings(storyId),
  )
  ipcMain.handle('db:create-world-setting', (_e, data: any) => db.createWorldSetting(data))
  ipcMain.handle('db:update-world-setting', (_e, id: string, patch: any) =>
    db.updateWorldSetting(id, patch),
  )
  ipcMain.handle('db:delete-world-setting', (_e, id: string) => {
    db.deleteWorldSetting(id)
    return true
  })
  ipcMain.handle('db:reorder-world-settings', (_e, storyId: string, orderedIds: string[]) => {
    db.reorderWorldSettings(storyId, orderedIds)
    return true
  })
}
