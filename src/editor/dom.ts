// contenteditable 富文本工具集 — 通用 DOM 工具
// 原内容来自 src/components/editor/contenteditableUtils.ts（机械拆分，无逻辑改动）

export function findAncestorWithAttr(
  node: HTMLElement | null | undefined,
  attr: string,
  value: string,
): HTMLElement | null {
  let cur: HTMLElement | null = node ?? null;
  while (cur) {
    if (cur.nodeType === Node.ELEMENT_NODE && cur.getAttribute(attr) === value) return cur;
    cur = cur.parentElement;
  }
  return null;
}

/** 找到 node 的最近 span 祖先(用于 applyTextDecorationPartNoFocus) */
export function findAncestorSpan(node: Node): HTMLElement | null {
  let cur: Node | null = node.parentNode;
  while (cur && cur.nodeType === Node.ELEMENT_NODE) {
    if ((cur as HTMLElement).tagName === 'SPAN') return cur as HTMLElement;
    cur = cur.parentNode;
  }
  return null;
}

/**
 * 方向键边界：光标在原子块（图片/骰子/折叠块）内部时，
 * 把光标跳到块的边界之外（before = 块前 / after = 块后）
 * - 原子块是不可编辑的整体，方向键应跨过它而不是卡在块内
 * - 返回 false 表示光标不在原子块内，调用方走默认行为
 */
export function moveCaretPastAtomicBlock(
  el: HTMLElement,
  direction: 'before' | 'after',
): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  const container = range.startContainer;
  const containerEl = container.nodeType === Node.ELEMENT_NODE
    ? container as HTMLElement
    : container.parentElement;
  const block = containerEl?.closest(
    '[data-type="image-block"], [data-type="dice-card"], [data-type="collapse-block"]',
  );
  if (!block || !el.contains(block)) return false;
  const r = document.createRange();
  if (direction === 'after') r.setStartAfter(block);
  else r.setStartBefore(block);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  return true;
}
