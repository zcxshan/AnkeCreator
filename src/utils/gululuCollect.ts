// ============================================================
// 骨碌碌安科收集：调 IPC 爬取 → 拼接 anke-creator-export JSON
//
// 与 NGA 收集（ankeCollect.ts）的差异：
// - 内容已是 HTML（ProseMirror JSON 在 electron 侧已转换），无需 bbcodeToHtml
// - 楼层无独立作者（统一用作品作者）
// - URL 格式：/book/{opusId}（非 ?tid=）
// - 无需 Cookie / authorid
// ============================================================

import type { RawPost } from './ngaCrawler'
import {
  splitPostsIntoSections,
  insertPlaceholderPosts,
  formatPostTime,
  stripImageBlocks,
  type SectionMode,
  type FormatSettings,
  type ManualFormatConfig,
  DEFAULT_FORMAT_SETTINGS,
  type Section,
  buildManualFormatJson,
} from './ankeCollect'

// ============================================================
// 类型定义
// ============================================================

export interface GululuRawPost {
  floor: number
  author: string
  content: string     // HTML 内容
  time?: number
  floorId?: number
}

export interface GululuCollectOptions {
  url: string
  startFloor: number
  endFloor: number
  workTitle?: string
  sectionMode?: SectionMode
  floorsPerSection?: number
  formatSettings?: FormatSettings
  manualFormat?: ManualFormatConfig
  retryFloorNums?: number[]
  existingItems?: GululuRawPost[]
}

export interface GululuCollectResult {
  ok: boolean
  error?: string
  jsonData?: unknown
  fileName?: string
  stats?: { totalFloors: number; sectionCount: number }
  failedFloorNums?: number[]
  items?: GululuRawPost[]
}

// ============================================================
// URL 解析（与 electron/gululuCrawler.ts 保持一致）
// ============================================================

export function parseGululuUrl(url: string): { opusId: number } | null {
  const m = url.match(/\/book\/(\d+)/i)
  if (!m) return null
  const opusId = parseInt(m[1], 10)
  if (!Number.isFinite(opusId) || opusId <= 0) return null
  return { opusId }
}

// ============================================================
// 骨碌碌专用 section HTML 构建
// ============================================================

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

/**
 * 骨碌碌一节内容：每楼前加 h4 小标题"—— 第 X 节 · 时间 ——" + 楼间虚线 <hr>。
 * 与 NGA 的 buildSectionHtml 差异：
 * - 不调 bbcodeToHtml（内容已是 HTML）
 * - 标题用"第 X 节"（无 @作者，骨碌碌楼层无独立作者）
 */
function buildGululuSectionHtml(posts: GululuRawPost[]): string {
  const blocks = posts.map((p) => {
    const inner = stripImageBlocks(p.content)
    const timeStr = formatPostTime(p.time)
    const header = timeStr
      ? `—— 第 ${p.floor} 节 · ${timeStr} ——`
      : `—— 第 ${p.floor} 节 ——`
    return `<h4 style="margin: 12px 0 8px; color: var(--accent); font-size: 14px; font-weight: 600;">${header}</h4>${inner}`
  })
  return blocks.join(
    '<hr style="border:none; border-top:1px dashed var(--border-color); margin:16px 0;" />',
  )
}

/**
 * 把骨碌碌 posts 切成多个 section
 * 复用 splitPostsIntoSections 的切分逻辑，但用 buildGululuSectionHtml 构建 content
 */
function splitGululuPostsIntoSections(
  posts: GululuRawPost[],
  mode: SectionMode,
  n: number = 10,
): Section[] {
  if (posts.length === 0) return []

  const groups: GululuRawPost[][] = []
  if (mode === 'single') {
    groups.push(posts)
  } else if (mode === 'one-per-floor') {
    for (const p of posts) groups.push([p])
  } else {
    const step = Math.max(1, Math.floor(n))
    for (let i = 0; i < posts.length; i += step) {
      groups.push(posts.slice(i, i + step))
    }
  }

  return groups.map((g, i) => {
    const startF = g[0].floor
    const endF = g[g.length - 1].floor
    const inner = buildGululuSectionHtml(g)
    const content = g.length > 1
      ? `<div class="anke-section">${inner}</div>`
      : inner
    return {
      title: g.length === 1
        ? `第 ${startF} 节`
        : `第 ${startF}-${endF} 节`,
      order_index: i,
      content,
      posts: g as unknown as RawPost[],
    }
  })
}

// ============================================================
// 主入口：爬取 → 切分 → 拼作品 JSON
// ============================================================

