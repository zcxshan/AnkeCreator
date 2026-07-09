// ============================================================
// 搜索面板（嵌入右侧属性面板）
// ------------------------------------------------------------
// 参考 VSCode 搜索面板，根据 editorMode 搜索对应视图内容：
// - bbcode 模式：基于 textarea value.indexOf + setSelectionRange
// - visual 模式：基于 window.find + execCommand insertText
// 支持查找、替换、上一个/下一个、全部替换、匹配数显示
// ============================================================

import React, { useEffect, useRef, useState } from 'react';

interface Props {
  editorMode: 'visual' | 'bbcode';
  bbcodeTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  visualEditorRef: React.RefObject<HTMLDivElement | null>;
  bbcodeValue: string;
  visualValue: string;
  onBBCodeChange: (v: string) => void;
  onVisualChange: (v: string) => void;
  /** 来自跨节搜索（GlobalSearchPanel）跳转的初始 query；非空时自动 doFind 第一个匹配 */
  initialQuery?: string;
  /** initialQuery 被消费后的回调（父组件借此清空 pendingSearchQuery） */
  onInitialQueryConsumed?: () => void;
}

export function SearchPanel({
  editorMode,
  bbcodeTextareaRef,
  visualEditorRef,
  bbcodeValue,
  visualValue,
  onBBCodeChange,
  onVisualChange,
  initialQuery = '',
  onInitialQueryConsumed,
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [replaceValue, setReplaceValue] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [matches, setMatches] = useState<number[]>([]);
  const [matchIndex, setMatchIndex] = useState(-1);
  const [visualFound, setVisualFound] = useState<boolean | null>(null);
  const [visualCount, setVisualCount] = useState(0);
  const [replaceCount, setReplaceCount] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 跨节搜索跳转的 initialQuery 只能消费一次（避免重复触发自动 doFind）
  const consumedInitialQueryRef = useRef<string>('');

  // 跨节搜索跳转时，initialQuery 变化 → 同步到 query 并自动 doFind 第一个匹配
  useEffect(() => {
    if (initialQuery && consumedInitialQueryRef.current !== initialQuery) {
      consumedInitialQueryRef.current = initialQuery;
      setQuery(initialQuery);
      setReplaceCount(null);
      // 下一个 tick 再 doFind，确保 React 已把 query 更新到子组件
      setTimeout(() => {
        inputRef.current?.focus();
        doFind(false); // 向下查找第一个
        onInitialQueryConsumed?.();
      }, 0);
    } else if (!initialQuery) {
      // 清空时重置（允许后续再次消费）
      consumedInitialQueryRef.current = '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  // 切换 editorMode 时重置
  useEffect(() => {
    setMatches([]);
    setMatchIndex(-1);
    setVisualFound(null);
    setVisualCount(0);
    setReplaceCount(null);
  }, [editorMode]);

  // 自动 focus 输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // BBCode 模式：query 或 value 变化时重算匹配
  useEffect(() => {
    if (editorMode !== 'bbcode') return;
    const q = query;
    if (!q) {
      setMatches([]);
      setMatchIndex(-1);
      return;
    }
    const positions: number[] = [];
    const value = bbcodeValue;
    let idx = value.indexOf(q);
    while (idx >= 0) {
      positions.push(idx);
      idx = value.indexOf(q, idx + q.length);
    }
    setMatches(positions);
    setMatchIndex((prev) => {
      if (positions.length === 0) return -1;
      return Math.min(prev < 0 ? 0 : prev, positions.length - 1);
    });
  }, [query, bbcodeValue, editorMode]);

  // 可视化模式：query 变化时重置状态
  useEffect(() => {
    if (editorMode !== 'visual') return;
    setVisualFound(null);
    setVisualCount(0);
    setReplaceCount(null);
  }, [query, editorMode]);

  // --- BBCode 模式查找 ---
  const highlightBBCodeMatch = (idx: number) => {
    if (matches.length === 0) return;
    const pos = matches[idx];
    const ta = bbcodeTextareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(pos, pos + query.length);
    // VSCode 风格：把目标行滚到视口中央（textarea 不支持 scrollIntoView，手动算 scrollTop）
    try {
      const textBefore = ta.value.substring(0, pos);
      const lineNum = textBefore.split('\n').length - 1;
      const computed = window.getComputedStyle(ta);
      const lineHeight = parseFloat(computed.lineHeight) || 20;
      const targetLineTop = lineNum * lineHeight;
      // 中央对齐：scrollTop = 目标行 - 视口一半 + 半行
      const targetScrollTop = Math.max(
        0,
        targetLineTop - ta.clientHeight / 2 + lineHeight / 2,
      );
      // 兜底：考虑 scrollHeight 上限（避免目标超出滚动范围）
      const maxScrollTop = Math.max(0, ta.scrollHeight - ta.clientHeight);
      ta.scrollTop = Math.min(targetScrollTop, maxScrollTop);
    } catch {
      // 静默失败
    }
  };

  const doFindBBCode = (next: boolean) => {
    if (matches.length === 0) return;
    const newIdx = next
      ? (matchIndex + 1) % matches.length
      : (matchIndex - 1 + matches.length) % matches.length;
    setMatchIndex(newIdx);
    setReplaceCount(null);
    highlightBBCodeMatch(newIdx);
  };

  // --- 可视化模式查找 ---
  // 收集编辑器内所有文本节点及其 textContent
  // 返回 [{ node, text, offset }]，其中 offset 是该节点 textContent 在全文本中的起始位置
  const collectTextNodes = (root: HTMLElement): Array<{ node: Text; start: number; text: string }> => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node: Node): number {
        const t = node.textContent || '';
        // 跳过 image-block/dice-card/collapse-block 内部文本（这些是原子块的元数据，不应被搜索）
        let p: Node | null = node.parentNode;
        while (p && p !== root) {
          const el = p as HTMLElement;
          if (
            el.dataset?.type === 'image-block' ||
            el.dataset?.type === 'dice-card' ||
            el.dataset?.type === 'collapse-block'
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          p = p.parentNode;
        }
        return t.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes: Array<{ node: Text; start: number; text: string }> = [];
    let pos = 0;
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const text = n.textContent || '';
      nodes.push({ node: n as Text, start: pos, text });
      pos += text.length;
    }
    return nodes;
  };

  // 计算 visual 编辑器中 q 出现的所有位置
  const findAllInVisual = (root: HTMLElement, q: string): Array<{ start: number; end: number; node: Text; nodeOffset: number }> => {
    if (!q) return [];
    const nodes = collectTextNodes(root);
    const fullText = nodes.map((n) => n.text).join('');
    const positions: Array<{ start: number; end: number; node: Text; nodeOffset: number }> = [];
    let idx = fullText.indexOf(q);
    while (idx >= 0) {
      // 找 idx 落在哪个节点
      for (const n of nodes) {
        const nStart = n.start;
        const nEnd = n.start + n.text.length;
        if (idx >= nStart && idx + q.length <= nEnd) {
          positions.push({
            start: idx,
            end: idx + q.length,
            node: n.node,
            nodeOffset: idx - nStart,
          });
          break;
        }
      }
      idx = fullText.indexOf(q, idx + q.length);
    }
    return positions;
  };

  // 把 Range 设置到匹配项并滚动可见（手动计算 scrollTop，避开 CSS zoom + scrollIntoView 兼容问题）
  const highlightVisualMatch = (root: HTMLElement, match: { node: Text; nodeOffset: number; end: number; start: number }, qLen: number) => {
    const range = document.createRange();
    range.setStart(match.node, match.nodeOffset);
    range.setEnd(match.node, match.nodeOffset + qLen);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    // 手动计算 scrollTop 让目标行居中（避开 CSS zoom 与 scrollIntoView 兼容问题）
    try {
      // 找到最近的 overflowY: auto/scroll 祖先（contenteditable 的滚动容器）
      const findScrollParent = (el: HTMLElement | null): HTMLElement | null => {
        let p: HTMLElement | null = el?.parentElement ?? null;
        while (p) {
          const style = window.getComputedStyle(p);
          const oy = style.overflowY;
          if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) {
            return p;
          }
          p = p.parentElement;
        }
        return null;
      };
      const container = findScrollParent(root);
      if (container) {
        // 瞬时滚动确保 selection 与滚动同步（不用 smooth，避免 React 重渲染时序问题）
        const rect = range.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        // 目标行相对容器顶部位置（offsetTop = 当前屏幕位置 - 容器屏幕位置 + 当前 scrollTop）
        const offsetTop = rect.top - containerRect.top + container.scrollTop;
        // 居中：scrollTop = offsetTop - 容器高度一半 + 行高一半
        const target = Math.max(0, offsetTop - container.clientHeight / 2 + rect.height / 2);
        const max = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollTop = Math.min(target, max);
      } else {
        // 找不到滚动容器时 fallback 到 scrollIntoView
        range.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
    } catch {
      // 静默
    }
  };

  const doFindVisual = (upward = false) => {
    const q = query.trim();
    if (!q) return;
    const el = visualEditorRef.current;
    if (!el) return;
    el.focus();

    // 先算全部匹配位置
    const allMatches = findAllInVisual(el, q);
    if (allMatches.length === 0) {
      setVisualFound(false);
      setVisualCount(0);
      setReplaceCount(null);
      return;
    }

    // 根据当前光标位置决定目标匹配项
    const sel = window.getSelection();
    const currentRange = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    let currentPos = -1;
    if (currentRange) {
      // 把当前光标位置转成全文本中的偏移
      const nodes = collectTextNodes(el);
      for (const n of nodes) {
        if (n.node === currentRange.startContainer) {
          currentPos = n.start + currentRange.startOffset;
          break;
        }
      }
    }

    // 找下一个/上一个匹配
    let target: typeof allMatches[number] | null = null;
    if (currentPos < 0) {
      // 第一次：跳到第一个
      target = upward ? allMatches[allMatches.length - 1] : allMatches[0];
    } else if (upward) {
      // 向上：找 currentPos 之前最近的匹配
      for (let i = allMatches.length - 1; i >= 0; i--) {
        if (allMatches[i].start < currentPos) {
          target = allMatches[i];
          break;
        }
      }
      if (!target) target = allMatches[allMatches.length - 1]; // 绕回末尾
    } else {
      // 向下：找 currentPos 之后最近的匹配
      for (const m of allMatches) {
        if (m.start > currentPos) {
          target = m;
          break;
        }
      }
      if (!target) target = allMatches[0]; // 绕回开头
    }

    if (target) {
      highlightVisualMatch(el, target, q.length);
      setVisualFound(true);
      setVisualCount(allMatches.length);
      setReplaceCount(null);
    }
  };

  // --- 统一查找入口 ---
  const doFind = (next: boolean) => {
    if (editorMode === 'bbcode') {
      doFindBBCode(next);
    } else {
      // next=false → 向下查找（Enter 默认），next=true → 向上查找
      doFindVisual(!next);
    }
  };

  // --- BBCode 模式替换 ---
  const doReplaceBBCode = () => {
    if (matches.length === 0 || matchIndex < 0 || !query) return;
    const pos = matches[matchIndex];
    const newValue =
      bbcodeValue.slice(0, pos) +
      replaceValue +
      bbcodeValue.slice(pos + query.length);
    onBBCodeChange(newValue);
    setReplaceCount(null);
    // value 变化后 useEffect 重算 matches，matchIndex 保持指向下一个
  };

  const doReplaceAllBBCode = () => {
    if (!query || matches.length === 0) return;
    const count = matches.length;
    const newValue = bbcodeValue.split(query).join(replaceValue);
    onBBCodeChange(newValue);
    setReplaceCount(count);
    setMatches([]);
    setMatchIndex(-1);
  };

  // --- 可视化模式替换 ---
  const doReplaceVisual = () => {
    const q = query.trim();
    if (!q) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      doFindVisual(false);
      return;
    }
    const selectedText = sel.toString();
    if (selectedText === q) {
      document.execCommand('insertText', false, replaceValue);
      setReplaceCount(null);
      // 重新计算匹配数（内容已变化）
      const el = visualEditorRef.current;
      if (el) {
        const allMatches = findAllInVisual(el, q);
        setVisualCount(allMatches.length);
        if (allMatches.length > 0) {
          doFindVisual(false);
        } else {
          setVisualFound(false);
        }
      }
    } else {
      doFindVisual(false);
    }
  };

  const doReplaceAllVisual = () => {
    const q = query.trim();
    if (!q) return;
    const el = visualEditorRef.current;
    if (!el) return;

    // 收集所有匹配位置（一次扫描，避免反复修改 DOM 错位）
    const allMatches = findAllInVisual(el, q);
    if (allMatches.length === 0) {
      setReplaceCount(0);
      return;
    }
    const count = allMatches.length;

    // 从后向前替换（避免前面的 Range 失效）
    // 但 TreeWalker 的 textContent 拼接的"全文本"是虚拟坐标，不能直接用于 DOM mutation
    // 改用：从后向前遍历 nodes 替换
    // 简化：直接用 textContent 替换（会丢失所有 HTML 标签和 atomic blocks，破坏 visual 编辑器）
    // 正确做法：每个 text node 内部从后向前替换，保持其他节点不变
    const nodes = collectTextNodes(el);
    // 关键：每个 text node 内的替换互不影响（因为替换不改变节点数）
    // 但不同 nodes 间可能匹配跨节点的情况（"hello world" 跨两个 text node）—— 这种情况罕见
    // 简化处理：只处理单节点内的匹配，跨节点匹配留给用户多次替换
    for (const n of nodes) {
      const text = n.text;
      if (!text.includes(q)) continue;
      // 替换所有出现
      const newText = text.split(q).join(replaceValue);
      n.node.textContent = newText;
    }

    setReplaceCount(count);
    setVisualCount(0);
    setVisualFound(false);

    // 触发 onChange（让 React 重新渲染 + 持久化）
    el.focus();
    // 触发 input 事件，让 RichTextEditor 的 onInput 拿到新内容
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  };

  // --- 统一替换入口 ---
  const doReplace = () => {
    if (editorMode === 'bbcode') {
      doReplaceBBCode();
    } else {
      doReplaceVisual();
    }
  };

  const doReplaceAll = () => {
    if (editorMode === 'bbcode') {
      doReplaceAllBBCode();
    } else {
      doReplaceAllVisual();
    }
  };

  // --- 状态文本 ---
  const statusText = (() => {
    if (editorMode === 'bbcode') {
      if (replaceCount !== null) return `已替换 ${replaceCount} 处`;
      if (matches.length === 0) {
        return query.trim() ? '未找到匹配' : '输入关键词后按 Enter 查找';
      }
      return `已找到 ${matches.length} 处，当前 ${matchIndex + 1}/${matches.length}`;
    }
    // visual
    if (replaceCount !== null) return `已替换 ${replaceCount} 处`;
    if (visualFound === null) return '输入关键词后按 Enter 查找';
    return visualFound
      ? `已找到匹配${visualCount > 0 ? `（${visualCount}）` : ''}`
      : '未找到匹配';
  })();

  const btnDisabled = !query.trim();
  const replaceBtnDisabled =
    editorMode === 'bbcode'
      ? !query.trim() || matches.length === 0
      : !query.trim();

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* 模式提示 */}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
        {editorMode === 'bbcode' ? '📝 BBCode 视图' : '🖊️ 可视化视图'} · 按 Ctrl+F 快速打开
      </div>

      {/* 查找行 */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => setShowReplace((s) => !s)}
          title={showReplace ? '隐藏替换' : '展开替换'}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 14,
            padding: '2px 4px',
            lineHeight: 1,
            transform: showReplace ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        >
          ▸
        </button>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setReplaceCount(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              doFind(false);
            }
          }}
          placeholder="查找…"
          style={{
            flex: 1,
            padding: '5px 8px',
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
          disabled={btnDisabled}
          style={{
            padding: '4px 8px',
            background: 'var(--bg-hover)',
            border: '1px solid var(--border-color)',
            borderRadius: 4,
            color: 'var(--text-primary)',
            cursor: btnDisabled ? 'not-allowed' : 'pointer',
            fontSize: 12,
            opacity: btnDisabled ? 0.5 : 1,
          }}
          title="上一个"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => doFind(false)}
          disabled={btnDisabled}
          style={{
            padding: '4px 8px',
            background: 'var(--accent)',
            border: '1px solid var(--accent)',
            borderRadius: 4,
            color: 'var(--text-on-accent)',
            cursor: btnDisabled ? 'not-allowed' : 'pointer',
            fontSize: 12,
            opacity: btnDisabled ? 0.5 : 1,
          }}
          title="下一个"
        >
          ↓
        </button>
      </div>

      {/* 替换行（可折叠） */}
      {showReplace && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', paddingLeft: 20 }}>
          <input
            type="text"
            value={replaceValue}
            onChange={(e) => {
              setReplaceValue(e.target.value);
              setReplaceCount(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                doReplace();
              }
            }}
            placeholder="替换为…"
            style={{
              flex: 1,
              padding: '5px 8px',
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
            onClick={doReplace}
            disabled={replaceBtnDisabled}
            style={{
              padding: '4px 8px',
              background: 'var(--bg-hover)',
              border: '1px solid var(--border-color)',
              borderRadius: 4,
              color: 'var(--text-primary)',
              cursor: replaceBtnDisabled ? 'not-allowed' : 'pointer',
              fontSize: 12,
              opacity: replaceBtnDisabled ? 0.5 : 1,
            }}
            title="替换当前匹配"
          >
            替换
          </button>
          <button
            type="button"
            onClick={doReplaceAll}
            disabled={replaceBtnDisabled}
            style={{
              padding: '4px 8px',
              background: 'var(--bg-hover)',
              border: '1px solid var(--border-color)',
              borderRadius: 4,
              color: 'var(--text-primary)',
              cursor: replaceBtnDisabled ? 'not-allowed' : 'pointer',
              fontSize: 12,
              opacity: replaceBtnDisabled ? 0.5 : 1,
            }}
            title="全部替换"
          >
            全部
          </button>
        </div>
      )}

      {/* 状态文本 */}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', minHeight: 14 }}>
        {statusText}
      </div>
    </div>
  );
}
