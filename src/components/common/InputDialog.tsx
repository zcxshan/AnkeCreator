import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      } else if (e.key === 'Enter' && !multiline) {
        e.stopPropagation();
        if (value.trim()) onConfirm(value.trim());
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, value, multiline, onConfirm, onCancel]);

  if (!open) return null;

  const handleConfirm = () => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  };

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
          width: 420,
          maxWidth: '90vw',
          animation: 'modalSlideIn 0.18s ease-out',
          border: '1px solid var(--border-color, #e5e7eb)',
        }}
      >
        <h3
          style={{
            margin: 0,
            marginBottom: 16,
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--text-primary, #111)',
          }}
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
              border: '1px solid var(--border-color, #e5e7eb)',
              borderRadius: 6,
              background: 'var(--bg-base, #fff)',
              color: 'var(--text-primary, #111)',
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
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              fontSize: 14,
              border: '1px solid var(--border-color, #e5e7eb)',
              borderRadius: 6,
              background: 'var(--bg-base, #fff)',
              color: 'var(--text-primary, #111)',
              outline: 'none',
            }}
          />
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 20,
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
            onClick={handleConfirm}
            disabled={!value.trim()}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 600,
              border: '1px solid rgba(37,99,235,0.2)',
              borderRadius: 6,
              background: !value.trim()
                ? 'rgba(0,0,0,0.05)'
                : 'rgba(37,99,235,0.10)',
              color: !value.trim() ? 'var(--text-secondary, #999)' : '#2563eb',
              cursor: value.trim() ? 'pointer' : 'not-allowed',
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
