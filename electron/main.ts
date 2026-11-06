// © 星星的辰 | 开发时间: 2026-06-17 | 唯一标识: AnkeCreator_20260617_XXXX
// 本应用由本人独立开发，保留所有权利 | 非授权禁止商用
//
// Electron 主进程入口
// - 窗口管理
// - 应用生命周期
// - 协议 + NGA Referer 钩子
// - IPC 注册（委托给 ./ipc 域模块）

import { app, BrowserWindow, crashReporter, dialog, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'

// 主进程数据库（JSON 文件存储）
import * as db from './db-main'
import { ensureDailySnapshot, consumeRestoreRequest } from './snapshot'
import { migrateFromUserDataIfNeeded, migrateFlattenDataIfNeeded, isDataRootFallback, getDataDir } from './paths'
import { initializeStorageLayout } from './data-core/storageLayout'

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
import { registerNgaSessionIpc } from './ngaSession'
import { installWindowSecurity } from './security'

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
// 原生崩溃采集（本地 minidump，不上传）
// 渲染进程崩溃已有 errorReporter 的 render-process-gone 日志，这里补上
// 主进程/原生侧崩溃堆栈，便于用户反馈问题时导出 data/crashes 进行定位。
// 必须在 ready 之前设置 crashDumps 路径并 start。
// ============================================================
try {
  const crashDumpsDir = path.join(getDataDir(), 'crashes')
  fs.mkdirSync(crashDumpsDir, { recursive: true })
  app.setPath('crashDumps', crashDumpsDir)
  crashReporter.start({
    productName: 'Anke Creator',
    companyName: 'Anke Creator',
    uploadToServer: false,
    compress: false,
  })
} catch (e) {
  console.warn('[main] 崩溃采集初始化失败（不影响运行）：', e)
}

// ============================================================
// 窗口管理
// ============================================================
let win: BrowserWindow | null

// 关闭握手：用户点关闭后先通知渲染层 flush 未保存内容，完成后才 destroy。
// 超时 3s 仍未收到确认则强制关闭，避免渲染层崩溃时窗口无法关闭。
let closeConfirmed = false
let closeGuardTimer: NodeJS.Timeout | null = null
const CLOSE_GUARD_TIMEOUT_MS = 5000

function createWindow() {
  closeConfirmed = false
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

  // 导航/弹窗守卫：只允许停留在应用自身页面，外链交系统浏览器
  installWindowSecurity(win, {
    devServerOrigin: VITE_DEV_SERVER_URL,
    rendererDist: RENDERER_DIST,
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

  // 关闭前落盘握手：阻止立即关闭，通知渲染层 flush，收到确认后再 destroy
  win.on('close', (event) => {
    const current = win
    if (!current || closeConfirmed) return
    event.preventDefault()
    if (current.webContents.isDestroyed()) {
      closeConfirmed = true
      current.destroy()
      return
    }
    current.webContents.send('app:before-close')
    if (closeGuardTimer) clearTimeout(closeGuardTimer)
    closeGuardTimer = setTimeout(() => {
      closeGuardTimer = null
      closeConfirmed = true
      if (!current.isDestroyed()) current.destroy()
    }, CLOSE_GUARD_TIMEOUT_MS)
  })

  win.on('closed', () => {
    if (closeGuardTimer) {
      clearTimeout(closeGuardTimer)
      closeGuardTimer = null
    }
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

// 单实例锁：两个进程同时写同一份 JSON 会互相覆盖（进程内写锁无法跨进程）
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
}

// 渲染层完成 flush 后才真正销毁窗口（对应 preload 的 confirmAppClose）
ipcMain.on('app:close-confirmed', (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (!senderWindow) return
  if (closeGuardTimer) {
    clearTimeout(closeGuardTimer)
    closeGuardTimer = null
  }
  closeConfirmed = true
  senderWindow.destroy()
})

// 退出流程同样等待落盘握手（覆盖 Alt+F4、任务栏退出等路径）
app.on('before-quit', (event) => {
  if (closeConfirmed || !win) return
  event.preventDefault()
  win.close()
})

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
} else if (hasSingleInstanceLock) {
  // 注册全局错误处理（必须在所有 app.on('xxx') 之前）
  registerGlobalErrorHandlers()

  // 必须在 app ready 之前调用 registerSchemesAsPrivileged
  registerSchemesAsPrivileged()

  // 允许自动播放音频（掷骰音效需要，#4）：无需用户手势即可播放
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

  app.whenReady().then(async () => {
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

    // 步骤 1.8/4: 消费「恢复快照」请求（必须在数据库初始化之前，避免内存缓存互相覆盖）
    try {
      const restored = consumeRestoreRequest(getDataDir())
      if (restored) {
        console.log(`[main] 已恢复快照 ${restored.name}，当前数据已备份到 ${restored.safetyBackup}`)
      }
    } catch (e) {
      console.error('[main] 恢复快照失败（继续使用当前数据）:', e)
    }

    // 步骤 1.9: 提前确定存储布局（必须在数据库初始化之前，避免按错误布局读写）
    try {
      initializeStorageLayout(getDataDir())
    } catch (e) {
      console.warn('[main] 存储布局初始化失败（继续使用单文件布局）:', e)
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

    // 步骤 2.5/4: 每日自动快照（放在数据库初始化之后、开窗前，失败不阻塞启动）
    console.log('[main] 步骤 2.5/4: 检查每日自动快照...')
    try {
      const snap = ensureDailySnapshot(getDataDir())
      if (snap) {
        console.log(`[main] 今日快照已就绪：${snap.name}（${snap.storyFiles} 个作品文件 / ${snap.sectionFiles} 个正文文件）`)
      }
    } catch (e) {
      console.warn('[main] 自动快照失败（继续启动）:', e)
    }

    // 步骤 3/4: 注册协议 + IPC
    console.log('[main] 步骤 3/4: 注册协议 + IPC...')
    setupNgaRefererHook()
    registerLocalProtocol()
    registerIpcHandlers(getWindow)
    registerNgaSessionIpc()

    // 步骤 4/4: 创建窗口
    console.log('[main] 步骤 4/4: 创建窗口...')
    createWindow()
    console.log('[main] 启动完成')
  })
}

// 防止未使用警告
void ipcMain