export async function collectGululuToWorkJson(
  opts: GululuCollectOptions,
): Promise<GululuCollectResult> {
  // 1. 解析 URL
  const parsed = parseGululuUrl(opts.url)
  if (!parsed) {
    return { ok: false, error: 'URL 格式不正确，请确认包含 /book/数字' }
  }

  // 2. 楼层范围校验
  if (
    !Number.isFinite(opts.startFloor) ||
    !Number.isFinite(opts.endFloor) ||
    opts.startFloor < 1 ||
    opts.endFloor < opts.startFloor
  ) {
    return { ok: false, error: '楼层范围不合法' }
  }

  // 3. 调主进程 IPC
  const collectRes = await (window as any).electronAPI?.collectGululu?.({
    url: opts.url,
    startFloor: opts.startFloor,
    endFloor: opts.endFloor,
    ...(opts.retryFloorNums && opts.retryFloorNums.length > 0
      ? { retryFloorNums: opts.retryFloorNums }
      : {}),
  })

  if (!collectRes || !collectRes.ok) {
    return { ok: false, error: collectRes?.error || '抓取失败：主进程不可用' }
  }

  let posts: GululuRawPost[] = collectRes.items || []

  // 4. 楼层范围裁剪
  posts = posts.filter(
    (p) => p.floor >= opts.startFloor && p.floor <= opts.endFloor,
  )

  // 5. 按 floor 去重
  const seenFloors = new Set<number>()
  posts = posts.filter((p) => {
    if (seenFloors.has(p.floor)) return false
    seenFloors.add(p.floor)
    return true
  })

  // 6. 重试模式补齐
  if (opts.existingItems && opts.existingItems.length > 0) {
    const newFloors = new Set(posts.map((p) => p.floor))
    const leftovers = opts.existingItems.filter((p) => !newFloors.has(p.floor))
    posts = [...posts, ...leftovers]
  }

  // 7. 排序
  posts.sort((a, b) => a.floor - b.floor)

  // 7.5 补齐缺失楼层占位
  posts = insertPlaceholderPosts(posts as unknown as RawPost[], opts.startFloor, opts.endFloor) as unknown as GululuRawPost[]

  if (posts.length === 0) {
    return { ok: false, error: '指定范围内无内容' }
  }

  // 8. 拼作品 JSON
  const finalTitle = opts.workTitle?.trim() || collectRes.title || `骨碌碌-${parsed.opusId}`
  const baseData = {
    format: 'anke-creator-export' as const,
    version: '1.1',
    exportedAt: new Date().toISOString(),
    appVersion: '0.1.0',
  }
  const baseMeta = {
    title: finalTitle,
    description: `源：骨碌碌 opusId=${parsed.opusId}，第 ${opts.startFloor}-${opts.endFloor} 节`,
    category: '安科',
  }

  let jsonData: unknown
  let sectionCount: number

  if (opts.manualFormat?.enabled && opts.manualFormat.volumes.length > 0) {
    // 交互式高级格式：按用户指定的卷/章/节 + 楼号范围切分（共享逻辑，NGA/骨碌碌共用）
    const result = buildManualFormatJson({
      manualFormat: opts.manualFormat,
      posts: posts as unknown as RawPost[],
      buildSectionHtml: (secPosts) => buildGululuSectionHtml(secPosts as unknown as GululuRawPost[]),
      baseData,
      baseMeta,
    })
    sectionCount = result.sectionCount
    jsonData = result.jsonData
  } else {
    // 默认切分
    const sections = splitGululuPostsIntoSections(
      posts,
      opts.sectionMode ?? 'every-n',
      opts.floorsPerSection ?? 10,
    )
    sectionCount = sections.length
    const fmt: FormatSettings = { ...DEFAULT_FORMAT_SETTINGS, ...(opts.formatSettings || {}) }
    const volIndex = 1
    const chapterIndex = 1
    const volumeTitle = fmt.volumeTitleFormat
      .replace(/\{volIndex\}/g, String(volIndex))
      .replace(/\{chapterIndex\}/g, String(chapterIndex))
    const chapterTitle = fmt.chapterTitleFormat
      .replace(/\{volIndex\}/g, String(volIndex))
      .replace(/\{chapterIndex\}/g, String(chapterIndex))
    jsonData = {
      ...baseData,
      data: {
        ...baseMeta,
        volumes: [{ id: 'vol-default', title: volumeTitle, order_index: 0 }],
        chapters: [{
          title: chapterTitle,
          volume_id: 'vol-default',
          order_index: 0,
          sections: sections.map((s) => {
            const startF = s.posts[0]?.floor ?? 0
            const endF = s.posts[s.posts.length - 1]?.floor ?? 0
            const sectionTitle = fmt.sectionTitleFormat
              .replace(/\{startFloor\}/g, String(startF))
              .replace(/\{endFloor\}/g, String(endF))
              .replace(/\{volIndex\}/g, String(volIndex))
              .replace(/\{chapterIndex\}/g, String(chapterIndex))
            const rangeLine = fmt.sectionContentRangeFormat
              ? `<p class="anke-section-range">${fmt.sectionContentRangeFormat
                  .replace(/\{startFloor\}/g, String(startF))
                  .replace(/\{endFloor\}/g, String(endF))}</p>\n\n`
              : ''
            return { title: sectionTitle, order_index: s.order_index, content: rangeLine + s.content }
          }),
        }],
        characters: [],
        world_settings: [],
        outlines: [],
        character_relations: [],
        dice_history: [],
      },
    }
  }

  const safeTitle = finalTitle.replace(/[\/:*?"<>|]/g, '_')
  return {
    ok: true,
    jsonData,
    fileName: safeTitle,
    stats: { totalFloors: posts.length, sectionCount },
    failedFloorNums: collectRes.failedFloorNums,
    items: posts,
  }
}
