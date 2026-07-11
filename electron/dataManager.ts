// ============================================================
// 数据清理 IPC（应用内"清空所有数据"入口）
//
// - data:clearAll：删除 <dataRoot>/ 下的图片、JSON 数据库 + 渲染层所有 storage
//   （打包 = <安装路径>/data/，dev = %APPDATA%\\...\\）
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
import { getImagesDir } from './paths'

/** 描述当前数据根目录的简短字符串（用于弹窗展示） */
function describeDataDir(): string {
  // 打包模式：<安装路径>/data
  // dev 模式：%APPDATA%\<appId>
  if (app.isPackaged) {
    return '<安装路径>\\data'
  }
  return app.getPath('userData')
}

/** 注册数据清理相关 IPC handler */
export function registerDataIpc(getWindow: () => BrowserWindow | null): void {
  // data:clearAll：清空 <dataRoot>/images + AnkeCreatorData + 渲染层 storage
  ipcMain.handle(
    'data:clearAll',
    async (): Promise<{ ok: boolean; error?: string; cleared: string[] }> => {
      const cleared: string[] = []
      try {
        // 1) 删除 <dataRoot>/images/ 下所有文件
        try {
          const imagesDir = getImagesDir()
          if (fs.existsSync(imagesDir)) {
            const files = fs.readdirSync(imagesDir)
            for (const f of files) {
              try {
                fs.unlinkSync(path.join(imagesDir, f))
              } catch (e) {
                console.warn('[data:clearAll] 删除图片失败:', f, e)
              }
            }
            cleared.push(`${describeDataDir()}\\images\\`)
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

  // data:openUninstallGuide：弹系统对话框说明卸载行为（供设置页按钮调用）
  // 文案匹配 build/installer.nsh 的两步确认流程
  ipcMain.handle('data:openUninstallGuide', async (): Promise<{ ok: boolean }> => {
    const win = getWindow()
    // 打包模式：数据在 <安装路径>/data/（v3.2+ 扁平化后所有数据都在此目录下）
    // dev 模式：数据在 %APPDATA%\com.shanshian.ankecreator\
    const dataDirDesc = app.isPackaged ? '<安装路径>\\data' : '%APPDATA%\\com.shanshian.ankecreator'
    const result = await dialog.showMessageBox(win ?? (undefined as any), {
      type: 'info',
      title: '数据管理说明（卸载 / 更新 / 清空）',
      message: '安科作者助手的数据管理机制',
      detail:
        '【卸载时（Windows + GUI 模式）】\n' +
        '  1) 先弹「请先导出重要数据」提示 → 选「否」可取消整个卸载\n' +
        '  2) 再弹「是否同时清空数据」 → 默认「否」（保护数据）\n' +
        `  - 选「是」：彻底清理 ${dataDirDesc}（含 stories/、templates/、images/、sounds/、迁移标记文件）\n` +
        `  - 选「否」：数据保留在 ${dataDirDesc}，下次重装自动恢复\n\n` +
        '【更新时（覆盖安装）】\n' +
        '  - 所有数据自动保留在原位置\n' +
        '  - 安装器会先调用「卸载」步骤（按上述流程询问），然后再装新版本\n' +
        '  - 即使选「是」清空数据，迁移标记文件会先被清掉（避免脏数据）\n\n' +
        '【主动清空（设置里点「清空所有本地数据」）】\n' +
        `  - 立即清空 ${dataDirDesc} + %APPDATA%\\com.shanshian.ankecreator\\ 下所有数据\n` +
        '  - 不可恢复，请先导出重要作品！\n\n' +
        '【Android 端】\n' +
        '  - 系统卸载会自动清空应用私有目录（/data/data/<package>/）\n' +
        '  - 已禁用云备份（Android Auto Backup），避免卸载重装后从云端恢复旧数据\n\n' +
        '💡 建议：每次重要编辑后，用「单作品右键 → 整作品另存为」备份作品文件',
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
