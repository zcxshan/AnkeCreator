// 站点搜索结果类型。
// 放在 src/types 下，避免渲染层直接引用 electron 模块（会造成跨编译项目的 TS6307）。

export interface GululuResult {
  title: string
  author: string
  wordCount: string
  wordCountRaw: number // "20.3万字" → 203000，供排序/筛选
  viewCount: string
  viewCountRaw: number // "9.1万" → 91000
  updatedAt: string
  updatedAtRaw: number // "3天前" → 估算时间戳(秒)，越大越新
  publishedAt: string
  publishedAtRaw: number
  url: string
  /** 作品标签（爬虫尽量解析：安科/安价/同人/原创 等） */
  tags?: string[]
  /** 完结状态（爬虫尽量解析） */
  status?: 'ongoing' | 'finished' | 'unknown'
}

export interface NgaResult {
  title: string
  author: string
  floorCount: string
  floorCountRaw: number // "15037" → 15037
  lastReplyAt: string
  lastReplyAtRaw: number
  publishedAt: string
  publishedAtRaw: number // unix 时间戳(秒)
  url: string
  /** 作品标签（爬虫尽量解析：[安科] [安价] [同人] 等） */
  tags?: string[]
  /** 完结状态 */
  status?: 'ongoing' | 'finished' | 'unknown'
}
