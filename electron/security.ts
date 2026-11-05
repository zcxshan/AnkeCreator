// ============================================================
// Electron 窗口安全策略（主进程侧安装器）
//
// - window.open：外链交给系统浏览器；local:// 资源用受限子窗口展示；其余拒绝
// - will-navigate：只允许停留在应用自身页面
// - 禁止 webview 挂载、拒绝所有权限请求
//
// 纯策略函数见 ./securityPolicy（同一份 CSP 也被 vite.config.ts 用于注入 meta）
// ============================================================

import { BrowserWindow, shell } from 'electron'
import {
  isExternalUrl,
  isInternalUrl,
  isLocalAssetUrl,
  type NavGuardContext,
} from './securityPolicy'

/** 受限子窗口（仅用于展示 local:// 图片）：无 Node、无 preload、独立沙箱 */
const SAFE_CHILD_WINDOW_OPTIONS = {
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    preload: undefined as unknown as string,
  },
}

/** 给主窗口挂上导航/弹窗守卫 */
export function installWindowSecurity(win: BrowserWindow, ctx: NavGuardContext): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalAssetUrl(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: SAFE_CHILD_WINDOW_OPTIONS }
    }
    if (isExternalUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (isInternalUrl(url, ctx)) return
    event.preventDefault()
    if (isExternalUrl(url)) {
      void shell.openExternal(url)
    }
  })

  win.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  // 本应用不需要摄像头/麦克风/地理位置等权限，一律拒绝
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false)
  })
}
