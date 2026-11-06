import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  enqueueStoryWrite,
  readStoryDirectoryAt,
  writeStoryDirectoryAt,
  type DirectoryPayload,
} from '../data-core/storyStore'
import { readStoryManifest } from '../data-core/manifest'
import { writeJsonAtomic } from '../data-core/atomicJson'

let root = ''

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'anke-store-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function payload(chapterTitle = '第一章'): DirectoryPayload {
  return {
    story: { id: 's1', title: '作品', updated_at: '2026-11-05T00:00:00.000Z' },
    volumes: [{ id: 'v1', title: '第一卷', story_id: 's1' }],
    chapters: {
      list: [{ id: 'c1', title: chapterTitle, story_id: 's1', volume_id: 'v1' }],
      sections: [{ id: 'sec1', chapter_id: 'c1', title: '第1节', word_count: 3 }],
    },
    world: { world_settings: [], character_relations: [], outlines: [] },
    characters: [],
    dice: { dice_history: [] },
    sections: [{ id: 'sec1', content: '<p>正文</p>', bbcode: null, word_count: 3 }],
  }
}

describe('story directory store', () => {
  it('首次写入生成全部文件和 manifest', () => {
    const written = writeStoryDirectoryAt(root, payload())
    expect(written).toContain('story.json')
    expect(written).toContain('sections/sec1.json')
    expect(written[written.length - 1]).toBe('manifest.json')
    expect(readStoryManifest(root)?.files.story.path).toBe('story.json')
  })

  it('内容不变时只重写 manifest', () => {
    writeStoryDirectoryAt(root, payload())
    const written = writeStoryDirectoryAt(root, payload())
    expect(written).toEqual(['manifest.json'])
  })

  it('只写变化的章文件并递增该文件 generation', () => {
    writeStoryDirectoryAt(root, payload())
    const m1 = readStoryManifest(root)!
    writeStoryDirectoryAt(root, payload('改名后的第一章'))
    const m2 = readStoryManifest(root)!
    expect(m2.generation).toBe(m1.generation + 1)
    expect(m2.files.chapters.generation).toBe(m1.files.chapters.generation + 1)
    expect(m2.files.volumes.generation).toBe(m1.files.volumes.generation)
  })

  it('中途写失败时 manifest 不提交，读取仍返回旧数据', () => {
    writeStoryDirectoryAt(root, payload())
    const before = readStoryManifest(root)!
    expect(() =>
      writeStoryDirectoryAt(root, payload('会失败的新章'), {
        writeAtomic: (file, data, generation) => {
          if (file.endsWith('chapters.json')) throw new Error('模拟磁盘写入失败')
          writeJsonAtomic(file, data, generation)
        },
      }),
    ).toThrow('模拟磁盘写入失败')
    expect(readStoryManifest(root)!.generation).toBe(before.generation)
    expect(readStoryDirectoryAt(root)!.chapters.list[0].title).toBe('第一章')
  })

  it('删除已不存在的节文件', () => {
    writeStoryDirectoryAt(root, payload())
    expect(fs.existsSync(path.join(root, 'sections', 'sec1.json'))).toBe(true)
    const next = payload()
    next.chapters.sections = []
    next.sections = []
    writeStoryDirectoryAt(root, next)
    expect(fs.existsSync(path.join(root, 'sections', 'sec1.json'))).toBe(false)
  })

  it('同一作品的写入按入队顺序执行', async () => {
    const order: number[] = []
    const first = enqueueStoryWrite('s1', async () => {
      await new Promise((r) => setTimeout(r, 20))
      order.push(1)
    })
    const second = enqueueStoryWrite('s1', async () => {
      order.push(2)
    })
    await Promise.all([first, second])
    expect(order).toEqual([1, 2])
  })
})
