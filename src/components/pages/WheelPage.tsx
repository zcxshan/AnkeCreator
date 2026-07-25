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
    try {
      const [list, hist] = await Promise.all([
        window.wheelAPI.listSchemes(),
        window.wheelAPI.listHistory(50),
      ])
      setSchemes(list)
      setHistory(hist)
    } catch (e) {
      console.error('[WheelPage] 加载失败:', e)
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
      if (!confirm(`确定删除方案「${scheme.name}」吗？相关历史记录也会一并删除。`)) return
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
      void now
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
    if (!confirm('确定清空所有抽取历史记录吗？')) return
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
        className="rounded-xl p-4 transition-all"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
        }}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="text-base font-medium truncate" style={{ color: 'var(--text-primary)' }}>
              {scheme.name}
            </div>
            {scheme.description && (
              <div
                className="text-xs mt-1 line-clamp-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                {scheme.description}
              </div>
            )}
          </div>
        </div>
        <div
          className="flex flex-wrap gap-x-3 gap-y-1 text-xs mb-3"
          style={{ color: 'var(--text-tertiary, #888)' }}
        >
          <span>🎯 {scheme.stages.length} 个阶段</span>
          <span>
            📝 {scheme.stages.reduce((sum, s) => sum + s.options.length, 0)} 个选项
          </span>
          {scheme.promptTemplate && <span>🤖 含 Prompt 模板</span>}
          <span>🕒 {formatTime(scheme.updated_at)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handlePlay(scheme)}
            className="px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{
              background: 'var(--accent-bg)',
              color: 'var(--accent)',
              border: '1px solid var(--accent)',
            }}
          >
            🎡 开始抽取
          </button>
          <button
            onClick={() => handleEdit(scheme)}
            className="px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{
              background: 'var(--bg-hover)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
            }}
          >
            ✏️ 编辑
          </button>
          <button
            onClick={() => handleExport(scheme)}
            className="px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{
              background: 'var(--bg-hover)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
            }}
          >
            📤 导出
          </button>
          <button
            onClick={() => handleDuplicate(scheme)}
            className="px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{
              background: 'var(--bg-hover)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
            }}
          >
            📋 复制
          </button>
          <button
            onClick={() => handleDelete(scheme)}
            className="px-3 py-1.5 text-xs rounded-lg transition-colors"
            style={{
              background: 'var(--bg-hover)',
              color: '#ef4444',
              border: '1px solid var(--border-color)',
            }}
          >
            🗑 删除
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
        className="rounded-lg p-3 text-sm"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
            {h.schemeName}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-tertiary, #888)' }}>
            {formatTime(h.drawnAt)}
          </span>
        </div>
        <div className="space-y-1">
          {validResults.map((r, i) => (
            <div key={i} className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--text-tertiary, #888)' }}>{r.stageName}：</span>
              {r.results.join('、')}
            </div>
          ))}
          {validResults.length === 0 && (
            <div className="text-xs" style={{ color: 'var(--text-tertiary, #888)' }}>
              （所有阶段均跳过）
            </div>
          )}
        </div>
        {h.finalPrompt && (
          <details className="mt-2">
            <summary
              className="cursor-pointer text-xs select-none"
              style={{ color: 'var(--accent)' }}
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
        className="flex items-center justify-between gap-3 mb-4"
        style={{ borderBottom: '1px solid var(--border-color)' }}
      >
        <div className="flex items-center gap-3 pb-3">
          <button
            onClick={onBack}
            className="px-3 py-1.5 text-sm rounded-lg transition-colors"
            style={{
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
            }}
          >
            ← 返回
          </button>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            🎡 玩转盘
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
              📜 历史 ({history.length})
            </button>
            <button
              onClick={handleImport}
              className="px-3 py-1.5 text-xs rounded-lg transition-colors"
              style={{
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
              }}
            >
              📥 导入
            </button>
            <button
              onClick={handleCreate}
              className="px-3 py-1.5 text-xs rounded-lg transition-colors"
              style={{
                background: 'var(--accent-bg)',
                color: 'var(--accent)',
                border: '1px solid var(--accent)',
              }}
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
      className="min-h-full w-full flex flex-col"
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      <div className="flex-1 w-full max-w-4xl mx-auto px-4 py-4 md:px-6 md:py-6 flex flex-col">
        {header}

        {/* 列表视图 */}
        {view === 'list' && (
          <div className="flex-1 flex flex-col gap-4">
            {showHistory ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>
                    抽取历史记录
                  </h2>
                  {history.length > 0 && (
                    <button
                      onClick={handleClearHistory}
                      className="px-3 py-1 text-xs rounded-lg transition-colors"
                      style={{
                        background: 'var(--bg-hover)',
                        color: '#ef4444',
                        border: '1px solid var(--border-color)',
                      }}
                    >
                      清空历史
                    </button>
                  )}
                </div>
                {loading ? (
                  <div
                    className="text-center py-8 text-sm"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    加载中...
                  </div>
                ) : history.length === 0 ? (
                  <div
                    className="text-center py-12 rounded-xl"
                    style={{
                      background: 'var(--bg-card)',
                      border: '2px dashed var(--border-color)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <div className="text-3xl mb-2">📜</div>
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
                    className="text-center py-8 text-sm"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    加载中...
                  </div>
                ) : schemes.length === 0 ? (
                  <div
                    className="text-center py-16 rounded-xl"
                    style={{
                      background: 'var(--bg-card)',
                      border: '2px dashed var(--border-color)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <div className="text-5xl mb-3">🎡</div>
                    <div className="text-base font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                      还没有转盘方案
                    </div>
                    <div className="text-sm mb-4">
                      新建一个方案，或从已有 .wheel.json 文件导入
                    </div>
                    <div className="flex justify-center gap-2">
                      <button
                        onClick={handleCreate}
                        className="px-4 py-2 text-sm rounded-lg transition-colors"
                        style={{
                          background: 'var(--accent-bg)',
                          color: 'var(--accent)',
                          border: '1px solid var(--accent)',
                        }}
                      >
                        + 新建方案
                      </button>
                      <button
                        onClick={handleImport}
                        className="px-4 py-2 text-sm rounded-lg transition-colors"
                        style={{
                          background: 'var(--bg-card)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-color)',
                        }}
                      >
                        📥 导入方案
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
            <div className="mb-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
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
            <div className="mb-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
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
                ? '#ef4444'
                : toast.type === 'success'
                  ? '#10b981'
                  : 'var(--bg-card)',
            color: toast.type === 'info' ? 'var(--text-primary)' : '#fff',
            border: '1px solid var(--border-color)',
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
