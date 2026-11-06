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
        background: 'var(--an-card)',
        borderRadius: 'var(--an-radius-md)',
        boxShadow: 'var(--an-shadow-pop-lg), var(--an-shadow-soft)',
        padding: '20px 22px 18px',
        width: 420,
        maxWidth: '90vw',
        animation: 'modalSlideIn 0.18s var(--an-ease-bounce)',
        border: 'var(--an-line)',
      }}
    >
        <h3
          id="input-dialog-title"
          className="m-[0px] mb-[14px] text-[17px] font-bold text-[var(--an-ink)]"
          style={{ fontFamily: 'var(--an-font-display)' }}
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
              border: '2px solid var(--an-ink)',
              borderRadius: 'var(--an-radius-sm)',
              background: 'var(--an-paper-2)',
              color: 'var(--an-ink)',
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
            className="w-full box-border py-[10px] px-[12px] text-[14px] outline-none"
            style={{
              border: '2px solid var(--an-ink)',
              borderRadius: 'var(--an-radius-sm)',
              background: 'var(--an-paper-2)',
              color: 'var(--an-ink)',
            }}
          />
        )}
        <div className="flex justify-end gap-[8px] mt-[18px]">
          <button onClick={onCancel} className="an-btn an-btn--sm an-btn--ghost">
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!value.trim()}
            className="an-btn an-btn--sm an-btn--pink"
          >
            {confirmText}
          </button>
        </div>
    </Modal>
  );
}
