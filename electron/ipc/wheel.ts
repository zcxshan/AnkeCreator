// ============================================================
// 玩转盘 IPC
//
// 注册以下 IPC handler：
//   - wheel:list-schemes      列出所有方案
//   - wheel:get-scheme         获取单个方案
//   - wheel:create-scheme      创建方案
//   - wheel:update-scheme      更新方案
//   - wheel:delete-scheme      删除方案
//   - wheel:add-history        添加抽取历史
//   - wheel:list-history       列出抽取历史
//   - wheel:clear-history      清空抽取历史
//   - wheel:export-scheme      弹系统保存对话框，导出方案 JSON
//   - wheel:import-scheme      弹系统打开对话框，导入方案 JSON
// ============================================================

import { BrowserWindow, dialog, ipcMain } from 'electron'
import * as fs from 'fs'
import {
  listSchemes,
  getScheme,
  createScheme as storeCreateScheme,
  updateScheme as storeUpdateScheme,
  deleteScheme as storeDeleteScheme,
  addDrawHistory as storeAddDrawHistory,
  listDrawHistory as storeListDrawHistory,
  clearDrawHistory as storeClearDrawHistory,
} from '../wheelStore'
import type { WheelScheme, DrawHistory } from '../../src/types/wheel'

/** 注册玩转盘相关 IPC handler */
export function registerWheelIpc(getWindow: () => BrowserWindow | null): void {
  // ---- 方案 CRUD ----
  ipcMain.handle('wheel:list-schemes', () => listSchemes())

  ipcMain.handle('wheel:get-scheme', (_e, id: string) => getScheme(id))

  ipcMain.handle(
    'wheel:create-scheme',
    (_e, data: Omit<WheelScheme, 'id' | 'created_at' | 'updated_at'>) =>
      storeCreateScheme(data),
  )

  ipcMain.handle(
    'wheel:update-scheme',
    (_e, id: string, patch: Partial<WheelScheme>) => storeUpdateScheme(id, patch),
  )

  ipcMain.handle('wheel:delete-scheme', (_e, id: string) => storeDeleteScheme(id))

  // ---- 历史记录 ----
  ipcMain.handle('wheel:add-history', (_e, record: DrawHistory) => {
    storeAddDrawHistory(record)
    return true
  })

  ipcMain.handle('wheel:list-history', (_e, limit?: number) => storeListDrawHistory(limit))

  ipcMain.handle('wheel:clear-history', () => {
    storeClearDrawHistory()
    return true
  })

  // ---- 导出方案：弹系统保存对话框 ----
  ipcMain.handle(
    'wheel:export-scheme',
    async (
      _e,
      payload: { data: WheelScheme; suggestedName?: string },
    ): Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: string }> => {
      try {
        const focused =
          BrowserWindow.getFocusedWindow() || getWindow() || BrowserWindow.getAllWindows()[0]
        const safeName = (payload.suggestedName || payload.data.name || '未命名方案').replace(
          /[\\/:*?"<>|]/g,
          '_',
        )
        const result = await dialog.showSaveDialog(focused!, {
          title: '导出转盘方案',
          defaultPath: `${safeName}.wheel.json`,
          filters: [
            { name: '转盘方案文件', extensions: ['wheel.json'] },
            { name: 'JSON 文件', extensions: ['json'] },
          ],
        })
        if (result.canceled || !result.filePath) return { ok: false, canceled: true }
        // 包装成 export bundle 格式
        const bundle = {
          format: 'anke-creator-wheel-export',
          version: '1.0',
          exportedAt: new Date().toISOString(),
          data: payload.data,
        }
        fs.writeFileSync(result.filePath, JSON.stringify(bundle, null, 2), 'utf-8')
        return { ok: true, filePath: result.filePath }
      } catch (e) {
        console.error('[wheel] 导出方案失败:', e)
        return { ok: false, error: (e as Error).message }
      }
    },
  )

  // ---- 导入方案：弹系统打开对话框 ----
  ipcMain.handle(
    'wheel:import-scheme',
    async (): Promise<{
      ok: boolean
      canceled?: boolean
      filePath?: string
      data?: any
      error?: string
    }> => {
      try {
        const focused =
          BrowserWindow.getFocusedWindow() || getWindow() || BrowserWindow.getAllWindows()[0]
        const result = await dialog.showOpenDialog(focused!, {
          title: '导入转盘方案',
          properties: ['openFile'],
          filters: [
            { name: '转盘方案文件', extensions: ['wheel.json'] },
            { name: 'JSON 文件', extensions: ['json'] },
          ],
        })
        if (result.canceled || result.filePaths.length === 0) {
          return { ok: false, canceled: true }
        }
        const raw = fs.readFileSync(result.filePaths[0], 'utf-8')
        const data = JSON.parse(raw)
        return { ok: true, filePath: result.filePaths[0], data }
      } catch (e) {
        console.error('[wheel] 导入方案失败:', e)
        return { ok: false, error: (e as Error).message }
      }
    },
  )
}
