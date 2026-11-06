// electron/__tests__/bundle-to-directory.test.ts
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  migrateAllLegacyBundles,
  migrateStoryBundleToDirectory,
} from '../data-core/bundleToDirectory'
import { readStoryDirectoryAt, writeStoryDirectoryAt } from '../data-core/storyStore'
import {
  getLegacyBundlePath,
  getMigratedBackupPath,
  getStoriesRoot,
  getStoryDir,
} from '../data-core/storyPaths'

let dataDir = ''

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anke-bundle-migrate-'))
  fs.mkdirSync(getStoriesRoot(dataDir), { recursive: true })
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

function legacyBundle() {
  return {
    format: 'anke-creator-story-v2',
    version: '2.0',
    exportedAt: '2026-11-05T00:00:00.000Z',
    story: { id: 's1', title: '迁移作品', created_at: '', updated_at: '' },
    volumes: [{ id: 'v1', story_id: 's1', title: '第一卷', order_index: 0 }],
    chapters: [
      { id: 'c1', story_id: 's1', volume_id: 'v1', title: '第一章', order_index: 0 },
      { id: 'c2', story_id: 's1', volume_id: 'v1', title: '第二章', order_index: 1 },
    ],
    sections: [
      { id: 'sec1', chapter_id: 'c1', title: '第1节', content: '<p>一</p>', order_index: 0 },
      { id: 'sec2', chapter_id: 'c1', title: '第2节', content: '<p>二</p>', order_index: 1 },
      { id: 'sec3', chapter_id: 'c2', title: '第3节', content: '<p>三</p>', order_index: 0 },
    ],
    world_settings: [{ id: 'w1', story_id: 's1', title: '世界', content: '设定' }],
    characters: [{ id: 'ch1', story_id: 's1', name: '角色', variants: '[]' }],
    character_relations: [],
    outlines: [],
    dice_history: [],
    stats: { word_count: 3, section_count: 3, chapter_count: 2 },
  }
}

describe('bundle to directory migration', () => {
  it('迁移前后数量一致并保留正文', () => {
    fs.writeFileSync(getLegacyBundlePath(dataDir, 's1'), JSON.stringify(legacyBundle()))
    const snapshot = vi.fn()
    const result = migrateStoryBundleToDirectory(dataDir, 's1', { createSnapshot: snapshot })
    expect(result).toEqual({
      status: 'migrated',
      counts: { volumes: 1, chapters: 2, sections: 3 },
    })
    expect(snapshot).toHaveBeenCalledTimes(1)
    const dir = readStoryDirectoryAt(getStoryDir(dataDir, 's1'))!
    expect(dir.volumes).toHaveLength(1)
    expect(dir.chapters.list).toHaveLength(2)
    expect(dir.chapters.sections).toHaveLength(3)
    const sectionEnv = JSON.parse(
      fs.readFileSync(path.join(getStoryDir(dataDir, 's1'), 'sections', 'sec1.json'), 'utf-8'),
    )
    expect(sectionEnv.data.content).toBe('<p>一</p>')
    expect(fs.existsSync(getMigratedBackupPath(dataDir, 's1'))).toBe(true)
    expect(fs.existsSync(getLegacyBundlePath(dataDir, 's1'))).toBe(false)
  })

  it('已经在目录中的作品直接跳过', () => {
    fs.writeFileSync(getLegacyBundlePath(dataDir, 's2'), JSON.stringify(legacyBundle()))
    migrateStoryBundleToDirectory(dataDir, 's2')
    const again = migrateStoryBundleToDirectory(dataDir, 's2')
    expect(again.status).toBe('skipped')
  })

  it('解析失败时清理临时目录并保留旧文件', () => {
    fs.writeFileSync(getLegacyBundlePath(dataDir, 's3'), '{broken')
    const result = migrateStoryBundleToDirectory(dataDir, 's3')
    expect(result.status).toBe('failed')
    expect(result.error).toContain('旧作品 JSON 解析失败')
    expect(fs.existsSync(getLegacyBundlePath(dataDir, 's3'))).toBe(true)
    expect(fs.readdirSync(getStoriesRoot(dataDir)).some((name) => name.startsWith('.s3.migrating-'))).toBe(false)
  })

  it('数量校验失败时不提交目录', () => {
    fs.writeFileSync(getLegacyBundlePath(dataDir, 's4'), JSON.stringify(legacyBundle()))
    const result = migrateStoryBundleToDirectory(dataDir, 's4', {
      writeDirectory: (storyRoot, payload) => {
        writeStoryDirectoryAt(storyRoot, {
          ...payload,
          sections: payload.sections.slice(0, 2),
          chapters: {
            ...payload.chapters,
            sections: payload.chapters.sections.slice(0, 2),
          },
        })
      },
    })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('迁移校验失败')
    expect(fs.existsSync(getStoryDir(dataDir, 's4'))).toBe(false)
    expect(fs.existsSync(getLegacyBundlePath(dataDir, 's4'))).toBe(true)
  })

  it('批量迁移返回 migrated / skipped / failed 计数', () => {
    fs.writeFileSync(getLegacyBundlePath(dataDir, 'a'), JSON.stringify(legacyBundle()))
    fs.writeFileSync(getLegacyBundlePath(dataDir, 'b'), '{broken')
    const result = migrateAllLegacyBundles(dataDir)
    expect(result).toMatchObject({ migrated: 1, failed: 1, skipped: 0 })
  })
})
