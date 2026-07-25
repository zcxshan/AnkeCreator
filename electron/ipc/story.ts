// ============================================================
// 作品 IPC（story + 整作品导入导出）
// ============================================================

import { BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import * as db from '../db-main'
import { generateEpub, EpubExportControl, type EpubProgress, type EpubExportOptions } from '../epubExport'

// 当前活跃的导出控制器（同一时间只允许一个导出）
let activeExportControl: EpubExportControl | null = null

/** 注册作品相关 IPC handler */
export function registerStoryIpc(getWindow: () => BrowserWindow | null): void {
  // ---- Story 基础 ----
  ipcMain.handle('db:list-stories', () => db.listStories())
  ipcMain.handle('db:list-stories-with-stats', () => db.listStoriesWithStats())
  ipcMain.handle('db:get-story', (_e, id: string) => db.getStory(id))
  ipcMain.handle(
    'db:create-story',
    (_e, data: { title: string; description?: string; category?: string }) => db.createStory(data),
  )
  ipcMain.handle('db:update-story', (_e, id: string, patch: any) => db.updateStory(id, patch))
  ipcMain.handle('db:delete-story', (_e, id: string) => {
    db.deleteStory(id)
    return true
  })

  // ---- Trash / Recycle Bin ----
  ipcMain.handle('db:soft-delete-story', (_e, id: string) => {
    db.softDeleteStory(id)
    return true
  })
  ipcMain.handle('db:restore-story', (_e, id: string) => {
    db.restoreStory(id)
    return true
  })
  ipcMain.handle('db:permanently-delete-story', (_e, id: string) => {
    db.permanentlyDeleteStory(id)
    return true
  })
  ipcMain.handle('db:list-trashed-stories', () => db.listTrashedStories())
  ipcMain.handle('db:cleanup-old-trashed', (_e, days: number) => db.cleanupOldTrashed(days))

  // ---- Aggregate ----
  ipcMain.handle('db:get-story-with-all', (_e, storyId: string) => db.getStoryWithAll(storyId))

  // ---- 整作品另存为：弹系统保存对话框，导出 .anke.json 文件 ----
  ipcMain.handle(
    'story:export-to-file',
    async (
      _e,
      payload: { data: any; suggestedName?: string },
    ): Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: string }> => {
      try {
        const focused =
          BrowserWindow.getFocusedWindow() || getWindow() || BrowserWindow.getAllWindows()[0]
        const result = await dialog.showSaveDialog(focused!, {
          title: '安科作品另存为',
          defaultPath: `${payload.suggestedName || 'anke'}.anke.json`,
          filters: [
            { name: '安科作品文件', extensions: ['anke.json'] },
            { name: 'JSON 文件', extensions: ['json'] },
          ],
        })
        if (result.canceled || !result.filePath) return { ok: false, canceled: true }
        const json = JSON.stringify(payload.data, null, 2)
        fs.writeFileSync(result.filePath, json, 'utf-8')
        return { ok: true, filePath: result.filePath }
      } catch (e) {
        console.error('安科另存为失败:', e)
        return { ok: false, error: (e as Error).message }
      }
    },
  )

  // ---- 导入安科作品：弹系统打开对话框，读 .anke.json 文件内容 ----
  ipcMain.handle(
    'story:import-from-file',
    async (): Promise<{ ok: boolean; canceled?: boolean; filePath?: string; data?: any; error?: string }> => {
      try {
        const focused =
          BrowserWindow.getFocusedWindow() || getWindow() || BrowserWindow.getAllWindows()[0]
        const result = await dialog.showOpenDialog(focused!, {
          title: '导入安科作品',
          properties: ['openFile'],
          filters: [
            { name: '安科作品文件', extensions: ['anke.json'] },
            { name: 'JSON 文件', extensions: ['json'] },
          ],
        })
        if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true }
        const raw = fs.readFileSync(result.filePaths[0], 'utf-8')
        const data = JSON.parse(raw)
        return { ok: true, filePath: result.filePaths[0], data }
      } catch (e) {
        console.error('安科导入失败:', e)
        return { ok: false, error: (e as Error).message }
      }
    },
  )

  // 防止未使用警告
  void path

  // ---- 收藏夹（favorites）----
  ipcMain.handle('db:list-favorites', () => db.listFavorites())
  ipcMain.handle('db:create-favorite', (_e, data: { name: string }) => db.createFavorite(data))
  ipcMain.handle('db:rename-favorite', (_e, id: string, name: string) =>
    db.renameFavorite(id, name),
  )
  ipcMain.handle('db:delete-favorite-if-empty', (_e, id: string) =>
    db.deleteFavoriteIfEmpty(id),
  )
  ipcMain.handle('db:get-favorite-story-count', (_e, id: string) =>
    db.getFavoriteStoryCount(id),
  )
  ipcMain.handle('db:add-story-to-favorite', (_e, storyId: string, favoriteId: string) =>
    db.addStoryToFavorite(storyId, favoriteId),
  )
  ipcMain.handle('db:remove-story-from-favorite', (_e, storyId: string, favoriteId: string) =>
    db.removeStoryFromFavorite(storyId, favoriteId),
  )
  ipcMain.handle('db:get-favorites-for-story', (_e, storyId: string) =>
    db.getFavoritesForStory(storyId),
  )
  ipcMain.handle('db:get-story-ids-in-favorite', (_e, favoriteId: string) =>
    db.getStoryIdsInFavorite(favoriteId),
  )

  // ---- 图片库（image library）----
  ipcMain.handle('db:list-image-library-folders', (_e, parentId?: string | null) =>
    db.listImageLibraryFolders(parentId),
  )
  // v36: 列出所有文件夹(不过滤 parentId),用于子目录删除时的统计
  ipcMain.handle('db:list-all-image-library-folders', () => db.listAllImageLibraryFolders())
  // v36: 列出所有图片项(不过滤 folderId),用于子目录删除时的统计
  ipcMain.handle('db:list-all-image-library-items', () => db.listAllImageLibraryItems())
  ipcMain.handle(
    'db:create-image-library-folder',
    (_e, data: { name: string; parentId: string | null }) => db.createImageLibraryFolder(data),
  )
  ipcMain.handle('db:rename-image-library-folder', (_e, id: string, name: string) =>
    db.renameImageLibraryFolder(id, name),
  )
  ipcMain.handle('db:delete-image-library-folder', (_e, id: string) =>
    db.deleteImageLibraryFolder(id),
  )
  ipcMain.handle('db:list-image-library-items', (_e, folderId?: string | null) =>
    db.listImageLibraryItems(folderId),
  )
  ipcMain.handle('db:add-image-library-item', (_e, data: any) => db.addImageLibraryItem(data))
  ipcMain.handle('db:delete-image-library-item', (_e, id: string) =>
    db.deleteImageLibraryItem(id),
  )
  ipcMain.handle('db:move-image-library-item', (_e, id: string, folderId: string | null) =>
    db.moveImageLibraryItem(id, folderId),
  )
  // 改动 v3：资源库图片重命名 / 跨文件夹移动
  ipcMain.handle('db:update-image-library-item', (_e, id: string, patch: any) =>
    db.updateImageLibraryItem(id, patch),
  )
  // 改动 v3：资源库图片拖动换顺序
  ipcMain.handle(
    'db:reorder-image-library-items',
    (_e, ids: string[], folderId: string | null) => db.reorderImageLibraryItems(ids, folderId),
  )

  // ---- 素材网站推荐（material sites）----
  ipcMain.handle('db:list-material-sites', () => db.listMaterialSites())
  ipcMain.handle(
    'db:create-material-site',
    (_e, data: { name: string; url: string; category: string; description?: string }) =>
      db.createMaterialSite(data),
  )
  ipcMain.handle(
    'db:update-material-site',
    (_e, id: string, patch: any) => db.updateMaterialSite(id, patch),
  )
  ipcMain.handle('db:delete-material-site', (_e, id: string) => db.deleteMaterialSite(id))

  // ---- 导出为 EPUB 电子书（含离线图片 + 进度推送 + 暂停/取消）----
  ipcMain.handle(
    'story:export-epub',
    async (
      event,
      payload: { storyId: string; suggestedName?: string; options?: EpubExportOptions },
    ): Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: string; userCanceled?: boolean; failedImageCount?: number }> => {
      try {
        const focused =
          BrowserWindow.getFocusedWindow() || getWindow() || BrowserWindow.getAllWindows()[0]
        // 1. 弹保存对话框
        const result = await dialog.showSaveDialog(focused!, {
          title: '导出为 EPUB 电子书',
          defaultPath: `${payload.suggestedName || '安科作品'}.epub`,
          filters: [{ name: 'EPUB 电子书', extensions: ['epub'] }],
        })
        if (result.canceled || !result.filePath) return { ok: false, canceled: true }

        // 2. 取作品完整数据
        const story = db.getStoryWithAll(payload.storyId)
        if (!story) return { ok: false, error: '作品不存在' }

        // 3. 创建控制器
        if (activeExportControl) {
          activeExportControl.cancel()
        }
        const control = new EpubExportControl()
        activeExportControl = control

        // 4. 生成 EPUB（进度回调推送到渲染进程）
        const sender = event.sender
        const onProgress = (p: EpubProgress) => {
          try {
            sender.send('epub:export:progress', p)
          } catch {
            // sender 可能已销毁
          }
        }

        let epubBuffer: Buffer
        let failedImageCount = 0
        try {
          const genResult = await generateEpub(
            story,
            onProgress,
            payload.options || { embedImages: true },
            control,
          )
          epubBuffer = genResult.buffer
          failedImageCount = genResult.failedSrcs.length
        } catch (genErr) {
          if ((genErr as Error).message === 'EXPORT_CANCELED') {
            activeExportControl = null
            onProgress({ phase: 'canceled', current: 0, total: 0, message: '导出已取消' })
            return { ok: false, userCanceled: true, canceled: true }
          }
          throw genErr
        }

        activeExportControl = null

        // 5. 写盘
        fs.writeFileSync(result.filePath, epubBuffer)
        return { ok: true, filePath: result.filePath, failedImageCount }
      } catch (e) {
        activeExportControl = null
        console.error('EPUB 导出失败:', e)
        return { ok: false, error: (e as Error).message }
      }
    },
  )

  // EPUB 导出控制：暂停
  ipcMain.handle('epub:export:pause', () => {
    if (activeExportControl && !activeExportControl.canceled) {
      activeExportControl.pause()
      return { ok: true }
    }
    return { ok: false, error: '没有正在进行的导出' }
  })

  // EPUB 导出控制：恢复
  ipcMain.handle('epub:export:resume', () => {
    if (activeExportControl && !activeExportControl.canceled) {
      activeExportControl.resume()
      return { ok: true }
    }
    return { ok: false, error: '没有正在进行的导出' }
  })

  // EPUB 导出控制：取消
  ipcMain.handle('epub:export:cancel', () => {
    if (activeExportControl) {
      activeExportControl.cancel()
      return { ok: true }
    }
    return { ok: false, error: '没有正在进行的导出' }
  })
}
