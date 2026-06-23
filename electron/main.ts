// © 点点星辰 | 开发时间: 2026-06-17 | 唯一标识: AnkeCreator_20260617_XXXX
// 本应用由本人独立开发，保留所有权利 | 非授权禁止商用
import { app, BrowserWindow, ipcMain, dialog, protocol, shell, session } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import {
  parseThreadUrl,
  computePageRange,
  extractPostsFromHtml,
  filterAnjiaPosts,
  extractTotalPagesFromHtml,
  detectCharsetFromHtml,
  type CollectResult,
} from '../src/utils/ngaCrawler'

// ============================================================
// 数据库（JSON 文件存储，位于 userData/AnkeCreatorData）
// ============================================================
import * as db from './db-main'

process.env.APP_ROOT = path.join(__dirname, '..')
const appRoot = process.env.APP_ROOT
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const RENDERER_DIST = path.join(appRoot, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(appRoot, 'public') : RENDERER_DIST

// ============================================================
// 本地图片存储目录（用于"本地保存"模式）
// 路径：userData/images/，文件名 = sha256(buffer)[:16] + ext
// ============================================================
const imagesDir = path.join(app.getPath('userData'), 'images')
try {
  fs.mkdirSync(imagesDir, { recursive: true })
} catch (e) {
  console.error('[imagesDir] 创建失败:', e)
}

// 注册 local:// 为特权协议，使其支持 fetch / <img src="local://...">
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local',
    privileges: {
      standard: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
])

