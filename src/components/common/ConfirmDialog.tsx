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

  const confirmColor = danger ? 'var(--danger)' : 'var(--accent)';
  const confirmBg = danger
    ? 'var(--danger-soft)'
    : 'var(--accent-bg)';

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
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg, 10px)',
        boxShadow: 'var(--shadow-modal)',
        padding: '24px 28px 20px',
        minWidth: 320,
        maxWidth: 480,
        animation: 'modalSlideIn 0.18s ease-out',
        border: '1px solid var(--border-color)',
      }}
    >
      <h3
        id="confirm-dialog-title"
        className="m-[0px] mb-[12px] text-[16px] font-semibold text-[var(--text-primary)]"
      >
        {title}
      </h3>
      <p
        id="confirm-dialog-message"
        className="m-[0px] mb-[24px] text-[13px] leading-[1.6] text-[var(--text-secondary)] whitespace-pre-wrap"
      >
        {message}
      </p>
      <div
        className="flex justify-end gap-[8px]"
      >
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '8px 18px',
            fontSize: 13,
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md, 6px)',
            background: 'transparent',
            color: 'var(--text-primary)',
            cursor: 'pointer',
          }}
        >
          {cancelText}
        </button>
        <button
          ref={confirmBtnRef}
          type="button"
          onClick={onConfirm}
          style={{
            padding: '8px 18px',
            fontSize: 13,
            fontWeight: 600,
            border: '1px solid var(--border-color, transparent)',
            borderRadius: 'var(--radius-md, 6px)',
            background: confirmBg,
            color: confirmColor,
            cursor: 'pointer',
          }}
        >
          {confirmText}
        </button>
      </div>
    </Modal>
  );
}
