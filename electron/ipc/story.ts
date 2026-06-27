// ============================================================
// 作品 IPC（story + 整作品导入导出）
// ============================================================

import { BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import * as db from '../db-main'
import { generateEpub, type EpubProgress } from '../epubExport'

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

  // ---- 导出为 EPUB 电子书（含离线图片 + 进度推送）----
  ipcMain.handle(
    'story:export-epub',
    async (
      event,
      payload: { storyId: string; suggestedName?: string },
    ): Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: string }> => {
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

        // 3. 生成 EPUB（进度回调推送到渲染进程）
        const sender = event.sender
        const onProgress = (p: EpubProgress) => {
          try {
            sender.send('epub:export:progress', p)
          } catch {
            // sender 可能已销毁
          }
        }
        const epubBuffer = await generateEpub(story, onProgress)

        // 4. 写盘
        fs.writeFileSync(result.filePath, epubBuffer)
        return { ok: true, filePath: result.filePath }
      } catch (e) {
        console.error('EPUB 导出失败:', e)
        return { ok: false, error: (e as Error).message }
      }
    },
  )
}
