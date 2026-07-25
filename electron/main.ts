// © 星星的辰 | 开发时间: 2026-06-17 | 唯一标识: AnkeCreator_20260617_XXXX
// 本应用由本人独立开发，保留所有权利 | 非授权禁止商用
//
// Electron 主进程入口
// - 窗口管理
// - 应用生命周期
// - 协议 + NGA Referer 钩子
// - IPC 注册（委托给 ./ipc 域模块）

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'

// 主进程数据库（JSON 文件存储）
import * as db from './db-main'
import { migrateFromUserDataIfNeeded, migrateFlattenDataIfNeeded, isDataRootFallback, getDataDir } from './paths'

// 全局错误捕获（必须在所有 app.on('xxx') 之前）
import { registerGlobalErrorHandlers } from './errorReporter'
// 命令行诊断模式
import { runDiag } from './diag'

// 协议 + 图片上传 + NGA 抓取
import {
  registerSchemesAsPrivileged,
  registerLocalProtocol,
  setupNgaRefererHook,
} from './protocol'
import { registerIpcHandlers } from './ipc'

// ============================================================
// 路径常量
// ============================================================
process.env.APP_ROOT = path.join(__dirname, '..')
const appRoot = process.env.APP_ROOT
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const RENDERER_DIST = path.join(appRoot, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(appRoot, 'public') : RENDERER_DIST

// ============================================================
// 把 Electron 默认 userData 路径（C 盘 AppData）重定向到 data/ 目录下
// 确保 cookies、localStorage、IndexedDB、session 等也存到 data/ 而不是 C 盘
// 必须在 app.whenReady() 之前调用
// ============================================================
try {
  const electronDataDir = path.join(getDataDir(), 'electron-data')
  app.setPath('userData', electronDataDir)
  console.log('[main] Electron userData →', electronDataDir)
} catch (e) {
  console.warn('[main] 设置 userData 路径失败，使用默认 C 盘路径：', e)
}

// ============================================================
// 窗口管理
// ============================================================
let win: BrowserWindow | null

function createWindow() {
  const iconPath = path.join(appRoot, 'icon.png')

  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 400,
    center: true,
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hidden',
    frame: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: !app.isPackaged,
    },
  })

  // 打包后隐藏菜单栏（防止 Alt 打开）
  if (!VITE_DEV_SERVER_URL) {
    try {
      win.setMenuBarVisibility(false)
    } catch {
      /* noop */
    }
  }

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  // 非开发环境禁止打开 DevTools
  if (app.isPackaged) {
    win.webContents.on('devtools-opened', () => {
      win?.webContents.closeDevTools()
    })
  }

  // 同步窗口最大化/还原状态到 renderer（修复拖动取消最大化时图标不更新的 bug）
  // 关键：renderer 端只在点击标题栏按钮时乐观更新，但用户拖动窗口边缘/标题栏取消最大化时
  // 不会有"点击"事件，必须由 main 主动推送状态
  win.on('maximize', () => {
    win?.webContents.send('window:maximize-state', true)
  })
  win.on('unmaximize', () => {
    win?.webContents.send('window:maximize-state', false)
  })

  win.on('closed', () => {
    win = null
  })
}

/** 给 IPC handler 用的窗口 getter（避免模块级 win 引用） */
function getWindow(): BrowserWindow | null {
  return win
}

