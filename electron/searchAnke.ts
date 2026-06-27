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

/**
 * 抓取骨碌碌首页/搜索页，解析安科卡片
 */
async function searchGululu(keyword: string): Promise<GululuResult[]> {
  const url = keyword
    ? `https://www.gululu.world/search?q=${encodeURIComponent(keyword)}`
    : 'https://www.gululu.world/'
  const resp = await fetch(url, { headers: COMMON_HEADERS, redirect: 'follow' })
  if (!resp.ok) throw new Error(`骨碌碌请求失败: HTTP ${resp.status}`)
  const html = await resp.text()

  // 按 book ID 聚合所有 <a href="/book/ID">文本</a> 的内容
  const bookTexts = new Map<string, string[]>()
  const linkRe = /<a\b[^>]*href=["']?(?:https?:\/\/[^/]+)?(\/book\/(\d+))["']?[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(html)) !== null) {
    const bookId = m[2]
    const text = stripHtmlTags(m[3])
    if (!text) continue
    if (!bookTexts.has(bookId)) bookTexts.set(bookId, [])
    bookTexts.get(bookId)!.push(text)
  }

  const results: GululuResult[] = []
  for (const [bookId, texts] of bookTexts) {
    const fullUrl = `https://www.gululu.world/book/${bookId}`
    const cardText = texts.join(' ')

    // 标题：最长的非信息性文本
    const title = texts
      .filter((t) => !/^\d+\s*(天前|小时前|个月内|周前|分钟前)/.test(t))
      .filter((t) => !/^\d+(\.\d+)?万字?$/.test(t))
      .filter((t) => !/^安科\s*·/.test(t))
      .sort((a, b) => b.length - a.length)[0] || texts[0] || ''
    if (!title || title.length > 200) continue

    // 作者 + 更新时间 + 浏览数
    const infoMatch = cardText.match(
      /([^\d\s][^\d]*?)\s*(\d+)\s*(天前|小时前|个月内|周前|分钟前)\s*更新\s*浏览量([\d.]+万?)/,
    )
    const author = infoMatch ? infoMatch[1].trim() : ''
    const updatedAt = infoMatch ? `${infoMatch[2]}${infoMatch[3]}` : ''
    const viewCount = infoMatch ? infoMatch[4] : ''

    // 字数
    const wordMatch = cardText.match(/(\d+(?:\.\d+)?\s*万字?)/)
    const wordCount = wordMatch ? wordMatch[1].replace(/\s/g, '') : ''

    // 关键字过滤
    if (keyword && !title.includes(keyword) && !author.includes(keyword)) continue

    results.push({
      title: title.trim(),
      author: author || '佚名',
      wordCount: wordCount || '未知',
      wordCountRaw: parseWordCount(wordCount),
      viewCount: viewCount || '未知',
      viewCountRaw: parseViewCount(viewCount),
      updatedAt: updatedAt || '未知',
      updatedAtRaw: parseRelativeTime(updatedAt),
      publishedAt: '',
      publishedAtRaw: 0,
      url: fullUrl,
    })
  }

  return results.slice(0, 50)
}

/**
 * 抓取 NGA fid=784 安科版块列表（1-3 页），解析帖子表格
 */
async function searchNgaAnke(keyword: string): Promise<NgaResult[]> {
  const baseUrl = 'https://ngabbs.com'
  const maxPages = 3
  const results: NgaResult[] = []
  const seenTids = new Set<string>()

  for (let page = 1; page <= maxPages; page++) {
    const url = `${baseUrl}/thread.php?fid=784&page=${page}&rand=${Date.now() % 1000}`
    let html: string
    try {
      const resp = await fetch(url, {
        headers: { ...COMMON_HEADERS, Referer: `${baseUrl}/` },
        redirect: 'follow',
      })
      if (!resp.ok) {
        // 单页失败不中断整体，已抓到的结果仍返回
        break
      }
      const buffer = await resp.arrayBuffer()
      html = new TextDecoder('gbk').decode(buffer)
    } catch {
      break
    }

    // 切分表格行
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
    let rowMatch: RegExpExecArray | null
    let foundNewOnThisPage = false
    while ((rowMatch = rowRe.exec(html)) !== null) {
      const row = rowMatch[1]

      // 找含 read.php?tid= 的链接
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

      // 标题：取最长的非纯数字链接文本
      const titleLink = tidLinks
        .filter((l) => !/^\d+$/.test(l.text))
        .sort((a, b) => b.text.length - a.text.length)[0]
      if (!titleLink) continue
      const title = titleLink.text.trim()
      if (!title || title.startsWith('[公告]')) continue

      const fullUrl = `${baseUrl}/read.php?tid=${tid}`

      // 楼层数：第一个纯数字链接文本
      const floorCount = tidLinks.find((l) => /^\d+$/.test(l.text))?.text || '0'

      // 作者
      const authorRe = /<a\b[^>]*href=["']?nuke\.php\?func=ucp&uid=(\d+)["']?[^>]*>([\s\S]*?)<\/a>/i
      const authorMatch = row.match(authorRe)
      const author = authorMatch ? stripHtmlTags(authorMatch[2]) : ''

      // 时间戳：行内所有 10 位 unix 时间戳（第一个=发布时间，第二个=最后回复时间）
      const tsMatches = row.match(/\d{10}/g)
      const publishedTs = tsMatches && tsMatches.length > 0 ? parseInt(tsMatches[0], 10) : 0
      const lastReplyTs = tsMatches && tsMatches.length > 1 ? parseInt(tsMatches[1], 10) : publishedTs

      const publishedAt = publishedTs ? unixToDate(publishedTs) : ''
      const lastReplyAt = lastReplyTs ? unixToDate(lastReplyTs) : publishedAt

      // 关键字过滤
      if (keyword && !title.includes(keyword) && !author.includes(keyword)) continue

      results.push({
        title,
        author: author || '佚名',
        floorCount: floorCount || '0',
        floorCountRaw: parseFloorCount(floorCount),
        lastReplyAt,
        lastReplyAtRaw: lastReplyTs,
        publishedAt,
        publishedAtRaw: publishedTs,
        url: fullUrl,
      })
    }

    // 如果本页没有新帖子，不继续抓下一页
    if (!foundNewOnThisPage) break
    // 请求间限流，避免被反爬
    if (page < maxPages) {
      await new Promise((r) => setTimeout(r, 1500))
    }
  }

  return results.slice(0, 50)
}

export function registerSearchAnkeIpc(): void {
  ipcMain.handle('search:gululu', async (_event, keyword: string) => {
    try {
      return { ok: true, data: await searchGululu(keyword || '') }
    } catch (e) {
      return { ok: false, error: (e as Error).message || '骨碌碌搜索失败' }
    }
  })

  ipcMain.handle('search:nga-anke', async (_event, keyword: string) => {
    try {
      return { ok: true, data: await searchNgaAnke(keyword || '') }
    } catch (e) {
      return { ok: false, error: (e as Error).message || 'NGA搜索失败' }
    }
  })
}
