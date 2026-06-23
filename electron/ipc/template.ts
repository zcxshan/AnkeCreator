// ============================================================
// 模板 IPC（世界观模板 + 人物模板）
// ============================================================

import { ipcMain } from 'electron'
import * as db from '../db-main'

/** 注册模板相关 IPC handler */
export function registerTemplateIpc(): void {
  // ---- World templates ----
  ipcMain.handle('db:list-world-setting-templates', () => db.listWorldSettingTemplates())
  ipcMain.handle('db:create-world-setting-template', (_e, data: any) =>
    db.createWorldSettingTemplate(data),
  )
  ipcMain.handle('db:update-world-setting-template', (_e, id: string, patch: any) =>
    db.updateWorldSettingTemplate(id, patch),
  )
  ipcMain.handle('db:delete-world-setting-template', (_e, id: string) => {
    db.deleteWorldSettingTemplate(id)
    return true
  })
  ipcMain.handle('db:reorder-world-setting-templates', (_e, orderedIds: string[]) => {
    db.reorderWorldSettingTemplates(orderedIds)
    return true
  })

  // ---- Character templates ----
  ipcMain.handle('db:list-character-templates', () => db.listCharacterTemplates())
  ipcMain.handle('db:create-character-template', (_e, data: any) =>
    db.createCharacterTemplate(data),
  )
  ipcMain.handle('db:update-character-template', (_e, id: string, patch: any) =>
    db.updateCharacterTemplate(id, patch),
  )
  ipcMain.handle('db:delete-character-template', (_e, id: string) => {
    db.deleteCharacterTemplate(id)
    return true
  })
  ipcMain.handle('db:reorder-character-templates', (_e, orderedIds: string[]) => {
    db.reorderCharacterTemplates(orderedIds)
    return true
  })
}
