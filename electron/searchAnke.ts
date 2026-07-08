// ============================================================
// 寻找安科 IPC：搜索骨碌碌 + NGA 安科版块
//
// - search:gululu: 抓取 https://www.gululu.world/ 搜索/列表，解析安科卡片
// - search:nga-anke: 抓取 https://ngabbs.com/thread.php?fid=784 列表（1-3页），按关键字过滤
//
// 骨碌碌字段：标题/作者/字数/浏览数/最新更新时间/发布时间/链接
//   + _raw 数值字段（wordCountRaw/viewCountRaw/updatedAtRaw/publishedAtRaw）供前端排序/筛选
// NGA 字段：标题/作者/楼层数/最新回复时间/发布时间/链接
//   + _raw 数值字段（floorCountRaw/lastReplyAtRaw/publishedAtRaw）供前端排序/筛选
//
// 解析方式：纯正则 + 字符串切分（与 src/utils/ngaCrawler.ts 一致，不引入 cheerio）
// ============================================================

import { app, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'

export interface GululuResult {
  title: string
  author: string
  wordCount: string
  wordCountRaw: number    // "20.3万字" → 203000，供排序/筛选
  viewCount: string
  viewCountRaw: number     // "9.1万" → 91000
  updatedAt: string
  updatedAtRaw: number     // "3天前" → 估算时间戳(秒)，越大越新
  publishedAt: string
  publishedAtRaw: number
  url: string
  /** 作品标签（爬虫尽量解析：安科/安价/同人/原创 等） */
  tags?: string[]
  /** 完结状态（爬虫尽量解析） */
  status?: 'ongoing' | 'finished' | 'unknown'
}

export interface NgaResult {
  title: string
  author: string
  floorCount: string
  floorCountRaw: number    // "15037" → 15037
  lastReplyAt: string
  lastReplyAtRaw: number
  publishedAt: string
  publishedAtRaw: number   // unix 时间戳(秒)
  url: string
  /** 作品标签（爬虫尽量解析：[安科] [安价] [同人] 等） */
  tags?: string[]
  /** 完结状态 */
  status?: 'ongoing' | 'finished' | 'unknown'
}

const COMMON_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
}

/** unix 时间戳(秒) → "YYYY-MM-DD" */
function unixToDate(ts: number): string {
  const d = new Date(ts * 1000)
  if (isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 清理 HTML 标签，保留纯文本 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

/** "20.3万字" → 203000, "112.4万字" → 1124000, 无→0 */
function parseWordCount(s: string): number {
  if (!s) return 0
  const m = s.match(/(\d+(?:\.\d+)?)\s*万字?/)
  if (m) return Math.round(parseFloat(m[1]) * 10000)
  const n = parseInt(s.replace(/[^\d]/g, ''), 10)
  return isNaN(n) ? 0 : n
}

/** "9.1万" → 91000, "2554" → 2554, 无→0 */
function parseViewCount(s: string): number {
  if (!s) return 0
  const m = s.match(/(\d+(?:\.\d+)?)\s*万/)
  if (m) return Math.round(parseFloat(m[1]) * 10000)
  const n = parseInt(s.replace(/[^\d]/g, ''), 10)
  return isNaN(n) ? 0 : n
}

/** "15037" → 15037 */
function parseFloorCount(s: string): number {
  if (!s) return 0
  const n = parseInt(s.replace(/[^\d]/g, ''), 10)
  return isNaN(n) ? 0 : n
}

/** "3天前" → 当前时间戳-3天(秒), "2小时前" → 当前-2小时, 空→0 */
function parseRelativeTime(s: string): number {
  if (!s) return 0
  const m = s.match(/(\d+)\s*(天前|小时前|个月内|周前|分钟前)/)
  if (!m) return 0
  const n = parseInt(m[1], 10)
  const unit = m[2]
  const now = Math.floor(Date.now() / 1000)
  switch (unit) {
    case '天前': return now - n * 86400
    case '小时前': return now - n * 3600
    case '周前': return now - n * 86400 * 7
    case '个月内': return now - n * 86400 * 30
    case '分钟前': return now - n * 60
    default: return 0
  }
}

/** 安科/安价/同人/原创/连载中/已完结/暂停等常见标签的预设词典 */
const KNOWN_TAGS = [
  '安科', '安价', '同人', '原创', '官方', '半原创', '转载',
  'BanG Dream', 'BanGDream', 'mygo', 'MYGO', 'mujica', 'Mujica',
  '咒术回战', '鬼灭之刃', '原神', '崩坏', 'FGO', '东方',
  '跑团', 'TRPG', '克苏鲁', 'DND',
] as const

/**
 * 从标题中提取标签：[安科] [同人] [mygo] 等
 * 同时识别 [已完结] / [完] / [完结] → status='finished'，
 * 以及 [连载中] / [更新中] → status='ongoing'
 */
function extractTagsAndStatus(title: string): {
  tags: string[]
  status: 'ongoing' | 'finished' | 'unknown'
  cleanTitle: string
} {
  const bracketRe = /[【\[\(]([^】\]\)\n]{1,20})[】\]\)]/g
  const tags: string[] = []
  let m: RegExpExecArray | null
  let status: 'ongoing' | 'finished' | 'unknown' = 'unknown'
  while ((m = bracketRe.exec(title)) !== null) {
    const inner = m[1].trim()
    if (!inner) continue
    // 状态标记
    if (/^(完|完结|已完结|完稿|完坑)$/i.test(inner)) {
      status = 'finished'
      continue
    }
    if (/^(连载中|更新中|更新|连载|进行中|进行)$/i.test(inner)) {
      status = 'ongoing'
      continue
    }
    // 已知标签或自定义短词
    if (inner.length <= 20) {
      tags.push(inner)
    }
  }
  // 兜底：如果包含任何已知词典词，附加
  for (const k of KNOWN_TAGS) {
    if (title.includes(k) && !tags.includes(k)) tags.push(k)
  }
  return { tags: Array.from(new Set(tags)).slice(0, 8), status, cleanTitle: title }
}

