// ============================================================
// 卷/章/节 IPC（structure：volume + chapter + section）
//
// 所有写操作 db 函数均返回 Promise,handler 必须用 async/await
// 确保渲染层调用返回时写锁已释放、数据已落盘,避免 race
// ============================================================

import { ipcMain } from 'electron'
import * as db from '../db-main'

/** 注册卷/章/节相关 IPC handler */
export function registerStructureIpc(): void {
  // ---- Volumes ----
  ipcMain.handle('db:list-volumes', (_e, storyId: string) => db.listVolumes(storyId))
  ipcMain.handle('db:create-volume', async (_e, data: any) => db.createVolume(data))
  ipcMain.handle('db:update-volume', async (_e, id: string, patch: any) => db.updateVolume(id, patch))
  ipcMain.handle('db:delete-volume', async (_e, id: string) => {
    await db.deleteVolume(id)
    return true
  })
  ipcMain.handle('db:reorder-volumes', async (_e, storyId: string, orderedIds: string[]) => {
    await db.reorderVolumes(storyId, orderedIds)
    return true
  })

  // ---- Chapters ----
  ipcMain.handle('db:list-chapters', (_e, storyId: string) => db.listChapters(storyId))
  ipcMain.handle('db:list-chapters-by-volume', (_e, volumeId: string) =>
    db.listChaptersByVolume(volumeId),
  )
  ipcMain.handle('db:create-chapter', async (_e, data: any) => db.createChapter(data))
  ipcMain.handle('db:update-chapter', async (_e, id: string, patch: any) => db.updateChapter(id, patch))
  ipcMain.handle('db:delete-chapter', async (_e, id: string) => {
    await db.deleteChapter(id)
    return true
  })
  ipcMain.handle('db:reorder-chapters', async (_e, storyId: string, orderedIds: string[]) => {
    await db.reorderChapters(storyId, orderedIds)
    return true
  })
  ipcMain.handle(
    'db:move-chapters',
    async (_e, storyId: string, targetVolumeId: string | null, orderedIds: string[]) => {
      await db.moveChapters(storyId, targetVolumeId, orderedIds)
      return true
    },
  )

  // ---- Sections ----
  ipcMain.handle('db:list-sections', (_e, chapterId: string) => db.listSections(chapterId))
  ipcMain.handle('db:list-section-metadata', (_e, chapterId: string) => db.listSectionMetadata(chapterId))
  ipcMain.handle('db:create-section', async (_e, data: any) => db.createSection(data))
  ipcMain.handle('db:update-section', async (_e, id: string, patch: any) => db.updateSection(id, patch))
  ipcMain.handle('db:delete-section', async (_e, id: string) => {
    await db.deleteSection(id)
    return true
  })
  ipcMain.handle('db:reorder-sections', async (_e, chapterId: string, orderedIds: string[]) => {
    await db.reorderSections(chapterId, orderedIds)
    return true
  })
  ipcMain.handle('db:move-sections', async (_e, targetChapterId: string | null, orderedIds: string[]) => {
    await db.moveSections(targetChapterId, orderedIds)
    return true
  })

  // ---- Bulk Create (导入加速) ----
  ipcMain.handle('db:bulk-create-volumes', async (_e, rows: any[]) => db.bulkCreateVolumes(rows))
  ipcMain.handle('db:bulk-create-chapters', async (_e, rows: any[]) => db.bulkCreateChapters(rows))
  ipcMain.handle('db:bulk-create-sections', async (_e, rows: any[]) => db.bulkCreateSections(rows))
  // 导入完成后校准所有 word_count
  ipcMain.handle('db:recompute-story-word-counts', async (_e, storyId: string) => {
    await db.recomputeStoryWordCounts(storyId)
    return true
  })

  // ---- Section content (富文本正文) ----
  ipcMain.handle('db:get-section-content', (_e, id: string) => db.getSectionContent(id))
  ipcMain.handle('db:set-section-content', async (_e, id: string, content: string | null) => {
    await db.setSectionContent(id, content)
    return true
  })
  ipcMain.handle('db:set-section-bbcode', async (_e, id: string, bbcode: string | null) => {
    await db.setSectionBBCode(id, bbcode)
    return true
  })
}
