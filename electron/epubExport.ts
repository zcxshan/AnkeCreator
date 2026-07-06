// ============================================================
// EPUB 导出核心：将安科作品正文导出为 EPUB 电子书
//
// 流程：
// 1. 取 StoryWithAll 数据（卷→章→节，Section.content 是 HTML 正文）
// 2. 扫描所有节里的 <img src>，收集去重 src 列表
// 3. 逐个下载/读取图片（远端 fetch / 本地 fs / base64 解码）
//    失败 → 用占位图，不中断
// 4. 重写 HTML 里的 img src 为 EPUB 内相对路径
// 5. 处理自定义块（dice-block → 静态文本，collapse-block → <details>）
// 6. 移除 onerror 内联 JS（EPUB 不允许）
// 7. jszip 打包为 EPUB 3 格式
// ============================================================

import JSZip from 'jszip'
import { normalizeImageUrl, classifyImageSrc, type ImageSrcKind } from './imageUrl'
import fs from 'fs'
import path from 'path'
import type { StoryWithAll, Volume, ChapterWithSections, Section } from '../src/types/story'

// ---- 目录树类型（卷→章→节层级）----
interface TocNode {
  /** 章节 xhtml id（如 chapter-001），仅叶节点有 */
  id: string
  /** 显示标题 */
  title: string
  /** 子节点（卷→章→节） */
  children?: TocNode[]
}

// ---- 进度回调类型 ----
export type EpubProgressPhase =
  | 'scanning'
  | 'downloading-images'
  | 'building-html'
  | 'packaging'
  | 'done'
  | 'error'
  | 'canceled'

export interface EpubProgress {
  phase: EpubProgressPhase
  current: number
  total: number
  message: string
  imageProgress?: { current: number; total: number; failed: number }
}

type OnProgress = (p: EpubProgress) => void

// ---- 导出控制（暂停/取消）----

export class EpubExportControl {
  paused = false
  canceled = false
  private _resumeResolve: (() => void) | null = null

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
    if (this._resumeResolve) {
      this._resumeResolve()
      this._resumeResolve = null
    }
  }

  cancel(): void {
    this.canceled = true
    this.paused = false
    if (this._resumeResolve) {
      this._resumeResolve()
      this._resumeResolve = null
    }
  }

  /** 如果被取消，抛出错误；如果被暂停，等待恢复 */
  async checkPoint(): Promise<void> {
    if (this.canceled) {
      throw new Error('EXPORT_CANCELED')
    }
    if (this.paused) {
      await new Promise<void>((resolve) => {
        this._resumeResolve = resolve
      })
      if (this.canceled) {
        throw new Error('EXPORT_CANCELED')
      }
    }
  }
}

// ---- 图片处理 ----

/** 从 src 推断媒体类型 */
function getMediaType(src: string): string {
  const lower = src.toLowerCase().split('?')[0].split('#')[0]
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.startsWith('data:image/png')) return 'image/png'
  if (lower.startsWith('data:image/jpeg')) return 'image/jpeg'
  if (lower.startsWith('data:image/gif')) return 'image/gif'
  if (lower.startsWith('data:image/webp')) return 'image/webp'
  return 'image/png'
}

/** 从 src 推断文件扩展名 */
function getExtension(mediaType: string): string {
  switch (mediaType) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/gif': return 'gif'
    case 'image/webp': return 'webp'
    case 'image/svg+xml': return 'svg'
    default: return 'png'
  }
}

/** 判断是否是 base64 data URL */
function isDataUrl(src: string): boolean {
  return /^data:image\//i.test(src) || /;base64,/i.test(src)
}

