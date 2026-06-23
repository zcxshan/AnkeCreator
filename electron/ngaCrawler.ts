// ============================================================
// NGA 安价收集 IPC
//
// - nga:collect: 抓取 NGA 主题帖指定范围的楼层 + 过滤 + 取消
// - nga:collect:cancel: 取消抓取任务
// - nga:fetchThreadInfo: 自动检测 NGA 主题帖总页数
//
// 反爬策略：
// - 限流 1200ms 基线 + ±300ms 随机抖动（避免固定间隔被识别为机器人）
// - HTTP 403/429 检测到时退避 3 秒（典型 NGA 限流信号）
// ============================================================

import { ipcMain } from 'electron'
import {
  parseThreadUrl,
  computePageRange,
  extractPostsFromHtml,
  filterAnjiaPosts,
  extractTotalPagesFromHtml,
  detectCharsetFromHtml,
  type CollectResult,
} from '../src/utils/ngaCrawler'

// 模块级状态：跟踪当前抓取任务 + 已取消任务 ID 集合
let currentCollectingTaskId = 0
const cancelledTaskIds = new Set<number>()

/** 构造浏览器风格的 NGA 请求头（基于实际抓取验证） */
function buildNgaHeaders(baseUrl: string, cookies?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept':
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': `${baseUrl}/`, // 关键：必须有，否则可能被当爬虫
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',
  }
  if (cookies && cookies.trim()) {
    headers['Cookie'] = cookies.trim()
  }
  return headers
}