/** 根据扩展名推断 MIME */
function getMimeByExt(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.bmp') return 'image/bmp'
  if (ext === '.svg') return 'image/svg+xml'
  return 'application/octet-stream'
}

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

  // ============================================================
  // NGA 防盗链绕过：渲染进程加载 img.nga.178.com 图片时自动加 Referer
  // 根因：NGA 图床检查 Referer 头，Electron 渲染层默认不携带 nga.178.com referer，
  //       导致编辑器内插入的 NGA 图片加载失败
  // 主进程 ngaCrawler 已经在 main.ts:521-529 / 635-639 手动加过 Referer，
  // 但只覆盖 Node.js fetch，不覆盖渲染层 <img> 请求
  // ============================================================
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.nga.178.com/*'] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };
      // 模拟从 NGA 论坛页面访问图片的 referer
      if (!headers['Referer'] || headers['Referer'] === '') {
        headers['Referer'] = 'https://nga.178.com/';
      }
      callback({ requestHeaders: headers });
    },
  );

  // 注册 local:// 协议：把 local://<hash>.<ext> 映射到 userData/images/ 下的文件
  // 浏览器/渲染端用 <img src="local://xxx.png"> 时，由 Electron 拦截并返回文件内容
  protocol.handle('local', async (request) => {
    try {
      const url = new URL(request.url)
      // local://hash.png → hostname='hash.png'
      // 也兼容 local:///hash.png → pathname='/hash.png'
      let fileName = url.hostname || url.pathname.replace(/^\/+/, '')
      // URL 解码（防止扩展名含特殊字符）
      try {
        fileName = decodeURIComponent(fileName)
      } catch {
        // ignore
      }
      const filePath = path.join(imagesDir, fileName)
      // 防路径穿越：必须位于 imagesDir 内
      const normalized = path.normalize(filePath)
      if (!normalized.startsWith(path.normalize(imagesDir) + path.sep) && normalized !== path.normalize(imagesDir)) {
        return new Response('Forbidden', { status: 403 })
      }
      const data = await fs.promises.readFile(normalized)
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': getMimeByExt(normalized),
          'Cache-Control': 'no-cache',
        },
      })
    } catch (e) {
      return new Response('Not found', { status: 404 })
    }
  })

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
// image:select：弹系统选图对话框，直接读文件返回 base64+filename+mimeType+filePath
// image:upload：把 base64 buffer 上传到 sm.ms 图床，返回 URL
// **不**写本地文件，**不**写 base64 data URL
ipcMain.handle(
  'image:select',
  async (): Promise<{ buffer: string; filename: string; mimeType: string; filePath?: string } | null> => {
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: '选择图片',
      properties: ['openFile'],
      filters: [
        { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
      ],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const p = result.filePaths[0]
    try {
      const data = fs.readFileSync(p)
      const extRaw = path.extname(p).toLowerCase().replace(/^\./, '') || 'png'
      const ext = extRaw === 'jpg' ? 'jpeg' : extRaw
      return {
        buffer: data.toString('base64'),
        filename: path.basename(p),
        mimeType: `image/${ext}`,
        filePath: p,
      }
    } catch (e) {
      console.error('读取图片失败:', e)
      return null
    }
  },
)

ipcMain.handle(
  'image:upload',
  async (
    _e,
    payload: { buffer: string; filename: string; mimeType: string },
  ): Promise<{ ok: boolean; url?: string; error?: string; host?: string }> => {
    try {
      const buf = Buffer.from(payload.buffer, 'base64')
      const { uploadImage } = await import('./imageHosting')
      const res = await uploadImage({
        buffer: buf,
        filename: payload.filename,
        mimeType: payload.mimeType,
      })
      if (res.ok) {
        console.log(
          `[image:upload] 上传成功 (${(res as any).host || 'unknown'}):`,
          res.url,
        )
      } else {
        console.warn('[image:upload] 所有图床失败:', res.error)
      }
      return res
    } catch (e) {
      return { ok: false, error: (e as Error).message || '上传失败' }
    }
  },
)

// image:saveLocal：把图片写入 userData/images/，返回 local://xxx 协议 URL
// 用于"本地保存"模式——不联网，NGA 导出时自动用占位符
ipcMain.handle(
  'image:saveLocal',
  async (
    _e,
    payload: { buffer: string; filename: string; mimeType: string },
  ): Promise<{ ok: boolean; url?: string; error?: string }> => {
    try {
      const buf = Buffer.from(payload.buffer, 'base64')
      // sha256[:16] 做文件名（保证唯一 + 防止路径穿越）
      const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
      const m = payload.filename.match(/\.[^.]+$/)
      const ext = m ? m[0].toLowerCase() : '.png'
      const localName = `${hash}${ext}`
      const localPath = path.join(imagesDir, localName)
      // 已存在则跳过写入（相同图片不重复写盘）
      if (!fs.existsSync(localPath)) {
        fs.writeFileSync(localPath, buf)
      }
      return { ok: true, url: `local://${localName}` }
    } catch (e) {
      console.error('[image:saveLocal] 写入失败:', e)
      return { ok: false, error: (e as Error).message || '本地保存失败' }
    }
  },
)

// image:openFolder：用系统文件管理器打开本地图片目录
ipcMain.handle(
  'image:openFolder',
  async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await shell.openPath(imagesDir)
      if (res) {
        return { ok: false, error: res }
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
)

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

// Trash / Recycle Bin (soft delete, restore, permanent delete)
ipcMain.handle('db:soft-delete-story', (_e, id: string) => { db.softDeleteStory(id); return true })
ipcMain.handle('db:restore-story', (_e, id: string) => { db.restoreStory(id); return true })
ipcMain.handle('db:permanently-delete-story', (_e, id: string) => { db.permanentlyDeleteStory(id); return true })
ipcMain.handle('db:list-trashed-stories', () => db.listTrashedStories())
ipcMain.handle('db:cleanup-old-trashed', (_e, days: number) => db.cleanupOldTrashed(days))

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
ipcMain.handle('db:reorder-world-settings', (_e, storyId: string, orderedIds: string[]) => { db.reorderWorldSettings(storyId, orderedIds); return true })
ipcMain.handle('db:reorder-characters', (_e, storyId: string, orderedIds: string[]) => { db.reorderCharacters(storyId, orderedIds); return true })

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
ipcMain.handle('db:move-chapters', (_e, storyId: string, targetVolumeId: string | null, orderedIds: string[]) => { db.moveChapters(storyId, targetVolumeId, orderedIds); return true })

// Sections
ipcMain.handle('db:list-sections', (_e, chapterId: string) => db.listSections(chapterId))
ipcMain.handle('db:create-section', (_e, data: any) => db.createSection(data))
ipcMain.handle('db:update-section', (_e, id: string, patch: any) => db.updateSection(id, patch))
ipcMain.handle('db:delete-section', (_e, id: string) => { db.deleteSection(id); return true })
ipcMain.handle('db:reorder-sections', (_e, chapterId: string, orderedIds: string[]) => { db.reorderSections(chapterId, orderedIds); return true })
ipcMain.handle('db:move-sections', (_e, targetChapterId: string | null, orderedIds: string[]) => { db.moveSections(targetChapterId, orderedIds); return true })

// Section content (富文本正文)
ipcMain.handle('db:get-section-content', (_e, id: string) => db.getSectionContent(id))
ipcMain.handle('db:set-section-content', (_e, id: string, content: string | null) => { db.setSectionContent(id, content); return true })

// World templates
ipcMain.handle('db:list-world-setting-templates', () => db.listWorldSettingTemplates())
ipcMain.handle('db:create-world-setting-template', (_e, data: any) => db.createWorldSettingTemplate(data))
ipcMain.handle('db:update-world-setting-template', (_e, id: string, patch: any) => db.updateWorldSettingTemplate(id, patch))
ipcMain.handle('db:delete-world-setting-template', (_e, id: string) => { db.deleteWorldSettingTemplate(id); return true })
ipcMain.handle('db:reorder-world-setting-templates', (_e, orderedIds: string[]) => { db.reorderWorldSettingTemplates(orderedIds); return true })

// Character templates
ipcMain.handle('db:list-character-templates', () => db.listCharacterTemplates())
ipcMain.handle('db:create-character-template', (_e, data: any) => db.createCharacterTemplate(data))
ipcMain.handle('db:update-character-template', (_e, id: string, patch: any) => db.updateCharacterTemplate(id, patch))
ipcMain.handle('db:delete-character-template', (_e, id: string) => { db.deleteCharacterTemplate(id); return true })
ipcMain.handle('db:reorder-character-templates', (_e, orderedIds: string[]) => { db.reorderCharacterTemplates(orderedIds); return true })

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

// ============================================================
// 整作品另存为：弹系统保存对话框，导出 .anke.json 文件
// ============================================================
ipcMain.handle(
  'story:export-to-file',
  async (
    _e,
    payload: { data: any; suggestedName?: string },
  ): Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: string }> => {
    try {
      const focused = BrowserWindow.getFocusedWindow() || win || BrowserWindow.getAllWindows()[0]
      const result = await dialog.showSaveDialog(focused!, {
        title: '安科作品另存为',
        defaultPath: `${payload.suggestedName || 'anke'}.anke.json`,
        filters: [
          { name: '安科作品文件', extensions: ['anke.json'] },
          { name: 'JSON 文件', extensions: ['json'] },
        ],
      })
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      const json = JSON.stringify(payload.data, null, 2)
      fs.writeFileSync(result.filePath, json, 'utf-8')
      return { ok: true, filePath: result.filePath }
    } catch (e) {
      console.error('安科另存为失败:', e)
      return { ok: false, error: (e as Error).message }
    }
  },
)

// ============================================================
// 导入安科作品：弹系统打开对话框，读 .anke.json 文件内容
// ============================================================
ipcMain.handle(
  'story:import-from-file',
  async (): Promise<{ ok: boolean; canceled?: boolean; filePath?: string; data?: any; error?: string }> => {
    try {
      const focused = BrowserWindow.getFocusedWindow() || win || BrowserWindow.getAllWindows()[0]
      const result = await dialog.showOpenDialog(focused!, {
        title: '导入安科作品',
        properties: ['openFile'],
        filters: [
          { name: '安科作品文件', extensions: ['anke.json'] },
          { name: 'JSON 文件', extensions: ['json'] },
        ],
      })
      if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true }
      const raw = fs.readFileSync(result.filePaths[0], 'utf-8')
      const data = JSON.parse(raw)
      return { ok: true, filePath: result.filePaths[0], data }
    } catch (e) {
      console.error('安科导入失败:', e)
      return { ok: false, error: (e as Error).message }
    }
  },
)

// ============================================================
// NGA 安价收集
// - 抓取 NGA 主题帖指定范围的楼层
// - 过滤出"以指定文本开头"的楼层
// - 返回楼层号 / 层主 / 内容
// - 支持取消（nga:collect:cancel）+ 自动检测总页数（nga:fetchThreadInfo）
// ============================================================

// 模块级状态：跟踪当前抓取任务 + 已取消任务 ID 集合
let currentCollectingTaskId = 0;
const cancelledTaskIds = new Set<number>();

ipcMain.handle(
  'nga:collect',
  async (
    _e,
    payload: {
      url: string;
      startFloor: number;
      endFloor: number;
      prefix: string;
      authorid?: string;
      cookies?: string;
    },
  ): Promise<CollectResult> => {
    // 分配新的 taskId
    currentCollectingTaskId++;
    const taskId = currentCollectingTaskId;
    try {
      const parsed = parseThreadUrl(payload.url);
      if (!parsed) {
        return {
          ok: false,
          items: [],
          totalPages: 0,
          error: '无法解析 URL 中的 tid 参数，请检查链接格式',
        };
      }
      const { tid, baseUrl, authorid: urlAuthorid } = parsed;
      // 优先使用 URL 中的 authorid，其次使用 payload.authorid
      const targetAuthorid = urlAuthorid || payload.authorid;
      const { startPage, endPage, totalPages } = computePageRange(
        payload.startFloor,
        payload.endFloor,
      );

      console.log(
        `[nga:collect] taskId=${taskId} tid=${tid} 范围=${payload.startFloor}-${payload.endFloor} 页码=${startPage}-${endPage}（共 ${totalPages} 页）${targetAuthorid ? ` authorid=${targetAuthorid}` : ''}`,
      );

      const allPosts: ReturnType<typeof extractPostsFromHtml> = [];
      const errors: string[] = [];

      for (let page = startPage; page <= endPage; page++) {
        // 取消检查（在每页之间）
        if (cancelledTaskIds.has(taskId)) {
          console.log(`[nga:collect] 任务 ${taskId} 被取消（已抓 ${allPosts.length} 帖）`);
          break;
        }
        const pageUrl = `${baseUrl}/read.php?tid=${tid}&page=${page}`;
        try {
          // 增强请求头（基于实际抓取验证，Referer + Sec-Fetch-* 关键）
          const headers: Record<string, string> = {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
              '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept':
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Referer': `${baseUrl}/`,  // 关键：必须有，否则可能被当爬虫
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            'Cache-Control': 'max-age=0',
          };
          if (payload.cookies && payload.cookies.trim()) {
            headers['Cookie'] = payload.cookies.trim();
          }
          const resp = await fetch(pageUrl, { headers, redirect: 'follow' });
          if (!resp.ok) {
            errors.push(`第 ${page} 页 HTTP ${resp.status}`);
            console.warn(`[nga:collect] 第 ${page} 页 HTTP ${resp.status}`);
            // 触发反爬时退避：403/429 是 NGA 限流/封禁的典型信号
            // 退避 3 秒 + 标准间隔，避免加重被封
            if (resp.status === 403 || resp.status === 429) {
              console.warn(`[nga:collect] 检测到反爬信号（HTTP ${resp.status}），退避 3 秒...`);
              await new Promise((r) => setTimeout(r, 3000));
            }
            continue;
          }
          // GBK 解码（NGA 默认 charset=GBK，UTF-8 会乱码）
          const buffer = await resp.arrayBuffer();
          const charset = detectCharsetFromHtml(buffer);
          const html = new TextDecoder(charset).decode(buffer);
          const posts = extractPostsFromHtml(html);
          allPosts.push(...posts);
          console.log(
            `[nga:collect] 第 ${page} 页抓到 ${posts.length} 个帖子 (HTML ${html.length} chars, charset=${charset})`,
          );
          // 限流：基线 1200ms + 随机 ±300ms（避免固定间隔被识别为机器人）
          // - 1200ms 是经验安全基线：NGA 反爬通常对 < 1s 间隔的连续请求敏感
          // - ±300ms 抖动让间隔看起来像人类操作（100% 固定 = 机器人特征）
          // - 最后一页不等待，加快返回
          // 风险：抓 50 页 50 个帖耗时 ~ 60s（vs 旧版 15s），但更安全
          const baseDelay = 1200;
          const jitter = Math.floor(Math.random() * 600) - 300; // -300 ~ +300
          const delay = page < endPage ? baseDelay + jitter : 0;
          if (delay > 0) {
            console.log(`[nga:collect] 第 ${page} 页抓完，限流等待 ${delay}ms（基线 ${baseDelay}ms + 抖动 ${jitter >= 0 ? '+' : ''}${jitter}ms）`);
            await new Promise((r) => setTimeout(r, delay));
          }
        } catch (e) {
          errors.push(`第 ${page} 页抓取失败：${(e as Error).message}`);
          console.warn(`[nga:collect] 第 ${page} 页抓取失败：`, (e as Error).message);
        }
      }

      const items = filterAnjiaPosts(
        allPosts,
        payload.startFloor,
        payload.endFloor,
        payload.prefix,
        targetAuthorid,
      );

      const cancelled = cancelledTaskIds.has(taskId);
      console.log(
        `[nga:collect] taskId=${taskId} 完成${cancelled ? '（已取消）' : ''}：共抓 ${allPosts.length} 帖，过滤出 ${items.length} 条匹配"${payload.prefix}"${targetAuthorid ? ` authorid=${targetAuthorid}` : ''}`,
      );

      return {
        ok: true,
        items,
        totalPages,
        error: errors.length > 0 ? errors.join('；') : undefined,
      };
    } catch (e) {
      console.error('[nga:collect] 抓取异常：', e);
      return {
        ok: false,
        items: [],
        totalPages: 0,
        error: (e as Error).message || '抓取失败',
      };
    } finally {
      // 清理：删除 cancel flag
      cancelledTaskIds.delete(taskId);
    }
  },
)

// 取消抓取任务
ipcMain.handle(
  'nga:collect:cancel',
  async (_e, taskId?: number): Promise<{ ok: boolean }> => {
    const target = taskId ?? currentCollectingTaskId;
    if (target) {
      cancelledTaskIds.add(target);
      console.log(`[nga:collect:cancel] 已标记任务 ${target} 为取消`);
    }
    return { ok: true };
  },
)

// 自动检测 NGA 主题帖总页数
ipcMain.handle(
  'nga:fetchThreadInfo',
  async (
    _e,
    url: string,
    cookies?: string,
  ): Promise<{
    ok: boolean;
    totalPages?: number;
    totalFloors?: number;
    error?: string;
  }> => {
    try {
      const parsed = parseThreadUrl(url);
      if (!parsed) {
        return { ok: false, error: '无法解析 URL 中的 tid 参数' };
      }
      const { tid, baseUrl } = parsed;
      // 增强请求头
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': `${baseUrl}/`,
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
      };
      if (cookies && cookies.trim()) {
        headers['Cookie'] = cookies.trim();
      }
      const resp = await fetch(`${baseUrl}/read.php?tid=${tid}`, {
        headers,
        redirect: 'follow',
      });
      if (!resp.ok) {
        return { ok: false, error: `HTTP ${resp.status}` };
      }
      // GBK 解码
      const buffer = await resp.arrayBuffer();
      const charset = detectCharsetFromHtml(buffer);
      const html = new TextDecoder(charset).decode(buffer);

      // 解析总页数（优先 __PAGE 全局变量，备选末页链接）
      const totalPages = extractTotalPagesFromHtml(html);
      if (totalPages === 0) {
        return { ok: false, error: '无法从页面解析总页数，请手动输入末尾楼层' };
      }

      const totalFloors = totalPages * 20;
      console.log(
        `[nga:fetchThreadInfo] tid=${tid} 总页数=${totalPages}（约 ${totalFloors} 楼）charset=${charset}`,
      );
      return { ok: true, totalPages, totalFloors };
    } catch (e) {
      return { ok: false, error: (e as Error).message || '检测失败' };
    }
  },
)
