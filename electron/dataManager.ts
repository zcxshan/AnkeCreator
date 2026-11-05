// ============================================================
// 数据清理 IPC（应用内"清空所有数据"入口）
//
// - data:clearAll：删除 <dataRoot>/ 下的图片、JSON 数据库 + 渲染层所有 storage
//   （打包 = <安装路径>/data/，dev = <项目根>/data/）
// - data:openUninstallGuide：弹系统对话框说明卸载行为
//
// **不**修改任何业务逻辑；仅清空数据。
// 配套 build/installer.nsh：Windows 卸载时也会弹确认对话框
// ============================================================

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import * as db from './db-main'
import { getImagesDir, getDataRoot, getDataDir, getDefaultDataDir, isDataRootFallback, writeConfiguredDataDir } from './paths'
import { migrateDataDir } from './dataMigration'
import {
  createManualSnapshot,
  ensureDailySnapshot,
  listSnapshots,
  requestRestore,
} from './snapshot'

/** 描述当前数据根目录的简短字符串（用于弹窗展示） */
function describeDataDir(): string {
  // 统一显示实际数据目录（打包=<安装路径>\data，dev=<项目根>\data）
  return getDataRoot()
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
    // 数据统一在 data/ 目录下（打包=<安装路径>\data，dev=<项目根>\data）
    const result = await dialog.showMessageBox(win ?? (undefined as any), {
      type: 'info',
      title: '数据管理说明（卸载 / 更新 / 清空）',
      message: '安科作者助手的数据管理机制',
      detail:
        '【卸载时（Windows + GUI 模式）】\n' +
        '  - 仅弹一条提示，数据始终保留在安装路径\\data\\\n' +
        '  - 如需彻底删除数据，请手动删除 data\\ 文件夹\n\n' +
        '【更新时（覆盖安装）】\n' +
        '  - 所有数据自动保留在原位置\n' +
        '  - 如果安装到不同路径，安装器会自动从旧位置复制 data 到新位置\n\n' +
        '【主动清空】\n' +
        `  - 设置页已移除「清空所有本地数据」按钮\n` +
        '  - 如需清空，请到安装目录下手动删除 data\\ 文件夹\n\n' +
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

  // data:getInfo：设置页展示真实数据目录 + 快照列表
  ipcMain.handle(
    'data:getInfo',
    async (): Promise<{
      ok: boolean
      error?: string
      dataDir?: string
      defaultDataDir?: string
      custom?: boolean
      fallback?: boolean
      snapshots?: ReturnType<typeof listSnapshots>
    }> => {
      try {
        const dataDir = getDataDir()
        const defaultDataDir = getDefaultDataDir()
        return {
          ok: true,
          dataDir,
          defaultDataDir,
          custom: path.resolve(dataDir) !== path.resolve(defaultDataDir),
          fallback: isDataRootFallback(),
          snapshots: listSnapshots(dataDir),
        }
      } catch (e) {
        return { ok: false, error: (e as Error).message || '读取数据目录信息失败' }
      }
    },
  )

  // data:pickDataDir：让用户选择新的数据目录（不执行迁移）
  ipcMain.handle(
    'data:pickDataDir',
    async (): Promise<{ ok: boolean; canceled?: boolean; dir?: string; error?: string }> => {
      try {
        const win = getWindow()
        const res = await dialog.showOpenDialog(win ?? (undefined as any), {
          title: '选择新的数据目录',
          properties: ['openDirectory', 'createDirectory'],
        })
        if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true }
        return { ok: true, dir: res.filePaths[0] }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },
  )

  // data:migrateDataDir：把当前数据复制到目标目录 → 记录配置 → 重启
  // 约束：目标目录必须为空（或不存在），避免覆盖用户已有文件。
  // 复制前自动做一份快照，复制失败时清理目标目录中已写入的内容。
  ipcMain.handle(
    'data:migrateDataDir',
    async (_e, targetDirRaw: string): Promise<{ ok: boolean; error?: string; targetDir?: string }> => {
      const current = getDataDir()
      // 迁移前安全快照（尽力而为，不阻塞迁移）
      const result = migrateDataDir(current, targetDirRaw, {
        beforeCopy: () => {
          try {
            createManualSnapshot(current)
          } catch (e) {
            console.warn('[data:migrateDataDir] 迁移前快照失败（继续）:', e)
          }
        },
      })
      if (!result.ok || !result.targetDir) return { ok: false, error: result.error }
      writeConfiguredDataDir(result.targetDir)
      setTimeout(() => {
        app.relaunch()
        app.exit(0)
      }, 500)
      return { ok: true, targetDir: result.targetDir }
    },
  )

  // data:createSnapshot：手动创建一份快照
  ipcMain.handle(
    'data:createSnapshot',
    async (): Promise<{ ok: boolean; error?: string; snapshot?: ReturnType<typeof createManualSnapshot> }> => {
      try {
        const snapshot = createManualSnapshot(getDataDir())
        if (!snapshot) return { ok: false, error: '没有可备份的数据' }
        return { ok: true, snapshot }
      } catch (e) {
        return { ok: false, error: (e as Error).message || '创建快照失败' }
      }
    },
  )

  // data:ensureDailySnapshot：启动时补一份当日快照（幂等）
  ipcMain.handle('data:ensureDailySnapshot', async (): Promise<{ ok: boolean }> => {
    try {
      ensureDailySnapshot(getDataDir())
      return { ok: true }
    } catch (e) {
      console.warn('[data:ensureDailySnapshot] 失败（继续运行）:', e)
      return { ok: false }
    }
  })

  // data:restoreSnapshot：记录恢复请求 → 立刻重启；真正的覆盖发生在下次启动、DB 初始化之前
  ipcMain.handle(
    'data:restoreSnapshot',
    async (
      _e,
      name: string,
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        requestRestore(getDataDir(), name)
        setTimeout(() => {
          app.relaunch()
          app.exit(0)
        }, 500)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: (e as Error).message || '恢复快照失败' }
      }
    },
  )
}
