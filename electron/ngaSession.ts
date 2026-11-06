// ============================================================
// NGA 登录与回帖 IPC
//
// - nga:login     打开内嵌 NGA 登录窗口，登录成功后把 Cookie 字符串返回渲染层
// - nga:logout    清空内嵌登录窗口的会话数据
// - nga:reply     用当前 Cookie 在指定主题帖下回复（BBCode 正文）
// - nga:link:get  读取作品与 NGA 帖子的关联（<story>/nga.json）
// - nga:link:save 保存作品与 NGA 帖子的关联
//
// 登录窗使用独立持久化分区 persist:nga-login，与主窗口隔离；
// Cookie 只回传一次，由渲染层存入设置（与手动粘贴 Cookie 的旧路径兼容）。
// ============================================================

import { BrowserWindow, ipcMain, session } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { getDataDir } from './paths'
import { getStoryDir, assertSafeStoryId } from './data-core/storyPaths'
import { writeJsonAtomic, readJsonWithBak } from './data-core/atomicJson'
import { buildReplyBody, extractThreadIdentity, interpretReplyResponse } from './data-core/ngaReply'

const NGA_LOGIN_PARTITION = 'persist:nga-login'
const NGA_LOGIN_URL = 'https://bbs.nga.cn/'
const DEFAULT_BASE_URL = 'https://bbs.nga.cn'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export interface NgaLoginResult {
  ok: boolean
  cookie?: string
  uid?: string
  error?: string
  cancelled?: boolean
}

export interface NgaReplyResult {
  ok: boolean
  pid?: string
  error?: string
}

