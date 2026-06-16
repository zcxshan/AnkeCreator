// © 点点星辰 | 开发时间: 2026-06-16 | 唯一标识: AnkeCreator_20260616_XXXX
// 本应用由本人独立开发，保留所有权利 | 非授权禁止商用
import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs'

process.env.APP_ROOT = path.join(__dirname, '..')
const appRoot = process.env.APP_ROOT
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const RENDERER_DIST = path.join(appRoot, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(appRoot, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null

function ensureImagesDir(): string {
  const base = VITE_DEV_SERVER_URL
    ? path.join(appRoot, 'public')
    : RENDERER_DIST
  const imagesDir = path.join(base, 'assets', 'images')
  try {
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true })
    }
  } catch (e) {
    console.error('创建 images 目录失败:', e)
  }
  return imagesDir
}

function createWindow() {
  // 应用图标路径
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
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  win.on('closed', () => {
    win = null
  })
}

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

ipcMain.on('window:minimize', () => {
  win?.minimize()
})

ipcMain.on('window:toggle-maximize', () => {
  if (win?.isMaximized()) {
    win.unmaximize()
  } else {
    win?.maximize()
  }
})

ipcMain.on('window:close', () => {
  win?.close()
})

// 图片选择 + 复制到项目 assets/images 目录
// 返回相对路径（相对于 public/），例如 'assets/images/abc123.jpg'
ipcMain.handle('image:select', (): Promise<string | null> => {
  return new Promise((resolve) => {
    if (!win) return resolve(null)
    dialog
      .showOpenDialog(win, {
        title: '选择图片',
        properties: ['openFile'],
        filters: [
          {
            name: '图片文件',
            extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'],
          },
        ],
      })
      .then((result) => {
        if (result.canceled || !result.filePaths[0]) {
          return resolve(null)
        }
        const srcPath = result.filePaths[0]
        const imagesDir = ensureImagesDir()
        const ext = path.extname(srcPath).toLowerCase().replace(/^\./, '') || 'png'
        const fileName =
          Date.now().toString(36) +
          '_' +
          Math.random().toString(36).slice(2, 8) +
          '.' +
          ext
        const destPath = path.join(imagesDir, fileName)
        try {
          fs.copyFileSync(srcPath, destPath)
          const relativeUrl = `assets/images/${fileName}`
          resolve(relativeUrl)
        } catch (e) {
          console.error('复制图片失败:', e)
          // 失败时回退到 base64 内联
          try {
            const data = fs.readFileSync(srcPath)
            const mime = `image/${ext === 'jpg' ? 'jpeg' : ext}`
            const base64 = `data:${mime};base64,${data.toString('base64')}`
            resolve(base64)
          } catch {
            resolve(null)
          }
        }
      })
      .catch((e) => {
        console.error('文件选择框错误:', e)
        resolve(null)
      })
  })
})

// 保存 base64 图片到项目 assets/images 目录
// 接受 data URL 格式（如 data:image/png;base64,...），返回相对路径
ipcMain.handle('image:save', async (_event, dataUrl: string): Promise<string | null> => {
  try {
    const match = dataUrl.match(/^data:image\/([\w+]+);base64,(.+)$/)
    if (!match) return null
    const rawExt = match[1] === 'jpeg' ? 'jpg' : match[1].replace('+', '')
    const ext = rawExt || 'png'
    const base64Data = match[2]
    const imagesDir = ensureImagesDir()
    const fileName =
      Date.now().toString(36) +
      '_' +
      Math.random().toString(36).slice(2, 8) +
      '.' +
      ext
    const destPath = path.join(imagesDir, fileName)
    fs.writeFileSync(destPath, Buffer.from(base64Data, 'base64'))
    return `assets/images/${fileName}`
  } catch (e) {
    console.error('保存图片失败:', e)
    return null
  }
})

app.whenReady().then(createWindow)
