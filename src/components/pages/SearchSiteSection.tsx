// ============================================================
// 寻找安科：可复用搜索板块组件
//
// 设计目标：
// - 每个站点（骨碌碌 / NGA）独立使用一个 SearchSiteSection 实例
// - 各自维护搜索状态（keyword / lastKeyword / rawResults / loading / error）
// - 各自维护筛选状态（sort / numericMin / numericMax / status / timeRange / tags）
// - 状态完全隔离，不会出现数据串扰
//
// 搜索逻辑：
// - 关键字未变（且已有缓存结果）→ 不发请求，仅弹 toast 提示
// - 关键字变化 → 发起请求，更新缓存
// - 所有筛选为前端本地筛选，不触发网络请求
// ============================================================

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useToastStore } from '../../store/toastStore'
import { matchText, type MatchMode } from '../../utils/textMatch'
import { formatRelativeTime } from '../../utils/relativeTime'
import { Icon, type IconName } from '../common/Icon'

interface SortOption {
  value: string
  label: string
}

interface FilterConfig {
  /** 数值范围筛选字段（字数 / 楼数） */
  numericRangeField: 'wordCount' | 'floorCount'
  /** 数值范围筛选标签（"字数(万)" / "楼数"） */
  numericRangeLabel: string
  /** 数值放大倍数（字数 ×10000，楼数为 1） */
  numericRangeMultiplier: number
  /** 排序选项 */
  sortOptions: SortOption[]
  /** 默认排序值 */
  defaultSort: string
}

interface SearchResult {
  ok: boolean
  data?: any[]
  error?: string
}

export interface SearchSiteSectionProps<T> {
  /** 站点标识（用于 class 命名等） */
  siteKey: 'gululu' | 'nga'
  /** 板块图标（Lucide IconName） */
  icon: IconName
  /** 板块标题 */
  title: string
  /** 站点信息（如 "gululu.world · 安科轻小说站"） */
  subtitle: string
  /** 搜索框 placeholder */
  placeholder: string
  /**
   * 搜索函数（封装了对应站点的 IPC 调用）
   * 第二个参数为匹配字段：'title' 标题 / 'author' 作者
   * 第三个参数为页码（用于继续搜索/加载更多）
   * 第四个参数为结果条数上限（可选）
   */
  searchFn: (keyword: string, matchField: 'all' | 'title' | 'author', page?: number, limit?: number) => Promise<SearchResult>
  /** 结果卡片渲染函数 */
  renderCard: (item: T, onOpen: (url: string) => void) => React.ReactNode
  /** 站点特有筛选配置 */
  filterConfig: FilterConfig
  /** 打开外链回调 */
  onOpenUrl: (url: string) => void
  /** 是否在挂载时自动加载（骨碌碌 true，NGA false） */
  autoLoadOnMount?: boolean
  /** Tab 平铺布局：移除外层卡片边框/圆角，由外层容器控制布局 */
  flatLayout?: boolean
  /** 是否显示"标题 / 作者"切换器（gululu / NGA 都支持） */
  matchFieldSwitchable?: boolean
  /** 默认匹配字段 */
  defaultMatchField?: 'all' | 'title' | 'author'
  /** 默认搜索结果条数上限（0 或不传表示不限制） */
  defaultSearchCount?: number
}

// 站点结果通用字段（骨碌碌 / NGA 都有这些字段）
interface SiteResultItem {
  title: string
  author: string
  url: string
  tags?: string[]
  status?: 'ongoing' | 'finished' | 'unknown'
  // 数值字段（用于排序 / 筛选）
  wordCountRaw?: number      // 骨碌碌
  viewCountRaw?: number      // 骨碌碌
  updatedAtRaw?: number     // 骨碌碌
  publishedAtRaw?: number   // 骨碌碌 + NGA
  floorCountRaw?: number    // NGA
  lastReplyAtRaw?: number   // NGA
}