/** 校验回帖域名，避免把 Cookie 发送到任意站点 */
function normalizeBaseUrl(raw?: string): string | null {
  if (!raw) return DEFAULT_BASE_URL
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return null
    const host = url.hostname.toLowerCase()
    const allowed = ['nga.cn', 'ngabbs.com', 'nga.178.com', 'nga.com']
    if (!allowed.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

function buildHeaders(baseUrl: string, cookie?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: `${baseUrl}/`,
  }
  if (cookie?.trim()) headers.Cookie = cookie.trim()
  return headers
}

/** NGA 经典页面多为 GBK，按响应 charset 解码，避免错误提示乱码 */
async function readResponseText(res: Response): Promise<string> {
  const contentType = res.headers.get('content-type') || ''
  const charset = contentType.match(/charset=([a-zA-Z0-9_-]+)/i)?.[1]?.toLowerCase()
  const buffer = await res.arrayBuffer()
  const decodeUtf8 = () => new TextDecoder('utf-8').decode(buffer)
  const label = charset && charset !== 'utf-8' ? charset : 'gbk'
  try {
    return new TextDecoder(label).decode(buffer)
  } catch {
    return decodeUtf8()
  }
}

function storyNgaPath(storyId: string): string {
  return path.join(getStoryDir(getDataDir(), assertSafeStoryId(storyId)), 'nga.json')
}

/** 打开内嵌 NGA 登录窗口，等待 ngaPassportUid/Cid 出现 */
async function loginWithWindow(parent: BrowserWindow | null): Promise<NgaLoginResult> {
  const loginSession = session.fromPartition(NGA_LOGIN_PARTITION)
  const win = new BrowserWindow({
    width: 940,
    height: 760,
    title: '登录 NGA',
    parent: parent ?? undefined,
    modal: !!parent,
    autoHideMenuBar: true,
    webPreferences: {
      partition: NGA_LOGIN_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  win.removeMenu()

  return await new Promise<NgaLoginResult>((resolve) => {
    let settled = false
    let timer: NodeJS.Timeout | null = null

    const finish = (result: NgaLoginResult) => {
      if (settled) return
      settled = true
      if (timer) clearInterval(timer)
      resolve(result)
      if (!win.isDestroyed()) win.close()
    }

    const checkCookies = async () => {
      try {
        const cookies = await loginSession.cookies.get({ url: NGA_LOGIN_URL })
        const uid = cookies.find((c) => c.name === 'ngaPassportUid')?.value
        const cid = cookies.find((c) => c.name === 'ngaPassportCid')?.value
        if (!uid || !cid) return
        const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
        finish({ ok: true, cookie, uid })
      } catch (e) {
        finish({ ok: false, error: `读取登录 Cookie 失败：${(e as Error).message}` })
      }
    }

    win.webContents.on('did-navigate', () => void checkCookies())
    win.webContents.on('did-finish-load', () => void checkCookies())
    timer = setInterval(() => void checkCookies(), 1200)

    win.on('closed', () => {
      if (!settled) finish({ ok: false, cancelled: true })
    })

    setTimeout(() => finish({ ok: false, error: '登录超时，请重试' }), 5 * 60 * 1000)

    void win.loadURL(NGA_LOGIN_URL)
  })
}

/** 注册 NGA 登录 / 回帖 / 作品关联相关 IPC */
export function registerNgaSessionIpc(): void {
  ipcMain.handle('nga:login', async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    return await loginWithWindow(parent)
  })

  ipcMain.handle('nga:logout', async () => {
    await session.fromPartition(NGA_LOGIN_PARTITION).clearStorageData()
    return { ok: true }
  })

  ipcMain.handle(
    'nga:reply',
    async (
      _event,
      payload: { baseUrl?: string; tid: string; fid?: string; content: string; cookie?: string },
    ): Promise<NgaReplyResult> => {
      const baseUrl = normalizeBaseUrl(payload?.baseUrl)
      if (!baseUrl) return { ok: false, error: '仅支持向 NGA 官方域名发送' }
      if (!payload?.tid?.trim()) return { ok: false, error: '缺少主题帖 tid' }
      if (!payload.content?.trim()) return { ok: false, error: '正文为空，未发送' }
      if (!payload.cookie?.trim()) return { ok: false, error: '未登录 NGA，请先登录' }

      try {
        const tid = encodeURIComponent(payload.tid)
        let fid = payload.fid?.trim()

        // 没有 fid 时从主题页提取（新版回复页的 __U 里也带 fid）
        if (!fid) {
          const pageRes = await fetch(`${baseUrl}/read.php?tid=${tid}`, {
            headers: buildHeaders(baseUrl, payload.cookie),
          })
          const pageHtml = await readResponseText(pageRes)
          if (pageRes.status === 403 || /需要登录|请先登录|您需要登录/.test(pageHtml)) {
            return { ok: false, error: 'NGA 登录态已失效，请重新登录后再发送' }
          }
          fid = extractThreadIdentity(pageHtml).fid
        }
        if (!fid) {
          return { ok: false, error: '无法识别 NGA 版块 ID（fid），请重新关联帖子链接后再发送' }
        }

        const replyReferer = `${baseUrl}/post.php?action=reply&tid=${tid}&fid=${encodeURIComponent(fid)}`
        const postRes = await fetch(`${baseUrl}/post.php`, {
          method: 'POST',
          redirect: 'manual',
          headers: {
            ...buildHeaders(baseUrl, payload.cookie),
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: baseUrl,
            Referer: replyReferer,
          },
          body: buildReplyBody({
            tid: payload.tid,
            fid,
            content: payload.content,
          }),
        })
        const postHtml = await readResponseText(postRes)
        return interpretReplyResponse(
          postRes.status,
          postHtml,
          postRes.headers.get('location') ?? undefined,
        )
      } catch (e) {
        return { ok: false, error: `发送失败：${(e as Error).message}` }
      }
    },
  )

  ipcMain.handle('nga:link:get', async (_event, storyId: string) => {
    try {
      const file = storyNgaPath(storyId)
      if (!fs.existsSync(file)) return { ok: true, link: null }
      return { ok: true, link: readJsonWithBak(file).value }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('nga:link:save', async (_event, storyId: string, link: unknown) => {
    try {
      const file = storyNgaPath(storyId)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      writeJsonAtomic(file, link, 1)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
}