/** 判断是否是本地文件路径（需要 fs 读取） */
function isLocalPath(src: string): boolean {
  if (/^local:\/\//i.test(src)) return true
  if (/^file:\/\//i.test(src)) return true
  // Windows 绝对路径
  if (/^[A-Za-z]:[\\/]/.test(src)) return true
  // Unix 绝对路径
  if (/^\/(home|Users|tmp|var|opt|root)\//.test(src)) return true
  return false
}

/** 从本地路径 src 提取文件系统路径 */
function extractLocalPath(src: string): string {
  if (/^file:\/\//i.test(src)) {
    return decodeURIComponent(src.replace(/^file:\/\//i, ''))
  }
  if (/^local:\/\//i.test(src)) {
    // local:// 协议：尝试从 app images 目录读取（可能失败）
    return src.replace(/^local:\/\//i, '')
  }
  return src
}

/**
 * 下载/读取单个图片
 * @returns { buffer: Buffer; mediaType: string } 或 null（失败）
 */
async function fetchImage(src: string): Promise<{ buffer: Buffer; mediaType: string } | null> {
  try {
    // base64 data URL
    if (isDataUrl(src)) {
      const match = src.match(/^data:(image\/[a-z+]+);base64,(.+)$/i)
      if (match) {
        const mediaType = match[1]
        const buffer = Buffer.from(match[2], 'base64')
        return { buffer, mediaType }
      }
      return null
    }

    // 本地文件
    if (isLocalPath(src)) {
      const filePath = extractLocalPath(src)
      if (fs.existsSync(filePath)) {
        const buffer = fs.readFileSync(filePath)
        return { buffer, mediaType: getMediaType(filePath) }
      }
      return null
    }

    // 远端 URL
    if (/^https?:\/\//i.test(src)) {
      const resp = await fetch(src, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        redirect: 'follow',
      })
      if (!resp.ok) return null
      const arrayBuffer = await resp.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const ct = resp.headers.get('content-type') || ''
      const mediaType = ct.startsWith('image/') ? ct.split(';')[0] : getMediaType(src)
      return { buffer, mediaType }
    }

    return null
  } catch {
    return null
  }
}

// ---- HTML 处理 ----

/** 1x1 透明 PNG 占位图 */
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

/** 扫描 HTML 里所有 <img src="...">，返回去重 src 列表
 *  - 用 normalizeImageUrl 规范化 URL（剥离 NGA 签名 token）
 *  - 保留每张规范 URL 对应的「所有原始 URL」用于 HTML 重写
 *  - data: / local: URL 单独收集（用原始 URL 作 key，不需要去重）
 */
function collectImageSrcs(
  sections: Section[],
): {
  normToRaw: Map<string, string> // 规范 URL → 第一个原始 URL（用于下载/读取）
  normToAllRaws: Map<string, string[]> // 规范 URL → 所有原始 URL（用于 HTML 重写）
  rawSrcs: string[] // data: / local: 协议单独存放
} {
  const normToRaw = new Map<string, string>()
  const normToAllRaws = new Map<string, string[]>()
  const rawSrcs: string[] = []
  const imgRe = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi
  for (const sec of sections) {
    if (!sec.content) continue
    let m: RegExpExecArray | null
    while ((m = imgRe.exec(sec.content)) !== null) {
      const raw = m[1].trim()
      if (!raw) continue
      // data: / local: / file: 协议单独收集（不需要去重，每个都是独立的）
      if (/^(data|local|file):/i.test(raw)) {
        rawSrcs.push(raw)
        continue
      }
      // http(s) 走规范化去重
      const norm = normalizeImageUrl(raw)
      if (!norm) continue
      if (!normToRaw.has(norm)) {
        normToRaw.set(norm, raw)
        normToAllRaws.set(norm, [raw])
      } else {
        // 同一规范 URL 的另一个原始 URL（如 NGA 不同 token）→ 累积
        const list = normToAllRaws.get(norm)!
        if (!list.includes(raw)) list.push(raw)
      }
    }
  }
  return { normToRaw, normToAllRaws, rawSrcs }
}

/**
 * 将 HTML 转为 XHTML 合规格式：
 * - void 元素（br, img, hr, input 等）必须自闭合
 * - 移除内联事件处理器
 * - 移除 HTML 注释
 * - 确保属性值用引号包裹
 */
function sanitizeForXhtml(html: string): string {
  let result = html

  // 1. 移除所有内联事件处理器（onclick/onload/onerror/onmouseover 等）
  result = result.replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '')
  result = result.replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '')

  // 2. 移除 HTML 注释
  result = result.replace(/<!--[\s\S]*?-->/g, '')

  // 3. 将 void 元素自闭合：<br> → <br/>, <img ...> → <img .../>, <hr> → <hr/>
  //    void 元素列表：area, base, br, col, embed, hr, img, input, link, meta, source, track, wbr
  const voidTags = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']
  for (const tag of voidTags) {
    // 匹配 <tag ...> 但不匹配已经自闭合的 <tag .../>
    const re = new RegExp(`<(${tag})\\b([^>]*?)(?<!\\/)>`, 'gi')
    result = result.replace(re, (_match, _tagName, attrs) => {
      // 确保属性值用引号包裹
      const cleanAttrs = attrs.replace(/\s*\/?\s*$/, '').trim()
      return `<${tag}${cleanAttrs ? ' ' + cleanAttrs : ''}/>`
    })
  }

  return result
}

/**
 * 处理节的 HTML 内容：
 * - 重写 <img src="原URL"> → <img src="../images/img-001.png"/>
 * - 移除 onerror 等内联 JS
 * - dice-block → 静态文本
 * - collapse-block → <details><summary>
 * - image-block div → 普通 img
 * - XHTML 合规化（自闭合 void 元素等）
 */
function processSectionHtml(html: string, imageMap: Map<string, string>): string {
  let result = html

  // 移除所有 onerror="..." 属性（EPUB 不允许内联 JS）
  result = result.replace(/\sonerror\s*=\s*"[^"]*"/gi, '')
  result = result.replace(/\sonerror\s*=\s*'[^']*'/gi, '')

  // 重写 img src
  result = result.replace(
    /(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi,
    (match, prefix, src, suffix) => {
      const newSrc = imageMap.get(src)
      if (newSrc) {
        // 远端 URL 含查询参数时，& 必须转义为 &amp;（XML/XHTML 要求）
        const escapedSrc = newSrc.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
        return `${prefix}${escapedSrc}${suffix}`
      }
      // 未找到映射 → 用占位图
      return `${prefix}../images/placeholder.png${suffix}`
    },
  )

  // 处理 dice-block：提取 data-payload，转为静态文本
  result = result.replace(
    /<div\b[^>]*data-type=["']dice-block["'][^>]*data-payload=["']([^"']*)["'][^>]*>([\s\S]*?)<\/div>/gi,
    (_match, payload, content) => {
      let label = '🎲 骰子'
      try {
        const data = JSON.parse(decodeURIComponent(payload))
        if (data.expression) label = `🎲 ${data.expression}`
      } catch {
        // ignore
      }
      return `<div style="padding:8px;margin:8px 0;border-left:3px solid #ccc;background:#f5f5f5;">${label}</div>`
    },
  )

  // 处理 collapse-block：转为 <details><summary>
  result = result.replace(
    /<div\b[^>]*data-type=["']collapse-block["'][^>]*data-title=["']([^"']*)["'][^>]*>([\s\S]*?)<\/div>/gi,
    (_match, title, content) => {
      return `<details><summary>${title || '折叠内容'}</summary>${content}</details>`
    },
  )

  // 处理 quote-block → <blockquote>
  result = result.replace(
    /<div\b[^>]*data-type=["']quote-block["'][^>]*>([\s\S]*?)<\/div>/gi,
    '<blockquote>$1</blockquote>',
  )

  // 处理 image-block → 直接保留内部 img（已重写 src）
  result = result.replace(
    /<div\b[^>]*data-type=["']image-block["'][^>]*>([\s\S]*?)<\/div>/gi,
    '$1',
  )

  // 转义正文文本节点中的裸 &（不破坏已有 HTML 标签和实体）
  // 匹配 >文本< 之间的内容，对其中的裸 & 转义为 &amp;
  result = result.replace(/>([^<]+)</g, (match, text) => {
    const escaped = text.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
    return `>${escaped}<`
  })
  // 处理字符串开头/结尾的裸文本（没有 > < 包裹的部分）
  result = result.replace(/^([^<]+)/, (match, text) => {
    return text.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
  })
  result = result.replace(/([^>])$/, (match, text) => {
    return text.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
  })

  // XHTML 合规化（void 元素自闭合、移除内联事件等）
  result = sanitizeForXhtml(result)

  return result
}

/** 转义 XML 特殊字符 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ---- EPUB 结构生成 ----

/** 生成 content.opf（EPUB 清单） */
function buildContentOpf(story: StoryWithAll, chapters: { id: string; title: string }[], imageIds: string[]): string {
  const title = escapeXml(story.title || '未命名作品')
  const description = escapeXml(story.description || '')

  // manifest items（属性用单引号，避免正文双引号嵌套问题）
  const manifestItems: string[] = [
    "<item id='cover' href='text/cover.xhtml' media-type='application/xhtml+xml'/>",
    "<item id='nav' href='nav.xhtml' media-type='application/xhtml+xml' properties='nav'/>",
    "<item id='css' href='styles/main.css' media-type='text/css'/>",
    "<item id='ncx' href='toc.ncx' media-type='application/x-dtbncx+xml'/>",
  ]
  for (const ch of chapters) {
    manifestItems.push(
      `<item id='${ch.id}' href='text/${ch.id}.xhtml' media-type='application/xhtml+xml'/>`,
    )
  }
  for (const imgId of imageIds) {
    const ext = imgId.split('.').pop() || 'png'
    const mediaType =
      ext === 'jpg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : ext === 'svg' ? 'image/svg+xml' : 'image/png'
    manifestItems.push(
      `<item id='${imgId.replace(/\./g, '_')}' href='images/${imgId}' media-type='${mediaType}'/>`,
    )
  }

  // spine (阅读顺序)
  const spineItems: string[] = ["<itemref idref='cover'/>"]
  for (const ch of chapters) {
    spineItems.push(`<itemref idref='${ch.id}'/>`)
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns='http://www.idpf.org/2007/opf' version='3.0' unique-identifier='bookid'>
  <metadata xmlns:dc='http://purl.org/dc/elements/1.1/'>
    <dc:identifier id='bookid'>urn:uuid:${escapeXml(story.id)}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>zh-CN</dc:language>
    <dc:description>${description}</dc:description>
    <dc:creator>${escapeXml('安科作者助手')}</dc:creator>
    <meta property='dcterms:modified'>${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine toc='ncx'>
    ${spineItems.join('\n    ')}
  </spine>
</package>`
}

/** 递归生成 nav.xhtml 的嵌套 <li> 列表项 */
function renderNavNode(node: TocNode, indent: string): string {
  const title = escapeXml(node.title)
  const hasChildren = node.children && node.children.length > 0
  if (!hasChildren) {
    return `${indent}<li><a href='text/${node.id}.xhtml'>${title}</a></li>`
  }
  const childItems = node.children!
    .map((c) => renderNavNode(c, indent + '  '))
    .join('\n')
  return `${indent}<li><a href='text/${node.id}.xhtml'>${title}</a>
${indent}  <ol>
${childItems}
${indent}  </ol>
${indent}</li>`
}

/** 生成 nav.xhtml（EPUB3 导航，层级化） */
function buildNavXhtml(story: StoryWithAll, rootNodes: TocNode[]): string {
  const navItems = rootNodes
    .map((n) => renderNavNode(n, '      '))
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns='http://www.w3.org/1999/xhtml' xmlns:epub='http://www.idpf.org/2007/ops'>
<head>
  <meta charset='utf-8'/>
  <title>目录</title>
  <link rel='stylesheet' type='text/css' href='styles/main.css'/>
</head>
<body>
  <nav epub:type='toc'>
    <h1>目录</h1>
    <ol>
      <li><a href='text/cover.xhtml'>封面</a></li>
      ${navItems}
    </ol>
  </nav>
</body>
</html>`
}

/** 递归生成 toc.ncx 的嵌套 <navPoint> */
let ncxPlayOrder = 1
function renderNcxNode(node: TocNode, indent: string): string {
  ncxPlayOrder++
  const title = escapeXml(node.title)
  const hasChildren = node.children && node.children.length > 0
  if (!hasChildren) {
    return `${indent}<navPoint id='${node.id}' playOrder='${ncxPlayOrder}'>
${indent}  <navLabel><text>${title}</text></navLabel>
${indent}  <content src='text/${node.id}.xhtml'/>
${indent}</navPoint>`
  }
  const childItems = node.children!
    .map((c) => renderNcxNode(c, indent + '  '))
    .join('\n')
  return `${indent}<navPoint id='${node.id}' playOrder='${ncxPlayOrder}'>
${indent}  <navLabel><text>${title}</text></navLabel>
${indent}  <content src='text/${node.id}.xhtml'/>
${childItems}
${indent}</navPoint>`
}

/** 生成 toc.ncx（EPUB2 兼容目录，层级化） */
function buildTocNcx(story: StoryWithAll, rootNodes: TocNode[]): string {
  ncxPlayOrder = 1 // 重置计数器
  const navPoints = rootNodes
    .map((n) => renderNcxNode(n, '    '))
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns='http://www.daisy.org/z3986/2005/ncx/' version='2005-1'>
  <head>
    <meta name='dtb:uid' content='urn:uuid:${escapeXml(story.id)}'/>
  </head>
  <docTitle><text>${escapeXml(story.title || '未命名作品')}</text></docTitle>
  <navMap>
    <navPoint id='cover' playOrder='1'>
      <navLabel><text>封面</text></navLabel>
      <content src='text/cover.xhtml'/>
    </navPoint>
${navPoints}
  </navMap>
</ncx>`
}

/** 生成封面页 */
function buildCoverXhtml(story: StoryWithAll): string {
  const title = escapeXml(story.title || '未命名作品')
  const description = escapeXml(story.description || '')

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns='http://www.w3.org/1999/xhtml'>
<head>
  <meta charset='utf-8'/>
  <title>${title}</title>
  <link rel='stylesheet' type='text/css' href='styles/main.css'/>
</head>
<body class='cover-page'>
  <h1 class='cover-title'>${title}</h1>
  ${description ? `<p class='cover-description'>${description}</p>` : ''}
  <p class='cover-meta'>由安科作者助手导出</p>
</body>
</html>`
}

/** 生成章节 XHTML */
function buildChapterXhtml(title: string, content: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns='http://www.w3.org/1999/xhtml'>
<head>
  <meta charset='utf-8'/>
  <title>${escapeXml(title)}</title>
  <link rel='stylesheet' type='text/css' href='styles/main.css'/>
</head>
<body>
  <h2>${escapeXml(title)}</h2>
  ${content}
</body>
</html>`
}

/** CSS 样式 */
const EPUB_CSS = `body {
  font-family: "Noto Serif SC", "Source Han Serif SC", serif;
  line-height: 1.8;
  margin: 1em;
  color: #333;
}
h1, h2, h3 { color: #222; }
h1.cover-title {
  text-align: center;
  font-size: 2em;
  margin-top: 3em;
  margin-bottom: 1em;
}
.cover-page { text-align: center; }
.cover-description { color: #666; font-style: italic; }
.cover-meta { color: #999; font-size: 0.8em; margin-top: 4em; }
blockquote {
  border-left: 3px solid #ccc;
  margin: 1em 0;
  padding: 0.5em 1em;
  background: #f9f9f9;
  color: #555;
}
details {
  margin: 1em 0;
  padding: 0.5em;
  background: #f5f5f5;
  border-radius: 4px;
}
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; width: 100%; }
td, th { border: 1px solid #ddd; padding: 0.4em 0.8em; }
`

/** META-INF/container.xml */
const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version='1.0' xmlns='urn:oasis:names:tc:opendocument:xmlns:container'>
  <rootfiles>
    <rootfile full-path='OEBPS/content.opf' media-type='application/oebps-package+xml'/>
  </rootfiles>
</container>`

// ---- 主函数 ----

/** EPUB 导出选项 */
export interface EpubExportOptions {
  /** 是否内嵌图片到 EPUB。false = HTML 中保留远程 URL，EPUB 阅读器联网显示 */
  embedImages: boolean
}

const DEFAULT_OPTIONS: EpubExportOptions = {
  embedImages: true,
}

/** 图片处理统计 */
interface ImageStats {
  total: number
  remote: number
  local: number
  data: number
  failed: number
  skipped: number // 远端图但用户选择不内嵌
}

/** 构建带分类信息的进度消息 */
function buildImageProgressMessage(stats: ImageStats, current: number): string {
  const parts: string[] = []
  if (stats.remote > 0) parts.push(`远端 ${stats.remote}`)
  if (stats.local > 0) parts.push(`本地 ${stats.local}`)
  if (stats.data > 0) parts.push(`内嵌 ${stats.data}`)
  if (stats.skipped > 0) parts.push(`跳过 ${stats.skipped}`)
  if (stats.failed > 0) parts.push(`失败 ${stats.failed}`)
  const detail = parts.length > 0 ? `（${parts.join(' · ')}）` : ''
  return `图片 ${current} / ${stats.total}${detail}`
}

/**
 * 生成 EPUB Buffer
 * @param story 完整作品数据
 * @param onProgress 进度回调
 * @param options 导出选项（embedImages: false = 不下载远程图，HTML 保留远程 URL）
 * @param control 可选的暂停/取消控制器
 * @returns EPUB 文件的 Buffer
 */
export async function generateEpub(
  story: StoryWithAll,
  onProgress: OnProgress,
  options: EpubExportOptions = DEFAULT_OPTIONS,
  control?: EpubExportControl,
): Promise<Buffer> {
  // 1. 收集所有节（按卷→章→节顺序）
  const allSections: { section: Section; chapterTitle: string; volumeTitle: string }[] = []
  const volumes: Volume[] = (story.volumes || []).sort((a, b) => a.order_index - b.order_index)
  const looseChapters: ChapterWithSections[] = (story.chapters || []).filter(
    (ch) => !ch.volume_id,
  )
  const sortedChapters = (chapters: ChapterWithSections[]) =>
    [...chapters].sort((a, b) => a.order_index - b.order_index)

  // 有卷的章节
  for (const vol of volumes) {
    const volChapters = sortedChapters(
      (story.chapters || []).filter((ch) => ch.volume_id === vol.id),
    )
    for (const ch of volChapters) {
      for (const sec of [...ch.sections].sort((a, b) => a.order_index - b.order_index)) {
        allSections.push({ section: sec, chapterTitle: ch.title, volumeTitle: vol.title })
      }
    }
  }
  // 无卷的章节
  for (const ch of sortedChapters(looseChapters)) {
    for (const sec of [...ch.sections].sort((a, b) => a.order_index - b.order_index)) {
      allSections.push({ section: sec, chapterTitle: ch.title, volumeTitle: '' })
    }
  }

  // 2. 扫描所有图片 src（规范化去重）
  onProgress({ phase: 'scanning', current: 0, total: 0, message: '正在扫描图片...' })
  await control?.checkPoint()
  const { normToRaw, normToAllRaws, rawSrcs } = collectImageSrcs(
    allSections.map((s) => s.section),
  )

  // 总任务数 = 规范化后的远端/本地图数 + 单独收集的 data/local 图数
  const totalImages = normToRaw.size + rawSrcs.length
  const stats: ImageStats = {
    total: totalImages,
    remote: 0,
    local: 0,
    data: 0,
    failed: 0,
    skipped: 0,
  }

  // 3. 处理图片
  const imageMap = new Map<string, string>() // 原始 src → epub内文件名 或 远程URL（不内嵌时）
  const imageBuffers: { filename: string; buffer: Buffer; mediaType: string }[] = []
  let processedIndex = 0

  // 3a. 处理远端 / 本地图（规范化去重后的）
  for (const [normSrc, rawSrc] of normToRaw.entries()) {
    await control?.checkPoint()
    processedIndex++
    const kind: ImageSrcKind = classifyImageSrc(rawSrc)
    if (kind === 'local') stats.local++
    else if (kind === 'data') stats.data++
    else stats.remote++

    onProgress({
      phase: 'downloading-images',
      current: processedIndex,
      total: totalImages,
      message: buildImageProgressMessage(stats, processedIndex),
      imageProgress: {
        current: processedIndex,
        total: totalImages,
        failed: stats.failed,
      },
    })

    let target: string

    // 「不内嵌图片」模式：远端图直接保留规范 URL，EPUB 阅读器联网显示
    if (!options.embedImages && kind === 'remote') {
      target = normSrc // 保留规范化后的 URL（HTML 里直接用）
      stats.skipped++
    } else {
      const result = await fetchImage(rawSrc)
      if (result) {
        const ext = getExtension(result.mediaType)
        const filename = `img-${String(processedIndex).padStart(3, '0')}.${ext}`
        target = `../images/${filename}`
        imageBuffers.push({ filename, buffer: result.buffer, mediaType: result.mediaType })
      } else {
        stats.failed++
        // 失败 → 用占位图（不中断）
        target = '../images/placeholder.png'
      }
    }

    // 把同一规范 URL 的所有原始 URL 都映射到 target
    // （解决 NGA 不同 token URL 都指向同一图的问题）
    const allRaws = normToAllRaws.get(normSrc) || [rawSrc]
    for (const r of allRaws) {
      imageMap.set(r, target)
    }
  }

  // 3b. 处理 data: / local: / file: 协议图（每个独立，原始 URL 作 key）
  for (const rawSrc of rawSrcs) {
    await control?.checkPoint()
    processedIndex++
    const kind = classifyImageSrc(rawSrc)
    if (kind === 'local') stats.local++
    else if (kind === 'data') stats.data++
    else stats.remote++

    onProgress({
      phase: 'downloading-images',
      current: processedIndex,
      total: totalImages,
      message: buildImageProgressMessage(stats, processedIndex),
      imageProgress: {
        current: processedIndex,
        total: totalImages,
        failed: stats.failed,
      },
    })

    // data: / local: 不受 embedImages 选项影响（始终内嵌）
    const result = await fetchImage(rawSrc)
    if (result) {
      const ext = getExtension(result.mediaType)
      const filename = `img-${String(processedIndex).padStart(3, '0')}.${ext}`
      imageMap.set(rawSrc, `../images/${filename}`)
      imageBuffers.push({ filename, buffer: result.buffer, mediaType: result.mediaType })
    } else {
      stats.failed++
      imageMap.set(rawSrc, '../images/placeholder.png')
    }
  }

  // 如果有失败的图片，确保占位图被加入
  if (stats.failed > 0 && !imageBuffers.find((b) => b.filename === 'placeholder.png')) {
    imageBuffers.push({
      filename: 'placeholder.png',
      buffer: PLACEHOLDER_PNG,
      mediaType: 'image/png',
    })
  }

  // 4. 生成章节 HTML
  onProgress({ phase: 'building-html', current: 0, total: allSections.length, message: '正在生成章节内容...' })
  await control?.checkPoint()

  const chapterEntries: { id: string; title: string; content: string }[] = []
  // 同时构建层级化目录树（卷→章→节）
  // 用 Map 维护卷→章→节 的层级，保持插入顺序
  const volumeMap = new Map<string, { title: string; chapters: Map<string, { title: string; sections: { id: string; title: string }[] }> }>()
  const NO_VOLUME_KEY = '__no_volume__'

  for (let i = 0; i < allSections.length; i++) {
    await control?.checkPoint()
    const { section, chapterTitle, volumeTitle } = allSections[i]
    onProgress({
      phase: 'building-html',
      current: i + 1,
      total: allSections.length,
      message: `正在生成章节 ${i + 1}/${allSections.length}...`,
    })

    const rawContent = section.content || ''
    const processedContent = processSectionHtml(rawContent, imageMap)
    const title = volumeTitle
      ? `${volumeTitle} — ${chapterTitle}：${section.title}`
      : `${chapterTitle}：${section.title}`
    const chapterId = `chapter-${String(i + 1).padStart(3, '0')}`

    chapterEntries.push({
      id: chapterId,
      title,
      content: processedContent,
    })

    // 构建目录树：卷→章→节
    const volKey = volumeTitle || NO_VOLUME_KEY
    const volTitle = volumeTitle || ''
    if (!volumeMap.has(volKey)) {
      volumeMap.set(volKey, { title: volTitle, chapters: new Map() })
    }
    const vol = volumeMap.get(volKey)!
    if (!vol.chapters.has(chapterTitle)) {
      vol.chapters.set(chapterTitle, { title: chapterTitle, sections: [] })
    }
    vol.chapters.get(chapterTitle)!.sections.push({ id: chapterId, title: section.title })
  }

  // 转换为 TocNode[] 树
  const tocNodes: TocNode[] = []
  for (const vol of volumeMap.values()) {
    const chapterNodes: TocNode[] = []
    for (const ch of vol.chapters.values()) {
      chapterNodes.push({
        id: ch.sections[0]?.id || '', // 章节点 id 取第一个节的 id（点击跳转）
        title: ch.title,
        children: ch.sections.map((s) => ({ id: s.id, title: s.title })),
      })
    }
    if (vol.title) {
      // 有卷名：作为卷节点
      tocNodes.push({
        id: chapterNodes[0]?.id || '',
        title: vol.title,
        children: chapterNodes,
      })
    } else {
      // 无卷名：章节点直接作为根节点
      tocNodes.push(...chapterNodes)
    }
  }

  // 5. 用 jszip 打包
  await control?.checkPoint()
  onProgress({ phase: 'packaging', current: 0, total: 1, message: '正在打包 EPUB...' })

  const zip = new JSZip()
  // mimetype 必须是第一个文件且不压缩
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  // META-INF
  zip.file('META-INF/container.xml', CONTAINER_XML)
  // OEBPS
  const oebps = zip.folder('OEBPS')!
  oebps.file('content.opf', buildContentOpf(story, chapterEntries, imageBuffers.map((b) => b.filename)))
  oebps.file('nav.xhtml', buildNavXhtml(story, tocNodes))
  oebps.file('toc.ncx', buildTocNcx(story, tocNodes))
  oebps.file('styles/main.css', EPUB_CSS)
  oebps.file('text/cover.xhtml', buildCoverXhtml(story))
  for (const ch of chapterEntries) {
    oebps.file(`text/${ch.id}.xhtml`, buildChapterXhtml(ch.title, ch.content))
  }
  for (const img of imageBuffers) {
    oebps.file(`images/${img.filename}`, img.buffer)
  }

  const epubBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  onProgress({
    phase: 'done',
    current: 1,
    total: 1,
    message: `导出完成！共 ${chapterEntries.length} 章，${imageBuffers.length} 张图片（${stats.failed} 张失败用占位图替代）`,
    imageProgress: { current: totalImages, total: totalImages, failed: stats.failed },
  })

  return epubBuffer
}
