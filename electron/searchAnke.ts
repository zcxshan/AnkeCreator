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

import { ipcMain } from 'electron'

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
  matchField: 'title' | 'author' = 'title',
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

  // ─── 匹配作者：用 opus-author POST ───
  if (matchField === 'author') {
    if (!keyword || !keyword.trim()) {
      throw new Error('按作者搜索必须输入作者名关键词')
    }
    const url = 'https://backend.gululu.world/search/opus-author'
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)
    let resp: Response
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { ...GULULU_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: keyword.trim() }),
        signal: controller.signal,
      })
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error('骨碌碌请求超时（15 秒）')
      throw e
    } finally {
      clearTimeout(timeoutId)
    }
    if (!resp.ok) throw new Error(`骨碌碌请求失败: HTTP ${resp.status}`)
    const json: any = await resp.json()
    console.log('[searchGululu] opus-author response keys:', Object.keys(json || {}))

    const authors: any[] = json?.searchAuthorRespList || []
    const opuses: any[] = json?.searchOpusResps || []
    const results: GululuResult[] = []

    // 先把作者对应的作品也作为结果返回
    for (const it of opuses) {
      if (!it || (it.type && it.type !== 'book')) continue
      const id = String(it.opusId || it.recommendedId || '')
      if (!id) continue
      const title = (it.opusName || it.title || '').trim()
      if (!title) continue
      const words = typeof it.words === 'number' ? it.words : 0
      const readNum = typeof it.readNum === 'number' ? it.readNum : 0
      const tagArr = typeof it.tagNames === 'string'
        ? it.tagNames.split(/[\s,，]+/).filter(Boolean)
        : Array.isArray(it.tags) ? it.tags.filter((t: any) => typeof t === 'string') : []
      results.push({
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
        url: `https://www.gululu.world/opus/${id}`,
        tags: tagArr.slice(0, 8),
        status: 'unknown',
      })
    }
    // 追加纯作者（无作品时也展示）
    for (const a of authors) {
      results.push({
        title: `👤 ${a.nickName || '匿名作者'}`,
        author: a.nickName || '匿名作者',
        wordCount: '0',
        wordCountRaw: 0,
        viewCount: `${a.opusNum || 0} 部作品`,
        viewCountRaw: 0,
        updatedAt: '—',
        updatedAtRaw: 0,
        publishedAt: '',
        publishedAtRaw: 0,
        url: `https://www.gululu.world/user/${a.userId}`,
        tags: [],
        status: 'unknown',
      })
    }
    if (results.length === 0) {
      throw new Error(`骨碌碌未找到作者名包含"${keyword}"的作者/作品`)
    }
    return results.slice(0, 100)
  }

  // ─── 匹配标题：用 generalPageV2 type=OPUS GET（空关键字时拉热门列表） ───
  const key = keyword?.trim() || ''
  const url = key
    ? `https://backend.gululu.world/search/generalPageV2?type=OPUS&key=${encodeURIComponent(key)}&page=1`
    : `https://backend.gululu.world/search/generalPageV2?type=OPUS&page=1`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)
  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'GET',
      headers: GULULU_HEADERS,
      signal: controller.signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('骨碌碌请求超时（15 秒）')
    throw e
  } finally {
    clearTimeout(timeoutId)
  }
  console.log('[searchGululu] HTTP status:', resp.status)
  if (!resp.ok) throw new Error(`骨碌碌请求失败: HTTP ${resp.status}`)
  const json: any = await resp.json()
  console.log('[searchGululu] generalPageV2 items:', json?.data?.items?.length || 0)

  if (json?.code !== 200) throw new Error(`骨碌碌接口返回错误: ${json?.msg || '未知'}`)

  const items: any[] = json?.data?.items || []
  if (items.length === 0) {
    if (key) throw new Error(`骨碌碌未找到标题包含"${key}"的作品`)
    return []
  }

  const results: GululuResult[] = items
    .filter((it: any) => !it.type || it.type === 'book')
    .map((it: any) => {
      const id = String(it.opusId || '')
      const title = (it.opusName || '').trim()
      const words = typeof it.words === 'number' ? it.words : 0
      const readNum = typeof it.readNum === 'number' ? it.readNum : 0
      const tagArr = typeof it.tagNames === 'string'
        ? it.tagNames.split(/[\s,，]+/).filter(Boolean)
        : Array.isArray(it.tags) ? it.tags.filter((t: any) => typeof t === 'string') : []
      return {
        title,
        author: it.authorName || '佚名',
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
        url: `https://www.gululu.world/opus/${id}`,
        tags: tagArr.slice(0, 8),
        status: 'unknown',
      }
    })
  return results.slice(0, 100)
}

