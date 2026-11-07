// ============================================================
// 寻找安科页面
//
// 左右 Tab 切换布局：骨碌碌（gululu.world）+ NGA 安科版块（fid=784）
// - 顶部两个 Tab 按钮，一次只显示当前激活站点的搜索板块
// - 两个板块各自独立搜索状态、筛选状态、结果数据，切换时重新初始化
// - 桌面端走 Electron 主进程爬虫真实抓取
// - 安卓版：搜索依赖 Electron IPC，无法使用，显示"该功能仅桌面版可用"
//
// 搜索逻辑：
// - 单次最多 100 条结果（searchAnke.ts 内 slice(0, 100)）
// - 关键字未变 → 不重爬，仅 toast 提示
// - 所有筛选为前端本地筛选，不触发网络请求
// ============================================================

import { useState, useCallback } from 'react'
import { isCapacitor } from '../../utils/platform'
import { SearchSiteSection, GululuCard, NgaCard } from './SearchSiteSection'
import { Icon } from '../common/Icon'
import { useSettingStore } from '../../store/settingStore'
import type { GululuResult, NgaResult } from '../../types/search'

interface FindAnkePageProps {
  onBack: () => void
}

type Tab = 'gululu' | 'nga'

export function FindAnkePage({ onBack }: FindAnkePageProps) {
  const [tab, setTab] = useState<Tab>('gululu')
  const ngaCookies = useSettingStore((s) => s.ngaCookies)

  const openUrl = useCallback((url: string) => {
    const api = (window as any).electronAPI
    if (api?.openExternal) {
      api.openExternal(url)
    } else {
      window.open(url, '_blank')
    }
  }, [])

  // 骨碌碌搜索函数：封装 IPC 调用
  const gululuSearchFn = useCallback(
    (keyword: string, matchField: 'all' | 'title' | 'author', page?: number, limit?: number) =>
      (window as any).electronAPI.searchAnke.gululu(keyword, matchField, page, limit),
    [],
  )

  // NGA 搜索函数：封装 IPC 调用 + Cookie
  const ngaSearchFn = useCallback(
    (keyword: string, matchField: 'all' | 'title' | 'author', page?: number, limit?: number) =>
      (window as any).electronAPI.searchAnke.ngaAnke(
        keyword,
        ngaCookies || undefined,
        matchField,
        page,
        limit,
      ),
    [ngaCookies],
  )

  // 安卓版：搜索依赖 Electron IPC，无法使用
  if (isCapacitor) {
    return (
      <div
        className="an-page text-[var(--an-ink)] flex flex-col min-h-full"
      >
        <div
          className="flex items-center gap-3 px-4 py-3 shrink-0 sticky top-0 z-40"
          style={{ background: 'var(--an-paper-2)', borderBottom: '3px solid var(--an-ink)' }}
        >
          <button
            onClick={onBack}
            className="an-pill"
          >
            ← 返回
          </button>
          <Icon name="search" size={18} />
          <h1 className="text-lg font-bold m-0" style={{ fontFamily: 'var(--an-font-display)' }}>寻找安科</h1>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <div
            className="an-card text-center max-w-md p-8"
          >
            <div className="mb-4 inline-flex items-center justify-center w-20 h-20 rounded-full" style={{ background: 'var(--an-lilac-soft)', border: '3px solid var(--an-ink)', boxShadow: '0 4px 0 var(--an-ink)' }}><Icon name="laptop" size={40} /></div>
            <h2
              className="text-xl font-bold mb-2"
              style={{ fontFamily: 'var(--an-font-display)', color: 'var(--an-ink)' }}
            >
              该功能仅桌面版可用
            </h2>
            <p
              className="text-sm leading-relaxed m-0"
              style={{ color: 'var(--an-ink-soft)' }}
            >
              寻找安科需要在 Windows 桌面版使用，安卓版暂不支持。
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="an-page text-[var(--text-primary)] flex flex-col h-full"
    >
      {/* 顶栏 */}
      <div
        className="flex items-center gap-3 px-6 py-4 shrink-0"
        style={{ background: 'var(--an-paper-2)', borderBottom: '3px solid var(--an-ink)' }}
      >
        <button
          onClick={onBack}
          className="an-pill"
        >
          ← 返回
        </button>
        <div className="flex items-center gap-2">
          <Icon name="search" size={20} />
          <h1
            className="m-0 text-[var(--an-ink)]"
            style={{ fontFamily: 'var(--an-font-display)', fontSize: 22 }}
          >
            寻找安科
          </h1>
        </div>
      </div>

      {/* Tab 切换栏 */}
      <div
        className="shrink-0 flex gap-2 px-6 py-3"
        style={{ borderBottom: '2px solid var(--an-ink)' }}
      >
        <button
          onClick={() => setTab('gululu')}
          className={`an-pill ${tab === 'gululu' ? 'is-active' : ''}`}
        >
          <span className="inline-flex items-center gap-1">
            <Icon name="globe" size={14} />
            骨碌碌
          </span>
        </button>
        <button
          onClick={() => setTab('nga')}
          className={`an-pill ${tab === 'nga' ? 'is-active' : ''}`}
        >
          <span className="inline-flex items-center gap-1">
            <Icon name="gamepad" size={14} />
            NGA 安科
          </span>
        </button>
      </div>

      {/* 当前 Tab 的搜索板块（各自独立状态） */}
      <div className="flex-1 overflow-hidden">
        {tab === 'gululu' && (
          <div className="h-full overflow-y-auto p-4">
            <div className="max-w-[1180px] mx-auto flex flex-col gap-3">
              <div className="an-card p-4">
                <SearchSiteSection<GululuResult>
                  siteKey="gululu"
                  icon="globe"
                  title="骨碌碌安科搜索"
                  subtitle="gululu.world · 安科轻小说站"
                  placeholder="搜索骨碌碌安科（试试「mygo」「安价」）"
                  searchFn={gululuSearchFn}
                  renderCard={(item, onOpen) => <GululuCard item={item} onOpen={onOpen} />}
                  filterConfig={{
                    numericRangeField: 'wordCount',
                    numericRangeLabel: '字数(万)',
                    numericRangeMultiplier: 10000,
                    sortOptions: [
                      { value: 'default', label: '默认排序' },
                      { value: 'word-desc', label: '字数 ↓' },
                      { value: 'view-desc', label: '浏览 ↓' },
                      { value: 'time-desc', label: '更新 ↓' },
                    ],
                    defaultSort: 'default',
                  }}
                  onOpenUrl={openUrl}
                  autoLoadOnMount={false}
                  flatLayout
                  matchFieldSwitchable={true}
                  defaultMatchField="all"
                  defaultSearchCount={20}
                />
              </div>
            </div>
          </div>
        )}
        {tab === 'nga' && (
          <div className="h-full overflow-y-auto p-4">
            <div className="max-w-[1180px] mx-auto flex flex-col gap-3">
              {!ngaCookies && (
                <div
                  className="flex items-start gap-2 text-xs p-3"
                  style={{ background: 'var(--an-lemon-soft)', border: '2px solid var(--an-ink)', borderRadius: 'var(--an-radius-sm)', color: 'var(--an-ink)' }}
                >
                  <span className="shrink-0">
                    <Icon name="alert" size={14} />
                  </span>
                  <div className="flex-1">
                    <div className="font-semibold mb-0.5">未配置 NGA Cookie</div>
                    <div className="text-[var(--an-ink-soft)]">
                      未登录状态下仅能查看部分公开帖子，部分内容可能缺失或被拦截。
                      请在 <strong>设置 → NGA 登录态</strong> 中粘贴 Cookie 后重试。
                    </div>
                  </div>
                </div>
              )}
              <div className="an-card p-4">
                <SearchSiteSection<NgaResult>
                  siteKey="nga"
                  icon="gamepad"
                  title="NGA 安科搜索"
                  subtitle={
                    ngaCookies
                      ? 'ngabbs.com/fid=784 · 已配置 Cookie'
                      : 'ngabbs.com/fid=784 · 二次元跑团'
                  }
                  placeholder="搜索 NGA 安科（试试「mygo」「跑团」）"
                  searchFn={ngaSearchFn}
                  renderCard={(item, onOpen) => <NgaCard item={item} onOpen={onOpen} />}
                  filterConfig={{
                    numericRangeField: 'floorCount',
                    numericRangeLabel: '楼数',
                    numericRangeMultiplier: 1,
                    sortOptions: [
                      { value: 'default', label: '默认排序' },
                      { value: 'floor-desc', label: '楼层数 ↓' },
                      { value: 'reply-desc', label: '回复时间 ↓' },
                    ],
                    defaultSort: 'default',
                  }}
                  onOpenUrl={openUrl}
                  autoLoadOnMount={false}
                  flatLayout
                  matchFieldSwitchable={true}
                  defaultSearchCount={60}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
