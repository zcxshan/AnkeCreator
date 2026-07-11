/**
 * 作品字数重算器（Fix #3）
 *
 * 背景：
 *   - 数据库 sec.word_count 在写入时（updateSectionContent）使用后端
 *     countWordsInHtml（regex 去标签）计算；该算法会把 dice-card /
 *     image-block 内的文本也计入字数。
 *   - 编辑器选中节时用前端 countWordsFromHtml（DOM TreeWalker）覆盖
 *     sectionStats[s.id].words，不计入 dice-card / image-block。
 *   - 两个算法不一致导致：选中节字数对、卷/章总字数偏大。
 *
 * 本服务用前端算法（与编辑器实时统计一致）重新计算所有节字数并写回 DB。
 * 仅在用户主动点击"重算字数"时调用，不在常规编辑流程触发。
 */

import { countWordsFromHtml } from '../components/pages/WorksListPage'
import { countWordsAndDice } from '../components/pages/EditorPage'
import {
  getSectionContent,
  listSectionMetadata,
  updateSection,
} from '../db/structure'
import * as db from '../db'
import { useStoryStore } from '../store/storyStore'

export interface RecalculateOptions {
  onProgress?: (done: number, total: number) => void
  /** 每批处理多少节后让出主线程（默认 10） */
  batchSize?: number
  /**
   * 是否同时刷新 store 中的 sections（推荐 true，会触发目录树重渲染）
   * 设为 false 时只写 DB，调用方负责刷新 UI
   */
  refreshStore?: boolean
}

export interface RecalculateResult {
  updated: number
  skipped: number
  failed: number
  totalBefore: number
  totalAfter: number
  durationMs: number
}

export interface RecalculateController {
  promise: Promise<RecalculateResult>
  abort: () => void
}

interface AbortError extends Error {
  name: 'AbortError'
}

function makeAbortError(): AbortError {
  const e = new Error('aborted') as AbortError
  e.name = 'AbortError'
  return e
}

/** 让出主线程，避免长任务阻塞 UI */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/**
 * 解析 content（可能是 JSON 旧格式或 HTML 新格式）并返回字数
 * 与编辑器实时统计完全一致
 */
function computeWordsFromContent(content: string | null | undefined): number {
  if (!content) return 0
  // 先尝试 JSON 旧格式（TipTap）
  try {
    const json = JSON.parse(content)
    if (json && typeof json === 'object') {
      return countWordsAndDice(json).words
    }
  } catch {
    // 不是 JSON，走 HTML
  }
  // HTML 新格式（contenteditable）
  return countWordsFromHtml(content).words
}

/**
 * 重算指定作品所有节的字数。
 * - 用前端算法（与编辑器实时统计一致），不计入 dice-card / image-block
 * - 分批异步，每批后让出主线程，避免卡死 UI
 * - 进度通过 onProgress 回调报告
 * - 返回 abort 控制器，调用 abort() 取消
 */
export function recalculateWordCounts(
  storyId: string,
  options: RecalculateOptions = {},
): RecalculateController {
  const { onProgress, batchSize = 10, refreshStore = true } = options
  let aborted = false
  const controller: RecalculateController = {
    abort() {
      aborted = true
    },
    promise: Promise.resolve({ updated: 0, skipped: 0, failed: 0, totalBefore: 0, totalAfter: 0, durationMs: 0 }),
  }

  controller.promise = (async () => {
    const startMs = Date.now()
    if (!storyId) throw new Error('recalculateWordCounts: storyId is required')

    // 收集所有 sections（遍历所有 chapters → sections）
    const chapters = await db.listChapters(storyId)
    const allSectionMetaLists = await Promise.all(
      chapters.map((ch) => listSectionMetadata(ch.id)),
    )
    const sections = allSectionMetaLists.flat().sort((a, b) => a.order_index - b.order_index)
    const total = sections.length

    if (total === 0) {
      return { updated: 0, skipped: 0, failed: 0, totalBefore: 0, totalAfter: 0, durationMs: 0 }
    }

    let updated = 0
    let skipped = 0
    let failed = 0
    let totalBefore = 0
    let totalAfter = 0
    let done = 0

    onProgress?.(0, total)

    for (let i = 0; i < sections.length; i += batchSize) {
      if (aborted) throw makeAbortError()
      const batch = sections.slice(i, i + batchSize)
      for (const sec of batch) {
        if (aborted) throw makeAbortError()
        try {
          totalBefore += sec.word_count || 0
          const content = await getSectionContent(sec.id)
          const newCount = computeWordsFromContent(content)
          if (newCount !== (sec.word_count || 0)) {
            await updateSection(sec.id, { word_count: newCount })
            updated++
          } else {
            skipped++
          }
          totalAfter += newCount
        } catch (e) {
          if ((e as Error).name === 'AbortError') throw e
          failed++
          // 失败时仍计入原值，避免总字数失真
          totalAfter += sec.word_count || 0
          // eslint-disable-next-line no-console
          console.error(`[wordCountRecalc] 失败：${sec.id}`, e)
        } finally {
          done++
        }
      }
      onProgress?.(done, total)
      // 让出主线程
      await yieldToMain()
    }

    // 刷新 store 中的 sections（不重置 activeChapterId / activeSectionId）
    if (refreshStore && updated > 0) {
      try {
        const { activeStoryId, refreshSections } = useStoryStore.getState()
        if (activeStoryId === storyId && typeof refreshSections === 'function') {
          await refreshSections()
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[wordCountRecalc] 刷新 store 失败（不影响 word_count 已写回）', e)
      }
    }

    return {
      updated,
      skipped,
      failed,
      totalBefore,
      totalAfter,
      durationMs: Date.now() - startMs,
    }
  })()

  return controller
}

/**
 * 重算指定章节的 word_count（轻量版，进入章节时自动调用）
 * - 用与编辑器实时统计完全一致的前端算法
 * - 不写 store 也不触发 refreshSections（避免和用户操作冲突）
 * - 完成后只把更新后的 stats 写回 UI（不刷整个目录树）
 */
export async function recalculateChapterWordCount(
  chapterId: string,
): Promise<{ updated: number; totalAfter: number }> {
  if (!chapterId) return { updated: 0, totalAfter: 0 }
  try {
    const sectionMetas = await listSectionMetadata(chapterId)
    if (sectionMetas.length === 0) return { updated: 0, totalAfter: 0 }

    let updated = 0
    let totalAfter = 0
    const newCounts: Record<string, number> = {}
    for (const sec of sectionMetas) {
      try {
        const content = await getSectionContent(sec.id)
        const newCount = computeWordsFromContent(content)
        if (newCount !== (sec.word_count || 0)) {
          await updateSection(sec.id, { word_count: newCount })
          updated++
        }
        newCounts[sec.id] = newCount
        totalAfter += newCount
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        totalAfter += sec.word_count || 0
        // eslint-disable-next-line no-console
        console.error(`[chapterRecalc] 失败：${sec.id}`, e)
      }
    }
    // 精准更新 store 中 sections 的 word_count（避免 refreshSections 全量刷新目录树）
    if (updated > 0) {
      try {
        const state = useStoryStore.getState()
        const updatedSections = state.sections.map(s =>
          newCounts[s.id] != null ? { ...s, word_count: newCounts[s.id] } : s,
        )
        useStoryStore.setState({ sections: updatedSections })
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[chapterRecalc] 刷新 store 失败', e)
      }
    }
    return { updated, totalAfter }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[chapterRecalc] 整体失败', e)
    return { updated: 0, totalAfter: 0 }
  }
}
