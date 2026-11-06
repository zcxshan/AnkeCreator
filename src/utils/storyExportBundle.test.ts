import { describe, expect, it } from 'vitest'
import { exportStoryBundle } from './storyExportBundle'

function makeRepo(count: number, missingId?: string) {
  const sections = Array.from({ length: count }, (_, index) => ({
    id: `s${index}`,
    chapter_id: 'c1',
    title: `第${index + 1}节`,
    order_index: index,
  }))
  return {
    getStoryWithAll: async () => ({
      id: 'story-1',
      title: '导出作品',
      description: '',
      category: '测试',
      cover_gradient: '',
      word_count: 0,
      volumes: [{ id: 'v1', story_id: 'story-1', title: '第一卷', order_index: 0 }],
      chapters: [{ id: 'c1', story_id: 'story-1', volume_id: 'v1', title: '第一章', order_index: 0, sections }],
      sections: [],
      characters: [{ id: 'ch1', story_id: 'story-1', name: '角色' }],
      character_relations: [],
      outlines: [],
      dice_history: [],
    }) as any,
    listSectionMetadata: async () => sections,
    getSectionContent: async (id: string) =>
      id === missingId ? null : `<p>正文-${id}</p>`,
  }
}

describe('exportStoryBundle', () => {
  it('把全部正文收进一个 JSON 并每 50 节回报进度', async () => {
    const messages: Array<{ current: number; total: number; message: string }> = []
    const bundle = await exportStoryBundle(makeRepo(120), 'story-1', {
      onProgress: (progress) => messages.push(progress),
      now: () => new Date('2026-11-05T00:00:00.000Z'),
    })
    expect(bundle.format).toBe('anke-creator-export')
    expect(bundle.version).toBe('1.1')
    expect(bundle.schemaVersion).toBe(2)
    expect(bundle.appVersion).toBe('0.1.0')
    expect(bundle.exportedAt).toBe('2026-11-05T00:00:00.000Z')
    expect(bundle.data.chapters[0].sections).toHaveLength(120)
    expect(bundle.data.chapters[0].sections[119].content).toBe('<p>正文-s119</p>')
    expect(messages.filter((item) => item.current % 50 === 0).map((item) => item.current)).toEqual([50, 100])
    expect(messages[messages.length - 1]).toEqual({
      current: 120,
      total: 120,
      message: '导出完成：120/120 节',
    })
  })

  it('任一节缺少正文时抛出带章节序号的中文错误', async () => {
    const repo = makeRepo(10, 's3')
    await expect(
      exportStoryBundle(repo, 'story-1', {}),
    ).rejects.toThrow('第 4 节「第4节」缺少正文')
  })

  it('把 local:// 图片内嵌为 data URL，且同一张图片只读取一次', async () => {
    const messages: string[] = []
    const reads: string[] = []
    const repo = {
      ...makeRepo(2),
      getSectionContent: async (id: string) => `<img src="local://pic.png" alt="${id}" />`,
    }
    const bundle = await exportStoryBundle(repo, 'story-1', {
      onProgress: (p) => messages.push(p.message),
      readImageAsDataUrl: async (url) => {
        reads.push(url)
        return { ok: true, dataUrl: 'data:image/png;base64,AAAA' }
      },
    })
    expect(reads).toEqual(['local://pic.png'])
    expect(bundle.data.chapters[0].sections[0].content).toBe(
      '<img src="data:image/png;base64,AAAA" alt="s0" />',
    )
    // 两节都引用同一张图，内嵌次数是 2，但只读盘一次
    expect(messages[messages.length - 1]).toBe('导出完成：2/2 节（内嵌 2 张图片）')
  })

  it('图片读取失败时保留原引用并在进度里提示', async () => {
    const messages: string[] = []
    const repo = {
      ...makeRepo(1),
      getSectionContent: async () => '<img src="local://missing.png" />',
    }
    const bundle = await exportStoryBundle(repo, 'story-1', {
      onProgress: (p) => messages.push(p.message),
      readImageAsDataUrl: async () => ({ ok: false, error: '文件不存在' }),
    })
    expect(bundle.data.chapters[0].sections[0].content).toBe('<img src="local://missing.png" />')
    expect(messages[messages.length - 1]).toBe('导出完成：1/1 节（内嵌 0 张图片，1 张读取失败）')
  })

  it('角色头像与大纲正文里的 local:// 图片也内嵌', async () => {
    const base = makeRepo(1)
    const repo = {
      ...base,
      getStoryWithAll: async () => {
        const full = (await base.getStoryWithAll()) as any
        return {
          ...full,
          characters: [{ id: 'ch1', story_id: 'story-1', name: '角色', avatar: 'local://avatar.png' }],
          outlines: [
            { id: 'o1', story_id: 'story-1', content: '<img src="local://o.png" />', order_index: 0 },
          ],
        }
      },
    }
    const reads: string[] = []
    const bundle = await exportStoryBundle(repo, 'story-1', {
      readImageAsDataUrl: async (url) => {
        reads.push(url)
        return { ok: true, dataUrl: 'data:image/png;base64,AAAA' }
      },
    })
    expect(reads.sort()).toEqual(['local://avatar.png', 'local://o.png'])
    expect(bundle.data.characters[0].avatar).toBe('data:image/png;base64,AAAA')
    expect(bundle.data.outlines[0].content).toBe('<img src="data:image/png;base64,AAAA" />')
  })

  it('网络图片不触发本地读取，进度文案保持原样', async () => {
    let reads = 0
    const repo = {
      ...makeRepo(1),
      getSectionContent: async () => '<img src="https://example.com/a.png" />',
    }
    await exportStoryBundle(repo, 'story-1', {
      readImageAsDataUrl: async () => {
        reads += 1
        return { ok: true, dataUrl: 'data:image/png;base64,AAAA' }
      },
    })
    expect(reads).toBe(0)
  })
})
