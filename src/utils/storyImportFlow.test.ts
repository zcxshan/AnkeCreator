import { describe, expect, it } from 'vitest'
import { importStoryFromRawText } from './storyImportFlow'

function makeDeps() {
  const rows = { stories: [] as Array<{ id: string; title: string }>, volumes: [] as any[], chapters: [] as any[], sections: [] as any[] }
  let seq = 0
  return {
    rows,
    createStory: async (data: { title: string }) => {
      const row = { id: `story-${++seq}`, title: data.title }
      rows.stories.push(row)
      return row
    },
    createVolume: async (data: any) => {
      const row = { id: `vol-${++seq}`, ...data }
      rows.volumes.push(row)
      return row
    },
    createChapter: async (data: any) => {
      const row = { id: `ch-${++seq}`, ...data }
      rows.chapters.push(row)
      return row
    },
    createSection: async (data: any) => {
      const row = { id: `sec-${++seq}`, ...data }
      rows.sections.push(row)
      return row
    },
  }
}

describe('importStoryFromRawText', () => {
  it('从 export 包裹导入并补齐卷章', async () => {
    const deps = makeDeps()
    const raw = JSON.stringify({
      format: 'anke-creator-export',
      version: '1.1',
      data: {
        title: '导入作品',
        sections: [{ title: '第1节', content: '<p>正文</p>' }],
      },
    })
    const result = await importStoryFromRawText(raw, 'export.json', deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(deps.rows.stories).toHaveLength(1)
    expect(deps.rows.volumes).toHaveLength(1)
    expect(deps.rows.chapters).toHaveLength(1)
    expect(deps.rows.sections).toHaveLength(1)
    expect(deps.rows.sections[0].content).toBe('<p>正文</p>')
    expect(deps.rows.sections[0].chapter_id).toBe(deps.rows.chapters[0].id)
  })

  it('chapters 已存在时扁平 sections 仍全部落库', async () => {
    const deps = makeDeps()
    const raw = JSON.stringify({
      format: 'anke-creator-export',
      version: '1.1',
      data: {
        title: '章节优先',
        volumes: [{ id: 'v1', title: '第一卷', order_index: 0 }],
        chapters: [{ id: 'c1', volume_id: 'v1', title: '第一章', order_index: 0 }],
        sections: [{ id: 's1', chapter_id: 'c1', title: '第1节', content: '<p>正文</p>' }],
      },
    })
    const result = await importStoryFromRawText(raw, 'chapters.json', deps)
    expect(result.ok).toBe(true)
    expect(deps.rows.sections).toHaveLength(1)
    expect(deps.rows.sections[0].chapter_id).toBe(deps.rows.chapters[0].id)
  })

  it('损坏 JSON 返回中文错误且不建作品', async () => {
    const deps = makeDeps()
    const result = await importStoryFromRawText('{broken', 'broken.json', deps)
    expect(result).toEqual({ ok: false, error: '文件不是合法的 JSON：broken.json' })
    expect(deps.rows.stories).toHaveLength(0)
  })
})
