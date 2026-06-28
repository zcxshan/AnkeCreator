// ============================================================
// 角色 IPC（character + variant）
// ============================================================

import { ipcMain } from 'electron'
import * as db from '../db-main'

/** 注册角色相关 IPC handler */
export function registerCharacterIpc(): void {
  // ---- Characters ----
  ipcMain.handle('db:list-characters', (_e, storyId: string) => db.listCharacters(storyId))
  ipcMain.handle('db:create-character', (_e, data: any) => db.createCharacter(data))
  ipcMain.handle('db:update-character', (_e, id: string, patch: any) =>
    db.updateCharacter(id, patch),
  )
  ipcMain.handle('db:delete-character', (_e, id: string) => {
    db.deleteCharacter(id)
    return true
  })
  ipcMain.handle('db:reorder-characters', (_e, storyId: string, orderedIds: string[]) => {
    db.reorderCharacters(storyId, orderedIds)
    return true
  })

  // ---- Character Variants ----
  ipcMain.handle('db:list-character-variants', (_e, characterId: string) =>
    db.listCharacterVariants(characterId),
  )
  ipcMain.handle('db:create-character-variant', (_e, data: any) =>
    db.createCharacterVariant(data),
  )
  ipcMain.handle(
    'db:create-character-variants-batch',
    (_e, characterId: string, items: { name?: string; url: string }[]) =>
      db.createCharacterVariantsBatch(characterId, items),
  )
  ipcMain.handle('db:update-character-variant', (_e, id: string, patch: any) => {
    db.updateCharacterVariant(id, patch)
    return true
  })
  ipcMain.handle('db:delete-character-variant', (_e, id: string) => {
    db.deleteCharacterVariant(id)
    return true
  })
  ipcMain.handle('db:reorder-character-variants', (_e, characterId: string, orderedIds: string[]) => {
    db.reorderCharacterVariants(characterId, orderedIds)
    return true
  })
}
