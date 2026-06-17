// © 点点星辰 | 开发时间: 2026-06-17 | 唯一标识: AnkeCreator_20260617_XXXX
// 本应用由本人独立开发，保留所有权利 | 非授权禁止商用
import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs'

// ============================================================
// 数据库（JSON 文件存储，位于 userData/AnkeCreatorData）
// ============================================================
import * as db from './db-main'

process.env.APP_ROOT = path.join(__dirname, '..')
const appRoot = process.env.APP_ROOT
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const RENDERER_DIST = path.join(appRoot, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(appRoot, 'public') : RENDERER_DIST

let win: BrowserWindow | null

// ============================================================
// 图片选择 + 保存
// ============================================================
function ensureImagesDir(): string {
  const base = VITE_DEV_SERVER_URL ? path.join(appRoot, 'public') : RENDERER_DIST
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
    try { win.setMenuBarVisibility(false) } catch {}
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

app.whenReady().then(() => {
  // 启动时初始化数据库
  db.initMainDatabase()
  createWindow()
})

// ============================================================
// 窗口控制
// ============================================================
ipcMain.on('window:minimize', () => { win?.minimize() })
ipcMain.on('window:toggle-maximize', () => {
  if (win?.isMaximized()) win.unmaximize()
  else win?.maximize()
})
ipcMain.on('window:close', () => { win?.close() })

// ============================================================
// 图片处理
// ============================================================
ipcMain.handle('image:select', async (): Promise<string | null> => {
  if (!win) return null
  const result = await dialog.showOpenDialog(win, {
    title: '选择图片',
    properties: ['openFile'],
    filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }],
  })
  if (result.canceled || !result.filePaths[0]) return null
  const srcPath = result.filePaths[0]
  const imagesDir = ensureImagesDir()
  const ext = path.extname(srcPath).toLowerCase().replace(/^\./, '') || 'png'
  const fileName = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext
  const destPath = path.join(imagesDir, fileName)
  try {
    fs.copyFileSync(srcPath, destPath)
    return 'assets/images/' + fileName
  } catch (e) {
    console.error('复制图片失败:', e)
    try {
      const data = fs.readFileSync(srcPath)
      const mime = `image/${ext === 'jpg' ? 'jpeg' : ext}`
      return `data:${mime};base64,${data.toString('base64')}`
    } catch {
      return null
    }
  }
})

ipcMain.handle('image:save', async (_event, dataUrl: string): Promise<string | null> => {
  try {
    const match = dataUrl.match(/^data:image\/([\w+]+);base64,(.+)$/)
    if (!match) return null
    const rawExt = match[1] === 'jpeg' ? 'jpg' : match[1].replace('+', '')
    const ext = rawExt || 'png'
    const base64Data = match[2]
    const imagesDir = ensureImagesDir()
    const fileName = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext
    const destPath = path.join(imagesDir, fileName)
    fs.writeFileSync(destPath, Buffer.from(base64Data, 'base64'))
    return 'assets/images/' + fileName
  } catch (e) {
    console.error('保存图片失败:', e)
    return null
  }
})

// ============================================================
// 数据库 IPC (Renderer → Main)
// 所有数据库操作均在主进程执行，返回 Promise 结果。
// ============================================================

// Story
ipcMain.handle('db:list-stories', () => db.listStories())
ipcMain.handle('db:get-story', (_e, id: string) => db.getStory(id))
ipcMain.handle('db:create-story', (_e, data: { title: string; description?: string; category?: string }) => db.createStory(data))
ipcMain.handle('db:update-story', (_e, id: string, patch: any) => db.updateStory(id, patch))
ipcMain.handle('db:delete-story', (_e, id: string) => { db.deleteStory(id); return true })

// WorldSettings
ipcMain.handle('db:list-world-settings', (_e, storyId: string) => db.listWorldSettings(storyId))
ipcMain.handle('db:create-world-setting', (_e, data: any) => db.createWorldSetting(data))
ipcMain.handle('db:update-world-setting', (_e, id: string, patch: any) => db.updateWorldSetting(id, patch))
ipcMain.handle('db:delete-world-setting', (_e, id: string) => { db.deleteWorldSetting(id); return true })

// Characters
ipcMain.handle('db:list-characters', (_e, storyId: string) => db.listCharacters(storyId))
ipcMain.handle('db:create-character', (_e, data: any) => db.createCharacter(data))
ipcMain.handle('db:update-character', (_e, id: string, patch: any) => db.updateCharacter(id, patch))
ipcMain.handle('db:delete-character', (_e, id: string) => { db.deleteCharacter(id); return true })

// Character Variants
ipcMain.handle('db:list-character-variants', (_e, characterId: string) => db.listCharacterVariants(characterId))
ipcMain.handle('db:create-character-variant', (_e, data: any) => db.createCharacterVariant(data))
ipcMain.handle('db:create-character-variants-batch', (_e, characterId: string, items: { name?: string; url: string }[]) => db.createCharacterVariantsBatch(characterId, items))
ipcMain.handle('db:update-character-variant', (_e, id: string, patch: any) => { db.updateCharacterVariant(id, patch); return true })
ipcMain.handle('db:delete-character-variant', (_e, id: string) => { db.deleteCharacterVariant(id); return true })
ipcMain.handle('db:reorder-character-variants', (_e, characterId: string, orderedIds: string[]) => { db.reorderCharacterVariants(characterId, orderedIds); return true })

