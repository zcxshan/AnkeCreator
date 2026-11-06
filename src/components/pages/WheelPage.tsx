// ============================================================
// 玩转盘主页面（糖果贴纸风）
//
// 三种视图：
//   1. 列表视图：方案卡片墙 + 右侧历史卡 + 导入/新建
//   2. 编辑视图：SchemeEditor 编辑单个方案
//   3. 抽取视图：WheelPlayground 进行抽取
//
// 数据流：
//   - 列表 → wheelAPI.listSchemes()
//   - 保存 → wheelAPI.createScheme / updateScheme
//   - 删除 → wheelAPI.deleteScheme
//   - 导入 → wheelAPI.openSchemeFile → validateWheelImport → createScheme
//   - 导出 → wheelAPI.saveSchemeAsFile
//   - 历史 → wheelAPI.listHistory / clearHistory
// ============================================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Icon } from '../common/Icon'
import { askConfirm } from '../common/confirmPrompt'
import { SchemeEditor } from '../wheel/SchemeEditor'
import { WheelPlayground } from '../wheel/WheelPlayground'
import { validateWheelImport, unwrapWheelImport } from '../../utils/wheelImport'
import type { WheelScheme, DrawHistory, DrawResult } from '../../types/wheel'

type View = 'list' | 'edit' | 'play'

interface WheelPageProps {
  onBack: () => void
}

/** 方案卡胶带颜色循环 */
const TAPE_COLORS = ['#ffd45e', '#5cc6ff', '#ff86b8', '#4fdcae', '#b39bff']

/** 生成唯一 ID（与 wheelStore 风格一致） */
function genId(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36).slice(-4) +
    Math.random().toString(36).slice(2, 6)
  )
}

/** 创建一个空方案（用于新建） */
function createEmptyScheme(): WheelScheme {
  const now = new Date().toISOString()
  return {
    id: genId(),
    name: '',
    description: '',
    stages: [],
    created_at: now,
    updated_at: now,
  }
}

