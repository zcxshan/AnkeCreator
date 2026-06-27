// ============================================================
// 人物关系 IPC
// ============================================================

import { ipcMain } from 'electron'
import * as db from '../db-main'

/** 注册人物关系相关 IPC handler */
export function registerRelationIpc(): void {
  ipcMain.handle('db:list-character-relations', (_e, storyId: string) =>
    db.listCharacterRelations(storyId),
  )
  ipcMain.handle('db:create-character-relation', (_e, data: any) =>
    db.createCharacterRelation(data),
  )
  ipcMain.handle('db:update-character-relation', (_e, id: string, patch: any) =>
    db.updateCharacterRelation(id, patch),
  )
  ipcMain.handle('db:delete-character-relation', (_e, id: string) => {
    db.deleteCharacterRelation(id)
    return true
  })
}
