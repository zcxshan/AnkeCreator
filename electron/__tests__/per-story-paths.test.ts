// electron/__tests__/per-story-paths.test.ts
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertSafeStoryId,
  getLegacyBundlePath,
  getMigratedBackupPath,
  getStoryDir,
  getStoryEntityPath,
  getStorySectionPath,
} from '../data-core/storyPaths'

const dataDir = path.join('E:', 'tmp', 'anke-data')

describe('per-story paths', () => {
  it('把作品实体放进 stories/<id>/', () => {
    expect(getStoryDir(dataDir, 'story-1')).toBe(path.join(dataDir, 'stories', 'story-1'))
    expect(getStoryEntityPath(dataDir, 'story-1', 'manifest.json')).toBe(
      path.join(dataDir, 'stories', 'story-1', 'manifest.json'),
    )
    expect(getStorySectionPath(dataDir, 'story-1', 'sec-1')).toBe(
      path.join(dataDir, 'stories', 'story-1', 'sections', 'sec-1.json'),
    )
  })

  it('保留旧单文件与迁移备份路径', () => {
    expect(getLegacyBundlePath(dataDir, 'story-1')).toBe(
      path.join(dataDir, 'stories', 'story-1.json'),
    )
    expect(getMigratedBackupPath(dataDir, 'story-1')).toBe(
      path.join(dataDir, 'stories', 'story-1.json.migrated.bak'),
    )
  })

  it('拒绝路径穿越和空 id', () => {
    expect(() => assertSafeStoryId('../evil')).toThrow('非法的作品 id')
    expect(() => assertSafeStoryId('a/b')).toThrow('非法的作品 id')
    expect(() => assertSafeStoryId('')).toThrow('非法的作品 id')
    expect(assertSafeStoryId('a1_b-2')).toBe('a1_b-2')
  })
})
