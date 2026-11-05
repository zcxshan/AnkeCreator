// ============================================================
// 玩转盘主页面
//
// 三种视图：
//   1. 列表视图：方案列表 + 历史记录 + 导入/导出 + 新建按钮
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

export function WheelPage({ onBack }: WheelPageProps) {
  const [view, setView] = useState<View>('list')
  const [schemes, setSchemes] = useState<WheelScheme[]>([])
  const [history, setHistory] = useState<DrawHistory[]>([])
  const [editingScheme, setEditingScheme] = useState<WheelScheme | null>(null)
  const [playingScheme, setPlayingScheme] = useState<WheelScheme | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  // 加载失败需在页面内可见并可重试（不能只弹一次 toast）
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'error' | 'success' } | null>(null)

  // 简易 toast
  const showToast = useCallback((msg: string, type: 'info' | 'error' | 'success' = 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }, [])

  // 加载方案列表 + 历史记录
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

  // 新建方案
  const handleCreate = useCallback(() => {
    setEditingScheme(createEmptyScheme())
    setView('edit')
  }, [])

  // 编辑现有方案
  const handleEdit = useCallback((scheme: WheelScheme) => {
    setEditingScheme({ ...scheme }) // 复制一份，避免直接修改原数据
    setView('edit')
  }, [])

  // 玩转盘
  const handlePlay = useCallback((scheme: WheelScheme) => {
    if (scheme.stages.length === 0) {
      showToast('方案没有阶段，请先编辑添加阶段', 'error')
      return
    }
    setPlayingScheme(scheme)
    setView('play')
  }, [showToast])

  // 删除方案
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

  // 复制方案（基于现有方案创建新方案）
  const handleDuplicate = useCallback(
    async (scheme: WheelScheme) => {
      try {
        const now = new Date().toISOString()
        // 重新生成 id，避免冲突
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

  // 编辑器变更
  const handleEditorChange = useCallback((next: WheelScheme) => {
    setEditingScheme(next)
  }, [])

  // 保存方案
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
        // 新建：用 createScheme，由后端生成新 id 和时间戳
        await window.wheelAPI.createScheme({
          name: editingScheme.name.trim(),
          description: editingScheme.description,
          stages: editingScheme.stages,
          promptTemplate: editingScheme.promptTemplate,
        })
      } else {
        // 更新：保留原 id
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

  // 取消编辑
  const handleCancelEdit = useCallback(() => {
    setEditingScheme(null)
    setView('list')
  }, [])

  // 导入方案
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

  // 导出方案
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

  // 清空历史
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

  // 抽取完成回调
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
        // 不立即刷新，避免影响抽取界面体验；返回列表时再刷新
      } catch (e) {
        console.error('[WheelPage] 保存历史失败:', e)
      }
    },
    [playingScheme],
  )

  // 关闭抽取界面
  const handleClosePlay = useCallback(() => {
    setPlayingScheme(null)
    setView('list')
    refresh()
  }, [refresh])

  // 渲染方案列表项
  const renderSchemeCard = useCallback(
    (scheme: WheelScheme) => (
      <div
        key={scheme.id}
        className="anke-card p-4 transition-all"
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="text-[var(--text-primary)] text-base font-medium truncate">
              {scheme.name}
            </div>
            {scheme.description && (
              <div
                className="text-[var(--text-secondary)] text-xs mt-1 line-clamp-2"
              >
                {scheme.description}
              </div>
            )}
          </div>
        </div>
        <div
          className="text-[var(--text-tertiary)] flex flex-wrap gap-x-3 gap-y-1 text-xs mb-3"
        >
          <span className="inline-flex items-center gap-1"><Icon name="target" size={12} /> {scheme.stages.length} 个阶段</span>
          <span className="inline-flex items-center gap-1"><Icon name="fileText" size={12} /> {scheme.stages.reduce((sum, s) => sum + s.options.length, 0)} 个选项</span>
          {scheme.promptTemplate && (
            <span className="inline-flex items-center gap-1"><Icon name="bot" size={12} /> 含 Prompt 模板</span>
          )}
          <span className="inline-flex items-center gap-1"><Icon name="clock" size={12} /> {formatTime(scheme.updated_at)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handlePlay(scheme)}
            className="bg-[var(--accent-bg)] text-[var(--accent)] border border-[color:var(--accent)] px-3 py-1.5 text-xs rounded-lg transition-colors"
          >
            <><Icon name="wheel" size={16} /> 开始抽取</>
          </button>
          <button
            onClick={() => handleEdit(scheme)}
            className="bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[color:var(--border-color)] px-3 py-1.5 text-xs rounded-lg transition-colors"
          >
            <><Icon name="pen" size={16} /> 编辑</>
          </button>
          <button
            onClick={() => handleExport(scheme)}
            className="bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[color:var(--border-color)] px-3 py-1.5 text-xs rounded-lg transition-colors"
          >
            <><Icon name="upload" size={16} /> 导出</>
          </button>
          <button
            onClick={() => handleDuplicate(scheme)}
            className="bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[color:var(--border-color)] px-3 py-1.5 text-xs rounded-lg transition-colors"
          >
            <><Icon name="copy" size={16} /> 复制</>
          </button>
          <button
            onClick={() => handleDelete(scheme)}
            className="bg-[var(--bg-hover)] text-[var(--tone-danger)] border border-[color:var(--border-color)] px-3 py-1.5 text-xs rounded-lg transition-colors"
          >
            <><Icon name="trash" size={16} /> 删除</>
          </button>
        </div>
      </div>
    ),
    [handlePlay, handleEdit, handleExport, handleDuplicate, handleDelete],
  )

  // 渲染历史记录
  const renderHistoryItem = useCallback((h: DrawHistory) => {
    const validResults = h.results.filter((r) => !r.skipped && r.results.length > 0)
    return (
      <div
        key={h.id}
        className="anke-card p-3 text-sm"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[var(--text-primary)] font-medium">
            {h.schemeName}
          </span>
          <span className="text-[var(--text-tertiary)] text-xs">
            {formatTime(h.drawnAt)}
          </span>
        </div>
        <div className="space-y-1">
          {validResults.map((r, i) => (
            <div key={i} className="text-[var(--text-secondary)] text-xs">
              <span className="text-[var(--text-tertiary)]">{r.stageName}：</span>
              {r.results.join('、')}
            </div>
          ))}
          {validResults.length === 0 && (
            <div className="text-[var(--text-tertiary)] text-xs">
              （所有阶段均跳过）
            </div>
          )}
        </div>
        {h.finalPrompt && (
          <details className="mt-2">
            <summary
              className="text-[var(--accent)] cursor-pointer text-xs select-none"
            >
              查看 Prompt
            </summary>
            <pre
              className="mt-1 p-2 text-xs whitespace-pre-wrap rounded"
              style={{
                background: 'var(--bg-base)',
                color: 'var(--text-primary)',
                fontFamily: 'inherit',
                margin: 0,
              }}
            >
              {h.finalPrompt}
            </pre>
          </details>
        )}
      </div>
    )
  }, [])

  // 顶部 header
  const header = useMemo(
    () => (
      <div
        className="border-b border-b-[color:var(--border-color)] flex items-center justify-between gap-3 mb-4"
      >
        <div className="flex items-center gap-3 pb-3">
          <button
            onClick={onBack}
            className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[color:var(--border-color)] inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-sm rounded-lg transition-colors"
          >
            <><Icon name="back" size={16} /> 返回</>
          </button>
          <h1 className="text-[var(--text-primary)] text-lg font-semibold inline-flex items-center gap-2">
            <Icon name="wheel" size={16} /> 玩转盘
          </h1>
        </div>
        {view === 'list' && (
          <div className="flex items-center gap-2 pb-3">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="px-3 py-1.5 text-xs rounded-lg transition-colors"
              style={{
                background: showHistory ? 'var(--accent-bg)' : 'var(--bg-card)',
                color: showHistory ? 'var(--accent)' : 'var(--text-primary)',
                border: '1px solid var(--border-color)',
              }}
            >
              <><Icon name="scroll" size={16} /> 历史 ({history.length})</>
            </button>
            <button
              onClick={handleImport}
              className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[color:var(--border-color)] px-3 py-1.5 text-xs rounded-lg transition-colors"
            >
              <><Icon name="download" size={16} /> 导入</>
            </button>
            <button
              onClick={handleCreate}
              className="bg-[var(--accent-bg)] text-[var(--accent)] border border-[color:var(--accent)] px-3 py-1.5 text-xs rounded-lg transition-colors"
            >
              + 新建方案
            </button>
          </div>
        )}
      </div>
    ),
    [view, onBack, showHistory, history.length, handleImport, handleCreate],
  )

  return (
    <div
      className="bg-[var(--bg-base)] text-[var(--text-primary)] min-h-full w-full flex flex-col"
    >
      <div className="flex-1 w-full max-w-4xl mx-auto px-4 py-4 md:px-6 md:py-6 flex flex-col">
        {header}

        {/* 列表视图 */}
        {view === 'list' && (
          <div className="flex-1 flex flex-col gap-4">
            {loadError ? (
              <div
                role="alert"
                className="border border-[color:var(--tone-danger-border)] bg-[var(--tone-danger-veil)] rounded-xl px-6 py-8 text-center"
              >
                <div className="text-[var(--tone-danger)] flex justify-center mb-2">
                  <Icon name="alert" size={28} />
                </div>
                <div className="text-[var(--text-primary)] text-sm font-medium">转盘数据加载失败</div>
                <div className="text-[var(--text-secondary)] text-xs mt-1">{loadError}</div>
                <button
                  onClick={() => refresh()}
                  className="mt-4 inline-flex items-center gap-1 px-4 py-1.5 text-sm rounded-md bg-[var(--accent-bg)] text-[var(--accent)] border border-[color:var(--accent)]"
                >
                  <Icon name="refresh" size={13} /> 重新加载
                </button>
              </div>
            ) : showHistory ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-[var(--text-primary)] text-base font-medium">
                    抽取历史记录
                  </h2>
                  {history.length > 0 && (
                    <button
                      onClick={handleClearHistory}
                      className="bg-[var(--bg-hover)] text-[var(--tone-danger)] border border-[color:var(--border-color)] px-3 py-1 text-xs rounded-lg transition-colors"
                    >
                      清空历史
                    </button>
                  )}
                </div>
                {loading ? (
                  <div
                    className="text-[var(--text-secondary)] text-center py-8 text-sm"
                  >
                    加载中...
                  </div>
                ) : history.length === 0 ? (
                  <div
                    className="bg-[var(--bg-card)] border-[2px] border-[color:var(--border-color)] text-[var(--text-secondary)] text-center py-12 rounded-xl"
                  >
                    <div className="flex justify-center mb-2"><Icon name="scroll" size={48} /></div>
                    <div className="text-sm">还没有抽取历史记录</div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {history.map(renderHistoryItem)}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {loading ? (
                  <div
                    className="text-[var(--text-secondary)] text-center py-8 text-sm"
                  >
                    加载中...
                  </div>
                ) : schemes.length === 0 ? (
                  <div
                    className="bg-[var(--bg-card)] border-[2px] border-[color:var(--border-color)] text-[var(--text-secondary)] text-center py-16 rounded-xl"
                  >
                    <div className="flex justify-center mb-3"><Icon name="wheel" size={48} /></div>
                    <div className="text-[var(--text-primary)] text-base font-medium mb-1">
                      还没有转盘方案
                    </div>
                    <div className="text-sm mb-4">
                      新建一个方案，或从已有 .wheel.json 文件导入
                    </div>
                    <div className="flex justify-center gap-2">
                      <button
                        onClick={handleCreate}
                        className="bg-[var(--accent-bg)] text-[var(--accent)] border border-[color:var(--accent)] px-4 py-2 text-sm rounded-lg transition-colors"
                      >
                        + 新建方案
                      </button>
                      <button
                        onClick={handleImport}
                        className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[color:var(--border-color)] px-4 py-2 text-sm rounded-lg transition-colors"
                      >
                        <><Icon name="download" size={16} /> 导入方案</>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {schemes.map(renderSchemeCard)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 编辑视图 */}
        {view === 'edit' && editingScheme && (
          <div className="flex-1 flex flex-col">
            <div className="text-[var(--text-secondary)] mb-3 text-sm">
              {schemes.some((s) => s.id === editingScheme.id) ? '编辑方案' : '新建方案'}
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
          <div className="flex-1 flex flex-col">
            <div className="text-[var(--text-secondary)] mb-3 text-sm">
              正在抽取：{playingScheme.name}
            </div>
            <WheelPlayground
              scheme={playingScheme}
              onClose={handleClosePlay}
              onComplete={handlePlayComplete}
            />
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm shadow-lg z-50"
          style={{
            background:
              toast.type === 'error'
                ? 'var(--tone-danger)'
                : toast.type === 'success'
                  ? 'var(--tone-success)'
                  : 'var(--bg-card)',
            color: toast.type === 'info' ? 'var(--text-primary)' : 'var(--text-on-accent)',
            border: '1px solid var(--border-color)',
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
