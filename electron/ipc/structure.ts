// ============================================================
// 卷/章/节 IPC（structure：volume + chapter + section）
// ============================================================

import { ipcMain } from 'electron'
import * as db from '../db-main'

/** 注册卷/章/节相关 IPC handler */
export function registerStructureIpc(): void {
  // ---- Volumes ----
  ipcMain.handle('db:list-volumes', (_e, storyId: string) => db.listVolumes(storyId))
  ipcMain.handle('db:create-volume', (_e, data: any) => db.createVolume(data))
  ipcMain.handle('db:update-volume', (_e, id: string, patch: any) => db.updateVolume(id, patch))
  ipcMain.handle('db:delete-volume', (_e, id: string) => {
    db.deleteVolume(id)
    return true
  })
  ipcMain.handle('db:reorder-volumes', (_e, storyId: string, orderedIds: string[]) => {
    db.reorderVolumes(storyId, orderedIds)
    return true
  })

  // ---- Chapters ----
  ipcMain.handle('db:list-chapters', (_e, storyId: string) => db.listChapters(storyId))
  ipcMain.handle('db:list-chapters-by-volume', (_e, volumeId: string) =>
    db.listChaptersByVolume(volumeId),
  )
  ipcMain.handle('db:create-chapter', (_e, data: any) => db.createChapter(data))
  ipcMain.handle('db:update-chapter', (_e, id: string, patch: any) => db.updateChapter(id, patch))
  ipcMain.handle('db:delete-chapter', (_e, id: string) => {
    db.deleteChapter(id)
    return true
  })
  ipcMain.handle('db:reorder-chapters', (_e, storyId: string, orderedIds: string[]) => {
    db.reorderChapters(storyId, orderedIds)
    return true
  })
  ipcMain.handle(
    'db:move-chapters',
    (_e, storyId: string, targetVolumeId: string | null, orderedIds: string[]) => {
      db.moveChapters(storyId, targetVolumeId, orderedIds)
      return true
    },
  )

  // ---- Sections ----
  ipcMain.handle('db:list-sections', (_e, chapterId: string) => db.listSections(chapterId))
  ipcMain.handle('db:create-section', (_e, data: any) => db.createSection(data))
  ipcMain.handle('db:update-section', (_e, id: string, patch: any) => db.updateSection(id, patch))
  ipcMain.handle('db:delete-section', (_e, id: string) => {
    db.deleteSection(id)
    return true
  })
  ipcMain.handle('db:reorder-sections', (_e, chapterId: string, orderedIds: string[]) => {
    db.reorderSections(chapterId, orderedIds)
    return true
  })
  ipcMain.handle('db:move-sections', (_e, targetChapterId: string | null, orderedIds: string[]) => {
    db.moveSections(targetChapterId, orderedIds)
    return true
  })

  // ---- Section content (富文本正文) ----
  ipcMain.handle('db:get-section-content', (_e, id: string) => db.getSectionContent(id))
  ipcMain.handle('db:set-section-content', (_e, id: string, content: string | null) => {
    db.setSectionContent(id, content)
    return true
  })
}
