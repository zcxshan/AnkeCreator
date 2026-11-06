import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// 多个弹窗叠加时共享滚动锁，避免先关闭的弹窗把 body 提前解锁
let scrollLockCount = 0;
let savedBodyOverflow = '';

function lockBodyScroll() {
  if (scrollLockCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = savedBodyOverflow;
  }
}

const MODAL_KEYFRAMES_ID = 'anke-modal-keyframes';

/** 全局只注入一次动画 keyframes */
function ensureModalKeyframes() {
  if (typeof document === 'undefined' || document.getElementById(MODAL_KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = MODAL_KEYFRAMES_ID;
  style.textContent = `
    @keyframes modalFade {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes modalSlideIn {
      from { opacity: 0; transform: translateY(-8px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
  `;
  document.head.appendChild(style);
}

const DEFAULT_OVERLAY_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(64, 50, 92, 0.42)',
  backdropFilter: 'blur(3px)',
  animation: 'modalFade 0.15s ease-out',
};

const DEFAULT_CONTENT_STYLE: React.CSSProperties = {
  background: 'var(--an-card)',
  color: 'var(--an-ink)',
  borderRadius: 'var(--an-radius-md)',
  border: 'var(--an-line)',
  boxShadow: 'var(--an-shadow-pop-lg), var(--an-shadow-soft)',
  animation: 'modalSlideIn 0.18s var(--an-ease-bounce)',
};

export interface ModalProps {
  open: boolean;
  /** 点击遮罩 / Esc */
  onClose?: () => void;
  /** 覆盖层级，默认 9000 */
  zIndex?: number;
  role?: 'dialog' | 'alertdialog';
  labelledBy?: string;
  describedBy?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** 与默认遮罩样式合并，覆盖冲突项 */
  overlayStyle?: React.CSSProperties;
  /** 与默认内容容器样式合并 */
  contentStyle?: React.CSSProperties;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  contentClassName?: string;
  overlayClassName?: string;
  children: React.ReactNode;
}

/**
 * 统一模态弹窗原语：portal、遮罩、滚动锁、焦点陷阱、Esc、焦点恢复
 */
export function Modal({
  open,
  onClose,
  zIndex = 9000,
  role = 'dialog',
  labelledBy,
  describedBy,
  initialFocusRef,
  overlayStyle,
  contentStyle,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  contentClassName,
  overlayClassName,
  children,
}: ModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // 用 ref 持有最新值，避免内联回调导致每次渲染都重置焦点/滚动锁
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeOnEscapeRef = useRef(closeOnEscape);
  closeOnEscapeRef.current = closeOnEscape;

  useEffect(() => {
    if (!open) return;
    ensureModalKeyframes();
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    lockBodyScroll();

    const focusTimer = window.setTimeout(() => {
      const target =
        initialFocusRef?.current ??
        contentRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
        null;
      target?.focus?.();
    }, 10);

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!closeOnEscapeRef.current || !onCloseRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      // 焦点陷阱：Tab / Shift+Tab 只在弹窗内部循环
      const root = contentRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (node) => node.getClientRects().length > 0,
      );
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    // 捕获阶段监听，确保子组件/其他弹窗的 Esc 处理不会抢先
    window.addEventListener('keydown', handler, true);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handler, true);
      unlockBodyScroll();
      restoreFocusRef.current?.focus?.();
      restoreFocusRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className={overlayClassName}
      style={{ ...DEFAULT_OVERLAY_STYLE, zIndex, ...overlayStyle }}
      onClick={() => {
        if (!closeOnOverlayClick) return;
        onClose?.();
      }}
    >
      <div
        ref={contentRef}
        className={contentClassName}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onClick={(e) => e.stopPropagation()}
        style={{ ...DEFAULT_CONTENT_STYLE, ...contentStyle }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
