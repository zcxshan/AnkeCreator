// ============================================================
// 寻找安科页面
// 双 tab 面板：骨碌碌（gululu.world）+ NGA 安科版块（fid=784）
// 桌面端：走 Electron 主进程爬虫真实抓取
// 安卓版：显示"该功能仅桌面版可用"
//
// 核心逻辑：
// - 每个 tab 独立搜索状态（lastKeyword + rawResults 缓存）
// - 关键字未变 → 不重爬，仅本地筛选/排序（useMemo 即时响应）
// - 关键字变了 → 重新爬取，更新缓存
// ============================================================

import { useState, useCallback, useMemo } from 'react'
import { isCapacitor } from '../../utils/platform'
import type { GululuResult, NgaResult } from '../../../electron/searchAnke'

interface FindAnkePageProps {
  onBack: () => void
}

type Tab = 'gululu' | 'nga'

// 每个 tab 独立搜索状态
interface TabSearchState<T> {
  lastKeyword: string
  rawResults: T[]
}

type GululuSort = 'default' | 'word-desc' | 'view-desc' | 'time-desc'
type NgaSort = 'default' | 'floor-desc' | 'reply-desc'

export function FindAnkePage({ onBack }: FindAnkePageProps) {
  const [tab, setTab] = useState<Tab>('gululu')
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 每个 tab 独立的搜索缓存
  const [gululuState, setGululuState] = useState<TabSearchState<GululuResult>>({ lastKeyword: '', rawResults: [] })
  const [ngaState, setNgaState] = useState<TabSearchState<NgaResult>>({ lastKeyword: '', rawResults: [] })

  // 本地筛选状态（不触发爬取）
  const [gululuSort, setGululuSort] = useState<GululuSort>('default')
  const [minWordCount, setMinWordCount] = useState(0)
  const [authorFilter, setAuthorFilter] = useState('')
  const [ngaSort, setNgaSort] = useState<NgaSort>('default')
  const [ngaAuthorFilter, setNgaAuthorFilter] = useState('')

  const isElectronAvailable =
    typeof (window as any).electronAPI?.searchAnke !== 'undefined'

  const openUrl = useCallback((url: string) => {
    const api = (window as any).electronAPI
    if (api?.openExternal) {
      api.openExternal(url)
    } else {
      window.open(url, '_blank')
    }
  }, [])

  const handleSearch = useCallback(async () => {
    const api = (window as any).electronAPI
    if (!api?.searchAnke) {
      setError('当前环境不支持搜索（需要桌面版）')
      return
    }

    // 关键字未变 → 不重爬，仅本地筛选（useMemo 会自动更新）
    if (tab === 'gululu' && keyword === gululuState.lastKeyword) return
    if (tab === 'nga' && keyword === ngaState.lastKeyword) return

    setLoading(true)
    setError(null)
    try {
      if (tab === 'gululu') {
        const res = await api.searchAnke.gululu(keyword)
        if (res.ok) {
          setGululuState({ lastKeyword: keyword, rawResults: res.data || [] })
        } else {
          setError(res.error || '骨碌碌搜索失败')
        }
      } else {
        const res = await api.searchAnke.ngaAnke(keyword)
        if (res.ok) {
          setNgaState({ lastKeyword: keyword, rawResults: res.data || [] })
        } else {
          setError(res.error || 'NGA 搜索失败')
        }
      }
    } catch (e) {
      setError((e as Error).message || '搜索失败')
    } finally {
      setLoading(false)
    }
  }, [tab, keyword, gululuState.lastKeyword, ngaState.lastKeyword])

  // 骨碌碌：本地筛选 + 排序
  const displayedGululu = useMemo(() => {
    let list = gululuState.rawResults
    if (minWordCount > 0) {
      list = list.filter((r) => r.wordCountRaw >= minWordCount * 10000)
    }
    if (authorFilter) {
      list = list.filter((r) => r.author.includes(authorFilter))
    }
    switch (gululuSort) {
      case 'word-desc':
        list = [...list].sort((a, b) => b.wordCountRaw - a.wordCountRaw)
        break
      case 'view-desc':
        list = [...list].sort((a, b) => b.viewCountRaw - a.viewCountRaw)
        break
      case 'time-desc':
        list = [...list].sort((a, b) => b.updatedAtRaw - a.updatedAtRaw)
        break
    }
    return list
  }, [gululuState.rawResults, gululuSort, minWordCount, authorFilter])

  // NGA：本地筛选 + 排序
  const displayedNga = useMemo(() => {
    let list = ngaState.rawResults
    if (ngaAuthorFilter) {
      list = list.filter((r) => r.author.includes(ngaAuthorFilter))
    }
    switch (ngaSort) {
      case 'floor-desc':
        list = [...list].sort((a, b) => b.floorCountRaw - a.floorCountRaw)
        break
      case 'reply-desc':
        list = [...list].sort((a, b) => b.lastReplyAtRaw - a.lastReplyAtRaw)
        break
    }
    return list
  }, [ngaState.rawResults, ngaSort, ngaAuthorFilter])

  // 安卓版：仅桌面版可用提示
  if (isCapacitor) {
    return (
      <div
        className="flex flex-col h-full"
        style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
      >
        <div
          className="flex items-center gap-3 px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--border-color)' }}
        >
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium"
            style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)' }}
          >
            ← 返回
          </button>
          <span style={{ fontSize: '20px' }}>🔍</span>
          <h1 className="text-lg font-semibold m-0">寻找安科</h1>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <div
            className="text-center max-w-md p-8 rounded-2xl"
            style={{
              background: 'var(--bg-card)',
              border: '1px dashed var(--border-color)',
            }}
          >
            <div className="text-5xl mb-4">💻</div>
            <h2
              className="text-xl font-semibold mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              该功能仅桌面版可用
            </h2>
            <p
              className="text-sm leading-relaxed m-0"
              style={{ color: 'var(--text-secondary)' }}
            >
              寻找安科需要在 Windows 桌面版使用，安卓版暂不支持。
            </p>
          </div>
        </div>
      </div>
    )
  }

  const hasGululuResults = gululuState.rawResults.length > 0
  const hasNgaResults = ngaState.rawResults.length > 0

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      {/* 顶栏 */}
      <div
        className="flex items-center gap-3 px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border-color)' }}
      >
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
        >
          ← 返回
        </button>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: '20px' }}>🔍</span>
          <h1 className="text-lg font-semibold m-0">寻找安科</h1>
        </div>
      </div>

      {/* Tab 栏 */}
      <div
        className="shrink-0 flex"
        style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-card)' }}
      >
        {([
          { key: 'gululu', label: '🌐 骨碌碌' },
          { key: 'nga', label: '🎮 NGA' },
        ] as const).map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex-1 py-2.5 text-sm font-medium transition-colors"
              style={{
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                background: active ? 'var(--accent-soft)' : 'transparent',
                borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* 搜索框 */}
      <div
        className="shrink-0 flex items-center gap-2 px-4 py-3"
        style={{ borderBottom: '1px solid var(--border-color)' }}
      >
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch()
          }}
          placeholder={tab === 'gululu' ? '搜索骨碌碌安科（留空看全部）' : '搜索 NGA 安科（留空看全部）'}
          className="flex-1 px-3 py-2 rounded-md text-sm outline-none"
          style={{
            border: '1px solid var(--border-color)',
            background: 'var(--bg-input)',
            color: 'var(--text-primary)',
          }}
        />
        <button
          onClick={handleSearch}
          disabled={loading || !isElectronAvailable}
          className="shrink-0 px-4 py-2 rounded-md text-sm font-medium transition-colors"
          style={{
            background: loading ? 'var(--bg-hover)' : 'var(--accent)',
            color: loading ? 'var(--text-secondary)' : 'var(--text-on-accent)',
            opacity: loading || !isElectronAvailable ? 0.6 : 1,
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? '搜索中…' : '搜索'}
        </button>
      </div>

      {/* 筛选条 */}
      {tab === 'gululu' && hasGululuResults && (
        <div
          className="shrink-0 flex items-center gap-2 px-4 py-2 flex-wrap"
          style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-card)' }}
        >
          <select
            value={gululuSort}
            onChange={(e) => setGululuSort(e.target.value as GululuSort)}
            className="px-2 py-1 rounded-md text-xs outline-none"
            style={{ border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
          >
            <option value="default">默认排序</option>
            <option value="word-desc">字数 ↓</option>
            <option value="view-desc">浏览 ↓</option>
            <option value="time-desc">更新 ↓</option>
          </select>
          <input
            type="number"
            placeholder="最小字数(万)"
            value={minWordCount || ''}
            onChange={(e) => setMinWordCount(e.target.value ? parseInt(e.target.value, 10) : 0)}
            className="w-28 px-2 py-1 rounded-md text-xs outline-none"
            style={{ border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
          />
          <input
            type="text"
            placeholder="筛选作者"
            value={authorFilter}
            onChange={(e) => setAuthorFilter(e.target.value)}
            className="w-32 px-2 py-1 rounded-md text-xs outline-none"
            style={{ border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
          />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            共 {displayedGululu.length} 条
          </span>
        </div>
      )}
      {tab === 'nga' && hasNgaResults && (
        <div
          className="shrink-0 flex items-center gap-2 px-4 py-2 flex-wrap"
          style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-card)' }}
        >
          <select
            value={ngaSort}
            onChange={(e) => setNgaSort(e.target.value as NgaSort)}
            className="px-2 py-1 rounded-md text-xs outline-none"
            style={{ border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
          >
            <option value="default">默认排序</option>
            <option value="floor-desc">楼层数 ↓</option>
            <option value="reply-desc">回复时间 ↓</option>
          </select>
          <input
            type="text"
            placeholder="筛选作者"
            value={ngaAuthorFilter}
            onChange={(e) => setNgaAuthorFilter(e.target.value)}
            className="w-32 px-2 py-1 rounded-md text-xs outline-none"
            style={{ border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
          />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            共 {displayedNga.length} 条
          </span>
        </div>
      )}

      {/* 结果区 */}
      <div className="flex-1 overflow-y-auto p-4">
        {!isElectronAvailable ? (
          <div className="text-center py-8" style={{ color: 'var(--text-secondary)' }}>
            当前环境不支持搜索（需要桌面版 Electron）
          </div>
        ) : error ? (
          <div
            className="text-center py-8 px-4 rounded-md"
            style={{ color: 'var(--error)', background: 'var(--error-bg)' }}
          >
            ❌ {error}
          </div>
        ) : tab === 'gululu' ? (
          !hasGululuResults ? (
            <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
              {loading ? '搜索中…' : '输入关键字搜索骨碌碌安科'}
            </div>
          ) : displayedGululu.length === 0 ? (
            <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
              没有符合筛选条件的结果
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {displayedGululu.map((r, i) => (
                <GululuCard key={`${r.url}-${i}`} item={r} onOpen={openUrl} />
              ))}
            </div>
          )
        ) : !hasNgaResults ? (
          <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
            {loading ? '搜索中…' : '输入关键字搜索 NGA 安科'}
          </div>
        ) : displayedNga.length === 0 ? (
          <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}>
            没有符合筛选条件的结果
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {displayedNga.map((r, i) => (
              <NgaCard key={`${r.url}-${i}`} item={r} onOpen={openUrl} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// 骨碌碌结果卡片
function GululuCard({ item, onOpen }: { item: GululuResult; onOpen: (url: string) => void }) {
  return (
    <div
      className="p-4 rounded-lg cursor-pointer transition-colors"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-color)')}
      onClick={() => onOpen(item.url)}
    >
      <div
        className="text-base font-semibold mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        {item.title}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <span>👤 {item.author}</span>
        <span>📝 {item.wordCount}</span>
        <span>👁 {item.viewCount}</span>
        <span>🔄 {item.updatedAt}</span>
        {item.publishedAt && <span>📅 {item.publishedAt}</span>}
      </div>
    </div>
  )
}

// NGA 结果卡片
function NgaCard({ item, onOpen }: { item: NgaResult; onOpen: (url: string) => void }) {
  return (
    <div
      className="p-4 rounded-lg cursor-pointer transition-colors"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-color)')}
      onClick={() => onOpen(item.url)}
    >
      <div
        className="text-base font-semibold mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        {item.title}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <span>👤 {item.author}</span>
        <span>🔢 {item.floorCount} 楼</span>
        <span>💬 {item.lastReplyAt}</span>
        {item.publishedAt && <span>📅 {item.publishedAt}</span>}
      </div>
    </div>
  )
}
