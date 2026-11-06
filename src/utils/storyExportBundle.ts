// ============================================================
// 单文件导出：把整部作品（含全部正文）收进一个 JSON 对象
//
// 导入端的 normalizeImportPayload 只接受单个 JSON 文件，因此导出端
// 必须把卷/章/节（正文内嵌 content）、角色、关系、大纲、
// 骰子记录统一塞进 data 下。大作品按节读取正文，并每 50 节回报进度；
// 任一节读不到正文时立即抛出带节序号与标题的中文错误，避免导出
// 残缺文件。
// ============================================================

import type { Chapter, SectionMeta, StoryWithAll, Volume } from '../types/story'
import type { CharacterRelation, Character, Outline } from '../types'

export interface ExportSourceStory extends StoryWithAll {
  cover_gradient?: string
  word_count?: number
  character_relations?: CharacterRelation[]
  dice_history?: unknown[]
}

export interface ExportSourceRepository {
  getStoryWithAll(storyId: string): Promise<ExportSourceStory | undefined>
  listSectionMetadata(chapterId: string): Promise<SectionMeta[]>
  getSectionContent(sectionId: string): Promise<string | null>
  /** 人物关系不在 StoryWithAll 中，页面现有实现调用 db.listCharacterRelations(id) */
  listCharacterRelations?: (storyId: string) => Promise<CharacterRelation[]>
}

export interface ExportSection extends SectionMeta {
  content: string
}

export interface ExportChapter extends Chapter {
  sections: ExportSection[]
}

export interface ExportBundle {
  format: 'anke-creator-export'
  version: '1.1'
  schemaVersion: 2
  exportedAt: string
  appVersion: '0.1.0'
  data: {
    title: string
    description: string
    category: string
    word_count: number
    volumes: Volume[]
    chapters: ExportChapter[]
    characters: Character[]
    character_relations: CharacterRelation[]
    outlines: Outline[]
    dice_history: unknown[]
    stats: { word_count: number; section_count: number; chapter_count: number }
  }
}

export interface ExportProgress {
  current: number
  total: number
  message: string
}

