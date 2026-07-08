// ============================================================
// 骨碌碌安科收集 IPC
//
// - gululu:collect: 抓取骨碌碌书籍指定楼层范围的内容
// - gululu:collect:cancel: 取消抓取任务
// - gululu:fetchBookInfo: 自动检测书籍总楼数
//
// 进度事件：
//   gululu:collect:progress { taskId, current, total, phase, message }
//
// API 端点：
// - GET  /reader/opus/detail/{opusId}     → 作品详情
// - GET  /reader/floor/index-list/{opusId} → 楼层目录 [{floorId, floorNum, name}]
// - POST /reader/floor/content-by-ids      → 楼层内容（body: [floorId1, floorId2, ...]）
// ============================================================

import { ipcMain, type BrowserWindow } from 'electron'

// ============================================================
// 类型定义
// ============================================================

export interface GululuRawPost {
  floor: number       // floorNum
  author: string      // 作品作者（骨碌碌楼层无独立作者）
  content: string     // HTML 内容（已从 ProseMirror JSON 转换）
  time?: number       // 更新时间戳（秒）
  floorId: number
}

export interface GululuCollectResult {
  ok: boolean
  items: GululuRawPost[]
  totalFloors: number
  title?: string
  author?: string
  error?: string
  failedFloorNums?: number[]
}

interface DirectoryEntry {
  floorId: number
  floorNum: number
  name: string
}

// ============================================================
// 常量
// ============================================================

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

const API_BASE = 'https://backend.gululu.world'
const BATCH_SIZE = 10          // 每批请求的楼层数
const BATCH_DELAY_MS = 800     // 批间延迟（防限流）
const FETCH_TIMEOUT_MS = 15000

// ============================================================
// URL 解析
// ============================================================

export function parseGululuUrl(url: string): { opusId: number } | null {
  const m = url.match(/\/book\/(\d+)/i)
  if (!m) return null
  const opusId = parseInt(m[1], 10)
  if (!Number.isFinite(opusId) || opusId <= 0) return null
  return { opusId }
}

// ============================================================
// ProseMirror JSON → HTML 转换
// ============================================================

interface PMNode {
  type: string
  attrs?: Record<string, any> | null
  content?: PMNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, any> | null }[]
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[c] as string),
  )
}

function applyMarks(text: string, marks?: { type: string; attrs?: Record<string, any> | null }[]): string {
  if (!marks || marks.length === 0) return text
  let result = text
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        result = `<b>${result}</b>`
        break
      case 'italic':
        result = `<i>${result}</i>`
        break
      case 'underline':
        result = `<u>${result}</u>`
        break
      case 'strike':
        result = `<s>${result}</s>`
        break
      case 'link': {
        const href = mark.attrs?.href || ''
        result = `<a href="${escapeHtml(href)}">${result}</a>`
        break
      }
    }
  }
  return result
}

function renderInlineNodes(nodes: PMNode[]): string {
  let html = ''
  for (const node of nodes) {
    if (node.type === 'text' && node.text) {
      html += applyMarks(node.text, node.marks)
    } else if (node.type === 'hard_break') {
      html += '<br>'
    } else if (node.type === 'image') {
      const src = node.attrs?.src || ''
      if (src) html += `<img src="${escapeHtml(src)}" alt="" />`
    } else if (node.content && node.content.length > 0) {
      html += renderInlineNodes(node.content)
    }
  }
  return html
}

export function proseMirrorToHtml(paragraphContents: PMNode[] | any): string {
  if (!Array.isArray(paragraphContents)) return ''
  const blocks: string[] = []
  for (const node of paragraphContents) {
    if (!node || typeof node !== 'object') continue
    const inner = node.content ? renderInlineNodes(node.content) : ''
    switch (node.type) {
      case 'paragraph':
        blocks.push(`<p>${inner}</p>`)
        break
      case 'heading': {
        const level = Math.min(6, Math.max(1, node.attrs?.level || 1))
        blocks.push(`<h${level}>${inner}</h${level}>`)
        break
      }
      case 'blockquote':
        blocks.push(`<blockquote>${inner}</blockquote>`)
        break
      case 'code_block':
        blocks.push(`<pre><code>${escapeHtml(inner)}</code></pre>`)
        break
      case 'image': {
        const src = node.attrs?.src || ''
        if (src) blocks.push(`<img src="${escapeHtml(src)}" alt="" />`)
        break
      }
      case 'hr':
        blocks.push('<hr />')
        break
      case 'hard_break':
        blocks.push('<br />')
        break
      default:
        // 未知块类型：尝试提取文本内容
        if (inner) blocks.push(`<p>${inner}</p>`)
        break
    }
  }
  return blocks.join('')
}

