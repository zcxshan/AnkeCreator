// ============================================================
// NGA 安价收集 IPC
//
// - nga:collect: 抓取 NGA 主题帖指定范围的楼层 + 过滤 + 取消/暂停/进度
// - nga:collect:cancel: 取消抓取任务
// - nga:collect:pause: 暂停/恢复抓取
// - nga:fetchThreadInfo: 自动检测 NGA 主题帖总页数
//
// 进度事件：
//   nga:collect:progress { taskId, current, total, phase, message }
//     phase: 'starting' | 'fetching' | 'parsing' | 'filtering' | 'done' | 'error' | 'cancelled' | 'paused'
//
// 反爬策略：
// - 限流 1200ms 基线 + ±300ms 随机抖动（避免固定间隔被识别为机器人）
// - HTTP 403/429 检测到时退避 3 秒（典型 NGA 限流信号）
// - 连续空页自动停止（authorid 模式下非常重要）
// ============================================================

import { ipcMain } from 'electron'
import {
  parseThreadUrl,
  computePageRange,
  extractPostsFromHtml,
  filterAnjiaPosts,
  extractTotalPagesFromHtml,
  detectCharsetFromHtml,
  type AnjiaItem,
  type CollectResult,
  type MatchMode,
} from '../src/utils/ngaCrawler'

interface TaskState {
  cancelled: boolean
  paused: boolean
}

let currentCollectingTaskId = 0
const tasks = new Map<number, TaskState>()

type ProgressPhase = 'starting' | 'fetching' | 'parsing' | 'filtering' | 'done' | 'error' | 'cancelled' | 'paused'

interface ProgressPayload {
  taskId: number
  current: number
  total: number
  phase: ProgressPhase
  message: string
  itemsFound?: number
}

function sendProgress(sender: Electron.WebContents, payload: ProgressPayload) {
  try {
    sender.send('nga:collect:progress', payload)
  } catch {
    // ignore - sender may be destroyed
  }
}

/** UA 池：随机轮换以降低反爬识别概率 */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
]

