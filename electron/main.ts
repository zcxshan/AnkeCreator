// © 点点星辰 | 开发时间: 2026-06-17 | 唯一标识: AnkeCreator_20260617_XXXX
// 本应用由本人独立开发，保留所有权利 | 非授权禁止商用
//
// Electron 主进程入口
// - 窗口管理
// - 应用生命周期
// - 协议 + NGA Referer 钩子
// - IPC 注册（委托给 ./ipc 域模块）

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'path'

// 主进程数据库（JSON 文件存储）
import * as db from './db-main'
import { migrateFromUserDataIfNeeded } from './paths'

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
// 窗口管理
// ============================================================
let win: BrowserWindow | null

function createWindow() {
  const iconPath = path.join(appRoot, 'icon.png')

  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
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
