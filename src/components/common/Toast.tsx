import { useEffect, useRef } from 'react';
import { useToastStore } from '../../store/toastStore';

// 颜色映射
const typeStyles: Record<string, { bg: string; border: string; textColor: string; icon: string }> = {
  success: {
    bg: 'var(--tone-success-soft)',
    border: '1px solid var(--tone-success-border)',
    textColor: 'var(--tone-success)',
    icon: '✓',
  },
  error: {
    bg: 'var(--tone-danger-veil)',
    border: '1px solid var(--tone-danger-border-strong)',
    textColor: 'var(--tone-danger)',
    icon: '✕',
  },
  warning: {
    bg: 'var(--tone-warn-veil)',
    border: '1px solid var(--tone-warn-glow)',
    textColor: 'var(--tone-warn-ink)',
    icon: '!',
  },
  info: {
    bg: 'var(--tone-info-veil)',
    border: '1px solid var(--tone-info-border-strong)',
    textColor: 'var(--tone-info)',
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
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-card)',
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
          borderRadius: 'var(--radius-toolbar)',
          background: style.textColor,
          color: 'var(--text-on-accent)',
          fontSize: 12,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {style.icon}
      </span>
      <span
        className="text-[var(--text-primary)] flex-[1] break-words leading-[1.4]"
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
            borderRadius: 'var(--radius-sm)',
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
        className="ml-[2px] p-[2px] border-none bg-transparent text-[var(--text-secondary)] cursor-pointer text-[14px] opacity-[0.6] shrink-0"
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
        <div key={t.id} className="pointer-events-auto">
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
