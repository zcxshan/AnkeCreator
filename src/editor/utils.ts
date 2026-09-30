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

/**
 * 判断编辑器 DOM 当前序列化内容是否已与目标 content 等价。
 *
 * 背景：浏览器对 innerHTML 的序列化不是幂等的（标签名转小写、空段落补 <br>、
 * 表格补 <tbody>、属性顺序调整等），因此「写入内联字符串再读回」得到的字符串
 * 可能与原始快照不一致。RichTextEditor 的 content effect 用它做守卫：
 *   - 快路径：el.innerHTML 与目标完全一致（用户输入/撤销重做写回后），跳过
 *   - 慢路径：目标内容解析后重新序列化，与 DOM 当前序列化对比；等价则视为
 *     "内容已显示"，跳过重写与历史栈 reset()，避免撤销后误清空 redo 栈
 * @param el 编辑器根元素（contenteditable）
 * @param content 目标内容（原始 HTML 字符串，可能为 '' 表示空内容）
 * @returns true 表示 DOM 已显示等价内容，调用方应跳过写入与历史重置
 */
export function domShowsContent(el: HTMLElement, content: string | null | undefined): boolean {
  const safeContent: string = content == null || content === '' ? '' : content;
  // 空内容在编辑器中以 <br> 占位显示（contenteditable 空 div 不显示光标）
  const displayHTML = safeContent === '' ? '<br>' : safeContent;
  if (el.innerHTML === displayHTML) return true;
  // 规范化比较：把目标内容按浏览器同样的规则解析再序列化，与 DOM 当前序列化对比
  const probe = document.createElement('div');
  probe.innerHTML = displayHTML;
  return el.innerHTML === probe.innerHTML;
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
