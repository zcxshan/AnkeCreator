// contenteditable 富文本工具集 — 共享常量 / 原子历史 / 块级工具
// 原内容来自 src/components/editor/contenteditableUtils.ts（机械拆分，无逻辑改动）

import { useEditorHistoryStore } from '../store/editorHistoryStore';

/**
 * 原子块 push helper（Phase E — 子卡点 3.3）：
 *   - 推历史快照到 useEditorHistoryStore
 *   - 同时清掉 RichTextEditor 的待推 timer（window.__editorHistoryTimer），
 *     避免 handleInput 的 200ms debounce 在原子操作后又推一次
 *
 * RichTextEditor.handleInput 会写 window.__editorHistoryTimer；
 * 这里 6 处 atomic push（insert/remove × image/dice/collapse）都调它。
 */
export function pushAtomicHistory(html: string): void {
  const w = window as any;
  if (w.__editorHistoryTimer != null) {
    window.clearTimeout(w.__editorHistoryTimer);
    w.__editorHistoryTimer = null;
  }
  useEditorHistoryStore.getState().push(html);
}

// ------------------------------------------------------------
// 获取当前块级元素（用于段落 / 标题 / 对齐 / 列表判断）
// ------------------------------------------------------------
export const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'BLOCKQUOTE',
  'PRE',
]);

export function getCurrentBlock(
  editor: HTMLElement,
): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) {
    return null;
  }
  let node: Node | null = sel.anchorNode;
  while (node && node !== editor) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (BLOCK_TAGS.has(el.tagName)) return el;
    }
    node = node.parentNode;
  }
  // 如果没找到 block，则把整段 root 作为一个段落容器处理
  return editor;
}

export function getCurrentBlockAlign(editor: HTMLElement): string {
  const block = getCurrentBlock(editor);
  if (!block) return 'left';
  const v = block.style.textAlign;
  return v && v !== '' ? v : 'left';
}

export function isInsideList(editor: HTMLElement, tag: 'UL' | 'OL'): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) {
    return false;
  }
  let node: Node | null = sel.anchorNode;
  while (node && node !== editor) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === tag) return true;
    }
    node = node.parentNode;
  }
  return false;
}

// ============================================================
// 块级 selector 常量
// ============================================================

export const IMAGE_BLOCK_SELECTOR = 'div[data-type="image-block"]';

export const DICE_CARD_SELECTOR = 'div[data-type="dice-card"]';

export const COLLAPSE_BLOCK_SELECTOR = 'div[data-type="collapse-block"]';