// ============================================================
// HTTP 请求工具
// ============================================================

async function fetchJson(url: string, options: { method?: string; body?: any } = {}): Promise<{ status: number; json: any }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const fetchOptions: RequestInit = {
      method: options.method || 'GET',
      headers: {
        ...GULULU_HEADERS,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: controller.signal,
    }
    if (options.body !== undefined) {
      fetchOptions.body = JSON.stringify(options.body)
    }
    const res = await fetch(url, fetchOptions)
    const text = await res.text()
    let json: any
    try { json = JSON.parse(text) } catch { json = { _raw: text.slice(0, 500) } }
    return { status: res.status, json }
  } finally {
    clearTimeout(timer)
  }
}

// ============================================================
// 爬虫主逻辑
// ============================================================

interface CollectOptions {
  opusId: number
  startFloor: number
  endFloor: number
  retryFloorNums?: number[]
}

async function collectGululuBook(
  opts: CollectOptions,
  taskId: number,
  getWindow: () => BrowserWindow | null,
  isCancelled: () => boolean,
): Promise<GululuCollectResult> {
  const { opusId, startFloor, endFloor } = opts
  const win = getWindow()

  const sendProgress = (current: number, total: number, phase: string, message: string) => {
    win?.webContents.send('gululu:collect:progress', { taskId, current, total, phase, message })
  }

  sendProgress(0, 0, 'starting', '正在获取作品详情...')

  // 1. 获取作品详情
  const detailRes = await fetchJson(`${API_BASE}/reader/opus/detail/${opusId}`)
  if (detailRes.status !== 200 || !detailRes.json) {
    return { ok: false, items: [], totalFloors: 0, error: `获取作品详情失败: HTTP ${detailRes.status}` }
  }
  const detailData = detailRes.json.data || detailRes.json
  const title = detailData?.name || detailData?.opusName || `骨碌碌-${opusId}`
  const author = detailData?.author?.authorName || detailData?.author?.nickName || '未知'
  const totalFloors = detailData?.floorNum || 0

  if (isCancelled()) return { ok: false, items: [], totalFloors, error: '已取消' }

  // 2. 获取楼层目录
  sendProgress(0, 0, 'fetching', '正在获取楼层目录...')
  const dirRes = await fetchJson(`${API_BASE}/reader/floor/index-list/${opusId}`)
  if (dirRes.status !== 200 || !dirRes.json) {
    return { ok: false, items: [], totalFloors, title, author, error: `获取楼层目录失败: HTTP ${dirRes.status}` }
  }
  const directory: DirectoryEntry[] = dirRes.json.data || dirRes.json || []
  if (!Array.isArray(directory) || directory.length === 0) {
    return { ok: false, items: [], totalFloors, title, author, error: '楼层目录为空' }
  }

  // 3. 按楼层范围裁剪目录
  let targetEntries = directory.filter(
    (d) => d.floorNum >= startFloor && d.floorNum <= endFloor,
  )

  // 3.5 重试模式：仅抓指定 floorNum
  if (opts.retryFloorNums && opts.retryFloorNums.length > 0) {
    const retrySet = new Set(opts.retryFloorNums)
    targetEntries = targetEntries.filter((d) => retrySet.has(d.floorNum))
  }

  if (targetEntries.length === 0) {
    return { ok: false, items: [], totalFloors, title, author, error: '指定范围内无楼层' }
  }

  // 4. 分批获取楼层内容
  const allPosts: GululuRawPost[] = []
  const failedFloorNums: number[] = []
  const total = targetEntries.length

  for (let i = 0; i < targetEntries.length; i += BATCH_SIZE) {
    if (isCancelled()) {
      return { ok: false, items: allPosts, totalFloors, title, author, error: '已取消', failedFloorNums }
    }

    const batch = targetEntries.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(total / BATCH_SIZE)
    sendProgress(i, total, 'fetching', `正在获取第 ${batchNum}/${totalBatches} 批楼层（${batch.length} 层）...`)

    const floorIds = batch.map((b) => b.floorId)
    try {
      const contentRes = await fetchJson(`${API_BASE}/reader/floor/content-by-ids`, {
        method: 'POST',
        body: floorIds,  // 纯数组格式
      })

      if (contentRes.status === 200 && contentRes.json?.code === 200) {
        const floorsData: any[] = contentRes.json.data || []
        for (const floor of floorsData) {
          const html = proseMirrorToHtml(floor.paragraphContents)
          const timeStr = floor.updateTime || floor.createTime || ''
          // 时间格式 "2023-05-28 11:44" → 秒级时间戳
          let time: number | undefined
          if (timeStr) {
            const dt = new Date(timeStr.replace(' ', 'T'))
            if (!isNaN(dt.getTime())) time = Math.floor(dt.getTime() / 1000)
          }
          allPosts.push({
            floor: floor.floorNum,
            author,
            content: html,
            time,
            floorId: floor.id || batch.find((b) => b.floorNum === floor.floorNum)?.floorId || 0,
          })
        }
      } else {
        // 批次失败：记录所有楼层为失败
        for (const b of batch) failedFloorNums.push(b.floorNum)
      }
    } catch {
      for (const b of batch) failedFloorNums.push(b.floorNum)
    }

    // 批间延迟（最后一批不延迟）
    if (i + BATCH_SIZE < targetEntries.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS))
    }
  }

  sendProgress(total, total, 'done', `完成：获取 ${allPosts.length} 层，失败 ${failedFloorNums.length} 层`)

  return {
    ok: true,
    items: allPosts,
    totalFloors,
    title,
    author,
    failedFloorNums: failedFloorNums.length > 0 ? failedFloorNums : undefined,
  }
}

