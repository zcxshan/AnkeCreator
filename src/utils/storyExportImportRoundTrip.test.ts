import { describe, expect, it } from 'vitest'
import { exportStoryBundle } from './storyExportBundle'
import { normalizeImportPayload } from './storyImport'

const DATA_URL = 'data:image/png;base64,AAAA'

function makeRepo() {
  const sections = [
    { id: 's1', chapter_id: 'c1', title: '第一节', order_index: 0 },
    { id: 's2', chapter_id: 'c1', title: '第二节', order_index: 1 },
  ]
  return {
    getStoryWithAll: async () =>
      ({
        id: 'story-1',
        title: '往返测试作品',
        description: '简介',
        category: '测试',
        cover_gradient: '',
        word_count: 0,
        volumes: [{ id: 'v1', story_id: 'story-1', title: '第一卷', order_index: 0 }],
        chapters: [
          {
            id: 'c1',
            story_id: 'story-1',
            volume_id: 'v1',
            title: '第一章',
            order_index: 0,
            sections,
          },
        ],
        sections: [],
        characters: [{ id: 'ch1', story_id: 'story-1', name: '角色', avatar: 'local://avatar.png' }],
        character_relations: [],
        outlines: [{ id: 'o1', story_id: 'story-1', content: `<img src="local://o.png" />`, order_index: 0 }],
        dice_history: [],
      }) as any,
    listSectionMetadata: async () => sections,
    getSectionContent: async (id: string) => `<img src="local://pic.png" alt="${id}" />`,
  }
}

describe('导出 → 导入 往返（单 JSON 内嵌图片）', () => {
  it('导出内嵌的 data URL 图片经 JSON 序列化与导入归一化后仍然保留', async () => {
    const bundle = await exportStoryBundle(makeRepo(), 'story-1', {
      readImageAsDataUrl: async () => ({ ok: true, dataUrl: DATA_URL }),
    })

    // 模拟真实落盘/读盘：导出文件被写成 JSON 文本后再解析回来
    const roundTripped = JSON.parse(JSON.stringify(bundle))

    const result = normalizeImportPayload(roundTripped, '往返测试作品.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.format).toBe('export')
    expect(result.data.title).toBe('往返测试作品')
    expect(result.data.sections).toHaveLength(2)
    expect(result.data.sections[0].content).toContain(`src="${DATA_URL}"`)
    expect(result.data.sections[1].content).toContain(`src="${DATA_URL}"`)
    expect(result.data.sections[0].chapter_id).toBe('c1')

    expect((result.data.characters[0] as { avatar?: string }).avatar).toBe(DATA_URL)
    expect((result.data.outlines[0] as { content?: string }).content).toContain(DATA_URL)
  })

  it('未传入图片读取器时导出保留 local:// 引用，导入后仍能读到原引用', async () => {
    const bundle = await exportStoryBundle(makeRepo(), 'story-1', {})
    const roundTripped = JSON.parse(JSON.stringify(bundle))
    const result = normalizeImportPayload(roundTripped, '作品.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.sections[0].content).toContain('local://pic.png')
    expect((result.data.characters[0] as { avatar?: string }).avatar).toBe('local://avatar.png')
  })
})
