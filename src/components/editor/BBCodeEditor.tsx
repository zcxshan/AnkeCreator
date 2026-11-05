import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useToastStore } from '../../store/toastStore';
import { ContextMenu } from '../common/ContextMenu';

/**
 * BBCode 视图编辑器：受控 textarea + 300ms 防抖回写。
 *
 * - Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z 走外部的跨节历史栈（浏览器内置 undo 无法满足）
 * - Ctrl+F 打开节内搜索
 * - Tab 插入 4 个空格（NGA BBCode 不识别 \t）
 * - 内置右键菜单：复制 / 粘贴 / 在当前节中搜索
 */
export function BBCodeEditor({
  value,
  onChange,
  onDebouncedChange,
  onUndo,
  onRedo,
  textareaRef: externalTextareaRef,
  onSearchOpen,
}: {
  value: string;
  onChange: (v: string) => void;
  onDebouncedChange: (v: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onSearchOpen?: () => void;
}) {
  const localRef = useRef<number | null>(null);
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalTextareaRef ?? internalTextareaRef;
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    hasSelection: boolean;
  } | null>(null);

  useEffect(() => {
    if (localRef.current !== null) {
      window.clearTimeout(localRef.current);
    }
    localRef.current = window.setTimeout(() => {
      onDebouncedChange(value);
    }, 300);
    return () => {
      if (localRef.current !== null) {
        window.clearTimeout(localRef.current);
      }
    };
  }, [value, onDebouncedChange]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab：插入 4 个普通空格，避免焦点切换
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const insert = '    ';
      const newValue = value.slice(0, start) + insert + value.slice(end);
      onChange(newValue);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd =
            start + insert.length;
        }
      });
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;
    const key = e.key.toLowerCase();
    if (key === 'f') {
      e.preventDefault();
      onSearchOpen?.();
      return;
    }
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      onUndo();
      return;
    }
    if (key === 'y' || (key === 'z' && e.shiftKey)) {
      e.preventDefault();
      onRedo();
      return;
    }
  };

  return (
    <div
      className="bg-[var(--bg-input)] flex-1 min-h-0 overflow-hidden p-3"
    >
      <textarea
        ref={textareaRef as RefObject<HTMLTextAreaElement>}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onContextMenu={(e) => {
          e.preventDefault();
          const ta = textareaRef.current;
          const hasSelection = !!(ta && ta.selectionStart !== ta.selectionEnd);
          setCtxMenu({ x: e.clientX, y: e.clientY, hasSelection });
        }}
        spellCheck={false}
        placeholder="在此直接编辑 BBCode 文本（或 Ctrl+V 粘贴 NGA 帖子的 BBCode）…"
        className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[color:var(--border-color)] w-full h-full p-3 rounded-lg outline-none resize-none font-mono text-sm leading-relaxed"
      />
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            {
              label: '复制',
              disabled: !ctxMenu.hasSelection,
              onClick: () => {
                const ta = textareaRef.current;
                if (!ta) return;
                const text = ta.value.substring(ta.selectionStart, ta.selectionEnd);
                if (!text) return;
                navigator.clipboard
                  .writeText(text)
                  .then(() => {
                    useToastStore.getState().showToast('已复制', 'success');
                  })
                  .catch(() => {
                    ta.focus();
                    document.execCommand('copy');
                  });
                setCtxMenu(null);
              },
            },
            {
              label: '粘贴',
              onClick: async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  if (!text) {
                    setCtxMenu(null);
                    return;
                  }
                  const ta = textareaRef.current;
                  if (!ta) return;
                  ta.focus();
                  const start = ta.selectionStart;
                  const end = ta.selectionEnd;
                  const newVal = ta.value.substring(0, start) + text + ta.value.substring(end);
                  onChange(newVal);
                  requestAnimationFrame(() => {
                    if (textareaRef.current) {
                      textareaRef.current.selectionStart = textareaRef.current.selectionEnd =
                        start + text.length;
                    }
                  });
                } catch (err) {
                  useToastStore
                    .getState()
                    .showToast('粘贴失败：' + (err as Error).message, 'error');
                }
                setCtxMenu(null);
              },
            },
            {
              label: '在当前节中搜索',
              onClick: () => {
                setCtxMenu(null);
                onSearchOpen?.();
              },
            },
          ]}
        />
      )}
    </div>
  );
}
