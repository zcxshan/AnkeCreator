// ============================================================
// 安科编辑器 —— 折叠块 DOM 工具（Tiptap 内核）
//
// 从旧 contenteditable 模块 collapseBlock.ts 机械搬迁 ensureDragHandle，
// 函数体与语义逐字保留。
// ============================================================

/**
 * 确保折叠块标题栏右侧有拖动把手，并移除块级 draggable 属性。
 * - 仅 .collapse-drag-handle 可触发整块拖动
 * - body / title 内的文本可正常选中（不再被块级 draggable 干扰）
 */
export function ensureDragHandle(block: HTMLElement): void {
  block.removeAttribute('draggable');
  block.style.cursor = '';
  const head = block.querySelector<HTMLElement>('.collapse-head');
  if (!head) return;
  if (head.querySelector('.collapse-drag-handle')) return;
  const handle = document.createElement('span');
  handle.className = 'collapse-drag-handle';
  handle.setAttribute('contenteditable', 'false');
  handle.setAttribute('draggable', 'true');
  handle.style.cursor = 'grab';
  handle.style.userSelect = 'none';
  handle.style.flexShrink = '0';
  handle.style.marginLeft = '4px';
  handle.style.fontSize = '14px';
  handle.style.lineHeight = '1';
  handle.style.opacity = '0.6';
  handle.textContent = '⠿';
  handle.title = '拖动移动整个折叠块';
  head.appendChild(handle);
}
