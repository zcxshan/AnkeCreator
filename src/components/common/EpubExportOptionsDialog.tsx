// ============================================================
// EPUB 导出选项弹窗
//
// 在「下载图片中」之前弹出，让用户选择：
//   1. 是否内嵌图片（默认开）
//      - 开：下载/读取所有图片嵌入到 EPUB，离线可看
//      - 关：HTML 中保留远程 URL，EPUB 阅读器联网显示（导出文件小、秒完成）
//
// 取消 / 确认回调
// ============================================================

import { useEffect, useState } from 'react'

export interface EpubExportOptions {
  embedImages: boolean
}

interface Props {
  open: boolean
  /** 作品标题，用于副标题 */
  storyTitle?: string
  /** 估算的「唯一图片数」（扫描结果） */
  estimatedImages?: number
  /** 「保留远程链接」模式下能省多少时间（可选） */
  estimatedEmbedMs?: number
  onCancel: () => void
  onConfirm: (options: EpubExportOptions) => void
}

export function EpubExportOptionsDialog({
  open,
  storyTitle,
  estimatedImages,
  estimatedEmbedMs,
  onCancel,
  onConfirm,
}: Props) {
  const [embedImages, setEmbedImages] = useState(true)

  useEffect(() => {
    if (open) setEmbedImages(true)
  }, [open])

  if (!open) return null

  const embedSec = estimatedEmbedMs ? Math.ceil(estimatedEmbedMs / 1000) : null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        animation: 'epubOptFade 0.18s ease-out',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className="relative w-[480px] rounded-2xl overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.05)',
          animation: 'epubOptSlideIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* 顶部彩色 accent 条 */}
        <div
          style={{
            height: 4,
            background: 'linear-gradient(90deg, var(--accent), #8b5cf6, #ec4899)',
          }}
        />

        {/* 标题栏 */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--border-color)' }}
        >
          <div className="flex items-center gap-2.5">
            <span style={{ fontSize: 22 }}>📚</span>
            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
              导出 EPUB 电子书
            </h3>
          </div>
          <button
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center rounded-full text-lg transition-colors"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)'
              e.currentTarget.style.color = 'var(--text-primary)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--text-secondary)'
            }}
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        {/* 内容区 */}
        <div className="px-6 py-5 space-y-4">
          {storyTitle && (
            <div
              className="p-3 rounded-lg"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
            >
              <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                作品
              </div>
              <div
                className="text-sm font-semibold truncate"
                style={{ color: 'var(--text-primary)' }}
                title={storyTitle}
              >
                {storyTitle}
              </div>
              {estimatedImages !== undefined && estimatedImages > 0 && (
                <div className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                  扫描到 <b style={{ color: 'var(--accent)' }}>{estimatedImages}</b> 张唯一图片
                </div>
              )}
            </div>
          )}

          <label
            className="flex items-start gap-3 p-4 rounded-xl cursor-pointer transition-all"
            style={{
              background: embedImages ? 'rgba(37,99,235,0.06)' : 'var(--bg-secondary)',
              border: embedImages ? '1.5px solid var(--accent)' : '1px solid var(--border-color)',
            }}
            onMouseEnter={(e) => {
              if (!embedImages) e.currentTarget.style.background = 'var(--bg-hover)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = embedImages ? 'rgba(37,99,235,0.06)' : 'var(--bg-secondary)'
            }}
          >
            <input
              type="checkbox"
              checked={embedImages}
              onChange={(e) => setEmbedImages(e.target.checked)}
              className="mt-0.5"
              style={{
                width: 18,
                height: 18,
                accentColor: 'var(--accent)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            />
            <div className="flex-1">
              <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                内嵌图片到 EPUB
              </div>
              <div className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {embedImages
                  ? embedSec
                    ? `下载/读取所有图片并嵌入到 EPUB。预计耗时 ${embedSec} 秒，离线可阅读。`
                    : '下载/读取所有图片并嵌入到 EPUB，离线可阅读。'
                  : 'HTML 中保留远程 URL，EPUB 阅读器联网时显示。文件极小、几秒完成；离线无法看图。'}
              </div>
            </div>
          </label>

          <div
            className="flex items-start gap-2 text-xs p-3 rounded-lg"
            style={{ background: 'rgba(245,158,11,0.08)', color: 'var(--text-secondary)' }}
          >
            <span style={{ flexShrink: 0 }}>💡</span>
            <span className="leading-relaxed">
              同一张 NGA 图在正文里被多次引用时，会自动按规范化 URL 去重，不会重复下载。NGA 图床的签名 token 也会被自动剥离。
            </span>
          </div>
        </div>

        {/* 按钮栏 */}
        <div
          className="flex justify-end gap-3 px-6 py-4"
          style={{ borderTop: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}
        >
          <button
            onClick={onCancel}
            className="px-5 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-card)'
            }}
          >
            取消
          </button>
          <button
            onClick={() => onConfirm({ embedImages })}
            className="px-6 py-2 rounded-lg text-sm font-semibold text-white transition-all"
            style={{
              background: 'var(--accent)',
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(37,99,235,0.35)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)'
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(37,99,235,0.45)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 14px rgba(37,99,235,0.35)'
            }}
          >
            开始导出
          </button>
        </div>
      </div>

      <style>{`
        @keyframes epubOptFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes epubOptSlideIn {
          from { opacity: 0; transform: translateY(-12px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  )
}
