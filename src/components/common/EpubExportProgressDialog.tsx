// ============================================================
// EPUB 导出进度弹窗
// 监听主进程推送的进度（phase + current/total + message + imageProgress）
// 功能：
// - 更醒目的视觉样式（深色遮罩 + 居中大弹窗 + 彩色进度条）
// - 暂停/继续/取消按钮
// - 完成/失败状态显示
// ============================================================

import { useEffect, useState, useCallback } from 'react'
import { Icon, type IconName } from './Icon'

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
  onRetry?: () => void
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

const PHASE_ICON: Record<EpubPhase, IconName> = {
  scanning: 'search',
  'downloading-images': 'image',
  'building-html': 'pen',
  packaging: 'box',
  done: 'check',
  error: 'alert',
  canceled: 'x',
}

export function EpubExportProgressDialog({ open, onClose, onRetry }: EpubExportProgressDialogProps) {
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
        const total = progress?.total ?? 0
        const current = progress?.current ?? 0
        const subPercent = total > 0 ? (current / total) * 100 : (ph === 'scanning' ? 50 : 0)
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--scrim-strong)] backdrop-blur-[4px]">
      <div className="epub-dialog-in rounded-2xl w-[480px] max-w-[92vw] shadow-2xl overflow-hidden bg-[var(--bg-card)] border border-[var(--border-color)]">
        {/* 顶部彩色条 */}
        <div
          className="h-1.5 transition-all duration-300"
          style={{
            background: isDone
              ? 'var(--gradient-success)'
              : isError
              ? 'var(--gradient-danger)'
              : isCanceled
              ? 'var(--gradient-neutral)'
              : paused
              ? 'var(--gradient-warn)'
              : 'linear-gradient(90deg, var(--tone-indigo), var(--tone-purple), var(--tone-purple))',
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
                  ? 'var(--tone-success-soft)'
                  : isError
                  ? 'var(--tone-danger-veil)'
                  : isCanceled
                  ? 'var(--tone-neutral-soft)'
                  : paused
                  ? 'var(--tone-warn-veil)'
                  : 'var(--accent-soft)',
              }}
            >
              {paused && isRunning ? <Icon name="clock" size={22} /> : <Icon name={PHASE_ICON[phase]} size={22} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-lg font-semibold text-[var(--text-primary)]">
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
              <div className="text-xs mt-0.5 text-[var(--text-secondary)]">
                {isRunning && !paused && PHASE_LABEL[phase]}
                {isRunning && paused && '点击「继续」恢复导出进度'}
                {isDone && '文件已保存到指定位置'}
                {isError && message}
                {isCanceled && '导出已被取消，文件未保存'}
              </div>
            </div>
            {isRunning && (
              <div className="text-right shrink-0">
                <div className="text-2xl font-bold tabular-nums text-[var(--accent)]">
                  {overallPercent}%
                </div>
              </div>
            )}
          </div>

          {/* 主进度条 */}
          {isRunning && (
            <div className="h-3 rounded-full overflow-hidden mb-2 bg-[var(--bg-hover)]">
              <div
                className="h-full rounded-full transition-all duration-300 ease-out"
                style={{
                  width: `${overallPercent}%`,
                  background: paused
                    ? 'var(--gradient-warn)'
                    : 'linear-gradient(90deg, var(--tone-indigo), var(--tone-purple), var(--tone-purple))',
                  boxShadow: paused
                    ? '0 0 8px var(--tone-warn-glow)'
                    : '0 0 8px var(--tone-indigo-glow)',
                }}
              />
            </div>
          )}

          {/* 阶段详情（下载图片时显示详细进度） */}
          {isRunning && phase === 'downloading-images' && progress?.imageProgress && (
            <div className="mb-2">
              <div className="flex justify-between items-center text-xs mb-1 text-[var(--text-secondary)]">
                <span>图片下载进度</span>
                <span className="tabular-nums">
                  {progress.imageProgress.current} / {progress.imageProgress.total}
                  {progress.imageProgress.failed > 0 && (
                    <span className="text-[var(--error)]"> · 失败 {progress.imageProgress.failed}</span>
                  )}
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden bg-[var(--bg-hover)]">
                <div
                  className="h-full rounded-full transition-all duration-200 bg-[var(--tone-indigo-soft)]"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          )}

          {/* 阶段消息 */}
          {isRunning && progressText && (
            <div className="text-xs mt-2 mb-1 text-[var(--text-tertiary)]">
              {progressText}
            </div>
          )}

          {/* 成功状态 */}
          {isDone && (
            <div className="text-sm mt-2 mb-4 p-3.5 rounded-xl flex items-start gap-2.5 bg-[var(--tone-success-soft)] border border-[var(--tone-success-border)]">
              <span className="shrink-0"><Icon name="folder" size={16} /></span>
              <span className="flex-1 break-all text-[var(--text-secondary)]">
                {message}
              </span>
            </div>
          )}

          {/* 取消状态 */}
          {isCanceled && (
            <div className="text-sm mt-2 mb-4 p-3.5 rounded-xl flex items-start gap-2.5 bg-[var(--tone-neutral-soft)] border border-[var(--tone-neutral-border)]">
              <span className="shrink-0"><Icon name="ban" size={16} /></span>
              <span className="flex-1 text-[var(--text-secondary)]">
                {message || '导出已取消'}
              </span>
            </div>
          )}

          {/* 错误状态 */}
          {isError && (
            <div className="text-sm mt-2 mb-4 p-3.5 rounded-xl flex items-start gap-2.5 bg-[var(--tone-danger-soft)] border border-[var(--tone-danger-border)]">
              <span className="shrink-0"><Icon name="alert" size={16} /></span>
              <span className="flex-1 break-all text-[var(--error)]">
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
                  className="px-4 py-2 text-sm rounded-lg transition-colors cursor-pointer bg-transparent text-[var(--text-secondary)] border border-[var(--border-color)] hover:text-[var(--error)] hover:border-[var(--error)]"
                >
                  取消导出
                </button>
                {/* 暂停/继续按钮 */}
                {paused ? (
                  <button
                    onClick={handleResume}
                    className="px-5 py-2 text-sm font-medium rounded-lg transition-opacity cursor-pointer bg-[var(--accent)] text-[var(--text-on-accent)] border-0 hover:opacity-[0.85]"
                  >
                    <span className="inline-flex items-center gap-1"><Icon name="play" size={14} /> 继续</span>
                  </button>
                ) : (
                  <button
                    onClick={handlePause}
                    className="px-5 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer bg-[var(--tone-warn-veil)] text-[var(--tone-warn-ink)] border border-[var(--tone-warn-border)]"
                  >
                    <span className="inline-flex items-center gap-1"><Icon name="pause" size={14} /> 暂停</span>
                  </button>
                )}
              </>
            ) : (
              <>
                {/* 完成状态 + 有失败图片时显示重试按钮 */}
                {isDone && progress?.imageProgress && progress.imageProgress.failed > 0 && onRetry && (
                  <button
                    onClick={onRetry}
                    className="px-5 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer bg-[var(--tone-warn-veil)] text-[var(--tone-warn-ink)] border border-[var(--tone-warn-border)]"
                    title={`重新导出以重试 ${progress.imageProgress.failed} 张失败图片`}
                  >
                    <span className="inline-flex items-center gap-1"><Icon name="refresh" size={14} /> 重试失败图片</span>
                  </button>
                )}
                <button
                  onClick={onClose}
                  className={`px-6 py-2 text-sm font-medium rounded-lg transition-opacity cursor-pointer border-0 hover:opacity-[0.85] ${isDone ? 'bg-[var(--accent)] text-[var(--text-on-accent)]' : 'bg-[var(--bg-hover)] text-[var(--text-primary)]'}`}
                >
                  {isDone ? '完成' : '关闭'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
