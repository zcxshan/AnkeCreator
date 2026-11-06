import { useRef } from 'react';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  /** 覆盖层级；全局确认框可用更高值压在其他弹窗之上 */
  zIndex?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 通用二次确认对话框
 *
 * 声明式用法：
 *   <ConfirmDialog open={open} message="确定删除？" danger
 *     onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} />
 *
 * 命令式用法（推荐在事件处理里使用）：
 *   if (!(await askConfirm({ message: '确定删除？', danger: true }))) return;
 */
export function ConfirmDialog({
  open,
  title = '确认',
  message,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  zIndex = 9000,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const confirmBg = danger ? 'var(--an-pink)' : 'var(--an-mint)';

  return (
    <Modal
      open={open}
      onClose={onCancel}
      zIndex={zIndex}
      role="alertdialog"
      labelledBy="confirm-dialog-title"
      describedBy="confirm-dialog-message"
      initialFocusRef={confirmBtnRef}
      contentStyle={{
        background: 'var(--an-card)',
        borderRadius: 'var(--an-radius-md)',
        boxShadow: 'var(--an-shadow-pop-lg), var(--an-shadow-soft)',
        padding: '22px 24px 18px',
        minWidth: 320,
        maxWidth: 480,
        animation: 'modalSlideIn 0.18s var(--an-ease-bounce)',
        border: 'var(--an-line)',
      }}
    >
      <h3
        id="confirm-dialog-title"
        className="m-[0px] mb-[10px] text-[17px] font-bold text-[var(--an-ink)]"
        style={{ fontFamily: 'var(--an-font-display)' }}
      >
        {title}
      </h3>
      <p
        id="confirm-dialog-message"
        className="m-[0px] mb-[20px] text-[13px] leading-[1.7] text-[var(--an-ink-soft)] whitespace-pre-wrap"
      >
        {message}
      </p>
      <div className="flex justify-end gap-[8px]">
        <button type="button" onClick={onCancel} className="an-btn an-btn--sm an-btn--ghost">
          {cancelText}
        </button>
        <button
          ref={confirmBtnRef}
          type="button"
          onClick={onConfirm}
          className="an-btn an-btn--sm"
          style={{
            background: confirmBg,
            color: '#2a1a33',
            border: '2px solid var(--an-ink)',
            boxShadow: '0 2px 0 var(--an-ink)',
            fontWeight: 700,
          }}
        >
          {confirmText}
        </button>
      </div>
    </Modal>
  );
}