// ============================================================
// 应用生命周期
// ============================================================
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// 命令行诊断模式：不开窗、只输出诊断信息（--diag 参数）
if (runDiag()) {
  // diag 自己处理退出，不进入主流程
} else {
  // 注册全局错误处理（必须在所有 app.on('xxx') 之前）
  registerGlobalErrorHandlers()

  // 必须在 app ready 之前调用 registerSchemesAsPrivileged
  registerSchemesAsPrivileged()

  // 允许自动播放音频（掷骰音效需要，#4）：无需用户手势即可播放
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

  app.whenReady().then(() => {
    console.log('[main] Electron ready, version:', process.versions.electron)
    console.log('[main] isPackaged:', app.isPackaged, 'execPath:', process.execPath)

    // 步骤 1/4: 检查并迁移旧数据
    console.log('[main] 步骤 1/4: 检查并迁移旧数据...')
    try {
      migrateFromUserDataIfNeeded()
    } catch (e) {
      console.error('[main] 迁移失败（继续启动）:', e)
    }

    // 步骤 1.4/4: v31 新增 — 如果刚刚发生了从注册表记录的旧版位置迁移，
    // 弹一个友好提示告诉用户数据已自动恢复
    if (app.isPackaged) {
      try {
        const newDataDir = getDataDir()
        const regFlag = path.join(newDataDir, '.migrated-from-registry')
        const appDataFlag = path.join(newDataDir, '.migrated-from-appdata')
        if (fs.existsSync(regFlag) || fs.existsSync(appDataFlag)) {
          let flagPath = fs.existsSync(regFlag) ? regFlag : appDataFlag
          try {
            const flagData = JSON.parse(fs.readFileSync(flagPath, 'utf-8'))
            // 只在「实际发生了复制」的情况下提示(skipped 标记不弹)
            if (flagData?.from && flagData?.to) {
              dialog.showMessageBox({
                type: 'info',
                title: '数据已自动恢复',
                message:
                  '检测到您之前的作品数据,已自动从旧版安装位置复制到当前安装位置。\n\n' +
                  '您之前的作品、世界观、人物、图片等都已保留,可以继续使用。\n\n' +
                  '旧版安装位置的数据已保留作为备份,如需彻底删除请手动清理。',
                buttons: ['我知道了'],
              })
            }
          } catch {
            /* flag 文件解析失败不弹 */
          }
        }
      } catch (e) {
        console.error('[main] v31 迁移提示失败（继续启动）:', e)
      }
    }

    // 步骤 1.5/4: v3.2+ 数据扁平化迁移（#9：旧的 <installDir>/data/data/ → <installDir>/data/）
    console.log('[main] 步骤 1.5/4: 检查 v3.2 扁平化迁移...')
    try {
      migrateFlattenDataIfNeeded()
    } catch (e) {
      console.error('[main] 扁平化迁移失败（继续启动）:', e)
    }

    // 步骤 1.6/4: 提示用户数据目录回退（仅打包模式）
    // 关键：用户安装到 C:\Program Files\ 等无写权限位置时，
    // 数据会自动回退到 %APPDATA%，必须明确告知用户数据实际位置，
    // 避免「安装目录里的 data/ 是空的」造成「数据丢失」错觉
    if (isDataRootFallback()) {
      try {
        dialog.showMessageBox({
          type: 'info',
          title: '数据目录已切换',
          message:
            '由于安装目录无写权限，您的数据已自动保存到 %APPDATA% 目录。\n\n' +
            '请勿卸载时直接删除安装目录，否则不会影响您的数据。\n' +
            '如需更换数据位置，请重新安装到「文档」「D盘」等有写权限的位置。',
          buttons: ['我知道了'],
        })
      } catch {
        /* noop */
      }
    }

    // 步骤 2/4: 初始化数据库
    console.log('[main] 步骤 2/4: 初始化数据库...')
    try {
      db.initMainDatabase()
    } catch (e) {
      console.error('[main] 数据库初始化失败:', e)
      try {
        dialog.showErrorBox(
          '数据库初始化失败',
          `${(e as any)?.message || e}\n\n请尝试重装应用或在设置中重置数据。`,
        )
      } catch {
        /* noop */
      }
      app.quit()
      return
    }

    // 步骤 3/4: 注册协议 + IPC
    console.log('[main] 步骤 3/4: 注册协议 + IPC...')
    setupNgaRefererHook()
    registerLocalProtocol()
    registerIpcHandlers(getWindow)

    // 步骤 4/4: 创建窗口
    console.log('[main] 步骤 4/4: 创建窗口...')
    createWindow()
    console.log('[main] 启动完成')
  })
}

// 防止未使用警告
void ipcMain
