// ============================================================
// 数据库统一入口（re-export 全部 facade）
//
// 对外 API 与原 src/db/database.ts 完全一致：
//   import { listStories, createCharacter, ... } from '@/db'
// ============================================================

import { createBrowserRepository, createElectronRepository } from './repository'

export * from './story'
export * from './character'
export * from './template'
export * from './relation'
export * from './outline'
export * from './structure'
export * from './imageLibrary'
export * from './materialSites'
export { initDatabase } from './shared'
export type { CharacterRelationRow } from './relation'

// 统一仓储接口（三后端适配器）
export {
  createBrowserRepository,
  createElectronRepository,
  createMemoryRepository,
  type StoryRepository,
} from './repository'

export function getStoryRepository(): import('./repository').StoryRepository {
  if (typeof window !== 'undefined' && window.dbAPI) {
    return createElectronRepository(window.dbAPI)
  }
  return createBrowserRepository()
}
