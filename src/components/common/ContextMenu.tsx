// ============================================================
// 共享右键菜单组件
// ------------------------------------------------------------
// 抽取自 RichTextEditor 的内联实现，供 RichTextEditor（contentEditable）
// 和 BBCodeEditor（textarea）共用。
// 菜单容器 fixed 定位 + 遮罩点击关闭，菜单项支持 disabled + hover 高亮。
// ============================================================

import React from 'react';

export interface ContextMenuItemConfig {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItemConfig[];
  /** 在第 N 项之前插入分隔符（基于 0 的索引；多项可传数组） */
  separatorsBefore?: number[];
  onClose: () => void;
}

export function ContextMenu({
  x,
  y,
  items,
  separatorsBefore,
  onClose,
}: ContextMenuProps) {
  const sepSet = new Set(separatorsBefore ?? []);
  return (
    <>
      {/* 菜单容器 */}
      <div
        role="menu"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: x,
          top: y,
          zIndex: 1000,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          padding: 4,
          minWidth: 180,
          fontSize: 13,
          color: 'var(--text-primary)',
          userSelect: 'none',
        }}
      >
        {items.map((item, idx) => (
          <React.Fragment key={idx}>
            {sepSet.has(idx) && (
              <div
                style={{
                  height: 1,
                  background: 'var(--border-color)',
                  margin: '4px 0',
                }}
              />
            )}
            <ContextMenuItem {...item} />
          </React.Fragment>
        ))}
      </div>
      {/* 遮罩：点击或右键关闭菜单 */}
      <div
        aria-hidden
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 999,
        }}
      />
    </>
  );
}

/** 单个菜单项 */
function ContextMenuItem({
  label,
  onClick,
  disabled,
}: ContextMenuItemConfig) {
  return (
    <div
      role="menuitem"
      onClick={disabled ? undefined : onClick}
      style={{
        padding: '6px 12px',
        borderRadius: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.12s',
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = 'var(--bg-hover, rgba(99,102,241,0.1))';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {label}
    </div>
  );
}
