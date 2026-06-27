// ============================================================
// EPUB 导出进度弹窗
// 监听主进程推送的进度（phase + current/total + message + imageProgress）
// - scanning / downloading-images / building-html / packaging：不可关闭
// - done：显示文件路径 + 关闭按钮（成功后由外部 onClose 关闭）
// - error：显示错误信息 + 关闭按钮
// ============================================================

import { useEffect, useState } from 'react'

type EpubPhase = 'scanning' | 'downloading-images' | 'building-html' | 'packaging' | 'done' | 'error'

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
  scanning: '扫描正文图片...',
  'downloading-images': '下载图片...',
  'building-html': '构建章节 HTML...',
  packaging: '打包 EPUB 文件...',
  done: '导出完成',
  error: '导出失败',
}

export function EpubExportProgressDialog({ open, onClose }: EpubExportProgressDialogProps) {
  const [progress, setProgress] = useState<EpubProgressPayload | null>(null)

  useEffect(() => {
    if (!open) {
      setProgress(null)
      return
    }
    // 重置进度（每次打开弹窗时清空旧状态）
    setProgress({ phase: 'scanning', current: 0, total: 0, message: '准备导出...' })
    const unsubscribe = window.electronAPI?.onEpubExportProgress((p: EpubProgressPayload) => {
      setProgress(p)
    })
    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [open])

  if (!open) return null

  const phase = progress?.phase ?? 'scanning'
  const message = progress?.message ?? ''
  const isRunning = phase !== 'done' && phase !== 'error'
  const isDone = phase === 'done'
  const isError = phase === 'error'

  // 进度百分比：仅 downloading-images 阶段有 imageProgress.current/total
  // 其他运行阶段用 current/total 或 indeterminate
  let percent = 0
  let progressText = ''
  if (phase === 'downloading-images' && progress?.imageProgress) {
    const { current, total, failed } = progress.imageProgress
    percent = total > 0 ? Math.round((current / total) * 100) : 0
    progressText = failed > 0 ? `${current} / ${total}（失败 ${failed}）` : `${current} / ${total}`
  } else if (progress && progress.total > 0) {
    percent = Math.round((progress.current / progress.total) * 100)
    progressText = `${progress.current} / ${progress.total}`
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
    >
      <div
        className="rounded-2xl p-6 w-96 max-w-[90vw] border"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
      >
        {/* 标题 */}
        <div className="flex items-center gap-2 mb-4">
          <div className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            {isDone ? '✅ 导出完成' : isError ? '❌ 导出失败' : '📚 导出 EPUB 电子书'}
          </div>
        </div>

        {/* 阶段说明 */}
        <div className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
          {isDone || isError ? message : `${PHASE_LABEL[phase]}${message ? ' · ' + message : ''}`}
        </div>

        {/* 进度条 */}
        {isRunning && (
          <>
            <div className="h-2 rounded-full overflow-hidden mb-2" style={{ background: 'var(--bg-hover)' }}>
              <div
                className="h-full transition-all"
                style={{
                  width: `${percent}%`,
                  background: 'var(--accent)',
                }}
              />
            </div>
            {progressText && (
              <div className="text-xs text-right" style={{ color: 'var(--text-secondary)' }}>
                {progressText}
              </div>
            )}
          </>
        )}

        {/* 成功状态显示文件路径 */}
        {isDone && (
          <div
            className="text-xs mt-3 mb-4 p-2.5 rounded-lg break-all"
            style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
          >
            {message}
          </div>
        )}

        {/* 错误状态显示错误信息 */}
        {isError && (
          <div
            className="text-xs mt-3 mb-4 p-2.5 rounded-lg break-all"
            style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
          >
            {message}
          </div>
        )}

        {/* 操作按钮 */}
        {!isRunning && (
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs rounded-lg transition-colors"
              style={{
                background: isDone ? 'var(--accent)' : 'var(--bg-card)',
                color: isDone ? 'var(--text-on-accent)' : 'var(--text-primary)',
                border: isDone ? 'none' : '1px solid var(--border-color)',
              }}
              onMouseEnter={(e) => {
                if (isDone) e.currentTarget.style.opacity = '0.9'
                else e.currentTarget.style.background = 'var(--bg-hover)'
              }}
              onMouseLeave={(e) => {
                if (isDone) e.currentTarget.style.opacity = '1'
                else e.currentTarget.style.background = 'var(--bg-card)'
              }}
            >
              关闭
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