export interface ExportOptions {
  onProgress?: (progress: ExportProgress) => void
  diceHistory?: unknown[]
  now?: () => Date
  /**
   * 读取本地图片为 data URL。传入后导出会把正文里的 local:// 图片内嵌进 JSON，
   * 这样换设备/重装后导入仍能看到图片（否则 local:// 只在本机 imagesDir 有效）。
   */
  readImageAsDataUrl?: (url: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>
}

// 只处理 local://（主进程 image:readAsDataUrl 只接受这个协议）
const LOCAL_IMAGE_ATTR_RE = /(src|data-original-src|data-src)=(["'])(local:\/\/[^"']*)\2/gi

interface ImageInlineStats {
  embedded: number
  failed: number
}

async function resolveLocalImageDataUrl(
  url: string,
  read: (url: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>,
  cache: Map<string, string | null>,
): Promise<string | null> {
  let dataUrl = cache.get(url)
  if (dataUrl === undefined) {
    const res = await read(url)
    dataUrl = res?.ok && res.dataUrl ? res.dataUrl : null
    cache.set(url, dataUrl)
  }
  return dataUrl
}

/**
 * 把 HTML 中的 local:// 图片引用替换为 data URL。
 * 同一张图片只读取一次（cache 复用），读取失败则保留原引用并计入 failed。
 */
async function inlineLocalImages(
  html: string,
  read: (url: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>,
  cache: Map<string, string | null>,
  stats: ImageInlineStats,
): Promise<string> {
  // 纯 URL 字段（如角色 avatar）直接整体替换
  const plain = html.trim()
  if (/^local:\/\/[^\s"'<>]+$/i.test(plain)) {
    const dataUrl = await resolveLocalImageDataUrl(plain, read, cache)
    if (dataUrl) {
      stats.embedded += 1
      return dataUrl
    }
    stats.failed += 1
    return html
  }

  const matches = Array.from(html.matchAll(LOCAL_IMAGE_ATTR_RE))
  if (matches.length === 0) return html

  let out = ''
  let last = 0
  for (const match of matches) {
    const [full, attr, quote, url] = match
    const index = match.index ?? 0
    out += html.slice(last, index)
    last = index + full.length

    const dataUrl = await resolveLocalImageDataUrl(url, read, cache)

    if (dataUrl) {
      out += `${attr}=${quote}${dataUrl}${quote}`
      stats.embedded += 1
    } else {
      out += full
      stats.failed += 1
    }
  }
  out += html.slice(last)
  return out
}

/**
 * 递归遍历实体对象，把其中所有字符串字段的 local:// 图片内嵌。
 * 覆盖角色 avatar、世界观/大纲正文等非章节字段。
 */
async function inlineLocalImagesDeep(
  value: unknown,
  read: (url: string) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>,
  cache: Map<string, string | null>,
  stats: ImageInlineStats,
): Promise<unknown> {
  if (typeof value === 'string') {
    return inlineLocalImages(value, read, cache, stats)
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => inlineLocalImagesDeep(item, read, cache, stats)))
  }
  if (value && typeof value === 'object') {
    const entries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(
        async ([key, item]) =>
          [key, await inlineLocalImagesDeep(item, read, cache, stats)] as const,
      ),
    )
    return Object.fromEntries(entries)
  }
  return value
}

export async function exportStoryBundle(
  repo: ExportSourceRepository,
  storyId: string,
  options: ExportOptions = {},
): Promise<ExportBundle> {
  const full = await repo.getStoryWithAll(storyId)
  if (!full) throw new Error(`作品不存在：${storyId}`)
  const total = full.chapters.reduce(
    (sum, chapter) => sum + (Array.isArray(chapter.sections) ? chapter.sections.length : 0),
    0,
  )
  let current = 0
  const chapters: ExportChapter[] = []
  const imageCache = new Map<string, string | null>()
  const imageStats: ImageInlineStats = { embedded: 0, failed: 0 }
  for (const chapter of full.chapters) {
    const metadata = await repo.listSectionMetadata(chapter.id)
    const sections: ExportSection[] = []
    for (const meta of metadata) {
      let content = await repo.getSectionContent(meta.id)
      if (content == null) {
        throw new Error(`第 ${current + 1} 节「${meta.title}」缺少正文`)
      }
      if (options.readImageAsDataUrl) {
        content = await inlineLocalImages(
          content,
          options.readImageAsDataUrl,
          imageCache,
          imageStats,
        )
      }
      current += 1
      const rest = { ...(meta as SectionMeta & { blocks?: unknown; bbcode?: unknown }) } as Record<string, unknown>
      delete rest.blocks
      delete rest.bbcode
      sections.push({ ...(rest as unknown as SectionMeta), content })
      if (current % 50 === 0) {
        options.onProgress?.({
          current,
          total,
          message: `正在读取正文：${current}/${total} 节`,
        })
      }
    }
    chapters.push({ ...(chapter as Chapter), sections })
  }
  const now = options.now ?? (() => new Date())
  const relations = repo.listCharacterRelations
    ? await repo.listCharacterRelations(storyId)
    : (full.character_relations ?? [])
  // 角色头像、大纲正文里的 local:// 图片也要内嵌，否则换机导入后同样丢失
  const inline = async <T>(value: T): Promise<T> => {
    if (!options.readImageAsDataUrl) return value
    return (await inlineLocalImagesDeep(
      value,
      options.readImageAsDataUrl,
      imageCache,
      imageStats,
    )) as T
  }
  const characters = await inline(full.characters as Character[])
  const outlines = await inline(full.outlines as Outline[])

  const imageSummary =
    imageStats.embedded > 0 || imageStats.failed > 0
      ? `（内嵌 ${imageStats.embedded} 张图片${imageStats.failed > 0 ? `，${imageStats.failed} 张读取失败` : ''}）`
      : ''
  options.onProgress?.({
    current,
    total,
    message: `导出完成：${current}/${total} 节${imageSummary}`,
  })
  return {
    format: 'anke-creator-export',
    version: '1.1',
    schemaVersion: 2,
    exportedAt: now().toISOString(),
    appVersion: '0.1.0',
    data: {
      title: full.title,
      description: full.description ?? '',
      category: full.category ?? '',
      word_count: full.word_count ?? 0,
      volumes: full.volumes as Volume[],
      chapters,
      characters,
      character_relations: relations,
      outlines,
      dice_history: options.diceHistory ?? full.dice_history ?? [],
      stats: {
        word_count: full.word_count ?? 0,
        section_count: total,
        chapter_count: chapters.length,
      },
    },
  }
}
