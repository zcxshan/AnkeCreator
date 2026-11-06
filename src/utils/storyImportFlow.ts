import {
  parseImportText,
  ensureDefaultVolumeAndChapter,
  type EnsureDefaultDeps,
  type EnsureProgressCallback,
  type NormalizedStoryInput,
} from './storyImport'

export interface ImportIdMaps {
  volumeIdMap: Record<string, string>
  chapterIdMap: Record<string, string>
  sectionIdMap: Record<string, string>
}

export interface ImportFlowOptions {
  /** 导入确认弹窗允许用户改标题时覆盖归一化标题 */
  title?: string
}

export interface ImportFlowDeps extends EnsureDefaultDeps {
  createStory: (data: {
    title: string
    description?: string
    category?: string
    cover_gradient?: string
  }) => Promise<{ id: string }>
  afterCreate?: (storyId: string, data: NormalizedStoryInput, maps: ImportIdMaps) => Promise<void>
  recomputeStoryWordCounts?: (storyId: string) => Promise<unknown>
  /** 结构写入失败时清理已创建的作品，避免留下空作品 */
  deleteStory?: (storyId: string) => Promise<unknown>
}

export type ImportFlowResult =
  | { ok: true; storyId: string; maps: ImportIdMaps }
  | { ok: false; error: string }

export async function importStoryFromRawText(
  rawText: string,
  fileName: string,
  deps: ImportFlowDeps,
  onProgress?: EnsureProgressCallback,
  options: ImportFlowOptions = {},
): Promise<ImportFlowResult> {
  const parsed = parseImportText(rawText, fileName)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const title = options.title?.trim() || parsed.data.title
  let story: { id: string }
  try {
    story = await deps.createStory({
      title,
      description: parsed.data.description || undefined,
      category: parsed.data.category || undefined,
      cover_gradient: parsed.data.cover_gradient || undefined,
    })
  } catch (error) {
    return { ok: false, error: `创建作品失败：${(error as Error).message}` }
  }
  // ensureDefaultVolumeAndChapter 在 chapters 存在时只读取 chapters[].sections，
  // 因此把归一化后的扁平 sections 按 chapter_id 重新挂回章节，避免节丢失。
  const chaptersWithSections = parsed.data.chapters.map((chapter) => ({
    ...chapter,
    sections: parsed.data.sections.filter((section) => section.chapter_id === chapter.id),
  }))
  let maps: ImportIdMaps = { volumeIdMap: {}, chapterIdMap: {}, sectionIdMap: {} }
  try {
    const created = await ensureDefaultVolumeAndChapter(
      story.id,
      { ...parsed.data, sections: [], chapters: chaptersWithSections },
      deps,
      onProgress,
    )
    maps = {
      volumeIdMap: created.volumeIdMap,
      chapterIdMap: created.chapterIdMap,
      sectionIdMap: created.sectionIdMap,
    }
    if (deps.afterCreate) await deps.afterCreate(story.id, parsed.data, maps)
  } catch (error) {
    if (deps.deleteStory) {
      try {
        await deps.deleteStory(story.id)
      } catch {
        // 清理失败不覆盖原始导入错误
      }
    }
    return { ok: false, error: `导入结构失败：${(error as Error).message}` }
  }
  if (deps.recomputeStoryWordCounts) await deps.recomputeStoryWordCounts(story.id)
  return { ok: true, storyId: story.id, maps }
}