/** 构造浏览器风格的 NGA 请求头（UA 随机轮换 + keep-alive 复用连接） */
function buildNgaHeaders(baseUrl: string, cookies?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    'Accept':
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': `${baseUrl}/`,
    'Connection': 'keep-alive',
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
      event,
      payload: {
        url: string
        startFloor: number
        endFloor: number
        prefix: string
        authorid?: string
        matchMode?: string
        cookies?: string
        /** 仅抓取这些页码（用于失败页重试）；提供时忽略 startFloor/endFloor 范围 */
        retryPages?: number[]
      },
    ): Promise<CollectResult> => {
      currentCollectingTaskId++
      const taskId = currentCollectingTaskId
      const state: TaskState = { cancelled: false, paused: false }
      tasks.set(taskId, state)
      const sender = event.sender

      const send = (p: Omit<ProgressPayload, 'taskId'>) =>
        sendProgress(sender, { taskId, ...p })

      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

      try {
        const parsed = parseThreadUrl(payload.url)
        if (!parsed) {
          send({ current: 0, total: 0, phase: 'error', message: '无法解析 URL 中的 tid 参数' })
          return { ok: false, items: [], totalPages: 0, error: '无法解析 URL 中的 tid 参数，请检查链接格式' }
        }
        const { tid, baseUrl, authorid: urlAuthorid } = parsed
        const targetAuthorid = urlAuthorid || payload.authorid

        // authorid 模式：NGA 按作者回复序号分页，不能用全楼楼层号算页码
        // 改为从 page=1 逐页爬到连续空页为止
        // retryPages 模式：仅抓取指定页码（用于失败页重试），不走 authorid 无限循环
        const isRetryMode = Array.isArray(payload.retryPages) && payload.retryPages.length > 0
        const retryPageSet = isRetryMode ? new Set(payload.retryPages!) : null
        const isAuthoridMode = !isRetryMode && !!targetAuthorid
        const computedRange = computePageRange(payload.startFloor, payload.endFloor)
        let startPage: number
        let endPage: number
        let totalPages: number
        let maxPage: number
        if (isRetryMode) {
          const sorted = [...payload.retryPages!].sort((a, b) => a - b)
          startPage = sorted[0]
          endPage = sorted[sorted.length - 1]
          totalPages = sorted.length
          maxPage = endPage
        } else if (isAuthoridMode) {
          startPage = 1
          endPage = -1
          totalPages = -1
          maxPage = Infinity
        } else {
          startPage = computedRange.startPage
          endPage = computedRange.endPage
          totalPages = computedRange.totalPages
          maxPage = endPage
        }

        // authorid 模式无法预知总页数，用"用户指定范围"估算（每页约20楼）
        // 即 (endFloor - startFloor + 1) / 20，而非用 endFloor/20
        // 这样进度条反映用户实际关心的页数
        const estimatedRange = Math.max(
          1,
          Math.ceil((payload.endFloor - payload.startFloor + 1) / 20),
        )
        // authorid 模式下 totalProgress 动态增长（endFloor 可能是用户估算，不一定准确）
        let totalProgress = isAuthoridMode
          ? estimatedRange
          : isRetryMode
            ? retryPageSet!.size
            : (endPage - startPage + 1)

        console.log(
          `[nga:collect] taskId=${taskId} tid=${tid} 范围=${payload.startFloor}-${payload.endFloor} ${isRetryMode ? `重试模式(页码=${[...retryPageSet!].join(',')})` : isAuthoridMode ? `authorid模式(逐页爬取)` : `页码=${startPage}-${endPage}（共 ${totalPages} 页）`}${targetAuthorid ? ` authorid=${targetAuthorid}` : ''}`,
        )

        send({
          current: 0,
          total: totalProgress,
          phase: 'starting',
          message: isRetryMode
            ? `准备重试 ${retryPageSet!.size} 个失败页...`
            : isAuthoridMode
              ? `准备按作者模式逐页抓取（楼层 ${payload.startFloor}-${payload.endFloor}）...`
              : `准备抓取第 ${startPage}-${endPage} 页...`,
        })

        const allPosts: ReturnType<typeof extractPostsFromHtml> = []
        const errors: string[] = []
        const failedPages: number[] = []
        let consecutiveEmptyPages = 0
        let consecutiveFailedPages = 0 // 独立于空页计数，防止"1失败+1空页"误触发停止
        // 重试策略拆分：
        // - 网络异常/超时：只重试 1 次（防止偶发抖动掩盖真实错误，让用户决定是否重试）
        // - 403/429 限流：重试 2 次（NGA 反爬必需，无法避免）
        // - 其他 HTTP 错误（500 等）：不重试，直接计入 failedPages
        const MAX_TRANSIENT_RETRIES = 1
        const MAX_RATE_LIMIT_RETRIES = 2
        const RETRY_DELAY = 2000
        // 重试模式下用 fetchedCount 跟踪已抓页数（因为会跳过不在 retryPageSet 中的页）
        let fetchedCount = 0
        // 按 floor 去重：防止 NGA 越界返回末页内容导致重复 push
        const seenFloors = new Set<number>()

        for (let page = startPage; page <= maxPage; page++) {
          // 重试模式：跳过不在 retryPageSet 中的页码
          if (retryPageSet && !retryPageSet.has(page)) continue

          if (state.cancelled) {
            send({ current: fetchedCount, total: totalProgress, phase: 'cancelled', message: '已取消' })
            break
          }

          while (state.paused && !state.cancelled) {
            send({ current: fetchedCount, total: totalProgress, phase: 'paused', message: '已暂停，等待恢复...' })
            await sleep(500)
          }
          if (state.cancelled) break

          const pageUrl = targetAuthorid
            ? `${baseUrl}/read.php?tid=${tid}&authorid=${targetAuthorid}&page=${page}`
            : `${baseUrl}/read.php?tid=${tid}&page=${page}`

          send({
            current: fetchedCount,
            total: totalProgress,
            phase: 'fetching',
            message: isRetryMode
              ? `正在重试第 ${page} 页...`
              : isAuthoridMode
                ? `正在抓取第 ${page} 页（作者模式）...`
                : `正在抓取第 ${page}/${endPage} 页...`,
            itemsFound: allPosts.length,
          })

          let postsOnPage: ReturnType<typeof extractPostsFromHtml> = []
          let pageFailed = false

          // 单页抓取重试：限流/网络异常走各自的退避次数
          // 最多总尝试次数 = max(M_RATE+1, M_TRANS+1) = 3
          const maxAttempts =
            Math.max(MAX_TRANSIENT_RETRIES, MAX_RATE_LIMIT_RETRIES) + 1
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (state.cancelled) break
            try {
              const headers = buildNgaHeaders(baseUrl, payload.cookies)
              const resp = await fetch(pageUrl, { headers, redirect: 'follow' })
              if (resp.ok) {
                const buffer = await resp.arrayBuffer()
                const charset = detectCharsetFromHtml(buffer)
                const html = new TextDecoder(charset).decode(buffer)
                postsOnPage = extractPostsFromHtml(html)
                console.log(
                  `[nga:collect] 第 ${page} 页抓到 ${postsOnPage.length} 个帖子 (HTML ${html.length} chars, charset=${charset})`,
                )
                break // 成功，退出重试循环
              }
              if (resp.status === 403 || resp.status === 429) {
                // 限流：退避后重试 MAX_RATE_LIMIT_RETRIES 次
                if (attempt < MAX_RATE_LIMIT_RETRIES) {
                  console.warn(
                    `[nga:collect] 第 ${page} 页 HTTP ${resp.status}（尝试 ${attempt + 1}/${maxAttempts}），退避 ${RETRY_DELAY * (attempt + 1)}ms...`,
                  )
                  await sleep(RETRY_DELAY * (attempt + 1))
                  continue
                }
                // 限流重试仍失败：计入 failedPages，让用户决定
                errors.push(`第 ${page} 页 HTTP ${resp.status}（限流重试 ${MAX_RATE_LIMIT_RETRIES} 次后仍失败）`)
                console.warn(`[nga:collect] 第 ${page} 页 HTTP ${resp.status}（限流重试仍失败）`)
                pageFailed = true
                break
              }
              // 非 403/429 的 HTTP 错误：不重试，立即计入 failedPages
              errors.push(`第 ${page} 页 HTTP ${resp.status}`)
              console.warn(`[nga:collect] 第 ${page} 页 HTTP ${resp.status}（非限流错误，不重试）`)
              pageFailed = true
              break
            } catch (e) {
              // 网络异常/超时：只重试 MAX_TRANSIENT_RETRIES 次
              if (attempt < MAX_TRANSIENT_RETRIES) {
                console.warn(
                  `[nga:collect] 第 ${page} 页抓取异常（尝试 ${attempt + 1}/${maxAttempts}）：`,
                  (e as Error).message,
                )
                await sleep(RETRY_DELAY)
                continue
              }
              errors.push(`第 ${page} 页抓取失败：${(e as Error).message}`)
              console.warn(`[nga:collect] 第 ${page} 页抓取失败：`, (e as Error).message)
              pageFailed = true
            }
          }

          if (state.cancelled) break

          fetchedCount++

          // authorid 模式：totalProgress 动态增长，避免进度条提前走完
          if (isAuthoridMode && !isRetryMode && fetchedCount >= totalProgress) {
            totalProgress = fetchedCount + 5 // 预留 5 页缓冲
          }

          if (!pageFailed) {
            if (postsOnPage.length === 0) {
              // 普通模式有 endPage 兜底，空页不 break（可能是临时反爬，下一页会恢复）
              // authorid 模式无 endPage 兜底，需要靠空页判断结束，阈值提高到 5
              // 重试模式不提前终止（用户明确要求重试这些页）
              if (isAuthoridMode && !isRetryMode) {
                consecutiveEmptyPages++
                consecutiveFailedPages = 0
                if (consecutiveEmptyPages >= 5) {
                  console.log(`[nga:collect] authorid模式连续 ${consecutiveEmptyPages} 页为空，停止抓取`)
                  send({
                    current: fetchedCount,
                    total: totalProgress,
                    phase: 'fetching',
                    message: `连续 ${consecutiveEmptyPages} 页无内容，已到作者回复末尾`,
                    itemsFound: allPosts.length,
                  })
                  break
                }
              } else {
                // 普通模式/重试模式：空页不累计，继续下一页
                consecutiveEmptyPages = 0
                consecutiveFailedPages = 0
              }
            } else {
              // 按 floor 去重：跳过已见过的 floor（防止 NGA 越界返回末页内容导致重复 push）
              const newPosts = postsOnPage.filter((p) => !seenFloors.has(p.floor))
              for (const p of newPosts) seenFloors.add(p.floor)

              if (newPosts.length === 0) {
                // 本页所有 floor 都已见过 → NGA 末页回退（返回了之前页的内容）
                if (isAuthoridMode && !isRetryMode) {
                  consecutiveEmptyPages++
                  consecutiveFailedPages = 0
                  console.log(
                    `[nga:collect] 第 ${page} 页全部 ${postsOnPage.length} 个楼层已存在（NGA 末页回退），计入空页`,
                  )
                  if (consecutiveEmptyPages >= 5) {
                    send({
                      current: fetchedCount,
                      total: totalProgress,
                      phase: 'fetching',
                      message: `连续 ${consecutiveEmptyPages} 页为重复内容（NGA 已无更多内容），停止`,
                      itemsFound: allPosts.length,
                    })
                    break
                  }
                } else {
                  // 普通模式：末页回退不 break，继续下一页（endPage 兜底）
                  consecutiveEmptyPages = 0
                  consecutiveFailedPages = 0
                }
              } else {
                // 有新帖子：两个计数器都重置
                consecutiveEmptyPages = 0
                consecutiveFailedPages = 0
                allPosts.push(...newPosts)
                if (newPosts.length < postsOnPage.length) {
                  console.log(
                    `[nga:collect] 第 ${page} 页去重：${postsOnPage.length} → ${newPosts.length}`,
                  )
                }
              }
            }
          } else {
            // 失败页：独立计数，连续 3 次才 break（不与空页共享）
            failedPages.push(page)
            consecutiveFailedPages++
            if (!isRetryMode && consecutiveFailedPages >= 3) {
              console.log(`[nga:collect] 连续 ${consecutiveFailedPages} 页失败，提前停止抓取`)
              errors.push(`连续 ${consecutiveFailedPages} 页失败，停止抓取`)
              // 把剩余未爬页加入 failedPages，让用户能用"重试失败页"恢复
              if (!isAuthoridMode && maxPage !== Infinity) {
                for (let p = page + 1; p <= maxPage; p++) {
                  if (!retryPageSet || retryPageSet.has(p)) {
                    if (!failedPages.includes(p)) failedPages.push(p)
                  }
                }
              }
              break
            }
          }

          // authorid 模式：已爬过目标楼层范围，提前停止（不再爬后续超出 endFloor 的页）
          if (isAuthoridMode && !state.cancelled && postsOnPage.length > 0 && allPosts.length > 0) {
            const minFloorInPage = Math.min(...postsOnPage.map((p) => p.floor))
            if (minFloorInPage > payload.endFloor) {
              console.log(
                `[nga:collect] authorid模式：第 ${page} 页最小楼层 ${minFloorInPage} 已超过 endFloor ${payload.endFloor}，停止抓取`,
              )
              send({
                current: fetchedCount,
                total: totalProgress,
                phase: 'fetching',
                message: `已爬到第 ${minFloorInPage} 楼，超过目标范围 ${payload.endFloor} 楼，停止抓取`,
                itemsFound: allPosts.length,
              })
              break
            }
          }

          // 限流：基线 1200ms + 随机 ±300ms（authorid 模式总是延迟，因为不知道何时到末页）
          const baseDelay = 1200
          const jitter = Math.floor(Math.random() * 600) - 300
          const isLastPage = !isAuthoridMode && !isRetryMode && page >= endPage
          const delay = isLastPage ? 0 : baseDelay + jitter
          if (delay > 0 && !state.cancelled) {
            // 使用分段 sleep 以支持暂停
            const slices = 6
            const sliceDelay = Math.floor(delay / slices)
            for (let s = 0; s < slices; s++) {
              if (state.cancelled) break
              while (state.paused && !state.cancelled) {
                await sleep(300)
              }
              await sleep(sliceDelay)
            }
          }
        }

        // 检测已爬到的最高楼（重试模式不检测，因为 retry pages 不代表完整楼层范围）
        // 注意：这是"已爬到的最高楼"，不是"帖子真实最高楼"。如果中途因反爬/网络中断 break，
        // actualMaxFloor 会小于帖子真实最高楼。此时 failedPages 应包含未爬页，用户可重试。
        const actualMaxFloor = !isRetryMode && allPosts.length > 0 ? Math.max(...allPosts.map((p) => p.floor)) : 0
        const floorWarnings: string[] = []
        if (!isRetryMode && actualMaxFloor > 0 && payload.endFloor > actualMaxFloor) {
          if (failedPages.length > 0) {
            floorWarnings.push(`爬虫在 ${actualMaxFloor} 楼附近停止抓取（可能因反爬或网络中断未到帖末，可点击"重试失败页"恢复，共 ${failedPages.length} 页待重试）`)
          } else {
            floorWarnings.push(`已爬到 ${actualMaxFloor} 楼，可能已到帖子末尾（您指定的 ${payload.endFloor} 楼超出范围）`)
          }
        }

        send({
          current: isRetryMode ? fetchedCount : (totalProgress || (isAuthoridMode ? allPosts.length : 0)),
          total: totalProgress,
          phase: 'filtering',
          message: `共抓到 ${allPosts.length} 条帖子，正在筛选...`,
          itemsFound: allPosts.length,
        })

        // authorid 模式修正：NGA authorid 参数已按作者过滤，
        // 但仍然需要按实际楼层号过滤（不能用 slice 按序号取），
        // 因为用户指定的是楼层范围不是作者回复序号
        let items: AnjiaItem[]
        if (targetAuthorid) {
          items = filterAnjiaPosts(
            allPosts,
            payload.startFloor,
            payload.endFloor,
            payload.prefix,
            undefined, // 不用再按 uid 过滤，NGA 已按 authorid 返回该作者回复
            (payload.matchMode as MatchMode) || 'prefix',
          )
        } else {
          items = filterAnjiaPosts(
            allPosts,
            payload.startFloor,
            payload.endFloor,
            payload.prefix,
            undefined,
            (payload.matchMode as MatchMode) || 'prefix',
          )
        }

        const cancelled = state.cancelled
        const allErrors = [...errors, ...floorWarnings]
        const doneMessage = cancelled
          ? '已取消，保留已抓取结果'
          : failedPages.length > 0
            ? `完成，共 ${items.length} 条匹配（${failedPages.length} 页抓取失败）`
            : floorWarnings.length > 0
              ? `完成，共 ${items.length} 条匹配。${floorWarnings.join('；')}`
              : `完成，共 ${items.length} 条匹配`

        console.log(
          `[nga:collect] taskId=${taskId} 完成${cancelled ? '（已取消）' : ''}：共抓 ${allPosts.length} 帖，裁剪出 ${items.length} 条匹配"${payload.prefix}"${targetAuthorid ? ` authorid=${targetAuthorid}` : ''}${failedPages.length > 0 ? ` 失败页=[${failedPages.join(',')}]` : ''}${actualMaxFloor > 0 ? ` 实际最高楼=${actualMaxFloor}` : ''}`,
        )

        send({
          current: isRetryMode ? fetchedCount : (totalProgress || (isAuthoridMode ? allPosts.length : 0)),
          total: totalProgress,
          phase: cancelled ? 'cancelled' : 'done',
          message: doneMessage,
          itemsFound: items.length,
        })

        return {
          ok: true,
          items,
          totalPages,
          error: allErrors.length > 0 ? allErrors.join('；') : undefined,
          failedPages: failedPages.length > 0 ? failedPages : undefined,
          actualMaxFloor: actualMaxFloor > 0 ? actualMaxFloor : undefined,
        }
      } catch (e) {
        console.error('[nga:collect] 抓取异常：', e)
        send({ current: 0, total: 0, phase: 'error', message: (e as Error).message || '抓取失败' })
        return {
          ok: false,
          items: [],
          totalPages: 0,
          error: (e as Error).message || '抓取失败',
        }
      } finally {
        tasks.delete(taskId)
      }
    },
  )

  // 取消抓取任务
  ipcMain.handle(
    'nga:collect:cancel',
    async (_e, taskId?: number): Promise<{ ok: boolean }> => {
      const target = taskId ?? currentCollectingTaskId
      const t = tasks.get(target)
      if (t) {
        t.cancelled = true
        t.paused = false
        console.log(`[nga:collect:cancel] 已标记任务 ${target} 为取消`)
      }
      return { ok: true }
    },
  )

  // 暂停/恢复抓取
  ipcMain.handle(
    'nga:collect:pause',
    async (_e, taskId?: number, paused?: boolean): Promise<{ ok: boolean; paused: boolean }> => {
      const target = taskId ?? currentCollectingTaskId
      const t = tasks.get(target)
      if (t) {
        t.paused = paused !== undefined ? paused : !t.paused
        console.log(`[nga:collect:pause] 任务 ${target} 暂停状态：${t.paused}`)
        return { ok: true, paused: t.paused }
      }
      return { ok: false, paused: false }
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
        const { tid, baseUrl, authorid } = parsed
        const headers = buildNgaHeaders(baseUrl, cookies)
        const threadUrl = authorid
          ? `${baseUrl}/read.php?tid=${tid}&authorid=${authorid}`
          : `${baseUrl}/read.php?tid=${tid}`
        const resp = await fetch(threadUrl, {
          headers,
          redirect: 'follow',
        })
        if (!resp.ok) {
          return { ok: false, error: `HTTP ${resp.status}` }
        }
        const buffer = await resp.arrayBuffer()
        const charset = detectCharsetFromHtml(buffer)
        const html = new TextDecoder(charset).decode(buffer)

        const totalPages = extractTotalPagesFromHtml(html)
        if (totalPages === 0) {
          return { ok: false, error: '无法从页面解析总页数，请手动输入末尾楼层' }
        }

        // authorid 模式下 totalPages 是"作者回复分页数"，不能 ×20 当全帖楼数
        // 返回 totalFloors=0 让前端不覆盖用户输入的 endFloor
        const totalFloors = authorid ? 0 : totalPages * 20
        console.log(
          `[nga:fetchThreadInfo] tid=${tid}${authorid ? ` authorid=${authorid}（作者模式，不返回 totalFloors）` : ''} 总页数=${totalPages}${authorid ? '' : `（约 ${totalFloors} 楼）`} charset=${charset}`,
        )
        return { ok: true, totalPages, totalFloors }
      } catch (e) {
        return { ok: false, error: (e as Error).message || '检测失败' }
      }
    },
  )
}