/**
 * 搜索骨碌碌作品
 *
 * 实测 API（来自 Playwright 真实抓包 + 用户截图）：
 * - 匹配标题：GET https://backend.gululu.world/search/generalPageV2?type=OPUS&key={keyword}&page=1
 * - 匹配作者：POST https://backend.gululu.world/search/opus-author，body {"text": "{keyword}"}
 * - opus-author 同时返回 searchOpusResps（该作者作品）+ searchAuthorRespList（作者本人）
 *
 * 必填头（实测无则 500）：
 * - authorization: Bearer
 * - referer: https://www.gululu.world/
 * - origin: https://www.gululu.world
 * - platform: 1
 * - sec-ch-ua-platform: "Windows"
 * - accept: application/json 等（见代码常量，注释内不写星号斜杠避免被解析为注释结束）
 */
async function searchGululu(
  keyword: string,
  matchField: 'all' | 'title' | 'author' = 'title',
  page: number = 1,
  limit?: number,
): Promise<GululuResult[]> {
  const GULULU_HEADERS: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Authorization': 'Bearer',
    'Referer': 'https://www.gululu.world/',
    'Origin': 'https://www.gululu.world',
    'platform': '1',
    'sec-ch-ua-platform': '"Windows"',
  }

  console.log('[searchGululu] keyword:', JSON.stringify(keyword), 'matchField:', matchField)

  const SENSITIVE_KEYS = new Set([
    'authorization', 'token', 'access_token', 'refresh_token', 'session', 'cookie',
    'jwt', 'apitoken', 'secrettoken', 'password', 'secret', 'accesstoken', 'refreshtoken',
  ])

  function sanitizeObject(obj: any): void {
    if (!obj || typeof obj !== 'object') return
    for (const k of Object.keys(obj)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        obj[k] = '***'
      } else if (typeof obj[k] === 'object') {
        sanitizeObject(obj[k])
      }
    }
  }

  function saveDebugLog(json: any): void {
    try {
      let userData = ''
      try {
        userData = app.getPath('userData')
      } catch {
        userData = ''
      }
      const logDir = userData
        ? path.join(userData, 'logs')
        : path.join(process.env.APPDATA || process.env.HOME || process.cwd(), '.AnkeCreator', 'logs')
      fs.mkdirSync(logDir, { recursive: true })
      const logPath = path.join(logDir, `searchGululu_${Date.now()}.json`)
      const clone = JSON.parse(JSON.stringify(json || {}))
      sanitizeObject(clone)
      fs.writeFileSync(logPath, JSON.stringify(clone, null, 2).slice(0, 50000), 'utf-8')
      console.log('[searchGululu] debug json saved to', logPath)
    } catch (e) {
      console.error('[searchGululu] failed to save debug json:', e)
    }
  }

  function logGululuResponse(json: any, label: string): void {
    const data = json?.data || {}
    const items: any[] = Array.isArray(data.items) ? data.items : []
    const opusList: any[] = Array.isArray(json?.searchOpusResps) ? json.searchOpusResps : []
    const authorList: any[] = Array.isArray(json?.searchAuthorRespList) ? json.searchAuthorRespList : []
    console.log(
      `[searchGululu] ${label} diagnostic:`,
      'code=', json?.code,
      'msg=', json?.msg,
      'success=', json?.success,
      'dataKeys=', Object.keys(data),
      'items=', items.length,
      'searchOpusResps=', opusList.length,
      'searchAuthorRespList=', authorList.length,
    )
    const first = items[0] || opusList[0] || authorList[0]
    if (first) {
      console.log(`[searchGululu] ${label} first item keys:`, Object.keys(first))
      const sample: Record<string, any> = {}
      for (const k of Object.keys(first)) {
        if (SENSITIVE_KEYS.has(k.toLowerCase())) {
          sample[k] = '***'
          continue
        }
        const v = first[k]
        if (v === undefined || v === null) {
          sample[k] = v
        } else if (typeof v === 'object') {
          sample[k] = Array.isArray(v) ? `[array:${v.length}]` : `{${Object.keys(v).join(',')}}`
        } else if (typeof v === 'string' && v.length > 120) {
          sample[k] = `${v.slice(0, 120)}...`
        } else {
          sample[k] = v
        }
      }
      console.log(`[searchGululu] ${label} first item sample:`, JSON.stringify(sample))
    }
  }

  async function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      })
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error('骨碌碌请求超时（15 秒）')
      throw e
    } finally {
      clearTimeout(timeoutId)
    }
  }

  function isSuccessResponse(json: any): boolean {
    return (
      json &&
      (json.code === 200 || json.code === 0 || json.code === '0' || json.success === true)
    )
  }

  function getBookId(it: any): string {
    const id = it.opusId || it.id || it.workId || it.novelId || it.opus_id || it.recommendedId
    return id !== undefined && id !== null ? String(id) : ''
  }

  function getUserId(it: any): string {
    const uid = it.userId || it.authorId || it.uid || it.user_id
    return uid !== undefined && uid !== null ? String(uid) : ''
  }

  function isBookType(it: any): boolean {
    return (
      !it.type ||
      ['book', 'opus', 'novel', 'work', 'story', 'comic'].includes(String(it.type).toLowerCase())
    )
  }

  function isAuthorRecord(it: any): boolean {
    return it.type === 'author' || (Boolean(getUserId(it)) && !Boolean(getBookId(it)))
  }

  function parseBookItem(it: any): GululuResult | null {
    if (!it || !isBookType(it)) return null
    const id = getBookId(it)
    if (!id) return null
    const title = (it.opusName || it.title || it.name || '').trim()
    if (!title) return null
    const words = typeof it.words === 'number' ? it.words : 0
    const readNum = typeof it.readNum === 'number' ? it.readNum : 0
    const tagArr =
      typeof it.tagNames === 'string'
        ? it.tagNames.split(/[\s,，]+/).filter(Boolean)
        : Array.isArray(it.tags)
          ? it.tags.filter((t: any) => typeof t === 'string')
          : []
    return {
      title,
      author: it.authorName || it.nickName || '佚名',
      wordCount: words ? (words >= 10000 ? `${(words / 10000).toFixed(1)}万字` : `${words}字`) : '未知',
      wordCountRaw: words,
      viewCount: readNum ? (readNum >= 10000 ? `${(readNum / 10000).toFixed(1)}万` : String(readNum)) : '未知',
      viewCountRaw: readNum,
      updatedAt: it.updateTime ? String(it.updateTime).split(' ')[0] : '未知',
      updatedAtRaw: it.updateTime
        ? Math.floor(new Date(String(it.updateTime).replace(' ', 'T') + '+08:00').getTime() / 1000) || 0
        : 0,
      publishedAt: it.createTime ? String(it.createTime).split(' ')[0] : '',
      publishedAtRaw: it.createTime
        ? Math.floor(new Date(String(it.createTime).replace(' ', 'T') + '+08:00').getTime() / 1000) || 0
        : 0,
      url: `https://www.gululu.world/book/${id}`,
      tags: tagArr.slice(0, 8),
      status: 'unknown',
    }
  }

  function parseAuthorItem(it: any): GululuResult | null {
    if (!it) return null
    const uid = getUserId(it)
    if (!uid) return null
    const authorName = it.nickName || it.authorName || '匿名作者'
    const opusNum = it.opusNum ?? it.workNum ?? it.opusNumber ?? it.workCount ?? 0
    return {
      title: `👤 ${authorName}`,
      author: authorName,
      wordCount: '0',
      wordCountRaw: 0,
      viewCount: `${opusNum} 部作品`,
      viewCountRaw: 0,
      updatedAt: '—',
      updatedAtRaw: 0,
      publishedAt: '',
      publishedAtRaw: 0,
      url: `https://www.gululu.world/user/${uid}`,
      tags: [],
      status: 'unknown',
    }
  }

  async function searchGululuByTitle(keyword: string, page: number = 1): Promise<GululuResult[]> {
    const key = keyword?.trim() || ''
    if (!key) {
      throw new Error('请输入搜索关键词')
    }
    const url = `https://backend.gululu.world/search/generalPageV2?type=OPUS&key=${encodeURIComponent(key)}&page=${page}`
    const resp = await fetchWithTimeout(url, { method: 'GET', headers: GULULU_HEADERS })
    console.log('[searchGululu] HTTP status:', resp.status)
    if (!resp.ok) throw new Error(`骨碌碌请求失败: HTTP ${resp.status}`)
    const json: any = await resp.json()
    logGululuResponse(json, 'OPUS')

    const isSuccess = isSuccessResponse(json)
    let items: any[] | undefined = json?.data?.items ?? json?.items
    if (!Array.isArray(items)) {
      if (!isSuccess) {
        saveDebugLog(json)
        throw new Error(`骨碌碌接口返回错误: ${json?.msg || JSON.stringify(json?.code) || '未知'}`)
      }
      items = []
    }

    const results: GululuResult[] = items
      .map(parseBookItem)
      .filter((r): r is GululuResult => r !== null)
    if (results.length === 0 && key) {
      throw new Error(`骨碌碌未找到标题包含"${key}"的作品`)
    }
    return results
  }

  async function searchGululuByAuthor(keyword: string): Promise<GululuResult[]> {
    if (!keyword || !keyword.trim()) {
      throw new Error('按作者搜索必须输入作者名关键词')
    }
    const url = 'https://backend.gululu.world/search/opus-author'
    const resp = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { ...GULULU_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: keyword.trim() }),
    })
    if (!resp.ok) throw new Error(`骨碌碌请求失败: HTTP ${resp.status}`)
    const json: any = await resp.json()
    logGululuResponse(json, 'opus-author')

    const isSuccess = isSuccessResponse(json)
    const authors: any[] = Array.isArray(json?.searchAuthorRespList) ? json.searchAuthorRespList : []
    const opuses: any[] = Array.isArray(json?.searchOpusResps) ? json.searchOpusResps : []
    if (authors.length === 0 && opuses.length === 0 && !isSuccess) {
      saveDebugLog(json)
      throw new Error(`骨碌碌接口返回错误: ${json?.msg || JSON.stringify(json?.code) || '未知'}`)
    }

    const results: GululuResult[] = []
    for (const it of opuses) {
      const r = parseBookItem(it)
      if (r) results.push(r)
    }
    for (const a of authors) {
      const r = parseAuthorItem(a)
      if (r) results.push(r)
    }
    if (results.length === 0) {
      throw new Error(`骨碌碌未找到作者名包含"${keyword}"的作者/作品`)
    }
    return results
  }

  // ─── 现有行为：按作者搜索 ───
  if (matchField === 'author') {
    return searchGululuByAuthor(keyword)
  }

  // ─── 现有行为：按标题搜索 ───
  if (matchField === 'title') {
    return searchGululuByTitle(keyword, page)
  }

  // ─── 全部搜索：先尝试 ALL 混合接口，无结果时 fallback 到 OPUS + 作者 ───
  const key = keyword?.trim() || ''
  if (!key) {
    throw new Error('请输入搜索关键词')
  }
  const url = `https://backend.gululu.world/search/generalPageV2?type=ALL&key=${encodeURIComponent(key)}&page=${page}`
  const resp = await fetchWithTimeout(url, { method: 'GET', headers: GULULU_HEADERS })
  console.log('[searchGululu] HTTP status:', resp.status)
  if (!resp.ok) throw new Error(`骨碌碌请求失败: HTTP ${resp.status}`)
  const json: any = await resp.json()
  logGululuResponse(json, 'ALL')

  const isSuccess = isSuccessResponse(json)
  let items: any[] | undefined = json?.data?.items ?? json?.items
  if (!Array.isArray(items)) {
    if (!isSuccess) {
      saveDebugLog(json)
      throw new Error(`骨碌碌接口返回错误: ${json?.msg || JSON.stringify(json?.code) || '未知'}`)
    }
    items = []
  }

  const bookResults: GululuResult[] = items
    .filter(isBookType)
    .map(parseBookItem)
    .filter((r): r is GululuResult => r !== null)
  const authorResults: GululuResult[] = items
    .filter(isAuthorRecord)
    .map(parseAuthorItem)
    .filter((r): r is GululuResult => r !== null)

  console.log(
    '[searchGululu] ALL items: books=',
    bookResults.length,
    'authors=',
    authorResults.length,
  )

  if (bookResults.length + authorResults.length === 0 && key) {
    console.log('[searchGululu] ALL returned no results, falling back to OPUS + author...')
    let titleResults: GululuResult[] = []
    let authorResults2: GululuResult[] = []
    try {
      titleResults = await searchGululuByTitle(keyword, page)
    } catch (e) {
      console.error('[searchGululu] fallback OPUS error:', e)
    }
    try {
      authorResults2 = await searchGululuByAuthor(keyword)
    } catch (e) {
      console.error('[searchGululu] fallback author error:', e)
    }
    const merged = new Map<string, GululuResult>()
    const add = (r: GululuResult) => {
      if (!merged.has(r.url)) merged.set(r.url, r)
    }
    for (const r of bookResults) add(r)
    for (const r of authorResults) add(r)
    for (const r of titleResults) add(r)
    for (const r of authorResults2) add(r)
    const results = Array.from(merged.values())
    console.log('[searchGululu] fallback merged total:', results.length)
    if (results.length === 0) {
      throw new Error(`骨碌碌未找到包含"${key}"的结果`)
    }
    return results
  }

  return [...bookResults, ...authorResults]
}

