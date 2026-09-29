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
