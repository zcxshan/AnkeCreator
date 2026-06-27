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
import fs from 'fs'
import path from 'path'
import type { StoryWithAll, Volume, ChapterWithSections, Section } from '../src/types/story'

// ---- 进度回调类型 ----
export type EpubProgressPhase =
  | 'scanning'
  | 'downloading-images'
  | 'building-html'
  | 'packaging'
  | 'done'
  | 'error'

export interface EpubProgress {
  phase: EpubProgressPhase
  current: number
  total: number
  message: string
  imageProgress?: { current: number; total: number; failed: number }
}

type OnProgress = (p: EpubProgress) => void

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

/** 扫描 HTML 里所有 <img src="...">，返回去重 src 列表 */
function collectImageSrcs(sections: Section[]): string[] {
  const srcs = new Set<string>()
  const imgRe = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi
  for (const sec of sections) {
    if (!sec.content) continue
    let m: RegExpExecArray | null
    while ((m = imgRe.exec(sec.content)) !== null) {
      const src = m[1].trim()
      if (src) srcs.add(src)
    }
  }
  return [...srcs]
}

/**
 * 处理节的 HTML 内容：
 * - 重写 <img src="原URL"> → <img src="../images/img-001.png">
 * - 移除 onerror 内联 JS
 * - dice-block → 静态文本
 * - collapse-block → <details><summary>
 * - image-block div → 普通 img
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
        return `${prefix}${newSrc}${suffix}`
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

  // manifest items
  const manifestItems: string[] = [
    '<item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>',
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="styles/main.css" media-type="text/css"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
  ]
  for (const ch of chapters) {
    manifestItems.push(
      `<item id="${ch.id}" href="text/${ch.id}.xhtml" media-type="application/xhtml+xml"/>`,
    )
  }
  for (const imgId of imageIds) {
    const ext = imgId.split('.').pop() || 'png'
    const mediaType =
      ext === 'jpg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : ext === 'svg' ? 'image/svg+xml' : 'image/png'
    manifestItems.push(
      `<item id="${imgId.replace(/\./g, '_')}" href="images/${imgId}" media-type="${mediaType}"/>`,
    )
  }

  // spine (阅读顺序)
  const spineItems: string[] = ['<itemref idref="cover"/>']
  for (const ch of chapters) {
    spineItems.push(`<itemref idref="${ch.id}"/>`)
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${escapeXml(story.id)}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>zh-CN</dc:language>
    <dc:description>${description}</dc:description>
    <dc:creator>${escapeXml('安科作者助手')}</dc:creator>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${spineItems.join('\n    ')}
  </spine>
</package>`
}

/** 生成 nav.xhtml（EPUB3 导航） */
function buildNavXhtml(story: StoryWithAll, chapters: { id: string; title: string }[]): string {
  const navItems = chapters
    .map((ch) => `<li><a href="text/${ch.id}.xhtml">${escapeXml(ch.title)}</a></li>`)
    .join('\n      ')

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="utf-8"/>
  <title>目录</title>
  <link rel="stylesheet" type="text/css" href="styles/main.css"/>
</head>
<body>
  <nav epub:type="toc">
    <h1>目录</h1>
    <ol>
      <li><a href="text/cover.xhtml">封面</a></li>
      ${navItems}
    </ol>
  </nav>
</body>
</html>`
}

/** 生成 toc.ncx（EPUB2 兼容目录） */
function buildTocNcx(story: StoryWithAll, chapters: { id: string; title: string }[]): string {
  const navPoints = chapters
    .map((ch, i) => `    <navPoint id="${ch.id}" playOrder="${i + 2}">
      <navLabel><text>${escapeXml(ch.title)}</text></navLabel>
      <content src="text/${ch.id}.xhtml"/>
    </navPoint>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${escapeXml(story.id)}"/>
  </head>
  <docTitle><text>${escapeXml(story.title || '未命名作品')}</text></docTitle>
  <navMap>
    <navPoint id="cover" playOrder="1">
      <navLabel><text>封面</text></navLabel>
      <content src="text/cover.xhtml"/>
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
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8"/>
  <title>${title}</title>
  <link rel="stylesheet" type="text/css" href="styles/main.css"/>
</head>
<body class="cover-page">
  <h1 class="cover-title">${title}</h1>
  ${description ? `<p class="cover-description">${description}</p>` : ''}
  <p class="cover-meta">由安科作者助手导出</p>
</body>
</html>`
}

/** 生成章节 XHTML */
function buildChapterXhtml(title: string, content: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles/main.css"/>
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
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

// ---- 主函数 ----

/**
 * 生成 EPUB Buffer
 * @param story 完整作品数据
 * @param onProgress 进度回调
 * @returns EPUB 文件的 Buffer
 */
export async function generateEpub(story: StoryWithAll, onProgress: OnProgress): Promise<Buffer> {
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

  // 2. 扫描所有图片 src
  onProgress({ phase: 'scanning', current: 0, total: 0, message: '正在扫描图片...' })
  const imageSrcs = collectImageSrcs(allSections.map((s) => s.section))

  // 3. 逐个下载/读取图片
  const imageMap = new Map<string, string>() // src → epub内文件名
  const imageBuffers: { filename: string; buffer: Buffer; mediaType: string }[] = []
  let failedCount = 0

  for (let i = 0; i < imageSrcs.length; i++) {
    const src = imageSrcs[i]
    onProgress({
      phase: 'downloading-images',
      current: i + 1,
      total: imageSrcs.length,
      message: `正在下载图片 ${i + 1}/${imageSrcs.length}...`,
      imageProgress: { current: i + 1, total: imageSrcs.length, failed: failedCount },
    })

    const result = await fetchImage(src)
    if (result) {
      const ext = getExtension(result.mediaType)
      const filename = `img-${String(i + 1).padStart(3, '0')}.${ext}`
      imageMap.set(src, `../images/${filename}`)
      imageBuffers.push({ filename, buffer: result.buffer, mediaType: result.mediaType })
    } else {
      failedCount++
      // 失败 → 用占位图（不中断）
      imageMap.set(src, '../images/placeholder.png')
    }
  }

  // 如果有失败的图片，确保占位图被加入
  if (failedCount > 0 && !imageBuffers.find((b) => b.filename === 'placeholder.png')) {
    imageBuffers.push({
      filename: 'placeholder.png',
      buffer: PLACEHOLDER_PNG,
      mediaType: 'image/png',
    })
  }

  // 4. 生成章节 HTML
  onProgress({ phase: 'building-html', current: 0, total: allSections.length, message: '正在生成章节内容...' })

  const chapterEntries: { id: string; title: string; content: string }[] = []
  for (let i = 0; i < allSections.length; i++) {
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
  }

  // 5. 用 jszip 打包
  onProgress({ phase: 'packaging', current: 0, total: 1, message: '正在打包 EPUB...' })

  const zip = new JSZip()
  // mimetype 必须是第一个文件且不压缩
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  // META-INF
  zip.file('META-INF/container.xml', CONTAINER_XML)
  // OEBPS
  const oebps = zip.folder('OEBPS')!
  oebps.file('content.opf', buildContentOpf(story, chapterEntries, imageBuffers.map((b) => b.filename)))
  oebps.file('nav.xhtml', buildNavXhtml(story, chapterEntries))
  oebps.file('toc.ncx', buildTocNcx(story, chapterEntries))
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
    message: `导出完成！共 ${chapterEntries.length} 章，${imageSrcs.length} 张图片（${failedCount} 张失败用占位图替代）`,
    imageProgress: { current: imageSrcs.length, total: imageSrcs.length, failed: failedCount },
  })

  return epubBuffer
}
