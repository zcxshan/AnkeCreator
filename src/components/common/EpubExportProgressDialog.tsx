// ============================================================
// EPUB 导出进度弹窗
// 监听主进程推送的进度（phase + current/total + message + imageProgress）
// 功能：
// - 更醒目的视觉样式（深色遮罩 + 居中大弹窗 + 彩色进度条）
// - 暂停/继续/取消按钮
// - 完成/失败状态显示
// ============================================================

import { useEffect, useState, useCallback } from 'react'

type EpubPhase = 'scanning' | 'downloading-images' | 'building-html' | 'packaging' | 'done' | 'error' | 'canceled'

interface EpubProgressPayload {
  phase: EpubPhase
  current: number
  total: number
  message: string
  imageProgress?: { current: number; total: number; failed: number }
}

interface EpubExportProgressDialogProps {
  open: boolean
  onClose: () => void
}

const PHASE_LABEL: Record<EpubPhase, string> = {
  scanning: '正在扫描正文图片...',
  'downloading-images': '正在下载图片...',
  'building-html': '正在构建章节内容...',
  packaging: '正在打包 EPUB 文件...',
  done: '导出完成',
  error: '导出失败',
  canceled: '已取消导出',
}

const PHASE_ICON: Record<EpubPhase, string> = {
  scanning: '🔍',
  'downloading-images': '🖼️',
  'building-html': '📝',
  packaging: '📦',
  done: '✅',
  error: '❌',
  canceled: '🚫',
}

