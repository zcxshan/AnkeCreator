// ============================================================
// 数据清理 IPC（应用内"清空所有数据"入口）
//
// - data:clearAll：删除 userData 下的图片、JSON 数据库 + 渲染层所有 storage
// - data:openUninstallGuide：弹系统对话框说明卸载行为
//
// **不**修改任何业务逻辑；仅清空数据。
// 配套 build/installer.nsh：Windows 卸载时也会弹确认对话框
// ============================================================

import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import * as db from './db-main'

/** 注册数据清理相关 IPC handler */
export function registerDataIpc(getWindow: () => BrowserWindow | null): void {
  // data:clearAll：清空 userData/images + AnkeCreatorData + 渲染层 storage
  ipcMain.handle(
    'data:clearAll',
    async (): Promise<{ ok: boolean; error?: string; cleared: string[] }> => {
      const cleared: string[] = []
      try {
        // 1) 删除 userData/images/ 下所有文件
        try {
          const imagesDir = path.join(app.getPath('userData'), 'images')
          if (fs.existsSync(imagesDir)) {
            const files = fs.readdirSync(imagesDir)
            for (const f of files) {
              try {
                fs.unlinkSync(path.join(imagesDir, f))
              } catch (e) {
                console.warn('[data:clearAll] 删除图片失败:', f, e)
              }
            }
            cleared.push('userData/images/')
          }
        } catch (e) {
          console.warn('[data:clearAll] 清理 images/ 失败:', e)
        }

        // 2) 删除主进程 JSON 数据库
        try {
          const dataDir = db.getDataDirectory()
          if (fs.existsSync(dataDir)) {
            const files = fs.readdirSync(dataDir)
            for (const f of files) {
              // 只删除 JSON 数据文件，保留目录本身
              if (f.endsWith('.json') || f.endsWith('.db') || f.endsWith('.sqlite')) {
                try {
                  fs.unlinkSync(path.join(dataDir, f))
                } catch (e) {
                  console.warn('[data:clearAll] 删除数据文件失败:', f, e)
                }
              }
            }
            cleared.push(dataDir)
          }
        } catch (e) {
          console.warn('[data:clearAll] 清理 AnkeCreatorData 失败:', e)
        }

        // 3) 清理渲染层 storage：localStorage / IndexedDB / sessionStorage / cache
        const win = getWindow()
        if (win && !win.isDestroyed()) {
          try {
            const ses = win.webContents.session
            // clearStorageData 涵盖 localStorage / IndexedDB / sessionStorage / ServiceWorker
            await ses.clearStorageData()
            await ses.clearCache()
            await ses.clearHostResolverCache()
            // 通过 executeJavaScript 清空内存中的 localStorage 引用（保险措施）
            try {
              await win.webContents.executeJavaScript('try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}')
            } catch {
              /* noop */
            }
            cleared.push('渲染层 storage（localStorage / IndexedDB / cache）')
          } catch (e) {
            console.warn('[data:clearAll] 清理渲染层 storage 失败:', e)
          }
        }

        return { ok: true, cleared }
      } catch (e) {
        return { ok: false, error: (e as Error).message || '清空数据失败', cleared }
      }
    },
  )

  // data:openUninstallGuide：弹系统对话框说明卸载行为（供设置页"了解卸载行为"按钮调用）
  ipcMain.handle('data:openUninstallGuide', async (): Promise<{ ok: boolean }> => {
    const win = getWindow()
    const result = await dialog.showMessageBox(win ?? undefined as any, {
      type: 'info',
      title: '卸载行为说明',
      message: '卸载时会询问是否删除个人数据',
      detail:
        '• Windows：卸载时会弹出对话框询问是否同时清理个人数据（默认勾选"是"）\n' +
        '  - 选「是」：彻底清理 userData，下次重装数据全空\n' +
        '  - 选「否」：保留数据在 %APPDATA%\\com.shanshian.ankecreator，下次重装自动恢复\n' +
        '• Android：系统卸载会自动清空应用私有目录（/data/data/<package>/）\n' +
        '• 已禁用云备份（Android Auto Backup），避免卸载重装后从云端恢复旧数据\n\n' +
        '💡 提示：如需在卸载前主动清空数据，可在设置里点「清空所有本地数据」',
      buttons: ['我知道了'],
      defaultId: 0,
    })
    void result
    return { ok: true }
  })

  // data:openDataDirectory：打开数据目录（供设置页"打开数据目录"按钮调用）
  ipcMain.handle('data:openDataDirectory', async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const dir = db.getDataDirectory()
      await fs.promises.mkdir(dir, { recursive: true })
      const res = await shell.openPath(dir)
      if (res) {
        return { ok: false, error: res }
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
}
