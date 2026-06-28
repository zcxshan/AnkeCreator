import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface CollectDecisionDialogProps {
  open: boolean;
  title?: string;
  message: string;
  failedPages: number[];
  onContinue: () => void;
  onStop: () => void;
  onSkip: () => void;
}

/**
 * 收集任务决策对话框：连续抓取失败时让用户选择
 * - 继续尝试：reset 失败计数，继续抓
 * - 停止抓取：取消任务
 * - 跳过失败页并保存：把已抓结果保存，结束任务
 */
export function CollectDecisionDialog({
  open,
  title = '抓取异常',
  message,
  failedPages,
  onContinue,
  onStop,
  onSkip,
}: CollectDecisionDialogProps) {
  const continueBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onStop();
      } else if (e.key === 'Enter') {
        e.stopPropagation();
        onContinue();
      }
    };
    window.addEventListener('keydown', handler);
    setTimeout(() => continueBtnRef.current?.focus(), 10);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onContinue, onStop]);

  if (!open) return null;

  const displayPages = failedPages.slice(0, 20);
  const overflow = failedPages.length - displayPages.length;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        animation: 'modalFade 0.15s ease-out',
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-card, #fff)',
          borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
          padding: '24px 28px 20px',
          minWidth: 360,
          maxWidth: 520,
          animation: 'modalSlideIn 0.18s ease-out',
          border: '1px solid var(--border-color, #e5e7eb)',
        }}
      >
        <h3
          style={{
            margin: 0,
            marginBottom: 12,
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--text-primary, #111)',
          }}
        >
          {title}
        </h3>
        <p
          style={{
            margin: 0,
            marginBottom: 8,
            fontSize: 13,
            lineHeight: 1.6,
            color: 'var(--text-secondary, #555)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {message}
        </p>
        {failedPages.length > 0 && (
          <div
            style={{
              margin: '0 0 16px 0',
              padding: '8px 12px',
              fontSize: 12,
              lineHeight: 1.7,
              color: 'var(--text-secondary, #555)',
              background: 'var(--bg-hover, #f5f5f5)',
              borderRadius: 6,
              border: '1px solid var(--border-color, #e5e7eb)',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary, #111)' }}>
              失败页码（{failedPages.length} 页）
            </div>
            <div style={{ wordBreak: 'break-all' }}>
              {displayPages.join(', ')}
              {overflow > 0 && <span style={{ color: 'var(--text-secondary)' }}> 等 {overflow} 页</span>}
            </div>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <button
            onClick={onStop}
            style={{
              padding: '8px 14px',
              fontSize: 13,
              border: '1px solid #dc262633',
              borderRadius: 6,
              background: 'rgba(220,38,38,0.08)',
              color: '#dc2626',
              cursor: 'pointer',
            }}
          >
            停止抓取
          </button>
          <button
            onClick={onSkip}
            style={{
              padding: '8px 14px',
              fontSize: 13,
              border: '1px solid var(--border-color, #e5e7eb)',
              borderRadius: 6,
              background: 'transparent',
              color: 'var(--text-primary, #111)',
              cursor: 'pointer',
            }}
          >
            跳过失败页并保存
          </button>
          <button
            ref={continueBtnRef}
            onClick={onContinue}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 600,
              border: '1px solid #2563eb33',
              borderRadius: 6,
              background: 'rgba(37,99,235,0.08)',
              color: '#2563eb',
              cursor: 'pointer',
            }}
          >
            继续尝试
          </button>
        </div>
      </div>
      <style>
        {`
          @keyframes modalFade {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes modalSlideIn {
            from { opacity: 0; transform: translateY(-8px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}
      </style>
    </div>,
    document.body
  );
}