export function SearchSiteSection<T extends SiteResultItem>({
  siteKey,
  icon,
  title,
  subtitle,
  placeholder,
  searchFn,
  renderCard,
  filterConfig,
  onOpenUrl,
  autoLoadOnMount = false,
  flatLayout = false,
  matchFieldSwitchable = false,
  defaultMatchField = 'title',
  defaultSearchCount = 0,
}: SearchSiteSectionProps<T>) {
  // ===== 搜索状态（完全独立） =====
  const [keyword, setKeyword] = useState('')
  const [lastKeyword, setLastKeyword] = useState('')
  const [matchField, setMatchField] = useState<'all' | 'title' | 'author'>(defaultMatchField)
  const [lastMatchField, setLastMatchField] = useState<'all' | 'title' | 'author'>(defaultMatchField)
  const [matchMode, setMatchMode] = useState<MatchMode>('exact')
  const [rawResults, setRawResults] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [searchCount, setSearchCount] = useState(defaultSearchCount)

  // ===== 筛选状态（完全独立） =====
  const [sort, setSort] = useState(filterConfig.defaultSort)
  const [numericMin, setNumericMin] = useState(0)
  const [numericMax, setNumericMax] = useState(0)
  const [statusFilter, setStatusFilter] = useState<'all' | 'ongoing' | 'finished' | 'unknown'>('all')
  const [timeRange, setTimeRange] = useState<'all' | '7d' | '30d' | '1y'>('all')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [authorFilter, setAuthorFilter] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const isElectronAvailable = typeof (window as any).electronAPI?.searchAnke !== 'undefined'

  const handleSearch = useCallback(async () => {
    if (!isElectronAvailable) {
      setError('当前环境不支持搜索（需要桌面版）')
      return
    }
    // 空关键词保护：骨碌碌/NGA 空关键词搜索会报错，前端直接拦截
    if (!keyword.trim()) {
      setError('请输入搜索关键词')
      return
    }
    // 去重：关键字 + 匹配字段都未变 + 已有缓存 → 不重爬，仅 toast 提示
    if (keyword === lastKeyword && matchField === lastMatchField && rawResults.length > 0) {
      useToastStore.getState().showToast('关键字未变，已使用上次搜索结果', 'info')
      return
    }
    setLoading(true)
    setError(null)
    setCurrentPage(1)
    try {
      const limit = searchCount > 0 ? searchCount : undefined
      const res = await searchFn(keyword, matchField, 1, limit)
      if (res.ok) {
        setLastKeyword(keyword)
        setLastMatchField(matchField)
        setRawResults((res.data as T[]) || [])
      } else {
        setError(res.error || '搜索失败')
      }
    } catch (e) {
      setError((e as Error).message || '搜索失败')
    } finally {
      setLoading(false)
    }
  }, [keyword, lastKeyword, matchField, lastMatchField, rawResults.length, searchFn, isElectronAvailable, searchCount])

  // 自动加载推荐列表
  useEffect(() => {
    if (!autoLoadOnMount) return
    if (!isElectronAvailable) return
    if (rawResults.length > 0 || lastKeyword !== '') return

    setLoading(true)
    setError(null)
    searchFn('', matchField)
      .then((res: SearchResult) => {
        if (res.ok) {
          setLastKeyword('')
          setLastMatchField(matchField)
          setRawResults((res.data as T[]) || [])
        } else {
          setError(res.error || '加载推荐列表失败')
        }
      })
      .catch((e: any) => {
        setError(e?.message || '加载失败')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [autoLoadOnMount, isElectronAvailable, searchFn, matchField])

  // 本地筛选 + 排序（不触发网络请求）
  const displayedList = useMemo(() => {
    let list = rawResults as T[]
    // 高级文本匹配筛选（fuzzy/regex 模式对标题+作者+标签做本地二次筛选）
    if (matchMode !== 'exact') {
      const pattern = lastKeyword || keyword
      if (pattern) {
        list = list.filter((r) => {
          const haystack = [r.title, r.author, ...(r.tags || [])].join(' ')
          return matchText(haystack, pattern, { mode: matchMode })
        })
      }
    }
    // 数值范围筛选
    if (numericMin > 0) {
      const mult = filterConfig.numericRangeMultiplier
      list = list.filter((r) => {
        const v = filterConfig.numericRangeField === 'wordCount'
          ? (r.wordCountRaw || 0)
          : (r.floorCountRaw || 0)
        return v >= numericMin * mult
      })
    }
    if (numericMax > 0) {
      const mult = filterConfig.numericRangeMultiplier
      list = list.filter((r) => {
        const v = filterConfig.numericRangeField === 'wordCount'
          ? (r.wordCountRaw || 0)
          : (r.floorCountRaw || 0)
        return v <= numericMax * mult
      })
    }
    // 状态筛选
    if (statusFilter !== 'all') {
      list = list.filter((r) => (r.status || 'unknown') === statusFilter)
    }
    // 时间范围筛选
    if (timeRange !== 'all') {
      const now = Math.floor(Date.now() / 1000)
      const dayMap: Record<string, number> = { '7d': 7, '30d': 30, '1y': 365 }
      const days = dayMap[timeRange]
      const cutoff = now - days * 86400
      list = list.filter((r) => {
        const ts = r.updatedAtRaw || r.lastReplyAtRaw || r.publishedAtRaw || 0
        return ts > 0 && ts >= cutoff
      })
    }
    // 作者筛选
    if (authorFilter) {
      list = list.filter((r) => r.author.includes(authorFilter))
    }
    // 标签筛选（多选 = 包含任一）
    if (selectedTags.length > 0) {
      list = list.filter((r) => {
        const tags = r.tags || []
        return selectedTags.some((t) => tags.includes(t))
      })
    }
    // 排序
    switch (sort) {
      case 'word-desc':
        list = [...list].sort((a, b) => (b.wordCountRaw || 0) - (a.wordCountRaw || 0))
        break
      case 'view-desc':
        list = [...list].sort((a, b) => (b.viewCountRaw || 0) - (a.viewCountRaw || 0))
        break
      case 'time-desc':
        list = [...list].sort((a, b) => (b.updatedAtRaw || 0) - (a.updatedAtRaw || 0))
        break
      case 'floor-desc':
        list = [...list].sort((a, b) => (b.floorCountRaw || 0) - (a.floorCountRaw || 0))
        break
      case 'reply-desc':
        list = [...list].sort((a, b) => (b.lastReplyAtRaw || 0) - (a.lastReplyAtRaw || 0))
        break
    }
    return list
  }, [rawResults, sort, numericMin, numericMax, statusFilter, timeRange, authorFilter, selectedTags, filterConfig, matchMode, lastKeyword, keyword])

  // 收集所有可用标签（去重，按出现频次排序，取前 30）
  const allTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of rawResults) {
      for (const t of r.tags || []) {
        counts.set(t, (counts.get(t) || 0) + 1)
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([t]) => t)
  }, [rawResults])

  const hasResults = rawResults.length > 0
  const isCached = keyword === lastKeyword && matchField === lastMatchField && hasResults

  const clearAllFilters = () => {
    setNumericMin(0)
    setNumericMax(0)
    setStatusFilter('all')
    setTimeRange('all')
    setSelectedTags([])
    setAuthorFilter('')
  }

  // 导出当前（已筛选 + 排序后的）搜索结果为 JSON 文件
  const handleExport = useCallback(() => {
    if (displayedList.length === 0) return
    const data = {
      site: siteKey,
      keyword: lastKeyword,
      matchField,
      exportedAt: new Date().toISOString(),
      count: displayedList.length,
      results: displayedList,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${siteKey}-搜索结果-${lastKeyword || '推荐'}-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    useToastStore.getState().showToast(`已导出 ${displayedList.length} 条结果`, 'success')
  }, [displayedList, siteKey, lastKeyword, matchField])

  // 继续搜索：加载下一页结果，追加到已有列表（按 URL 去重）
  const handleLoadMore = useCallback(async () => {
    if (loading || !hasResults) return
    // 骨碌碌按作者搜索不支持分页（POST 接口无 page 参数）
    if (siteKey === 'gululu' && lastMatchField === 'author') {
      useToastStore.getState().showToast('按作者搜索不支持加载更多', 'info')
      return
    }
    // NGA 每次翻 3 页（与 maxPages=3 一致），骨碌碌每次翻 1 页
    const nextPage = siteKey === 'nga' ? currentPage + 3 : currentPage + 1
    setLoading(true)
    setError(null)
    try {
      const limit = searchCount > 0 ? searchCount : undefined
      const res = await searchFn(lastKeyword, lastMatchField, nextPage, limit)
      if (res.ok) {
        const newItems = (res.data as T[]) || []
        setRawResults((prev) => {
          const seen = new Set(prev.map((r) => r.url))
          const merged = [...prev]
          let newCount = 0
          for (const item of newItems) {
            if (!seen.has(item.url)) {
              merged.push(item)
              seen.add(item.url)
              newCount++
            }
          }
          if (newCount === 0) {
            useToastStore.getState().showToast('没有更多结果了', 'info')
          } else {
            useToastStore.getState().showToast(`新增 ${newCount} 条结果`, 'success')
          }
          return merged
        })
        setCurrentPage(nextPage)
      } else {
        setError(res.error || '加载更多失败')
      }
    } catch (e) {
      setError((e as Error).message || '加载更多失败')
    } finally {
      setLoading(false)
    }
  }, [loading, hasResults, currentPage, lastKeyword, lastMatchField, searchFn, siteKey, searchCount])

  return (
    <section
      className={`search-section ${flatLayout ? 'search-section--flat' : 'rounded-xl overflow-hidden'}`}
    >
      {/* 板块头部 */}
      <div className="search-section__header flex items-center gap-3 px-4 py-3 shrink-0">
        <Icon name={icon} size={20} />
        <div className="flex-1 min-w-0">
          <div className="search-section__title text-sm font-semibold">
            {title}
          </div>
          <div className="search-section__subtitle text-xs">
            {subtitle}
            {lastKeyword && ` · 已搜「${lastKeyword || '推荐'}」`}
          </div>
        </div>
        {rawResults.length > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleExport}
              title="导出当前结果为 JSON"
              className="search-export-btn inline-flex items-center gap-1"
            >
              <Icon name="download" size={13} /> 导出
            </button>
            <span className="search-count-badge">
              {rawResults.length}
            </span>
          </div>
        )}
      </div>

      {/* 搜索框（第一行：输入 + 内嵌搜索按钮；第二行：筛选胶囊） */}
      <div className="px-4 py-3 shrink-0 space-y-2">
        <div
          className="flex items-center gap-2 rounded-full overflow-hidden"
          style={{ background: 'var(--an-card)', border: '2px solid var(--an-ink)', padding: 3 }}
        >
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch()
            }}
            placeholder={matchField === 'author' ? '按作者名搜索' : placeholder}
            className="flex-1 px-3 h-9 text-sm outline-none bg-transparent text-[var(--text-primary)]"
          />
          <button
            onClick={handleSearch}
            disabled={loading || !isElectronAvailable}
            className="shrink-0 px-4 h-9 rounded-full text-[13px] font-semibold transition-colors disabled:opacity-50"
            style={{ background: 'var(--an-pink)', color: '#3a2340', border: '2px solid var(--an-ink)' }}
          >
            {loading ? '搜索中…' : isCached ? '重新筛选' : '搜索'}
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* 匹配模式选择器：精确 / 模糊 / 正则 */}
          <select
            value={matchMode}
            onChange={(e) => setMatchMode(e.target.value as MatchMode)}
            className="search-field px-3 h-8 rounded-full text-xs outline-none shrink-0 cursor-pointer"
            title="匹配模式：精确=子串包含；模糊=多关键词且逻辑；正则=JS正则表达式"
          >
            <option value="exact">精确</option>
            <option value="fuzzy">模糊</option>
            <option value="regex">正则</option>
          </select>
          {/* 数量上限输入：0=不限制，控制单次搜索结果条数 */}
          <div
            className="search-count flex items-center gap-1 shrink-0 h-8 px-3 rounded-full"
            title="搜索结果条数上限（0=不限制）"
          >
            <span className="search-count__label text-xs">数量</span>
            <input
              type="number"
              min={0}
              max={500}
              value={searchCount || ''}
              onChange={(e) =>
                setSearchCount(
                  Math.max(0, Math.min(500, parseInt(e.target.value, 10) || 0)),
                )
              }
              className="search-count__input w-12 px-1 text-xs outline-none bg-transparent"
            />
          </div>
          {/* 全部 / 标题 / 作者 切换器 */}
          {matchFieldSwitchable && (
            <div className="search-match-group flex shrink-0 rounded-full overflow-hidden">
              {([
                { key: 'all', label: '全部' },
                { key: 'title', label: '标题' },
                { key: 'author', label: '作者' },
              ] as const).map((m) => (
                <button
                  key={m.key}
                  onClick={() => setMatchField(m.key)}
                  className={`search-match-btn px-3 h-8 text-xs font-medium ${matchField === m.key ? 'is-active' : ''}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 去重提示 */}
      {isCached && (
        <div className="search-cache-hint px-4 py-1.5 text-xs shrink-0 inline-flex items-center gap-1.5">
          <Icon name="lightbulb" size={12} /> 关键字未变，点击「重新筛选」会基于已下载结果筛选，不会重新爬取
        </div>
      )}

      {/* 筛选条 */}
      {hasResults && (
        <div
          className="search-filters px-4 py-2 shrink-0"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="search-select px-2 py-1 rounded-md text-xs outline-none"
            >
              <option value="all">全部状态</option>
              <option value="ongoing">连载中</option>
              <option value="finished">已完结</option>
              <option value="unknown">未知</option>
            </select>
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as any)}
              className="search-select px-2 py-1 rounded-md text-xs outline-none"
            >
              <option value="all">全部时间</option>
              <option value="7d">近 7 天</option>
              <option value="30d">近 30 天</option>
              <option value="1y">近 1 年</option>
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="search-select px-2 py-1 rounded-md text-xs outline-none"
            >
              {filterConfig.sortOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className={`search-filter-toggle px-2 py-1 rounded-md text-xs ${advancedOpen ? 'is-open' : ''}`}
            >
              {advancedOpen ? '收起高级筛选' : '高级筛选'}
            </button>
            <span className="search-meta text-xs ml-auto">
              {displayedList.length} / {rawResults.length} 条
            </span>
          </div>

          {/* 高级筛选面板 */}
          {advancedOpen && (
            <div className="search-advanced mt-2 pt-2 flex items-center gap-2 flex-wrap">
              <span className="search-meta text-xs">{filterConfig.numericRangeLabel}:</span>
              <input
                type="number"
                placeholder="≥"
                value={numericMin || ''}
                onChange={(e) => setNumericMin(e.target.value ? parseInt(e.target.value, 10) : 0)}
                className="search-field w-16 px-2 py-1 rounded-md text-xs outline-none"
              />
              <span className="text-[var(--text-muted)]">—</span>
              <input
                type="number"
                placeholder="≤"
                value={numericMax || ''}
                onChange={(e) => setNumericMax(e.target.value ? parseInt(e.target.value, 10) : 0)}
                className="search-field w-16 px-2 py-1 rounded-md text-xs outline-none"
              />
              <input
                type="text"
                placeholder="筛选作者"
                value={authorFilter}
                onChange={(e) => setAuthorFilter(e.target.value)}
                className="search-field w-32 px-2 py-1 rounded-md text-xs outline-none"
              />
              <button
                onClick={clearAllFilters}
                className="search-ghost-btn px-2 py-1 rounded-md text-xs"
              >
                清空筛选
              </button>
            </div>
          )}

          {/* 标签多选 */}
          {allTags.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              {allTags.map((t) => {
                const active = selectedTags.includes(t)
                return (
                  <button
                    key={t}
                    onClick={() => {
                      setSelectedTags((cur) =>
                        cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t],
                      )
                    }}
                    className={`search-tag px-2 py-0.5 rounded-full text-xs font-medium ${active ? 'is-active' : ''}`}
                  >
                    {t}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* 结果列表区 */}
      <div className={flatLayout ? 'p-2' : 'p-4 max-h-[480px] overflow-y-auto'}>
        {!isElectronAvailable ? (
          <div className="search-empty text-center py-8">
            当前环境不支持搜索（需要桌面版 Electron）
          </div>
        ) : error ? (
          <div
            className="search-error text-center py-8 px-4 rounded-md"
          >
            <span className="inline-flex items-center gap-1"><Icon name="alert" size={14} /> {error}</span>
          </div>
        ) : loading && !hasResults ? (
          <div className="text-center py-12">
            <div className="search-empty__icon"><Icon name="hourglass" size={48} /></div>
            <div className="search-empty text-sm">正在抓取…</div>
          </div>
        ) : !hasResults && lastKeyword === '' && !error ? (
          <div className="text-center py-12">
            <div className="search-empty__icon"><Icon name="search" size={48} /></div>
            <div className="search-empty text-sm mb-1">
              {placeholder.replace(/[（）()]/g, '').split('，')[0]}
            </div>
            <div className="search-empty--muted text-xs">留空关键字可看站点最新内容</div>
          </div>
        ) : !hasResults && lastKeyword !== '' && !error ? (
          <div className="text-center py-12">
            <div className="search-empty__icon"><Icon name="inbox" size={48} /></div>
            <div className="search-empty text-sm mb-1">未找到相关结果</div>
            <div className="search-empty--muted text-xs mt-1">
              关键词"{lastKeyword}"未匹配到任何内容
            </div>
            <button
              onClick={handleSearch}
              className="search-ghost-btn mt-3 px-3 py-1 rounded-md text-xs"
            >
              重新搜索
            </button>
          </div>
        ) : displayedList.length === 0 ? (
          <div className="text-center py-10">
            <div className="search-empty__icon"><Icon name="searchX" size={48} /></div>
            <div className="search-empty--muted">没有符合筛选条件的结果</div>
            <button
              onClick={clearAllFilters}
              className="search-ghost-btn mt-3 px-3 py-1 rounded-md text-xs"
            >
              清空筛选
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {displayedList.map((r, i) => (
              <div key={`${siteKey}-${i}`}>
                {renderCard(r, onOpenUrl)}
              </div>
            ))}
            {/* 继续搜索按钮：追加下一页结果 */}
            <div className="flex justify-center mt-4 mb-2">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loading}
                className="search-more px-6 py-2 rounded-md text-sm font-medium transition-colors"
              >
                {loading
                  ? '加载中…'
                  : `继续搜索（第 ${currentPage + (siteKey === 'nga' ? 3 : 1)} 页）`}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

// ============================================================
// 卡片组件：骨碌碌 + NGA
// ============================================================

import type { GululuResult, NgaResult } from '../../types/search'

export function GululuCard({ item, onOpen }: { item: GululuResult; onOpen: (url: string) => void }) {
  const updatedRelative = formatRelativeTime(item.updatedAtRaw)
  const publishedDate = item.publishedAt || ''
  return (
    <div
      className="result-card p-4 rounded-xl flex gap-3"
      onClick={() => onOpen(item.url)}
    >
      <div
        className="result-cover shrink-0 flex items-center justify-center rounded-xl"
      >
        <span className="inline-flex items-center"><Icon name="book" size={36} /></span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 mb-1.5">
          <div className="result-title flex-1 text-base font-semibold">
            {item.title}
          </div>
          {item.status === 'ongoing' && (
            <span className="result-badge--success shrink-0 px-1.5 py-0.5 rounded text-xs font-medium">
              连载中
            </span>
          )}
          {item.status === 'finished' && (
            <span className="result-badge--indigo shrink-0 px-1.5 py-0.5 rounded text-xs font-medium">
              已完结
            </span>
          )}
        </div>
        {item.tags && item.tags.length > 0 && (
          <div className="flex gap-1 flex-wrap mb-2">
            {item.tags.slice(0, 5).map((t) => (
              <span
                key={t}
                className="result-tag px-1.5 py-0.5 rounded text-xs font-medium"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="result-meta flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1"><Icon name="user" size={12} /> {item.author}</span>
          <span className="inline-flex items-center gap-1"><Icon name="pen" size={12} /> {item.wordCount}</span>
          <span className="inline-flex items-center gap-1"><Icon name="eye" size={12} /> {item.viewCount}</span>
          {updatedRelative && <span className="inline-flex items-center gap-1"><Icon name="refresh" size={12} /> {updatedRelative}更新</span>}
          {publishedDate && <span className="inline-flex items-center gap-1"><Icon name="calendar" size={12} /> 发布于 {publishedDate}</span>}
        </div>
        <div className="mt-2 flex justify-end">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onOpen(item.url)
            }}
            className="an-pill"
            style={{ height: 32, paddingInline: 14 }}
          >
            打开 →
          </button>
        </div>
      </div>
    </div>
  )
}

export function NgaCard({ item, onOpen }: { item: NgaResult; onOpen: (url: string) => void }) {
  return (
    <div
      className="result-card p-4 rounded-xl"
      onClick={() => onOpen(item.url)}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="result-badge--neutral text-xs px-1.5 py-0.5 rounded font-medium"
        >
          NGA · 安科版块
        </span>
        {item.status === 'ongoing' && (
          <span
            className="result-badge--success px-1.5 py-0.5 rounded text-xs font-medium"
          >
            连载中
          </span>
        )}
        {item.status === 'finished' && (
          <span
            className="result-badge--indigo px-1.5 py-0.5 rounded text-xs font-medium"
          >
            已完结
          </span>
        )}
      </div>
      <div className="flex items-start gap-2 mb-1.5">
        <div className="result-title flex-1 text-base font-semibold">
          {item.title}
        </div>
      </div>
      {item.tags && item.tags.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-1.5">
          {item.tags.slice(0, 5).map((t) => (
            <span
              key={t}
              className="result-tag px-1.5 py-0.5 rounded text-xs font-medium"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      <div className="result-meta flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1"><Icon name="user" size={12} /> {item.author}</span>
        <span className="inline-flex items-center gap-1"><Icon name="hash" size={12} /> {item.floorCount} 楼</span>
        {item.lastReplyAt && <span className="inline-flex items-center gap-1"><Icon name="message" size={12} /> 最后回复 {item.lastReplyAt}</span>}
        {item.publishedAt && <span className="inline-flex items-center gap-1"><Icon name="calendar" size={12} /> 发布于 {item.publishedAt}</span>}
      </div>
      <div className="mt-2 flex justify-end">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onOpen(item.url)
          }}
          className="an-pill"
          style={{ height: 32, paddingInline: 14 }}
        >
          打开 →
        </button>
      </div>
    </div>
  )
}