export function EpubExportProgressDialog({ open, onClose }: EpubExportProgressDialogProps) {
  const [progress, setProgress] = useState<EpubProgressPayload | null>(null)
  const [paused, setPaused] = useState(false)

  const api = (window as any).electronAPI

  const handlePause = useCallback(async () => {
    if (!api?.pauseEpubExport) return
    setPaused(true)
    try { await api.pauseEpubExport() } catch { /* ignore */ }
  }, [api])

  const handleResume = useCallback(async () => {
    if (!api?.resumeEpubExport) return
    setPaused(false)
    try { await api.resumeEpubExport() } catch { /* ignore */ }
  }, [api])

  const handleCancel = useCallback(async () => {
    if (!api?.cancelEpubExport) return
    try { await api.cancelEpubExport() } catch { /* ignore */ }
  }, [api])

  useEffect(() => {
    if (!open) {
      setProgress(null)
      setPaused(false)
      return
    }
    setProgress({ phase: 'scanning', current: 0, total: 0, message: '准备导出...' })
    setPaused(false)
    const unsubscribe = api?.onEpubExportProgress?.((p: EpubProgressPayload) => {
      setProgress(p)
    })
    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [open, api])

  if (!open) return null

  const phase = progress?.phase ?? 'scanning'
  const message = progress?.message ?? ''
  const isRunning = phase !== 'done' && phase !== 'error' && phase !== 'canceled'
  const isDone = phase === 'done'
  const isError = phase === 'error'
  const isCanceled = phase === 'canceled'
  const isFinished = isDone || isError || isCanceled

  let percent = 0
  let progressText = message
  if (phase === 'downloading-images' && progress?.imageProgress) {
    const { current, total } = progress.imageProgress
    percent = total > 0 ? Math.round((current / total) * 100) : 0
    if (!progressText) progressText = `${current} / ${total}`
  } else if (progress && progress.total > 0) {
    percent = Math.round((progress.current / progress.total) * 100)
    if (!progressText) progressText = `${progress.current} / ${progress.total}`
  }

  // 计算各阶段整体进度（给用户更好的整体感知）
  const PHASE_WEIGHTS = {
    scanning: 5,
    'downloading-images': 70,
    'building-html': 20,
    packaging: 5,
  }
  let overallPercent = 0
  if (isRunning) {
    let weightSum = 0
    const phaseOrder: EpubPhase[] = ['scanning', 'downloading-images', 'building-html', 'packaging']
    for (const ph of phaseOrder) {
      if (ph === phase) {
        const w = PHASE_WEIGHTS[ph]
        const subPercent = progress?.total > 0 ? (progress.current / progress.total) * 100 : (ph === 'scanning' ? 50 : 0)
        overallPercent = weightSum + (subPercent / 100) * w
        break
      }
      weightSum += PHASE_WEIGHTS[ph as keyof typeof PHASE_WEIGHTS]
    }
  } else if (isDone) {
    overallPercent = 100
  } else if (isError || isCanceled) {
    overallPercent = percent
  }
  overallPercent = Math.min(100, Math.round(overallPercent))

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="rounded-2xl w-[480px] max-w-[92vw] shadow-2xl overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          animation: 'epubDialogIn 0.25s ease-out',
        }}
      >
        {/* 顶部彩色条 */}
        <div
          className="h-1.5 transition-all duration-300"
          style={{
            background: isDone
              ? 'linear-gradient(90deg, #22c55e, #16a34a)'
              : isError
              ? 'linear-gradient(90deg, #ef4444, #dc2626)'
              : isCanceled
              ? 'linear-gradient(90deg, #6b7280, #4b5563)'
              : paused
              ? 'linear-gradient(90deg, #f59e0b, #d97706)'
              : 'linear-gradient(90deg, #6366f1, #8b5cf6, #a855f7)',
            width: isFinished ? '100%' : `${overallPercent}%`,
          }}
        />

        <div className="p-6">
          {/* 标题区：图标 + 标题 */}
          <div className="flex items-center gap-3 mb-5">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0"
              style={{
                background: isDone
                  ? 'rgba(34,197,94,0.12)'
                  : isError
                  ? 'rgba(239,68,68,0.12)'
                  : isCanceled
                  ? 'rgba(107,114,128,0.12)'
                  : paused
                  ? 'rgba(245,158,11,0.12)'
                  : 'var(--accent-soft)',
              }}
            >
              {paused && isRunning ? '⏸️' : PHASE_ICON[phase]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {isDone
                  ? 'EPUB 导出完成'
                  : isError
                  ? '导出失败'
                  : isCanceled
                  ? '导出已取消'
                  : paused
                  ? '已暂停'
                  : '导出 EPUB 电子书'}
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                {isRunning && !paused && PHASE_LABEL[phase]}
                {isRunning && paused && '点击「继续」恢复导出进度'}
                {isDone && '文件已保存到指定位置'}
                {isError && message}
                {isCanceled && '导出已被取消，文件未保存'}
              </div>
            </div>
            {isRunning && (
              <div className="text-right shrink-0">
                <div className="text-2xl font-bold tabular-nums" style={{ color: 'var(--accent)' }}>
                  {overallPercent}%
                </div>
              </div>
            )}
          </div>

          {/* 主进度条 */}
          {isRunning && (
            <div
              className="h-3 rounded-full overflow-hidden mb-2"
              style={{ background: 'var(--bg-hover)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-300 ease-out"
                style={{
                  width: `${overallPercent}%`,
                  background: paused
                    ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                    : 'linear-gradient(90deg, #6366f1, #8b5cf6, #a855f7)',
                  boxShadow: paused
                    ? '0 0 8px rgba(245,158,11,0.4)'
                    : '0 0 8px rgba(99,102,241,0.4)',
                }}
              />
            </div>
          )}

          {/* 阶段详情（下载图片时显示详细进度） */}
          {isRunning && phase === 'downloading-images' && progress?.imageProgress && (
            <div className="mb-2">
              <div className="flex justify-between items-center text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                <span>图片下载进度</span>
                <span className="tabular-nums">
                  {progress.imageProgress.current} / {progress.imageProgress.total}
                  {progress.imageProgress.failed > 0 && (
                    <span style={{ color: 'var(--error, #ef4444)' }}> · 失败 {progress.imageProgress.failed}</span>
                  )}
                </span>
              </div>
              <div
                className="h-1.5 rounded-full overflow-hidden"
                style={{ background: 'var(--bg-hover)' }}
              >
                <div
                  className="h-full rounded-full transition-all duration-200"
                  style={{
                    width: `${percent}%`,
                    background: 'rgba(99,102,241,0.5)',
                  }}
                />
              </div>
            </div>
          )}

          {/* 阶段消息 */}
          {isRunning && progressText && (
            <div className="text-xs mt-2 mb-1" style={{ color: 'var(--text-tertiary, #999)' }}>
              {progressText}
            </div>
          )}

          {/* 成功状态 */}
          {isDone && (
            <div
              className="text-sm mt-2 mb-4 p-3.5 rounded-xl flex items-start gap-2.5"
              style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}
            >
              <span className="text-base">📁</span>
              <span className="flex-1 break-all" style={{ color: 'var(--text-secondary)' }}>
                {message}
              </span>
            </div>
          )}

          {/* 取消状态 */}
          {isCanceled && (
            <div
              className="text-sm mt-2 mb-4 p-3.5 rounded-xl flex items-start gap-2.5"
              style={{ background: 'rgba(107,114,128,0.08)', border: '1px solid rgba(107,114,128,0.2)' }}
            >
              <span className="text-base">🚫</span>
              <span className="flex-1" style={{ color: 'var(--text-secondary)' }}>
                {message || '导出已取消'}
              </span>
            </div>
          )}

          {/* 错误状态 */}
          {isError && (
            <div
              className="text-sm mt-2 mb-4 p-3.5 rounded-xl flex items-start gap-2.5"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              <span className="text-base">⚠️</span>
              <span className="flex-1 break-all" style={{ color: 'var(--error, #ef4444)' }}>
                {message}
              </span>
            </div>
          )}

          {/* 操作按钮区 */}
          <div className="flex justify-end gap-2 mt-5">
            {isRunning ? (
              <>
                {/* 取消按钮 */}
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 text-sm rounded-lg transition-colors"
                  style={{
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--error, #ef4444)'
                    e.currentTarget.style.color = 'var(--error, #ef4444)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-color)'
                    e.currentTarget.style.color = 'var(--text-secondary)'
                  }}
                >
                  取消导出
                </button>
                {/* 暂停/继续按钮 */}
                {paused ? (
                  <button
                    onClick={handleResume}
                    className="px-5 py-2 text-sm font-medium rounded-lg transition-colors"
                    style={{
                      background: 'var(--accent)',
                      color: 'var(--text-on-accent)',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85' }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
                  >
                    ▶ 继续
                  </button>
                ) : (
                  <button
                    onClick={handlePause}
                    className="px-5 py-2 text-sm font-medium rounded-lg transition-colors"
                    style={{
                      background: 'rgba(245,158,11,0.12)',
                      color: '#d97706',
                      border: '1px solid rgba(245,158,11,0.3)',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(245,158,11,0.2)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(245,158,11,0.12)' }}
                  >
                    ⏸ 暂停
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={onClose}
                className="px-6 py-2 text-sm font-medium rounded-lg transition-colors"
                style={{
                  background: isDone ? 'var(--accent)' : 'var(--bg-hover)',
                  color: isDone ? 'var(--text-on-accent)' : 'var(--text-primary)',
                  border: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85' }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
              >
                {isDone ? '完成' : '关闭'}
              </button>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes epubDialogIn {
          from { opacity: 0; transform: scale(0.92) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  )
}