// Character Relations
ipcMain.handle('db:list-character-relations', (_e, storyId: string) => db.listCharacterRelations(storyId))
ipcMain.handle('db:create-character-relation', (_e, data: any) => db.createCharacterRelation(data))
ipcMain.handle('db:update-character-relation', (_e, id: string, patch: any) => db.updateCharacterRelation(id, patch))
ipcMain.handle('db:delete-character-relation', (_e, id: string) => { db.deleteCharacterRelation(id); return true })

// Outlines
ipcMain.handle('db:list-outlines', (_e, storyId: string) => db.listOutlines(storyId))
ipcMain.handle('db:create-outline', (_e, data: any) => db.createOutline(data))
ipcMain.handle('db:update-outline', (_e, id: string, patch: any) => db.updateOutline(id, patch))
ipcMain.handle('db:delete-outline', (_e, id: string) => { db.deleteOutline(id); return true })

// Volumes
ipcMain.handle('db:list-volumes', (_e, storyId: string) => db.listVolumes(storyId))
ipcMain.handle('db:create-volume', (_e, data: any) => db.createVolume(data))
ipcMain.handle('db:update-volume', (_e, id: string, patch: any) => db.updateVolume(id, patch))
ipcMain.handle('db:delete-volume', (_e, id: string) => { db.deleteVolume(id); return true })
ipcMain.handle('db:reorder-volumes', (_e, storyId: string, orderedIds: string[]) => { db.reorderVolumes(storyId, orderedIds); return true })

// Chapters
ipcMain.handle('db:list-chapters', (_e, storyId: string) => db.listChapters(storyId))
ipcMain.handle('db:list-chapters-by-volume', (_e, volumeId: string) => db.listChaptersByVolume(volumeId))
ipcMain.handle('db:create-chapter', (_e, data: any) => db.createChapter(data))
ipcMain.handle('db:update-chapter', (_e, id: string, patch: any) => db.updateChapter(id, patch))
ipcMain.handle('db:delete-chapter', (_e, id: string) => { db.deleteChapter(id); return true })
ipcMain.handle('db:reorder-chapters', (_e, storyId: string, orderedIds: string[]) => { db.reorderChapters(storyId, orderedIds); return true })

// Sections
ipcMain.handle('db:list-sections', (_e, chapterId: string) => db.listSections(chapterId))
ipcMain.handle('db:create-section', (_e, data: any) => db.createSection(data))
ipcMain.handle('db:update-section', (_e, id: string, patch: any) => db.updateSection(id, patch))
ipcMain.handle('db:delete-section', (_e, id: string) => { db.deleteSection(id); return true })
ipcMain.handle('db:reorder-sections', (_e, chapterId: string, orderedIds: string[]) => { db.reorderSections(chapterId, orderedIds); return true })

// Section content (富文本正文)
ipcMain.handle('db:get-section-content', (_e, id: string) => db.getSectionContent(id))
ipcMain.handle('db:set-section-content', (_e, id: string, content: string | null) => { db.setSectionContent(id, content); return true })

// Content blocks
ipcMain.handle('db:list-blocks', (_e, sectionId: string) => db.listBlocks(sectionId))
ipcMain.handle('db:create-text-block', (_e, sectionId: string, payload: any, orderIndex?: number) => db.createBlock(sectionId, 'text', payload, orderIndex))
ipcMain.handle('db:create-image-block', (_e, sectionId: string, payload: any, orderIndex?: number) => db.createBlock(sectionId, 'image', payload, orderIndex))
ipcMain.handle('db:create-dice-block', (_e, sectionId: string, payload: any, orderIndex?: number) => db.createBlock(sectionId, 'dice', payload, orderIndex))
ipcMain.handle('db:update-block-payload', (_e, id: string, payload: any) => db.updateBlockPayload(id, payload))
ipcMain.handle('db:reorder-blocks', (_e, sectionId: string, orderedIds: string[]) => { db.reorderBlocks(sectionId, orderedIds); return true })
ipcMain.handle('db:delete-block', (_e, id: string) => { db.deleteBlock(id); return true })

// World templates
ipcMain.handle('db:list-world-setting-templates', () => db.listWorldSettingTemplates())
ipcMain.handle('db:create-world-setting-template', (_e, data: any) => db.createWorldSettingTemplate(data))
ipcMain.handle('db:update-world-setting-template', (_e, id: string, patch: any) => db.updateWorldSettingTemplate(id, patch))
ipcMain.handle('db:delete-world-setting-template', (_e, id: string) => { db.deleteWorldSettingTemplate(id); return true })

// Character templates
ipcMain.handle('db:list-character-templates', () => db.listCharacterTemplates())
ipcMain.handle('db:create-character-template', (_e, data: any) => db.createCharacterTemplate(data))
ipcMain.handle('db:update-character-template', (_e, id: string, patch: any) => db.updateCharacterTemplate(id, patch))
ipcMain.handle('db:delete-character-template', (_e, id: string) => { db.deleteCharacterTemplate(id); return true })

// Aggregate
ipcMain.handle('db:get-story-with-all', (_e, storyId: string) => db.getStoryWithAll(storyId))

// Utilities
ipcMain.handle('db:get-data-directory', () => db.getDataDirectory())

// ============================================================
// 显示本地目录（供用户打开保存位置）
// ============================================================
ipcMain.handle('app:open-data-directory', async (): Promise<boolean> => {
  try {
    const dir = db.getDataDirectory()
    await (fs.promises as any).mkdir(dir, { recursive: true })
    // 跨平台打开目录
    const { shell } = require('electron')
    shell.openPath(dir)
    return true
  } catch (e) {
    console.error('打开数据目录失败:', e)
    return false
  }
})
