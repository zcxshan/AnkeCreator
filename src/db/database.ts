// ============================================================
// 数据库统一入口（re-export 全部 facade）
//
// 拆分到 ./story / ./character / ./world / ./template /
// ./relation / ./outline / ./structure，详见各文件
//
// 对外 API 完全不变：
//   import { listStories, createCharacter, ... } from '@/db/database'
// ============================================================

export * from './index'
