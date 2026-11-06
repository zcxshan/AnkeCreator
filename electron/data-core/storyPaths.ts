// electron/data-core/storyPaths.ts
import * as path from 'node:path'

export const STORY_MANIFEST_FILE = 'manifest.json'
export const STORY_SECTIONS_DIR = 'sections'

export function assertSafeStoryId(storyId: string): string {
  if (!storyId || !/^[A-Za-z0-9_-]+$/.test(storyId)) {
    throw new Error(`非法的作品 id：${storyId}`)
  }
  return storyId
}

export function getStoriesRoot(dataDir: string): string {
  return path.join(dataDir, 'stories')
}

export function getStoryDir(dataDir: string, storyId: string): string {
  return path.join(getStoriesRoot(dataDir), assertSafeStoryId(storyId))
}

export function getStoryEntityPath(dataDir: string, storyId: string, fileName: string): string {
  return path.join(getStoryDir(dataDir, storyId), fileName)
}

export function getStorySectionsDir(dataDir: string, storyId: string): string {
  return path.join(getStoryDir(dataDir, storyId), STORY_SECTIONS_DIR)
}

export function getStorySectionPath(dataDir: string, storyId: string, sectionId: string): string {
  return path.join(
    getStorySectionsDir(dataDir, storyId),
    `${assertSafeStoryId(sectionId)}.json`,
  )
}

export function getLegacyBundlePath(dataDir: string, storyId: string): string {
  return path.join(getStoriesRoot(dataDir), `${assertSafeStoryId(storyId)}.json`)
}

export function getLegacyBundleBakPath(dataDir: string, storyId: string): string {
  return `${getLegacyBundlePath(dataDir, storyId)}.bak`
}

export function getMigratedBackupPath(dataDir: string, storyId: string): string {
  return `${getLegacyBundlePath(dataDir, storyId)}.migrated.bak`
}
