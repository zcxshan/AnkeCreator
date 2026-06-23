// ============================================================
// 节内搜索对话框（编辑器右键菜单触发）
// 使用浏览器原生 window.find API 在当前节中查找并高亮匹配
// ============================================================

import React, { useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 编辑器 DOM 引用，用于在 find 前/后聚焦 */
  editorRef: React.RefObject<HTMLElement>;
}

export function SectionSearchDialog({ open, onClose, editorRef }: Props) {
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [hasMatches, setHasMatches] = useState<boolean | null>(null); // null=未搜索
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时自动 focus + reset
  useEffect(() => {
    if (open) {
      setQuery('');
      setMatchIndex(0);
      setHasMatches(null);
      // 下一帧 focus 输入框
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 触发 window.find
  const doFind = (upward = false) => {
    const q = query.trim();
    if (!q) return;
    // 确保编辑器有焦点，window.find 才能在编辑器内匹配
    const el = editorRef.current;
    if (el) el.focus();
    // window.find(query, caseSensitive, backward, wrapAround, wholeWord, searchInFrames, showDialog)
    // TypeScript 不会把 window.find 列在 Window 类型上，需要类型断言
    const findFn = (window as any).find?.bind(window) as
      | ((
          query: string,
          caseSensitive?: boolean,
          backward?: boolean,
          wrapAround?: boolean,
          wholeWord?: boolean,
          searchInFrames?: boolean,
          showDialog?: boolean,
        ) => boolean)
      | undefined;
    if (!findFn) {
      return;
    }
    const found = findFn(
      q,
      false, // caseSensitive
      upward, // backward
      true, // wrapAround
      false, // wholeWord
      false, // searchInFrames
      false, // showDialog
    );
    if (found) {
      setHasMatches(true);
      setMatchIndex((i) => (upward ? Math.max(1, i - 1) : i + 1));
    } else {
      setHasMatches(false);
    }
  };

  if (!open) return null;

  return (
    <>
      {/* 背景遮罩 */}
      <div
        aria-hidden
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.35)',
          zIndex: 1999,
        }}
      />
      {/* 居中 modal */}
      <div
        role="dialog"
        aria-label="在当前节中搜索"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: '20%',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 2000,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
          padding: 16,
          minWidth: 380,
          maxWidth: '90vw',
          color: 'var(--text-primary)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>在当前节中搜索</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setMatchIndex(0);
              setHasMatches(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                doFind(false);
              }
            }}
            placeholder="输入关键词，Enter 查找下一个"
            style={{
              flex: 1,
              padding: '6px 10px',
              border: '1px solid var(--border-color)',
              borderRadius: 4,
              background: 'var(--bg-input, var(--bg-card))',
              color: 'var(--text-primary)',
              fontSize: 13,
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={() => doFind(true)}
            disabled={!query.trim()}
            style={{
              padding: '6px 10px',
              background: 'var(--bg-hover)',
              border: '1px solid var(--border-color)',
              borderRadius: 4,
              color: 'var(--text-primary)',
              cursor: !query.trim() ? 'not-allowed' : 'pointer',
              fontSize: 12,
              opacity: !query.trim() ? 0.5 : 1,
            }}
            title="上一个"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => doFind(false)}
            disabled={!query.trim()}
            style={{
              padding: '6px 10px',
              background: 'var(--accent)',
              border: '1px solid var(--accent)',
              borderRadius: 4,
              color: 'var(--text-on-accent)',
              cursor: !query.trim() ? 'not-allowed' : 'pointer',
              fontSize: 12,
              opacity: !query.trim() ? 0.5 : 1,
            }}
            title="下一个"
          >
            ↓ 下一个
          </button>
        </div>

        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color: 'var(--text-muted)',
            minHeight: 16,
          }}
        >
          {hasMatches === null
            ? '提示：Enter 跳到第一个匹配'
            : hasMatches
            ? `已找到匹配（计数 ${matchIndex}）`
            : '未找到匹配'}
        </div>
      </div>
    </>
  );
}
