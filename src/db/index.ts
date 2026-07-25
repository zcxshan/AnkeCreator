// ============================================================
// 数据库统一入口（re-export 全部 facade）
//
// 对外 API 与原 src/db/database.ts 完全一致：
//   import { listStories, createCharacter, ... } from '@/db'
// ============================================================

export * from './story'
export * from './character'
export * from './world'
export * from './template'
export * from './relation'
export * from './outline'
export * from './structure'
export * from './imageLibrary'
export * from './materialSites'
export { initDatabase } from './shared'
export type { CharacterRelationRow } from './relation'
