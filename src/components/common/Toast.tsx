import { useEffect, useRef } from 'react';
import { useToastStore } from '../../store/toastStore';

// 颜色映射
const typeStyles: Record<string, { bg: string; border: string; textColor: string; icon: string }> = {
  success: {
    bg: 'rgba(34, 197, 94, 0.12)',
    border: '1px solid rgba(34, 197, 94, 0.4)',
    textColor: '#16a34a',
    icon: '✓',
  },
  error: {
    bg: 'rgba(239, 68, 68, 0.12)',
    border: '1px solid rgba(239, 68, 68, 0.4)',
    textColor: '#dc2626',
    icon: '✕',
  },
  warning: {
    bg: 'rgba(245, 158, 11, 0.12)',
    border: '1px solid rgba(245, 158, 11, 0.4)',
    textColor: '#d97706',
    icon: '!',
  },
  info: {
    bg: 'rgba(59, 130, 246, 0.12)',
    border: '1px solid rgba(59, 130, 246, 0.4)',
    textColor: '#2563eb',
    icon: 'ℹ',
  },
};

function ToastItem({
  id,
  message,
  type,
  duration,
  undo,
  onHide,
}: {
  id: string;
  message: string;
  type: string;
  duration: number;
  undo?: () => void;
  onHide: (id: string) => void;
}) {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (duration > 0) {
      timerRef.current = window.setTimeout(() => {
        onHide(id);
      }, duration);
    }
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [id, duration, onHide]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onHide(id);
  };

  const style = typeStyles[type] || typeStyles.info;

  return (
    <div
      role="status"
      tabIndex={0}
      onKeyDown={handleKey}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 14px',
        background: style.bg,
        border: style.border,
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        minWidth: 220,
        maxWidth: 460,
        animation: 'toastFadeIn 0.2s ease-out',
        fontSize: 13,
        backdropFilter: 'blur(8px)',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
          borderRadius: 10,
          background: style.textColor,
          color: '#fff',
          fontSize: 12,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {style.icon}
      </span>
      <span
        style={{
          color: 'var(--text-primary)',
          flex: 1,
          wordBreak: 'break-word',
          lineHeight: 1.4,
        }}
      >
        {message}
      </span>
      {undo && (
        <button
          onClick={() => {
            undo();
            onHide(id);
          }}
          style={{
            marginLeft: 6,
            padding: '4px 10px',
            border: '1px solid var(--border-color)',
            borderRadius: 4,
            background: 'transparent',
            color: style.textColor,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          撤销
        </button>
      )}
      <button
        onClick={() => onHide(id)}
        aria-label="关闭"
        style={{
          marginLeft: 2,
          padding: 2,
          border: 'none',
          background: 'transparent',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: 14,
          opacity: 0.6,
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.opacity = '1';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.opacity = '0.6';
        }}
      >
        ✕
      </button>
    </div>
  );
}

/**
 * 全局 Toast 容器，放置在 App 根组件中
 */
export function ToastContainer() {
  const { toasts, hideToast } = useToastStore();

  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div key={t.id} style={{ pointerEvents: 'auto' }}>
          <ToastItem
            id={t.id}
            message={t.message}
            type={t.type}
            duration={t.duration}
            undo={t.undo}
            onHide={hideToast}
          />
        </div>
      ))}
      <style>
        {`
          @keyframes toastFadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}
      </style>
    </div>
  );
}