// ============================================================
// 获取书籍信息（自动检测总楼数）
// ============================================================

async function fetchBookInfo(url: string): Promise<{
  ok: boolean
  totalFloors?: number
  title?: string
  author?: string
  error?: string
}> {
  const parsed = parseGululuUrl(url)
  if (!parsed) return { ok: false, error: 'URL 格式不正确，请确认包含 /book/数字' }

  const res = await fetchJson(`${API_BASE}/reader/opus/detail/${parsed.opusId}`)
  if (res.status !== 200 || !res.json) {
    return { ok: false, error: `获取作品详情失败: HTTP ${res.status}` }
  }
  const d = res.json.data || res.json
  return {
    ok: true,
    totalFloors: d?.floorNum || 0,
    title: d?.name || d?.opusName,
    author: d?.author?.authorName || d?.author?.nickName,
  }
}

// ============================================================
// IPC 注册
// ============================================================

interface TaskState {
  cancelled: boolean
}

let currentTaskId = 0
const tasks = new Map<number, TaskState>()

export function registerGululuIpc(getWindow: () => BrowserWindow | null): void {
  // 主抓取通道
  ipcMain.handle('gululu:collect', async (event, payload: {
    url: string
    startFloor: number
    endFloor: number
    retryFloorNums?: number[]
  }) => {
    const parsed = parseGululuUrl(payload.url)
    if (!parsed) {
      return { ok: false, items: [], totalFloors: 0, error: 'URL 格式不正确' } as GululuCollectResult
    }

    const taskId = ++currentTaskId
    const taskState: TaskState = { cancelled: false }
    tasks.set(taskId, taskState)

    try {
      return await collectGululuBook(
        {
          opusId: parsed.opusId,
          startFloor: payload.startFloor,
          endFloor: payload.endFloor,
          retryFloorNums: payload.retryFloorNums,
        },
        taskId,
        getWindow,
        () => taskState.cancelled,
      )
    } finally {
      tasks.delete(taskId)
    }
  })

  // 取消任务
  ipcMain.handle('gululu:collect:cancel', (_e, taskId?: number) => {
    if (taskId !== undefined && tasks.has(taskId)) {
      const state = tasks.get(taskId)!
      state.cancelled = true
    } else {
      // 取消当前任务
      for (const [, state] of tasks) state.cancelled = true
    }
    return { ok: true }
  })

  // 自动检测书籍信息
  ipcMain.handle('gululu:fetchBookInfo', async (_e, url: string) => {
    return await fetchBookInfo(url)
  })
}