/**
 * 抓取 NGA fid=784 安科版块列表（1-3 页），解析帖子表格
 * 支持传入 cookies（从设置中读取的登录态），若 cookies 有效即可绕过访客限制。
 * matchField: 'title' 匹配标题 / 'author' 匹配作者
 */
async function searchNgaAnke(
  keyword: string,
  matchField: 'title' | 'author' = 'title',
  cookies?: string,
): Promise<NgaResult[]> {
  // ngabbs.com 反爬相对宽松，优先尝试；bbs.nga.cn 反爬最严放最后
  const domains = ['https://ngabbs.com', 'https://nga.178.com', 'https://bbs.nga.cn']
  const maxPages = 3
  const results: NgaResult[] = []
  const seenTids = new Set<string>()

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
  console.log('[searchNgaAnke] keyword:', JSON.stringify(keyword), 'cookies:', NGA_HEADERS['Cookie'] ? '(已配置)' : '(未配置)')

  // 关键词为空时退化为按版块列表浏览（不做过滤）
  const useSearch = !!(keyword && keyword.trim())
  const encodedKey = useSearch ? encodeURIComponent(keyword.trim()) : ''

  let accessible = false
  let lastError = ''
  let accessDenied = false  // 标记是否触发 ERROR:2048（需要登录）

  for (const baseUrl of domains) {
    for (let page = 1; page <= maxPages; page++) {
      // 关键词非空时用 NGA 搜索（thread.php?key=...&fid=784&content=4）
      // 关键词为空时用版块列表（thread.php?fid=784）
      const url = useSearch
        ? `${baseUrl}/thread.php?key=${encodedKey}&fid=784&content=4&page=${page}`
        : `${baseUrl}/thread.php?fid=784&page=${page}&rand=${Date.now() % 1000}`
      console.log('[searchNgaAnke] fetch URL:', url)
      let html: string
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 15000)
        let resp: Response
        try {
          resp = await fetch(url, {
            headers: page === 1 || !useSearch ? NGA_HEADERS : { ...NGA_HEADERS, Referer: `${baseUrl}/thread.php?fid=784&page=${page - 1}` },
            redirect: 'follow',
            signal: controller.signal,
          })
        } catch (e) {
          if ((e as Error).name === 'AbortError') {
            lastError = 'NGA 请求超时（15 秒）'
            break
          }
          throw e
        } finally {
          clearTimeout(timeoutId)
        }
        console.log('[searchNgaAnke] HTTP status:', resp.status, 'domain:', baseUrl, 'page:', page)
        if (resp.status === 403) {
          lastError = cookies
            ? 'NGA 访问被拒绝（403），Cookie 可能已过期，请在设置中重新粘贴最新 Cookie'
            : 'NGA 目前限制访客访问安科版块（需登录账号），请使用骨碌碌搜索或在设置中粘贴 NGA Cookie'
          accessDenied = true
          break
        }
        if (!resp.ok) {
          lastError = `NGA 请求失败: HTTP ${resp.status}`
          break
        }
        const buffer = await resp.arrayBuffer()
        try {
          html = new TextDecoder('gbk').decode(buffer)
        } catch {
          html = new TextDecoder('utf-8').decode(buffer)
        }
        console.log('[searchNgaAnke] HTML length:', html.length)
        accessible = true

        // 检测 NGA 搜索 ERROR:2048（需登录 Cookie）
        if (html.includes('(ERROR:<!--msgcodestart-->2048') || html.includes('注册用户/威望大于0方可使用搜索')) {
          accessDenied = true
          if (!cookies) {
            throw new Error('NGA 搜索需要登录账号，请在设置中粘贴 NGA Cookie 后重试（需要注册用户且威望 > 0）')
          }
          throw new Error('NGA 搜索失败：当前 Cookie 无效或威望不足')
        }
      } catch (e) {
        lastError = (e as Error).message
        break
      }

      // 切分表格行
      const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
      let rowMatch: RegExpExecArray | null
      let foundNewOnThisPage = false
      while ((rowMatch = rowRe.exec(html)) !== null) {
        const row = rowMatch[1]

        const tidRe = /<a\b[^>]*href=["']?read\.php\?tid=(\d+)["']?[^>]*>([\s\S]*?)<\/a>/gi
        const tidLinks: { tid: string; text: string }[] = []
        let tm: RegExpExecArray | null
        while ((tm = tidRe.exec(row)) !== null) {
          tidLinks.push({ tid: tm[1], text: stripHtmlTags(tm[2]) })
        }
        if (tidLinks.length === 0) continue

        const tid = tidLinks[0].tid
        if (seenTids.has(tid)) continue
        seenTids.add(tid)
        foundNewOnThisPage = true

        const titleLink = tidLinks
          .filter((l) => !/^\d+$/.test(l.text))
          .sort((a, b) => b.text.length - a.text.length)[0]
        if (!titleLink) continue
        const title = titleLink.text.trim()
        if (!title || title.startsWith('[公告]')) continue
        // NGA 搜索页会把搜索关键词原样回显在第一行，过滤掉
        if (useSearch && title.trim() === keyword.trim()) continue

        const fullUrl = `${baseUrl}/read.php?tid=${tid}`

        const floorCount = tidLinks.find((l) => /^\d+$/.test(l.text))?.text || '0'

        const authorRe = /<a\b[^>]*href=["']?nuke\.php\?func=ucp&uid=(\d+)["']?[^>]*>([\s\S]*?)<\/a>/i
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

        results.push({
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

      if (!foundNewOnThisPage) break
      if (page < maxPages) {
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
    if (accessible) break
  }

  if (!accessible && results.length === 0 && lastError) {
    throw new Error(lastError)
  }
  if (accessible && results.length === 0) {
    console.error('[searchNgaAnke] 页面请求成功但未解析到任何帖子')
    throw new Error('NGA 页面请求成功但未解析到任何帖子（版块 HTML 结构可能已变化，或 Cookie 已过期）')
  }
  console.log('[searchNgaAnke] results parsed:', results.length)
  return results.slice(0, 100)
}

export function registerSearchAnkeIpc(): void {
  ipcMain.handle(
    'search:gululu',
    async (
      _event,
      payload: string | { keyword: string; matchField?: 'title' | 'author' },
    ) => {
      try {
        // 兼容旧调用（直接传 keyword 字符串）和新调用（传对象 {keyword, matchField}）
        let keyword = ''
        let matchField: 'title' | 'author' = 'title'
        if (typeof payload === 'string') {
          keyword = payload
        } else if (payload && typeof payload === 'object') {
          keyword = payload.keyword || ''
          matchField = payload.matchField || 'title'
        }
        return { ok: true, data: await searchGululu(keyword || '', matchField) }
      } catch (e) {
        return { ok: false, error: (e as Error).message || '骨碌碌搜索失败' }
      }
    },
  )

  ipcMain.handle(
    'search:nga-anke',
    async (
      _event,
      payload: string | { keyword: string; cookies?: string; matchField?: 'title' | 'author' },
    ) => {
      try {
        // 兼容旧调用（直接传 keyword 字符串）和新调用（传对象 {keyword, cookies, matchField}）
        let keyword = ''
        let cookies: string | undefined
        let matchField: 'title' | 'author' = 'title'
        if (typeof payload === 'string') {
          keyword = payload
        } else if (payload && typeof payload === 'object') {
          keyword = payload.keyword || ''
          cookies = payload.cookies
          matchField = payload.matchField || 'title'
        }
        return { ok: true, data: await searchNgaAnke(keyword || '', matchField, cookies) }
      } catch (e) {
        return { ok: false, error: (e as Error).message || 'NGA搜索失败' }
      }
    },
  )
}