/** 格式化时间显示 */
function formatTime(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${day} ${hh}:${mm}`
  } catch {
    return ''
  }
}

function useWideLayout(minWidth: number): boolean {
  const [wide, setWide] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth >= minWidth,
  )
  useEffect(() => {
    const mq = window.matchMedia?.(`(min-width: ${minWidth}px)`)
    if (!mq) return
    const handler = (event: MediaQueryListEvent) => setWide(event.matches)
    mq.addEventListener?.('change', handler)
    return () => mq.removeEventListener?.('change', handler)
  }, [minWidth])
  return wide
}

/** 方案卡顶部的贴纸胶带 */
function Tape({ color, tilt = -3 }: { color: string; tilt?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: -12,
        left: '50%',
        width: 78,
        height: 20,
        transform: `translateX(-50%) rotate(${tilt}deg)`,
        background: color,
        border: '2px solid var(--an-ink)',
        borderRadius: 4,
        boxShadow: '0 2px 0 var(--an-ink)',
        zIndex: 2,
      }}
    />
  )
}

export function WheelPage({ onBack }: WheelPageProps) {
  const wide = useWideLayout(1200)
  const [view, setView] = useState<View>('list')
  const [schemes, setSchemes] = useState<WheelScheme[]>([])
  const [history, setHistory] = useState<DrawHistory[]>([])
  const [editingScheme, setEditingScheme] = useState<WheelScheme | null>(null)
  const [playingScheme, setPlayingScheme] = useState<WheelScheme | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'error' | 'success' } | null>(null)

  const showToast = useCallback((msg: string, type: 'info' | 'error' | 'success' = 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [list, hist] = await Promise.all([
        window.wheelAPI.listSchemes(),
        window.wheelAPI.listHistory(50),
      ])
      setSchemes(list)
      setHistory(hist)
    } catch (e) {
      console.error('[WheelPage] 加载失败:', e)
      setLoadError((e as Error)?.message || String(e))
      showToast('加载数据失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleCreate = useCallback(() => {
    setEditingScheme(createEmptyScheme())
    setView('edit')
  }, [])

  const handleEdit = useCallback((scheme: WheelScheme) => {
    setEditingScheme({ ...scheme })
    setView('edit')
  }, [])

  const handlePlay = useCallback(
    (scheme: WheelScheme) => {
      if (scheme.stages.length === 0) {
        showToast('方案没有阶段，请先编辑添加阶段', 'error')
        return
      }
      setPlayingScheme(scheme)
      setView('play')
    },
    [showToast],
  )

  const handleDelete = useCallback(
    async (scheme: WheelScheme) => {
      const confirmed = await askConfirm({
        title: '删除方案',
        message: `确定删除方案「${scheme.name}」吗？相关历史记录也会一并删除。`,
        confirmText: '删除',
        danger: true,
      })
      if (!confirmed) return
      try {
        await window.wheelAPI.deleteScheme(scheme.id)
        showToast('已删除', 'success')
        refresh()
      } catch (e) {
        console.error('[WheelPage] 删除失败:', e)
        showToast('删除失败', 'error')
      }
    },
    [refresh, showToast],
  )

  const handleDuplicate = useCallback(
    async (scheme: WheelScheme) => {
      try {
        const duplicated: Omit<WheelScheme, 'id' | 'created_at' | 'updated_at'> = {
          name: `${scheme.name}（副本）`,
          description: scheme.description,
          stages: scheme.stages.map((s) => ({
            ...s,
            id: genId(),
            options: s.options.map((o) => ({ ...o, id: genId() })),
          })),
          promptTemplate: scheme.promptTemplate,
        }
        await window.wheelAPI.createScheme(duplicated)
        showToast('已复制为新方案', 'success')
        refresh()
      } catch (e) {
        console.error('[WheelPage] 复制失败:', e)
        showToast('复制失败', 'error')
      }
    },
    [refresh, showToast],
  )

  const handleEditorChange = useCallback((next: WheelScheme) => {
    setEditingScheme(next)
  }, [])

  const handleSave = useCallback(async () => {
    if (!editingScheme) return
    if (!editingScheme.name.trim()) {
      showToast('请填写方案名', 'error')
      return
    }
    setSaving(true)
    try {
      const isNew = !schemes.some((s) => s.id === editingScheme.id)
      if (isNew) {
        await window.wheelAPI.createScheme({
          name: editingScheme.name.trim(),
          description: editingScheme.description,
          stages: editingScheme.stages,
          promptTemplate: editingScheme.promptTemplate,
        })
      } else {
        await window.wheelAPI.updateScheme(editingScheme.id, {
          name: editingScheme.name.trim(),
          description: editingScheme.description,
          stages: editingScheme.stages,
          promptTemplate: editingScheme.promptTemplate,
        })
      }
      showToast('保存成功', 'success')
      setEditingScheme(null)
      setView('list')
      refresh()
    } catch (e) {
      console.error('[WheelPage] 保存失败:', e)
      showToast('保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }, [editingScheme, schemes, refresh, showToast])

  const handleCancelEdit = useCallback(() => {
    setEditingScheme(null)
    setView('list')
  }, [])

  const handleImport = useCallback(async () => {
    try {
      const result = await window.wheelAPI.openSchemeFile()
      if (!result.ok || result.canceled || !result.data) {
        if (result.error) showToast(`导入失败: ${result.error}`, 'error')
        return
      }
      const validation = validateWheelImport(result.data)
      if (!validation.ok || !validation.bundle) {
        showToast(`导入文件无效: ${validation.error}`, 'error')
        return
      }
      const newScheme = unwrapWheelImport(validation.bundle)
      await window.wheelAPI.createScheme({
        name: newScheme.name,
        description: newScheme.description,
        stages: newScheme.stages,
        promptTemplate: newScheme.promptTemplate,
      })
      showToast(`已导入方案「${newScheme.name}」`, 'success')
      refresh()
    } catch (e) {
      console.error('[WheelPage] 导入失败:', e)
      showToast('导入失败', 'error')
    }
  }, [refresh, showToast])

  const handleExport = useCallback(
    async (scheme: WheelScheme) => {
      try {
        const result = await window.wheelAPI.saveSchemeAsFile(scheme, scheme.name)
        if (!result.ok && !result.canceled) {
          showToast(`导出失败: ${result.error}`, 'error')
          return
        }
        if (result.ok && result.filePath) {
          showToast(`已导出到: ${result.filePath}`, 'success')
        }
      } catch (e) {
        console.error('[WheelPage] 导出失败:', e)
        showToast('导出失败', 'error')
      }
    },
    [showToast],
  )

  const handleClearHistory = useCallback(async () => {
    const confirmed = await askConfirm({
      title: '清空历史',
      message: '确定清空所有抽取历史记录吗？',
      confirmText: '清空',
      danger: true,
    })
    if (!confirmed) return
    try {
      await window.wheelAPI.clearHistory()
      showToast('已清空历史', 'success')
      refresh()
    } catch (e) {
      console.error('[WheelPage] 清空历史失败:', e)
      showToast('清空失败', 'error')
    }
  }, [refresh, showToast])

  const handlePlayComplete = useCallback(
    async (results: DrawResult[], finalPrompt?: string) => {
      if (!playingScheme) return
      try {
        const record: DrawHistory = {
          id: genId(),
          schemeId: playingScheme.id,
          schemeName: playingScheme.name,
          results,
          finalPrompt,
          drawnAt: new Date().toISOString(),
        }
        await window.wheelAPI.addHistory(record)
      } catch (e) {
        console.error('[WheelPage] 保存历史失败:', e)
      }
    },
    [playingScheme],
  )

  const handleClosePlay = useCallback(() => {
    setPlayingScheme(null)
    setView('list')
    refresh()
  }, [refresh])

  const totalOptions = useMemo(
    () => schemes.reduce((sum, s) => sum + s.stages.reduce((n, st) => n + st.options.length, 0), 0),
    [schemes],
  )

  // ---------------- 渲染：方案卡 ----------------
  const renderSchemeCard = useCallback(
    (scheme: WheelScheme, index: number) => {
      const optionCount = scheme.stages.reduce((sum, s) => sum + s.options.length, 0)
      return (
        <div
          key={scheme.id}
          className="an-card an-card--hover"
          style={{ padding: '20px 16px 16px', marginTop: 12 }}
        >
          <Tape
            color={TAPE_COLORS[index % TAPE_COLORS.length]}
            tilt={index % 2 === 0 ? -3 : 3}
          />
          <div style={{ minWidth: 0, marginBottom: 10 }}>
            <div
              style={{
                fontFamily: 'var(--an-font-display)',
                fontSize: 20,
                color: 'var(--an-ink)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={scheme.name}
            >
              {scheme.name}
            </div>
            {scheme.description && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: 'var(--an-ink-soft)',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {scheme.description}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            <span className="an-chip">
              <Icon name="target" size={12} /> {scheme.stages.length} 阶段
            </span>
            <span className="an-chip">
              <Icon name="hash" size={12} /> {optionCount} 选项
            </span>
            {scheme.promptTemplate && (
              <span className="an-chip">
                <Icon name="bot" size={12} /> Prompt
              </span>
            )}
          </div>

          <div style={{ fontSize: 12, color: 'var(--an-ink-soft)', marginBottom: 12 }}>
            <Icon name="clock" size={11} /> 更新于 {formatTime(scheme.updated_at)}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button className="an-btn an-btn--sm an-btn--mint" onClick={() => handlePlay(scheme)}>
              <Icon name="play" size={14} /> 开始抽取
            </button>
            <button className="an-btn an-btn--sm an-btn--ghost" onClick={() => handleEdit(scheme)}>
              <Icon name="pen" size={14} /> 编辑
            </button>
            <button className="an-btn an-btn--sm an-btn--ghost" onClick={() => handleExport(scheme)}>
              <Icon name="upload" size={14} /> 导出
            </button>
            <button className="an-btn an-btn--sm an-btn--ghost" onClick={() => handleDuplicate(scheme)}>
              <Icon name="copy" size={14} /> 复制
            </button>
            <button
              className="an-btn an-btn--sm an-btn--ghost"
              style={{ color: '#c0392b' }}
              onClick={() => handleDelete(scheme)}
            >
              <Icon name="trash" size={14} /> 删除
            </button>
          </div>
        </div>
      )
    },
    [handlePlay, handleEdit, handleExport, handleDuplicate, handleDelete],
  )

  // ---------------- 渲染：历史条目 ----------------
  const renderHistoryItem = useCallback((h: DrawHistory) => {
    const validResults = h.results.filter((r) => !r.skipped && r.results.length > 0)
    return (
      <div key={h.id} className="an-card" style={{ padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontFamily: 'var(--an-font-display)', fontSize: 15 }}>{h.schemeName}</span>
          <span style={{ fontSize: 12, color: 'var(--an-ink-soft)', whiteSpace: 'nowrap' }}>
            {formatTime(h.drawnAt)}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
          {validResults.map((r, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--an-ink-soft)' }}>
              <span style={{ color: 'var(--an-ink-faint)' }}>{r.stageName}：</span>
              <span style={{ color: 'var(--an-ink)', fontWeight: 700 }}>{r.results.join('、')}</span>
            </div>
          ))}
          {validResults.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--an-ink-faint)' }}>（所有阶段均跳过）</div>
          )}
        </div>
        {h.finalPrompt && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ fontSize: 12, color: 'var(--an-pink)', cursor: 'pointer' }}>
              查看 Prompt
            </summary>
            <pre
              className="an-scroll"
              style={{
                margin: '8px 0 0',
                padding: 8,
                maxHeight: 160,
                overflow: 'auto',
                background: 'var(--an-paper-2)',
                borderRadius: 10,
                fontSize: 12,
                fontFamily: 'inherit',
                whiteSpace: 'pre-wrap',
              }}
            >
              {h.finalPrompt}
            </pre>
          </details>
        )}
      </div>
    )
  }, [])

  const historyCard = useMemo(
    () => (
      <div className="an-card" style={{ padding: 16, position: 'sticky', top: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 12,
          }}
        >
          <span className="an-badge">
            <Icon name="scroll" size={12} /> 最近抽取
          </span>
          {history.length > 0 && (
            <button
              className="an-pill"
              onClick={handleClearHistory}
              title="清空历史"
              style={{ fontSize: 12 }}
            >
              清空
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--an-ink-soft)' }}>
            <Icon name="inbox" size={32} />
            <div style={{ fontSize: 12, marginTop: 6 }}>还没有抽取历史</div>
          </div>
        ) : (
          <div
            className="an-scroll"
            style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 520, overflowY: 'auto' }}
          >
            {history.slice(0, 8).map(renderHistoryItem)}
          </div>
        )}
      </div>
    ),
    [history, renderHistoryItem, handleClearHistory],
  )

  const toolbar = (
    <div className="an-toolbar" style={{ marginBottom: 20 }}>
      <span className="an-badge">
        <Icon name="wheel" size={12} /> {schemes.length} 个方案
      </span>
      {schemes.length > 0 && (
        <select
          className="an-pill"
          defaultValue=""
          onChange={(e) => {
            const scheme = schemes.find((s) => s.id === e.target.value)
            e.currentTarget.value = ''
            if (scheme) handlePlay(scheme)
          }}
          style={{ cursor: 'pointer' }}
          aria-label="方案选择"
        >
          <option value="">方案选择…</option>
          {schemes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      <button
        className={`an-pill${showHistory ? ' is-active' : ''}`}
        onClick={() => setShowHistory((v) => !v)}
      >
        <Icon name="scroll" size={12} /> 历史 ({history.length})
      </button>
      <button className="an-pill" onClick={handleImport}>
        <Icon name="download" size={12} /> 导入
      </button>
      <button className="an-btn an-btn--sm an-btn--pink an-toolbar__spacer" onClick={handleCreate}>
        <Icon name="plus" size={14} /> 新建方案
      </button>
    </div>
  )

  return (
    <div className="an-page">
      <div className="an-shell">
        {/* 顶栏 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 16,
          }}
        >
          <button className="an-pill" onClick={onBack}>
            <Icon name="back" size={14} /> 返回
          </button>
          <h1 className="an-title" style={{ fontSize: 28 }}>
            玩转盘
          </h1>
          <span className="an-badge" style={{ marginLeft: 'auto' }}>
            骰子决定命运
          </span>
        </div>

        {view === 'list' && toolbar}

        {/* 列表视图 */}
        {view === 'list' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: wide && !showHistory ? 'minmax(0, 1fr) 340px' : 'minmax(0, 1fr)',
              gap: 24,
              alignItems: 'start',
            }}
          >
            <div style={{ minWidth: 0 }}>
              {loadError ? (
                <div className="an-card" style={{ padding: 32, textAlign: 'center' }}>
                  <div style={{ color: '#c0392b', display: 'flex', justifyContent: 'center' }}>
                    <Icon name="alert" size={40} />
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>
                    转盘数据加载失败
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--an-ink-soft)', marginTop: 4 }}>
                    {loadError}
                  </div>
                  <button
                    className="an-btn an-btn--sm an-btn--pink"
                    style={{ marginTop: 16 }}
                    onClick={() => refresh()}
                  >
                    <Icon name="refresh" size={14} /> 重新加载
                  </button>
                </div>
              ) : loading ? (
                <div className="an-empty">
                  <Icon name="hourglass" size={40} />
                  <div className="an-empty__title">加载中…</div>
                </div>
              ) : showHistory ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="an-badge">全部历史</span>
                    {history.length > 0 && (
                      <button className="an-pill" onClick={handleClearHistory}>
                        清空历史
                      </button>
                    )}
                  </div>
                  {history.length === 0 ? (
                    <div className="an-empty">
                      <Icon name="scroll" size={56} />
                      <div className="an-empty__title">还没有抽取历史</div>
                      <div className="an-empty__desc">抽取一次之后，结果会自动记录在这里。</div>
                    </div>
                  ) : (
                    <div className="an-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {history.map(renderHistoryItem)}
                    </div>
                  )}
                </div>
              ) : schemes.length === 0 ? (
                <div className="an-empty">
                  <Icon name="wheel" size={56} />
                  <div className="an-empty__title">还没有转盘方案</div>
                  <div className="an-empty__desc">
                    新建一个方案，或从已有 .wheel.json 文件导入。三步就能开转：
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 10,
                      justifyContent: 'center',
                      marginTop: 6,
                    }}
                  >
                    <span className="an-chip">1. 新建方案</span>
                    <span className="an-chip">2. 添加阶段与选项</span>
                    <span className="an-chip">3. 开始抽取</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 10 }}>
                    <button className="an-btn an-btn--pink" onClick={handleCreate}>
                      <Icon name="plus" size={16} /> 新建方案
                    </button>
                    <button className="an-btn an-btn--sky" onClick={handleImport}>
                      <Icon name="download" size={16} /> 导入方案
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: wide ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(260px, 1fr))',
                    gap: 16,
                  }}
                >
                  {schemes.map(renderSchemeCard)}
                </div>
              )}
            </div>

            {wide && !showHistory && historyCard}
          </div>
        )}

        {/* 编辑视图 */}
        {view === 'edit' && editingScheme && (
          <div className="an-card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span className="an-badge">
                {schemes.some((s) => s.id === editingScheme.id) ? '编辑方案' : '新建方案'}
              </span>
              <span style={{ fontSize: 12, color: 'var(--an-ink-soft)' }}>
                共 {editingScheme.stages.length} 个阶段
              </span>
            </div>
            <SchemeEditor
              scheme={editingScheme}
              onChange={handleEditorChange}
              onSave={handleSave}
              onCancel={handleCancelEdit}
              saving={saving}
            />
          </div>
        )}

        {/* 抽取视图 */}
        {view === 'play' && playingScheme && (
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
                marginBottom: 16,
              }}
            >
              <span className="an-badge">
                <Icon name="play" size={12} /> 正在抽取
              </span>
              <span
                style={{
                  fontFamily: 'var(--an-font-display)',
                  fontSize: 20,
                  color: 'var(--an-ink)',
                }}
              >
                {playingScheme.name}
              </span>
              <button
                className="an-pill"
                style={{ marginLeft: 'auto' }}
                onClick={handleClosePlay}
              >
                <Icon name="back" size={12} /> 返回列表
              </button>
            </div>
            <WheelPlayground
              scheme={playingScheme}
              onClose={handleClosePlay}
              onComplete={handlePlayComplete}
            />
          </div>
        )}

        {totalOptions === 0 && view === 'list' && schemes.length > 0 && (
          <div style={{ marginTop: 24, fontSize: 12, color: 'var(--an-ink-soft)', textAlign: 'center' }}>
            提示：方案里还没有选项，编辑方案后即可抽取。
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="an-pop-in"
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '10px 20px',
            borderRadius: 999,
            border: '3px solid var(--an-ink)',
            boxShadow: '0 4px 0 var(--an-ink)',
            background:
              toast.type === 'error'
                ? '#ff9aa2'
                : toast.type === 'success'
                  ? 'var(--an-mint)'
                  : 'var(--an-card)',
            color: 'var(--an-ink)',
            fontSize: 13,
            fontWeight: 700,
            zIndex: 50,
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
