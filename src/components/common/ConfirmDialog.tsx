import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 通用二次确认对话框
 *
 * 使用方式：
 *   const [open, setOpen] = useState(false);
 *   <ConfirmDialog
 *     open={open}
 *     title="删除确认"
 *     message="确定删除此项？此操作不可撤销。"
 *     danger
 *     onConfirm={() => { doDelete(); setOpen(false); }}
 *     onCancel={() => setOpen(false)}
 *   />
 */
export function ConfirmDialog({
  open,
  title = '确认',
  message,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      } else if (e.key === 'Enter') {
        e.stopPropagation();
        onConfirm();
      }
    };
    window.addEventListener('keydown', handler);
    // 自动聚焦确认按钮
    setTimeout(() => confirmBtnRef.current?.focus(), 10);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  const confirmColor = danger ? '#dc2626' : '#2563eb';
  const confirmBg = danger ? 'rgba(220,38,38,0.08)' : 'rgba(37,99,235,0.08)';

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
      onClick={onCancel}
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
          minWidth: 320,
          maxWidth: 480,
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
            marginBottom: 24,
            fontSize: 13,
            lineHeight: 1.6,
            color: 'var(--text-secondary, #555)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {message}
        </p>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              border: '1px solid var(--border-color, #e5e7eb)',
              borderRadius: 6,
              background: 'transparent',
              color: 'var(--text-primary, #111)',
              cursor: 'pointer',
            }}
          >
            {cancelText}
          </button>
          <button
            ref={confirmBtnRef}
            onClick={onConfirm}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 600,
              border: `1px solid ${confirmColor}33`,
              borderRadius: 6,
              background: confirmBg,
              color: confirmColor,
              cursor: 'pointer',
            }}
          >
            {confirmText}
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
