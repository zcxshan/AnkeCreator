// ============================================================
// FontPicker —— 贴纸手账风字体下拉
//
// 替代原生 <select>：原生下拉由系统绘制，无法跟随应用主题，
// 与二次元贴纸风 UI 不一致。此组件用按钮 + 浮层列表实现：
//   · 触发按钮复用 .an-pill（3px 墨线描边 + 圆角胶囊）
//   · 浮层复用 --an-card / --an-ink / --an-radius-md / --an-shadow-pop-lg
//   · 选项用对应字体渲染，便于直接预览
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { NGA_FONTS } from '../../types';
import { Icon } from '../common/Icon';

export interface FontPickerProps {
  /** 当前 NGA 字体值（如 simsun） */
  value: string;
  onChange: (value: string) => void;
  /** 触发按钮的额外 class */
  className?: string;
}

export function FontPicker({ value, onChange, className = '' }: FontPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const active = NGA_FONTS.find((f) => f.value === value) ?? NGA_FONTS[0];

  return (
    <div ref={rootRef} className="relative inline-block" data-testid="font-picker">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`an-pill ${className}`}
        style={{ minWidth: 108, justifyContent: 'space-between', fontFamily: active.cssFamily }}
        title={`字体：${active.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{active.label}</span>
        <Icon name="chevronDown" size={12} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="字体"
          className="an-pop-in absolute left-0 top-full mt-1 z-50 p-1.5"
          style={{
            minWidth: 190,
            maxHeight: 300,
            overflowY: 'auto',
            background: 'var(--an-card)',
            border: '2px solid var(--an-ink)',
            borderRadius: 'var(--an-radius-md)',
            boxShadow: 'var(--an-shadow-pop-lg)',
          }}
        >
          {NGA_FONTS.map((f) => {
            const selected = f.value === value;
            return (
              <button
                key={f.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(f.value);
                  setOpen(false);
                }}
                className="w-full text-left px-2.5 py-1.5 text-[13px] transition-colors"
                style={{
                  fontFamily: f.cssFamily,
                  background: selected ? 'var(--an-pink-soft)' : 'transparent',
                  color: 'var(--an-ink)',
                  fontWeight: selected ? 700 : 500,
                  border: 'none',
                  borderRadius: 'var(--an-radius-sm)',
                  cursor: 'pointer',
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
