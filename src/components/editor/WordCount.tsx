// 字数统计组件：独立订阅 sectionContent（带 useDeferredValue 滞后计算），
// 打字时只重渲染本组件，避免整个页面因字数计算而重渲染（性能优化）。
import React, { memo, useDeferredValue, useMemo, useRef } from 'react';
import { useEditorStore } from '../../store/editorStore';

/** 基于 HTML 字符串统计字数（规则与原 EditorPage 实现一致：原子块不计入文字数） */
export function countWordsFromHtml(html: string): { words: number; dice: number } {
  if (!html) return { words: 0, dice: 0 };
  try {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    let words = 0;
    let dice = 0;
    const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_ALL, {
      acceptNode(node: Node): number {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          if (
            el.dataset?.type === 'image-block' ||
            el.dataset?.type === 'dice-card'
          ) {
            dice++;
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_SKIP;
        }
        if (node.nodeType === Node.TEXT_NODE) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      },
    });
    let node: Node | null = walker.nextNode();
    while (node) {
      const text = (node.textContent || '').replace(/\s/g, '');
      words += text.length;
      node = walker.nextNode();
    }
    return { words, dice };
  } catch {
    return { words: 0, dice: 0 };
  }
}

/** 计算编辑器当前内容的字数（先尝试 JSON 结构解析，失败退回 HTML 解析） */
export function computeSectionWordCount(content: string | null | undefined): number {
  if (!content) return 0;
  try {
    const json = JSON.parse(content);
    if (json && typeof json === 'object') {
      let words = 0;
      const walk = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (typeof node.text === 'string') {
          words += node.text.replace(/\s/g, '').length;
        }
        if (Array.isArray(node.content)) node.content.forEach(walk);
      };
      walk(json);
      return words;
    }
  } catch {
    // fallthrough
  }
  return countWordsFromHtml(content).words;
}

interface WordCountProps {
  /**
   * 'auto'（默认）：桌面端显示完整数字（"12,345 字"），移动端显示紧凑格式（"12k"）
   * 'compact'：始终显示紧凑格式
   */
  variant?: 'auto' | 'compact';
}

/**
 * 页头字数显示。
 * - 打字时只有本组件重渲染（useDeferredValue 滞后计算，避免长文档输入卡顿）
 * - 切节加载时保留旧值，避免字数闪烁为 0
 */
export const WordCount = memo(function WordCount({ variant = 'auto' }: WordCountProps) {
  const content = useEditorStore((s) => s.sectionContent);
  const loading = useEditorStore((s) => s.sectionLoading);
  const deferredContent = useDeferredValue(content);
  const count = useMemo(() => computeSectionWordCount(deferredContent), [deferredContent]);
  // 切节加载中保留上一次显示的字数（与原 displayWordCount 的 sectionLoading 逻辑一致）
  const prevCountRef = useRef(0);
  const displayCount = loading ? prevCountRef.current : count;
  prevCountRef.current = displayCount;

  if (variant === 'compact') {
    return <>{displayCount > 999 ? `${(displayCount / 1000).toFixed(1)}k` : displayCount}</>;
  }
  return (
    <>
      <span className="hidden sm:inline">{displayCount.toLocaleString()} 字</span>
      <span className="sm:hidden">{displayCount > 999 ? `${(displayCount / 1000).toFixed(1)}k` : displayCount}</span>
    </>
  );
});