/**
 * 抓取 NGA fid=784 安科版块列表（1-3 页），解析帖子表格
 * 支持传入 cookies（从设置中读取的登录态），若 cookies 有效即可绕过访客限制。
 * matchField: 'title' 匹配标题 / 'author' 匹配作者
 *
 * 完善：
 * - POST 请求规范化：Content-Type: application/x-www-form-urlencoded + body=''
 * - 多 fid 失败降级：首次用 NGA_FIDS，失败降级为 fid=784 单独重试
 * - HTML 解析容错：主模式失败时尝试 fallback 正则
 * - 详细错误诊断：区分网络失败/反爬拦截/Cookie 无效/未解析结果
 */
async function searchNgaAnke(
  keyword: string,
  matchField: 'title' | 'author' = 'title',
  cookies?: string,
  startPage: number = 1,
  limit?: number,
): Promise<NgaResult[]> {
  // ngabbs.com 反爬相对宽松，优先尝试；bbs.nga.cn 反爬最严放最后
  const domains = ['https://ngabbs.com', 'https://nga.178.com', 'https://bbs.nga.cn']
  // limit 控制：每页约 20 条，+1 页容错；无 limit 时默认 3 页
  const maxPages = limit ? Math.min(Math.ceil(limit / 20) + 1, 20) : 3
  const results: NgaResult[] = []
  const seenTids = new Set<string>()
  // 累积所有页的 HTML，用于 fallback 解析
  const allHtmlChunks: { baseUrl: string; html: string }[] = []

  // 移除可疑的 Referer（伪造百度来源）和 Sec-Fetch-* 系列（手动设置可能触发反爬检测）
  const NGA_HEADERS: Record<string, string> = {
    ...COMMON_HEADERS,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  }
  if (cookies && cookies.trim()) {
    // 清理 Cookie：去 "Cookie:" 前缀、压缩空白
    const cleaned = cookies.trim().replace(/^Cookie:\s*/i, '').replace(/\s+/g, ' ')
    if (cleaned) NGA_HEADERS['Cookie'] = cleaned
  }
  const cookieLen = NGA_HEADERS['Cookie']?.length || 0
  console.log(
    '[searchNgaAnke] keyword:', JSON.stringify(keyword),
    'cookies:', NGA_HEADERS['Cookie'] ? `(已配置 len=${cookieLen})` : '(未配置)',
  )

  // 关键词为空时退化为按版块列表浏览（不做过滤）
  const useSearch = !!(keyword && keyword.trim())
  const encodedKey = useSearch ? encodeURIComponent(keyword.trim()) : ''

  // NGA 安科相关版块 fid 列表（覆盖多个安科/跑团子版）
  const NGA_FIDS = '784,27472427,27472444,27472466,27472488'
  // 降级用单 fid
  const FALLBACK_FID = '784'

  // 解析诊断统计
  const diag = {
    mainTidLinks: 0,
    mainNoticeFilter: 0,
    mainEmptyTitle: 0,
    mainTrCount: 0,
  }

  // ===== 辅助：单次 fetch + 解码 HTML =====
  async function fetchHtml(
    baseUrl: string,
    fid: string,
    page: number,
  ): Promise<{ html: string; status: number; ok: boolean }> {
    const url = useSearch
      ? `${baseUrl}/thread.php?key=${encodedKey}&fid=${fid}&content=4&page=${page}`
      : `${baseUrl}/thread.php?fid=${fid}&page=${page}&rand=${Date.now() % 1000}`
    console.log('[searchNgaAnke] fetch URL:', url, 'method:', useSearch ? 'POST' : 'GET', 'fid:', fid)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)
    try {
      const headers =
        page === 1 || !useSearch
          ? NGA_HEADERS
          : { ...NGA_HEADERS, Referer: `${baseUrl}/thread.php?fid=${fid}&page=${page - 1}` }
      // NGA 搜索使用 GET 请求（浏览器实际行为，POST 可能被反爬识别）
      const fetchOptions: RequestInit = {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: controller.signal,
      }
      const resp = await fetch(url, fetchOptions)
      console.log(
        '[searchNgaAnke] HTTP status:', resp.status,
        'domain:', baseUrl, 'page:', page, 'cookieLen:', cookieLen,
      )
      if (!resp.ok) {
        return { html: '', status: resp.status, ok: false }
      }
      const buffer = await resp.arrayBuffer()
      let html: string
      try {
        html = new TextDecoder('gbk').decode(buffer)
      } catch {
        html = new TextDecoder('utf-8').decode(buffer)
      }
      console.log('[searchNgaAnke] HTML length:', html.length, 'domain:', baseUrl, 'page:', page)
      return { html, status: resp.status, ok: true }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  // ===== 辅助：解析单页 HTML 为 NgaResult[]（主模式 + 单页 fallback） =====
  function parseHtmlMain(html: string, baseUrl: string): NgaResult[] {
    const pageResults: NgaResult[] = []
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
    let rowMatch: RegExpExecArray | null
    let trCount = 0
    let pageTidLinks = 0
    let pageEmptyTitle = 0
    let pageNoticeFilter = 0
    while ((rowMatch = rowRe.exec(html)) !== null) {
      trCount++
      const row = rowMatch[1]

      const tidRe = /<a\b[^>]*href=["']?\/?read\.php\?tid=(\d+)["']?[^>]*>([\s\S]*?)<\/a>/gi
      const tidLinks: { tid: string; text: string }[] = []
      let tm: RegExpExecArray | null
      while ((tm = tidRe.exec(row)) !== null) {
        pageTidLinks++
        let text = stripHtmlTags(tm[2])
        if (!text) {
          const attrMatch = tm[0].match(/\b(?:alt|title)=["']([^"]*)["']/i)
          if (attrMatch) text = attrMatch[1]
        }
        tidLinks.push({ tid: tm[1], text })
      }
      if (tidLinks.length === 0) continue

      const tid = tidLinks[0].tid
      if (seenTids.has(tid)) continue

      const titleLink = tidLinks
        .filter((l) => !/^\d+$/.test(l.text))
        .sort((a, b) => b.text.length - a.text.length)[0]
      if (!titleLink) continue
      const title = titleLink.text.trim()
      if (!title) {
        pageEmptyTitle++
        continue
      }
      if (title.startsWith('[公告]')) {
        pageNoticeFilter++
        continue
      }

      // Only mark tid as seen when we are sure it becomes a valid result
      seenTids.add(tid)
      const fullUrl = `${baseUrl}/read.php?tid=${tid}`

      const floorCount = tidLinks.find((l) => /^\d+$/.test(l.text))?.text || '0'

      const authorRe = /<a\b[^>]*href=["']?\/?nuke\.php\?func=ucp&uid=(\d+)["']?[^>]*>([\s\S]*?)<\/a>/i
      const authorMatch = row.match(authorRe)
      const author = authorMatch ? stripHtmlTags(authorMatch[2]) : ''

      const tsMatches = row.match(/\d{10}/g)
      const publishedTs = tsMatches && tsMatches.length > 0 ? parseInt(tsMatches[0], 10) : 0
      const lastReplyTs = tsMatches && tsMatches.length > 1 ? parseInt(tsMatches[1], 10) : publishedTs

      const publishedAt = publishedTs ? unixToDate(publishedTs) : ''
      const lastReplyAt = lastReplyTs ? unixToDate(lastReplyTs) : publishedAt

      if (keyword) {
        const k = keyword.toLowerCase()
        if (matchField === 'title' && !title.toLowerCase().includes(k)) continue
        if (matchField === 'author' && !author.toLowerCase().includes(k)) continue
      }

      const ts = extractTagsAndStatus(title)

      pageResults.push({
        title: ts.cleanTitle,
        author: author || '佚名',
        floorCount: floorCount || '0',
        floorCountRaw: parseFloorCount(floorCount),
        lastReplyAt,
        lastReplyAtRaw: lastReplyTs,
        publishedAt,
        publishedAtRaw: publishedTs,
        url: fullUrl,
        tags: ts.tags,
        status: ts.status,
      })
    }
    diag.mainTidLinks += pageTidLinks
    diag.mainEmptyTitle += pageEmptyTitle
    diag.mainNoticeFilter += pageNoticeFilter
    diag.mainTrCount += trCount
    console.log(
      '[searchNgaAnke] parseMain trCount=', trCount,
      'tidLinkMatches=', pageTidLinks,
      'newResults=', pageResults.length,
    )
    return pageResults
  }

  // ===== 辅助：按单元格解析（绕过嵌套表格，直接匹配 c2/c1） =====
  function parseHtmlByCell(html: string, baseUrl: string): NgaResult[] {
    const pageResults: NgaResult[] = []
    const cellRe = /<td\b[^>]*class=["']?c2["']?[^>]*>([\s\S]*?)<\/td>/gi
    let cm: RegExpExecArray | null
    let lastIndex = 0
    while ((cm = cellRe.exec(html)) !== null) {
      const cell = cm[1]
      const aRe = /<a\b[^>]*href=["']?\/?read\.php\?tid=(\d+)["']?[^>]*>([\s\S]*?)<\/a>/i
      const am = cell.match(aRe)
      if (!am) continue
      const tid = am[1]
      if (seenTids.has(tid)) continue

      let title = stripHtmlTags(am[2]).trim()
      if (!title) {
        const attrMatch = am[0].match(/\b(?:alt|title)=["']([^"]*)["']/i)
        if (attrMatch) title = attrMatch[1].trim()
      }
      if (!title || title.startsWith('[公告]')) continue
      if (/^\d+$/.test(title)) continue

      // 在最近的前一个 c1 单元格中找作者
      const segment = html.slice(lastIndex, cm.index)
      const c1Matches = segment.match(/<td\b[^>]*class=["']?c1["']?[^>]*>([\s\S]*?)<\/td>/gi)
      let author = ''
      if (c1Matches && c1Matches.length > 0) {
        const lastC1 = c1Matches[c1Matches.length - 1]
        const authorAMatch = lastC1.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)
        author = authorAMatch ? stripHtmlTags(authorAMatch[1]) : stripHtmlTags(lastC1)
      }
      lastIndex = cm.index + cm[0].length

      const tsMatches = cell.match(/\d{10}/g)
      const publishedTs = tsMatches && tsMatches.length > 0 ? parseInt(tsMatches[0], 10) : 0
      const lastReplyTs = tsMatches && tsMatches.length > 1 ? parseInt(tsMatches[1], 10) : publishedTs
      const publishedAt = publishedTs ? unixToDate(publishedTs) : ''
      const lastReplyAt = lastReplyTs ? unixToDate(lastReplyTs) : publishedAt

      if (keyword) {
        const k = keyword.toLowerCase()
        if (matchField === 'title' && !title.toLowerCase().includes(k)) continue
        if (matchField === 'author' && !author.toLowerCase().includes(k)) continue
      }

      seenTids.add(tid)
      const ts = extractTagsAndStatus(title)
      pageResults.push({
        title: ts.cleanTitle,
        author: author || '佚名',
        floorCount: '0',
        floorCountRaw: 0,
        lastReplyAt,
        lastReplyAtRaw: lastReplyTs,
        publishedAt,
        publishedAtRaw: publishedTs,
        url: `${baseUrl}/read.php?tid=${tid}`,
        tags: ts.tags,
        status: ts.status,
      })
    }
    console.log('[searchNgaAnke] parseByCell newResults=', pageResults.length)
    return pageResults
  }

  // ===== 辅助：fallback 解析（直接全局匹配 read.php?tid=） =====
  function parseHtmlFallback(html: string, baseUrl: string): NgaResult[] {
    const pageResults: NgaResult[] = []
    const tidRe = /<a\b[^>]*href=["']?read\.php\?tid=(\d+)["']?[^>]*>([\s\S]*?)<\/a>/gi
    const tidLinks: { tid: string; text: string; alt: string }[] = []
    let tm: RegExpExecArray | null
    while ((tm = tidRe.exec(html)) !== null) {
      let text = stripHtmlTags(tm[2])
      let alt = ''
      if (!text) {
        const attrMatch = tm[0].match(/\b(?:alt|title)=["']([^"]*)["']/i)
        if (attrMatch) alt = attrMatch[1]
      }
      tidLinks.push({ tid: tm[1], text, alt })
    }
    console.log('[searchNgaAnke] parseFallback tidLinkMatches=', tidLinks.length)

    // 按 tid 分组，取每个 tid 最长的非纯数字文本作为标题；无非纯数字文本时尝试 alt
    const tidMap = new Map<string, string>()
    for (const l of tidLinks) {
      if (seenTids.has(l.tid)) continue
      if (/^\d+$/.test(l.text)) {
        if (l.alt && !/^\d+$/.test(l.alt)) {
          const existing = tidMap.get(l.tid)
          if (!existing || l.alt.length > existing.length) {
            tidMap.set(l.tid, l.alt)
          }
        }
        continue
      }
      const existing = tidMap.get(l.tid)
      if (!existing || l.text.length > existing.length) {
        tidMap.set(l.tid, l.text)
      }
    }

    for (const [tid, title] of tidMap.entries()) {
      const trimmed = title.trim()
      if (!trimmed || trimmed.length < 2 || /^\d+$/.test(trimmed) || trimmed.startsWith('[公告]')) continue
      seenTids.add(tid)

      if (keyword) {
        const k = keyword.toLowerCase()
        if (matchField === 'title' && !trimmed.toLowerCase().includes(k)) continue
        // author 模式 fallback 无法解析作者，跳过过滤
      }

      const ts = extractTagsAndStatus(trimmed)
      pageResults.push({
        title: ts.cleanTitle,
        author: '佚名',
        floorCount: '0',
        floorCountRaw: 0,
        lastReplyAt: '',
        lastReplyAtRaw: 0,
        publishedAt: '',
        publishedAtRaw: 0,
        url: `${baseUrl}/read.php?tid=${tid}`,
        tags: ts.tags,
        status: ts.status,
      })
    }
    console.log('[searchNgaAnke] parseFallback newResults=', pageResults.length)
    return pageResults
  }

  // ===== 主流程：尝试多 fid，失败降级单 fid =====
  let accessible = false
  let lastError = ''
  let accessDenied = false
  let usedBaseUrl = ''
  let triedFallbackFid = false
  let lastStatus = 0

  async function runWithFid(fid: string): Promise<{ ok: boolean; denied: boolean }> {
    for (const baseUrl of domains) {
      let denied = false
      for (let page = startPage; page < startPage + maxPages; page++) {
        let html: string
        let fetchResult: { html: string; status: number; ok: boolean } | undefined
        try {
          fetchResult = await fetchHtml(baseUrl, fid, page)
          if (!fetchResult.ok) {
            if (fetchResult.status === 403) {
              lastError = cookies
                ? 'NGA 访问被拒绝（403），Cookie 可能已过期，请在设置中重新粘贴最新 Cookie'
                : 'NGA 目前限制访客访问安科版块（需登录账号），请使用骨碌碌搜索或在设置中粘贴 NGA Cookie'
              denied = true
              accessDenied = true
              return { ok: false, denied: true }
            }
            lastError = `NGA 请求失败: HTTP ${fetchResult.status}`
            return { ok: false, denied: false }
          }
          html = fetchResult.html
        } catch (e) {
          if ((e as Error).name === 'AbortError') {
            lastError = `NGA 请求超时（15 秒，域名：${baseUrl}）。建议检查网络连接或稍后重试。`
          } else {
            lastError = `NGA 请求失败（域名：${baseUrl}）：${(e as Error).message}。建议检查网络连接或稍后重试。`
          }
          console.error('[searchNgaAnke] fetch error:', lastError)
          return { ok: false, denied: false }
        }

        accessible = true
        lastStatus = fetchResult.status
        usedBaseUrl = baseUrl
        allHtmlChunks.push({ baseUrl, html })

        // 检测 NGA 搜索 ERROR:2048（需登录 Cookie）
        if (html.includes('(ERROR:<!--msgcodestart-->2048') || html.includes('注册用户/威望大于0方可使用搜索')) {
          accessDenied = true
          if (!cookies) {
            lastError = 'NGA 搜索需要登录账号，请在设置中粘贴 NGA Cookie 后重试（需要注册用户且威望 > 0）'
          } else {
            lastError = 'NGA 搜索失败：当前 Cookie 无效或威望不足'
          }
          console.error('[searchNgaAnke] ERROR:2048 detected:', lastError)
          return { ok: false, denied: true }
        }

        // 主模式解析
        let pageResults = parseHtmlMain(html, baseUrl)
        if (pageResults.length > 0) {
          results.push(...pageResults)
        }

        // 主模式失败时尝试单元格模式
        if (pageResults.length === 0 && html.length > 1000) {
          const cellResults = parseHtmlByCell(html, baseUrl)
          if (cellResults.length > 0) {
            pageResults = cellResults
            results.push(...cellResults)
          }
        }

        // 翻页判断：若本页未解析到新 tid 且不是第一页，停止翻页
        const seenBefore = seenTids.size
        if (page === startPage && pageResults.length === 0 && html.length > 1000) {
          // 第一页就无结果，可能是 HTML 结构变化，本页尝试 fallback
          console.log('[searchNgaAnke] main parse 0 results on page', startPage, ', trying fallback...')
          const fbResults = parseHtmlFallback(html, baseUrl)
          if (fbResults.length > 0) {
            results.push(...fbResults)
          } else {
            console.error('[searchNgaAnke] response preview (first 500 chars):', html.slice(0, 500))
          }
        }

        const seenAfter = seenTids.size
        if (seenAfter === seenBefore && page > startPage) break

        // limit 控制：结果数已达上限，停止翻页
        if (limit && results.length >= limit) break

        if (page < startPage + maxPages - 1) {
          await new Promise((r) => setTimeout(r, 1500))
        }
      }
      if (accessible) return { ok: true, denied: false }
      if (denied) return { ok: false, denied: true }
    }
    return { ok: false, denied: accessDenied }
  }

  // 1. 先用多 fid
  const r1 = await runWithFid(NGA_FIDS)
  // 2. 多 fid 失败且未触发反爬 → 降级单 fid=784
  if (!r1.ok && !r1.denied && useSearch && !triedFallbackFid) {
    triedFallbackFid = true
    console.log('[searchNgaAnke] multi-fid failed, falling back to single fid=784...')
    // 重置状态
    accessible = false
    const r2 = await runWithFid(FALLBACK_FID)
    if (r2.ok && results.length > 0) {
      console.log('[searchNgaAnke] fallback fid=784 succeeded, results:', results.length)
    }
  }

  // 3. 主模式全部失败时，对累积的 HTML 做 fallback 解析
  if (accessible && results.length === 0 && allHtmlChunks.length > 0) {
    console.log('[searchNgaAnke] all pages main parse failed, trying fallback on all chunks...')
    for (const { baseUrl, html } of allHtmlChunks) {
      if (html.length > 1000) {
        const fbResults = parseHtmlFallback(html, baseUrl)
        if (fbResults.length > 0) {
          results.push(...fbResults)
        }
      }
    }
  }

  // 4. 错误处理
  if (!accessible && results.length === 0 && lastError) {
    throw new Error(lastError)
  }
  if (accessible && results.length === 0) {
    // 统计诊断信息
    const totalHtmlLen = allHtmlChunks.reduce((s, c) => s + c.html.length, 0)
    const trCount = allHtmlChunks.reduce(
      (s, c) => s + (c.html.match(/<tr\b[^>]*>/gi)?.length || 0),
      0,
    )
    const tidCount = allHtmlChunks.reduce(
      (s, c) => s + (c.html.match(/read\.php\?tid=\d+/gi)?.length || 0),
      0,
    )

    // 保存原始 HTML 日志供排查
    let logPath = ''
    try {
      let userData = ''
      try {
        userData = app.getPath('userData')
      } catch {
        userData = ''
      }
      const logDir = userData
        ? path.join(userData, 'logs')
        : path.join(process.env.APPDATA || process.env.HOME || process.cwd(), '.AnkeCreator', 'logs')
      fs.mkdirSync(logDir, { recursive: true })
      logPath = path.join(logDir, `searchNgaAnke_${Date.now()}.html`)
      const rawHtml = allHtmlChunks.map((c) => c.html).join('\n')
      fs.writeFileSync(logPath, rawHtml.slice(0, 50000), 'utf-8')
    } catch (e) {
      console.error('[searchNgaAnke] failed to save debug html:', e)
      logPath = ''
    }

    console.error(
      '[searchNgaAnke] parse failed. status=', lastStatus,
      'htmlLen=', totalHtmlLen,
      'trCount=', trCount,
      'tidCount=', tidCount,
      'cookieLen=', cookieLen,
      'baseUrl=', usedBaseUrl,
      'mainTidLinks=', diag.mainTidLinks,
      'noticeFilter=', diag.mainNoticeFilter,
      'emptyTitle=', diag.mainEmptyTitle,
      'logPath=', logPath,
    )

    throw new Error(
      `NGA 页面请求成功但未解析到任何帖子。HTML 长度=${totalHtmlLen}，<tr> 数量=${trCount}，read.php?tid= 匹配数量=${tidCount}，主模式 tid 链接数=${diag.mainTidLinks}，公告过滤数=${diag.mainNoticeFilter}，标题为空数=${diag.mainEmptyTitle}。日志已保存到：${logPath || '（保存失败）'}。可能是 HTML 结构变化或 Cookie 过期，请检查设置中的 NGA Cookie。`,
    )
  }
  console.log('[searchNgaAnke] results parsed:', results.length, 'usedBaseUrl:', usedBaseUrl)
  // limit 截断：结果数超过上限时截断
  if (limit && results.length > limit) {
    return results.slice(0, limit)
  }
  return results
}

export function registerSearchAnkeIpc(): void {
  ipcMain.handle(
    'search:gululu',
    async (
      _event,
      payload: string | { keyword: string; matchField?: 'all' | 'title' | 'author'; page?: number; limit?: number },
    ) => {
      try {
        // 兼容旧调用（直接传 keyword 字符串）和新调用（传对象 {keyword, matchField, page, limit}）
        let keyword = ''
        let matchField: 'all' | 'title' | 'author' = 'title'
        let page = 1
        let limit: number | undefined
        if (typeof payload === 'string') {
          keyword = payload
        } else if (payload && typeof payload === 'object') {
          keyword = payload.keyword || ''
          matchField = payload.matchField || 'title'
          page = payload.page || 1
          limit = payload.limit
        }
        // limit 控制：循环抓多页直到凑够 limit 条或无更多结果
        if (limit && limit > 0 && matchField !== 'author') {
          const allResults: GululuResult[] = []
          const seen = new Set<string>()
          let curPage = page
          const maxLoops = Math.min(Math.ceil(limit / 5) + 2, 20) // 安全上限：每页至少5条，最多翻20页
          for (let i = 0; i < maxLoops; i++) {
            const pageResults = await searchGululu(keyword || '', matchField, curPage)
            let newCount = 0
            for (const r of pageResults) {
              if (!seen.has(r.url)) {
                seen.add(r.url)
                allResults.push(r)
                newCount++
              }
            }
            if (newCount === 0) break // 无更多结果
            if (allResults.length >= limit) break // 达到上限
            curPage++
          }
          return { ok: true, data: allResults.slice(0, limit) }
        }
        return { ok: true, data: await searchGululu(keyword || '', matchField, page) }
      } catch (e) {
        return { ok: false, error: (e as Error).message || '骨碌碌搜索失败' }
      }
    },
  )

  ipcMain.handle(
    'search:nga-anke',
    async (
      _event,
      payload: string | { keyword: string; cookies?: string; matchField?: 'title' | 'author'; startPage?: number; limit?: number },
    ) => {
      try {
        // 兼容旧调用（直接传 keyword 字符串）和新调用（传对象 {keyword, cookies, matchField, startPage, limit}）
        let keyword = ''
        let cookies: string | undefined
        let matchField: 'title' | 'author' = 'title'
        let startPage = 1
        let limit: number | undefined
        if (typeof payload === 'string') {
          keyword = payload
        } else if (payload && typeof payload === 'object') {
          keyword = payload.keyword || ''
          cookies = payload.cookies
          matchField = payload.matchField || 'title'
          startPage = payload.startPage || 1
          limit = payload.limit
        }
        return { ok: true, data: await searchNgaAnke(keyword || '', matchField, cookies, startPage, limit) }
      } catch (e) {
        return { ok: false, error: (e as Error).message || 'NGA搜索失败' }
      }
    },
  )
}