/** 注册所有 NGA 抓取相关 IPC handler */
export function registerNgaIpc(): void {
  // nga:collect：抓取 NGA 主题帖指定范围的楼层
  ipcMain.handle(
    'nga:collect',
    async (
      _e,
      payload: {
        url: string
        startFloor: number
        endFloor: number
        prefix: string
        authorid?: string
        cookies?: string
      },
    ): Promise<CollectResult> => {
      // 分配新的 taskId
      currentCollectingTaskId++
      const taskId = currentCollectingTaskId
      try {
        const parsed = parseThreadUrl(payload.url)
        if (!parsed) {
          return {
            ok: false,
            items: [],
            totalPages: 0,
            error: '无法解析 URL 中的 tid 参数，请检查链接格式',
          }
        }
        const { tid, baseUrl, authorid: urlAuthorid } = parsed
        // 优先使用 URL 中的 authorid，其次使用 payload.authorid
        const targetAuthorid = urlAuthorid || payload.authorid
        const { startPage, endPage, totalPages } = computePageRange(
          payload.startFloor,
          payload.endFloor,
        )

        console.log(
          `[nga:collect] taskId=${taskId} tid=${tid} 范围=${payload.startFloor}-${payload.endFloor} 页码=${startPage}-${endPage}（共 ${totalPages} 页）${targetAuthorid ? ` authorid=${targetAuthorid}` : ''}`,
        )

        const allPosts: ReturnType<typeof extractPostsFromHtml> = []
        const errors: string[] = []

        for (let page = startPage; page <= endPage; page++) {
          // 取消检查（在每页之间）
          if (cancelledTaskIds.has(taskId)) {
            console.log(`[nga:collect] 任务 ${taskId} 被取消（已抓 ${allPosts.length} 帖）`)
            break
          }
          const pageUrl = `${baseUrl}/read.php?tid=${tid}&page=${page}`
          try {
            const headers = buildNgaHeaders(baseUrl, payload.cookies)
            const resp = await fetch(pageUrl, { headers, redirect: 'follow' })
            if (!resp.ok) {
              errors.push(`第 ${page} 页 HTTP ${resp.status}`)
              console.warn(`[nga:collect] 第 ${page} 页 HTTP ${resp.status}`)
              // 触发反爬时退避：403/429 是 NGA 限流/封禁的典型信号
              if (resp.status === 403 || resp.status === 429) {
                console.warn(`[nga:collect] 检测到反爬信号（HTTP ${resp.status}），退避 3 秒...`)
                await new Promise((r) => setTimeout(r, 3000))
              }
              continue
            }
            // GBK 解码（NGA 默认 charset=GBK，UTF-8 会乱码）
            const buffer = await resp.arrayBuffer()
            const charset = detectCharsetFromHtml(buffer)
            const html = new TextDecoder(charset).decode(buffer)
            const posts = extractPostsFromHtml(html)
            allPosts.push(...posts)
            console.log(
              `[nga:collect] 第 ${page} 页抓到 ${posts.length} 个帖子 (HTML ${html.length} chars, charset=${charset})`,
            )
            // 限流：基线 1200ms + 随机 ±300ms
            // - 1200ms 是经验安全基线：NGA 反爬通常对 < 1s 间隔的连续请求敏感
            // - ±300ms 抖动让间隔看起来像人类操作（100% 固定 = 机器人特征）
            // - 最后一页不等待，加快返回
            const baseDelay = 1200
            const jitter = Math.floor(Math.random() * 600) - 300 // -300 ~ +300
            const delay = page < endPage ? baseDelay + jitter : 0
            if (delay > 0) {
              console.log(
                `[nga:collect] 第 ${page} 页抓完，限流等待 ${delay}ms（基线 ${baseDelay}ms + 抖动 ${jitter >= 0 ? '+' : ''}${jitter}ms）`,
              )
              await new Promise((r) => setTimeout(r, delay))
            }
          } catch (e) {
            errors.push(`第 ${page} 页抓取失败：${(e as Error).message}`)
            console.warn(`[nga:collect] 第 ${page} 页抓取失败：`, (e as Error).message)
          }
        }

        const items = filterAnjiaPosts(
          allPosts,
          payload.startFloor,
          payload.endFloor,
          payload.prefix,
          targetAuthorid,
        )

        const cancelled = cancelledTaskIds.has(taskId)
        console.log(
          `[nga:collect] taskId=${taskId} 完成${cancelled ? '（已取消）' : ''}：共抓 ${allPosts.length} 帖，过滤出 ${items.length} 条匹配"${payload.prefix}"${targetAuthorid ? ` authorid=${targetAuthorid}` : ''}`,
        )

        return {
          ok: true,
          items,
          totalPages,
          error: errors.length > 0 ? errors.join('；') : undefined,
        }
      } catch (e) {
        console.error('[nga:collect] 抓取异常：', e)
        return {
          ok: false,
          items: [],
          totalPages: 0,
          error: (e as Error).message || '抓取失败',
        }
      } finally {
        // 清理：删除 cancel flag
        cancelledTaskIds.delete(taskId)
      }
    },
  )

  // 取消抓取任务
  ipcMain.handle(
    'nga:collect:cancel',
    async (_e, taskId?: number): Promise<{ ok: boolean }> => {
      const target = taskId ?? currentCollectingTaskId
      if (target) {
        cancelledTaskIds.add(target)
        console.log(`[nga:collect:cancel] 已标记任务 ${target} 为取消`)
      }
      return { ok: true }
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
      ok: boolean
      totalPages?: number
      totalFloors?: number
      error?: string
    }> => {
      try {
        const parsed = parseThreadUrl(url)
        if (!parsed) {
          return { ok: false, error: '无法解析 URL 中的 tid 参数' }
        }
        const { tid, baseUrl } = parsed
        const headers = buildNgaHeaders(baseUrl, cookies)
        const resp = await fetch(`${baseUrl}/read.php?tid=${tid}`, {
          headers,
          redirect: 'follow',
        })
        if (!resp.ok) {
          return { ok: false, error: `HTTP ${resp.status}` }
        }
        // GBK 解码
        const buffer = await resp.arrayBuffer()
        const charset = detectCharsetFromHtml(buffer)
        const html = new TextDecoder(charset).decode(buffer)

        // 解析总页数（优先 __PAGE 全局变量，备选末页链接）
        const totalPages = extractTotalPagesFromHtml(html)
        if (totalPages === 0) {
          return { ok: false, error: '无法从页面解析总页数，请手动输入末尾楼层' }
        }

        const totalFloors = totalPages * 20
        console.log(
          `[nga:fetchThreadInfo] tid=${tid} 总页数=${totalPages}（约 ${totalFloors} 楼）charset=${charset}`,
        )
        return { ok: true, totalPages, totalFloors }
      } catch (e) {
        return { ok: false, error: (e as Error).message || '检测失败' }
      }
    },
  )
}
