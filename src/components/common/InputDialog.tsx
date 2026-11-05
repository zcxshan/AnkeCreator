import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';

interface InputDialogProps {
    open: boolean;
    title?: string;
    placeholder?: string;
    defaultValue?: string;
    multiline?: boolean;
    rows?: number; // 仅 multiline=true 时生效，默认 4
    maxLength?: number; // textarea 和 input 都生效
    confirmText?: string;
    cancelText?: string;
    onConfirm: (value: string) => void;
    onCancel: () => void;
  }

/**
 * 通用输入对话框
 *
 * 使用方式：
 *   const [open, setOpen] = useState(false);
 *   <InputDialog
 *     open={open}
 *     title="新建作品"
 *     placeholder="请输入作品标题"
 *     onConfirm={(value) => { createStory(value); setOpen(false); }}
 *     onCancel={() => setOpen(false)}
 *   />
 */
export function InputDialog({
    open,
    title = '输入',
    placeholder = '',
    defaultValue = '',
    multiline = false,
    rows = 4,
    maxLength,
    confirmText = '确定',
    cancelText = '取消',
    onConfirm,
    onCancel,
  }: InputDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setTimeout(() => {
        inputRef.current?.focus();
        if (inputRef.current && 'select' in inputRef.current) {
          (inputRef.current as HTMLInputElement).select();
        }
      }, 10);
    }
  }, [open, defaultValue]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !multiline) {
        e.stopPropagation();
        if (value.trim()) onConfirm(value.trim());
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, value, multiline, onConfirm]);

  if (!open) return null;

  const handleConfirm = () => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      initialFocusRef={inputRef}
      labelledBy="input-dialog-title"
      contentStyle={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-toolbar)',
        boxShadow: 'var(--shadow-modal)',
        padding: '24px 28px 20px',
        width: 420,
        maxWidth: '90vw',
        animation: 'modalSlideIn 0.18s ease-out',
        border: '1px solid var(--border-color)',
      }}
    >
        <h3
          id="input-dialog-title"
          className="m-[0px] mb-[16px] text-[16px] font-semibold text-[var(--text-primary)]"
        >
          {title}
        </h3>
        {multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            rows={rows}
            maxLength={maxLength}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              fontSize: 14,
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-control)',
              background: 'var(--bg-base)',
              color: 'var(--text-primary)',
              resize: 'vertical',
              fontFamily: 'inherit',
              lineHeight: 1.5,
              outline: 'none',
            }}
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            maxLength={maxLength}
            className="w-full box-border py-[10px] px-[12px] text-[14px] border border-[color:var(--border-color)] rounded-[var(--radius-control)] bg-[var(--bg-base)] text-[var(--text-primary)] outline-none"
          />
        )}
        <div
          className="flex justify-end gap-[8px] mt-[20px]"
        >
          <button
            onClick={onCancel}
            className="py-[8px] px-[18px] text-[13px] border border-[color:var(--border-color)] rounded-[var(--radius-control)] bg-transparent text-[var(--text-primary)] cursor-pointer"
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!value.trim()}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 600,
              border: '1px solid var(--tone-info-border)',
              borderRadius: 'var(--radius-control)',
              background: !value.trim()
                ? 'var(--scrim-soft)'
                : 'var(--tone-info-veil)',
              color: !value.trim() ? 'var(--text-secondary)' : 'var(--tone-info)',
              cursor: value.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            {confirmText}
          </button>
        </div>
    </Modal>
  );
}
