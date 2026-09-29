// contenteditable 富文本工具集 — 折叠块 collapse-block（支持删除、撤销）
// 原内容来自 src/components/editor/contenteditableUtils.ts（机械拆分，无逻辑改动）

import { NGA_FONTS, NGA_FONT_SIZES, NGA_COLORS } from '../types';
import { ptToSizePercent } from '../utils/ngaHtmlToBBCode';
import { focusEditor, dispatchInput, getInsertionPoint } from './selection';
import { pushAtomicHistory, COLLAPSE_BLOCK_SELECTOR } from './utils';
import {
  getActiveFontFamily,
  getActiveFontSize,
  getActiveColor,
  removeInlineStyle,
  applyInlineStyle,
} from './inlineStyle';

export function isCollapseBlock(el: HTMLElement | null | undefined): boolean {
  return !!(el && el.dataset && el.dataset.type === 'collapse-block');
}

/** 从节点向上查找最近的 collapse-block */
export function findCollapseBlockAncestor(
  node: Node | null | undefined,
  editor: HTMLElement,
): HTMLElement | null {
  if (!node) return null;
  let cur: Node | null = node;
  while (cur && cur !== editor) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      if (isCollapseBlock(el)) return el;
    }
    cur = cur.parentNode;
  }
  return null;
}

/** 删除指定 collapse-block，光标落到前一个兄弟末尾 */
export function removeCollapseBlock(editor: HTMLElement, block: HTMLElement): void {
  if (!block.parentNode) return;
  const prev = block.previousSibling;
  block.parentNode.removeChild(block);

  const newRange = document.createRange();
  if (prev) {
    try {
      newRange.selectNodeContents(prev);
      newRange.collapse(false);
    } catch {
      newRange.selectNodeContents(editor);
      newRange.collapse(false);
    }
  } else {
    newRange.selectNodeContents(editor);
    newRange.collapse(false);
  }
  const sel = window.getSelection();
  sel?.removeAllRanges();
  focusEditor(editor);
  sel?.addRange(newRange);
  dispatchInput(editor);
  // 原子块删除立即 push 历史（跳过 200ms 防抖，让每次删除可独立撤销）
  pushAtomicHistory(editor.innerHTML);
}

/** 判断折叠块是否为空（body 无文本且无原子块） */
function isCollapseBlockEmpty(block: HTMLElement): boolean {
  const body = block.querySelector('.collapse-body');
  if (!body) return true;
  const text = (body.textContent || '').trim();
  if (text) return false;
  // body 内还有图片/骰子/嵌套 collapse 等原子块则非空
  return !body.querySelector('[data-type="image-block"],[data-type="dice-card"],[data-type="collapse-block"]');
}

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

/** 给编辑器挂载 collapse-block 交互：点击选中、Delete/Backspace 删除、点击 head 展开/折叠 */
export function attachCollapseBlockHandlers(
  editor: HTMLElement,
): () => void {
  // 对已有的 collapse-block 注入拖动把手（替代原 draggable=true）
  const existing = editor.querySelectorAll<HTMLElement>(COLLAPSE_BLOCK_SELECTOR);
  existing.forEach((el) => ensureDragHandle(el));

  const onMouseDown = (e: MouseEvent) => {
    const target = e.target as Node | null;
    if (!target || !editor.contains(target)) return;
    const targetEl = target as HTMLElement;
    // 点击到 head/title 或其子元素不做选中，允许正常编辑标题
    if (targetEl.classList?.contains('collapse-head')) return;
    if (targetEl.classList?.contains('collapse-title')) return;
    if (targetEl.closest?.('.collapse-head')) return;  // 含 toggle / drag-handle
    const block = findCollapseBlockAncestor(target, editor);
    if (block) {
      // body 内的文本可正常选中，不再 selectCollapseBlock 干扰
      clearCollapseSelection(editor);
      return;
    }
    clearCollapseSelection(editor);
  };

  /**
   * 点击 .collapse-head 切换 body 展开/折叠。
   * - 默认折叠（data-collapsed="true" + body display:none），点 + 展开
   * - 再次点击 − 折叠回去
   * - 触发展开/折叠后调 dispatchInput 让外部 onChangeContent 收到新 HTML
   */
  const onClick = (e: MouseEvent) => {
    const target = e.target as Node | null;
    if (!target || !editor.contains(target)) return;
    const targetEl = target as HTMLElement;
    // 拖动把手不触发展开/折叠
    if (targetEl.classList?.contains('collapse-drag-handle') || targetEl.closest?.('.collapse-drag-handle')) {
      return;
    }
    const head = targetEl.closest?.('.collapse-head') as HTMLElement | null;
    if (!head) return;
    const block = head.closest?.(COLLAPSE_BLOCK_SELECTOR) as HTMLElement | null;
    if (!block) return;
    const body = block.querySelector<HTMLElement>('.collapse-body');
    const toggle = block.querySelector<HTMLElement>('.collapse-toggle');
    const isCollapsed = block.dataset.collapsed === 'true';
    if (isCollapsed) {
      if (body) body.style.display = 'block';
      if (toggle) toggle.textContent = '−';
      block.dataset.collapsed = 'false';
    } else {
      if (body) body.style.display = 'none';
      if (toggle) toggle.textContent = '+';
      block.dataset.collapsed = 'true';
    }
    // 触发编辑器更新事件（让外部 onChangeContent 拿到新 HTML，保存/历史记录同步）
    dispatchInput(editor);
    e.preventDefault();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Backspace / Delete：处理"光标在空折叠块 body 内"的情况（一次删除整块）
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.metaKey) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return; // 让默认的"选区删除"逻辑走
      const range = sel.getRangeAt(0);
      if (!editor.contains(range.startContainer)) return;

      // 检测光标是否在折叠块 body 内（不是 title）
      const containerEl = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer as HTMLElement
        : (range.startContainer.parentElement as HTMLElement | null);
      if (!containerEl) return;
      const inBody = containerEl.closest('.collapse-body');
      // 必须真的在 body 内（不能是 collapse-title），且 body 在折叠块内
      if (inBody && !containerEl.closest('.collapse-title')) {
        const block = findCollapseBlockAncestor(inBody, editor);
        if (block && isCollapseBlockEmpty(block)) {
          e.preventDefault();
          removeCollapseBlock(editor, block);
          return;
        }
      }
    }

    // Enter：在折叠块 body 内换行（保持块内不脱离）
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      if (!editor.contains(range.startContainer)) return;
      const containerEl = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer as HTMLElement
        : (range.startContainer.parentElement as HTMLElement | null);
      if (!containerEl) return;
      const inBody = containerEl.closest('.collapse-body');
      if (inBody && !containerEl.closest('.collapse-title')) {
        e.preventDefault();
        range.deleteContents();
        const br = document.createElement('br');
        range.insertNode(br);
        const newRange = document.createRange();
        newRange.setStartAfter(br);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
        dispatchInput(editor);
        return;
      }
    }

    // Shift+Enter：在折叠块 body 内 → 把光标移到折叠块之后（整个折叠块向下移动一行）
    if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      if (!editor.contains(range.startContainer)) return;
      const containerEl = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer as HTMLElement
        : (range.startContainer.parentElement as HTMLElement | null);
      if (!containerEl) return;
      const inBody = containerEl.closest('.collapse-body');
      if (inBody && !containerEl.closest('.collapse-title')) {
        e.preventDefault();
        const block = findCollapseBlockAncestor(inBody, editor);
        if (!block) return;
        // 在折叠块后插入新 <p><br></p>，光标放到 br 之后
        const newP = document.createElement('p');
        const newBr = document.createElement('br');
        newP.appendChild(newBr);
        block.parentNode?.insertBefore(newP, block.nextSibling);
        const newRange = document.createRange();
        newRange.setStartAfter(newBr);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
        dispatchInput(editor);
        return;
      }
    }

    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const selected = getSelectedCollapseBlock(editor);
    if (selected) {
      // 光标若在 collapse-body / collapse-title 内部，让浏览器默认删字符
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && sel.isCollapsed) {
        const node = sel.anchorNode;
        if (node && node.parentElement) {
          const inBody = node.parentElement.closest('.collapse-body');
          const inTitle = node.parentElement.closest('.collapse-title');
          if (inBody || inTitle) {
            // 清掉 selected 标记，避免后续重复触发，让浏览器默认删字符
            selected.removeAttribute('data-selected');
            return; // 不 preventDefault
          }
        }
      }
      e.preventDefault();
      removeCollapseBlock(editor, selected);
      return;
    }
    // 光标在紧邻位置按 Backspace/Delete 也删除
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return;
    const container = range.startContainer;
    const offset = range.startOffset;

    if (container.nodeType === Node.ELEMENT_NODE) {
      const el = container as HTMLElement;
      if (e.key === 'Backspace') {
        const target = el.childNodes[offset - 1] as HTMLElement | undefined;
        if (target && target.nodeType === Node.ELEMENT_NODE && isCollapseBlock(target)) {
          if (isCollapseBlockEmpty(target)) {
            e.preventDefault();
            removeCollapseBlock(editor, target);
          }
          // 否则不 preventDefault，浏览器默认行为（光标跳入块内或无操作）
          return;
        }
      } else {
        const target = el.childNodes[offset] as HTMLElement | undefined;
        if (target && target.nodeType === Node.ELEMENT_NODE && isCollapseBlock(target)) {
          if (isCollapseBlockEmpty(target)) {
            e.preventDefault();
            removeCollapseBlock(editor, target);
          }
          // 否则不 preventDefault，浏览器默认行为（光标跳入块内或无操作）
          return;
        }
      }
    }

    if (container.nodeType === Node.TEXT_NODE) {
      const parent = container.parentNode as HTMLElement | null;
      if (!parent) return;
      const idx = Array.prototype.indexOf.call(parent.childNodes, container);
      if (e.key === 'Backspace' && offset === 0) {
        const prev = parent.childNodes[idx - 1] as HTMLElement | undefined;
        if (prev && prev.nodeType === Node.ELEMENT_NODE && isCollapseBlock(prev)) {
          if (isCollapseBlockEmpty(prev)) {
            e.preventDefault();
            removeCollapseBlock(editor, prev);
          }
          // 否则不 preventDefault，浏览器默认行为（光标跳入块内或无操作）
          return;
        }
      } else if (
        e.key === 'Delete' &&
        offset === (container.textContent?.length ?? 0)
      ) {
        const next = parent.childNodes[idx + 1] as HTMLElement | undefined;
        if (next && next.nodeType === Node.ELEMENT_NODE && isCollapseBlock(next)) {
          if (isCollapseBlockEmpty(next)) {
            e.preventDefault();
            removeCollapseBlock(editor, next);
          }
          // 否则不 preventDefault，浏览器默认行为（光标跳入块内或无操作）
          return;
        }
      }
    }
  };

  editor.addEventListener('mousedown', onMouseDown, true);
  editor.addEventListener('click', onClick, true);
  editor.addEventListener('keydown', onKeyDown, true);
  return () => {
    editor.removeEventListener('mousedown', onMouseDown, true);
    editor.removeEventListener('click', onClick, true);
    editor.removeEventListener('keydown', onKeyDown, true);
  };
}

/** 清除所有折叠块的选中态 */
function clearCollapseSelection(editor: HTMLElement): void {
  const list = editor.querySelectorAll<HTMLElement>(COLLAPSE_BLOCK_SELECTOR);
  list.forEach((el) => el.removeAttribute('data-selected'));
}

/** 选中指定折叠块 */
function selectCollapseBlock(editor: HTMLElement, block: HTMLElement): void {
  clearCollapseSelection(editor);
  block.setAttribute('data-selected', 'true');
}

/** 返回当前选中的折叠块 */
function getSelectedCollapseBlock(editor: HTMLElement): HTMLElement | null {
  const list = editor.querySelectorAll<HTMLElement>(COLLAPSE_BLOCK_SELECTOR);
  for (let i = 0; i < list.length; i++) {
    if (list[i].getAttribute('data-selected') === 'true') return list[i];
  }
  return null;
}

// ============================================================
// BBCode 标签工具（NGA 论坛风格）
//  - 在光标处插入一段 BBCode 文本并保持光标位置
//  - 包装选中文本为 [tag]…[/tag]
// ============================================================

/**
 * 取消链接：若选区/光标在 <a> 内，把 [url=…]…[/url] 形式的纯文本剥掉（保留 innerText）。
 * 若是 execCommand 创建的 <a> 真实 DOM，则用 execCommand('unlink')。
 */
export function removeLinkAtCursor(editor: HTMLElement): void {
  focusEditor(editor);
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const node = sel.anchorNode;
  if (!node) return;

  // 1) 优先处理 contenteditable 真实 <a>
  const a = findAncestorA(node as HTMLElement, editor);
  if (a) {
    // 把 <a> 内的文本取出替换
    const text = a.textContent || '';
    const tn = document.createTextNode(text);
    a.parentNode?.replaceChild(tn, a);
    // 选中文字
    const r = document.createRange();
    r.setStart(tn, 0);
    r.setEnd(tn, text.length);
    sel.removeAllRanges();
    sel.addRange(r);
    dispatchInput(editor);
    return;
  }

  // 2) 退回：尝试用 execCommand
  try {
    document.execCommand('unlink', false);
  } catch {
    /* ignore */
  }
  dispatchInput(editor);
}

function findAncestorA(node: HTMLElement, editor: HTMLElement): HTMLAnchorElement | null {
  let cur: Node | null = node;
  while (cur && cur !== editor) {
    if (cur.nodeType === Node.ELEMENT_NODE && (cur as HTMLElement).tagName === 'A') {
      return cur as HTMLAnchorElement;
    }
    cur = cur.parentNode;
  }
  return null;
}

// ============================================================
// V2 工具：NGA 风格的切换 / 自定义节点插入 / NGA 导入
// ============================================================

/** 从光标处选区提取有效 font-family（NGA 字体值或 cssFamily）；
 *  与现有 getActiveFontFamily 不同：本函数识别 NGA 字体表与"含空格"的多字体 */
export function getEffectiveFontFamilyValue(editor: HTMLElement): string | null {
  const v = getActiveFontFamily(editor);
  if (!v) return null;
  // 找到 NGA 字体表里匹配 cssFamily 的项
  for (const f of NGA_FONTS) {
    if (f.cssFamily === v || v.includes(f.value) || f.value === v) return f.value;
  }
  return v;
}

export function getEffectiveFontSizePercent(editor: HTMLElement): number | null {
  const v = getActiveFontSize(editor);
  if (!v) return null;
  // 用 ptToSizePercent 统一处理 pt/px/% 三种单位（原手动计算不兼容 %）
  return ptToSizePercent(v);
}

export function getEffectiveColorName(editor: HTMLElement): string | null {
  const v = getActiveColor(editor);
  if (!v) return null;
  for (const c of NGA_COLORS) {
    if (c.cssColor === v.toLowerCase()) return c.value;
  }
  return v;
}

/** 切换 font-family：若当前是 value，则移除；否则应用 */
export function toggleFontFamily(editor: HTMLElement, value: string): void {
  const cur = getEffectiveFontFamilyValue(editor);
  if (cur === value) {
    removeInlineStyle(editor, ['fontFamily']);
  } else {
    const target = NGA_FONTS.find((f) => f.value === value) ?? NGA_FONTS[0];
    applyInlineStyle(editor, { fontFamily: target.cssFamily });
  }
}

export function toggleFontSize(editor: HTMLElement, percent: number): void {
  const cur = getEffectiveFontSizePercent(editor);
  if (cur === percent) {
    removeInlineStyle(editor, ['fontSize']);
  } else {
    const target = NGA_FONT_SIZES.find((s) => s.percent === percent) ?? NGA_FONT_SIZES[0];
    applyInlineStyle(editor, { fontSize: target.cssSize });
  }
}

export function toggleColor(editor: HTMLElement, value: string): void {
  const cur = getEffectiveColorName(editor);
  if (cur === value) {
    removeInlineStyle(editor, ['color']);
  } else {
    const target = NGA_COLORS.find((c) => c.value === value) ?? NGA_COLORS[0];
    applyInlineStyle(editor, { color: target.cssColor });
  }
}

// ------------------------------------------------------------
// 内联引用（类似 Word 的引用高亮）：
//   - 选文字 → 点击「引用」→ 用 span.inline-quote 包裹（背景 #f2eddf）
//   - 再次点击 → 取消包裹（如果选区完全在一个 inline-quote 内）
//   - 支持撤销（通过 extractContents + insertNode 是原生 DOM 操作，浏览器会记录撤销栈）
//   - 清格式可以删除引用 span
// ------------------------------------------------------------

/** 对选中文本应用引用（blockquote），Ctrl+Z 可撤销。 */
export function insertQuoteBlock(editor: HTMLElement): void {
  focusEditor(editor);
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);

  // 1) 取消引用：检查光标/选区是否在 quote-block 内
  let quoteAncestor: HTMLElement | null = null;
  let checkNode: Node | null = range.startContainer;
  while (checkNode && checkNode !== editor) {
    if (checkNode.nodeType === Node.ELEMENT_NODE) {
      const el = checkNode as HTMLElement;
      const dt = el.dataset?.type;
      if (dt === 'quote-block' || el.classList?.contains('inline-quote') || dt === 'quote') {
        let endInside = false;
        let n: Node | null = range.endContainer;
        while (n && n !== editor) {
          if (n === el) { endInside = true; break; }
          n = n.parentNode;
        }
        if (endInside) { quoteAncestor = el; break; }
      }
    }
    checkNode = checkNode.parentNode;
  }
  if (quoteAncestor) {
    const parent = quoteAncestor.parentNode!;
    while (quoteAncestor.firstChild) parent.insertBefore(quoteAncestor.firstChild, quoteAncestor);
    parent.removeChild(quoteAncestor);
    dispatchInput(editor);
    return;
  }

  // 使用 CSS 变量，让亮/暗模式自动适配（暗模式文字继承 --text-primary 白色）
  const blockquoteStyle = `background:var(--quote-bg);color:inherit;padding:8px 12px;border-left:3px solid var(--quote-border, #c8b88a);border-radius:4px;margin:6px 0;`;

  if (range.collapsed) {
    // 2) 折叠光标：插入空 blockquote + trailing <br>（让光标能逃出引用块，#10）
    const blockquote = document.createElement('blockquote');
    blockquote.setAttribute('data-type', 'quote-block');
    blockquote.setAttribute('style', blockquoteStyle);
    blockquote.innerHTML = '<br>';
    const trailingBr = document.createElement('br');
    // 用 DocumentFragment 一次性插入，保持 blockquote → br 顺序
    const frag = document.createDocumentFragment();
    frag.appendChild(blockquote);
    frag.appendChild(trailingBr);
    range.insertNode(frag);
    // 光标移到 blockquote 之后（trailing br 之前），让用户点击外部时光标能逃出引用块（#10）
    const newRange = document.createRange();
    newRange.setStartAfter(blockquote);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  } else {
    // 3) 有选区：用 cloneContents 保留边界 span 的完整样式（extractContents 会拆 span）（#9）
    const frag = range.cloneContents();
    const tmp = document.createElement('div');
    tmp.appendChild(frag);
    const inner = tmp.innerHTML || '<br>';
    const blockquote = document.createElement('blockquote');
    blockquote.setAttribute('data-type', 'quote-block');
    blockquote.setAttribute('style', blockquoteStyle);
    blockquote.innerHTML = inner;
    range.deleteContents();
    range.insertNode(blockquote);
    // 追加 trailing <br>（让光标能逃出引用块，#10）
    const trailingBr = document.createElement('br');
    blockquote.parentNode!.insertBefore(trailingBr, blockquote.nextSibling);
    // 选区移到 blockquote 之后（trailing br 之前）
    const newRange = document.createRange();
    newRange.setStartAfter(blockquote);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }

  dispatchInput(editor);
}

// ------------------------------------------------------------
// 自定义 DOM 节点：collapse-block（标题 + 内容）
// ------------------------------------------------------------

/** 在光标处插入一个 collapse-block，标题为 title；若有选区则把选区内容放进折叠块中
 *  使用 range.insertNode() 避免 execCommand('insertHTML') 将块级元素包裹在 <p> 中 */
export function insertCollapseBlock(editor: HTMLElement, title: string): void {
  focusEditor(editor);
  // 同步光标到 saved range
  getInsertionPoint(editor);
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);

  const safeTitle = (title || '折叠').replace(/"/g, '&quot;');

  // 收集选区内容（如果有）
  let bodyContent = '<br>';
  if (!range.collapsed) {
    const frag = range.extractContents();
    const div = document.createElement('div');
    div.appendChild(frag);
    bodyContent = div.innerHTML || '<br>';
  }

  const block = document.createElement('div');
  block.setAttribute('data-type', 'collapse-block');
  block.setAttribute('data-title', safeTitle);
  block.setAttribute('tabindex', '-1');
  block.style.display = 'block';
  block.style.margin = '6px 0';
  block.style.borderRadius = '4px';
  block.style.overflow = 'hidden';
  block.style.outline = 'none';
  block.style.userSelect = 'auto';

  const head = document.createElement('div');
  head.className = 'collapse-head';
  head.style.background = 'var(--collapse-head-bg)';
  head.style.padding = '6px 10px';
  head.style.fontWeight = '600';
  head.style.display = 'flex';
  head.style.alignItems = 'center';
  head.style.gap = '4px';

  const toggle = document.createElement('span');
  toggle.className = 'collapse-toggle';
  toggle.setAttribute('contenteditable', 'false');
  toggle.style.cursor = 'pointer';
  toggle.style.userSelect = 'none';
  toggle.style.flexShrink = '0';
  toggle.textContent = '−';

  const titleEl = document.createElement('span');
  titleEl.className = 'collapse-title';
  titleEl.setAttribute('contenteditable', 'true');
  titleEl.style.outline = 'none';
  titleEl.style.flex = '1';
  titleEl.style.minWidth = '0';
  titleEl.textContent = safeTitle;

  head.appendChild(toggle);
  head.appendChild(titleEl);

  const body = document.createElement('div');
  body.className = 'collapse-body';
  body.setAttribute('contenteditable', 'true');
  body.style.background = 'var(--collapse-body-bg)';
  body.style.padding = '8px 12px';
  body.style.display = 'block';
  body.style.whiteSpace = 'normal';
  body.innerHTML = bodyContent;

  block.appendChild(head);
  block.appendChild(body);
  // 注入拖动把手（仅把手可拖动整块，body/title 不触发拖动）
  ensureDragHandle(block);

  range.deleteContents();
  range.insertNode(block);

  // 光标落到折叠块之后
  const newRange = document.createRange();
  newRange.setStartAfter(block);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);

  initCollapseBlockEvents(block, safeTitle);
  dispatchInput(editor);
  // 原子块插入立即 push 历史（跳过 200ms 防抖，让每次插入可独立撤销）
  pushAtomicHistory(editor.innerHTML);
}

/** 为折叠块初始化展开/折叠事件 */
function initCollapseBlockEvents(block: HTMLElement, title: string): void {
  block.dataset.collapseInit = '1';
  const toggle = block.querySelector<HTMLElement>('.collapse-toggle');
  const body = block.querySelector<HTMLElement>('.collapse-body');
  const titleEl = block.querySelector<HTMLElement>('.collapse-title');
  if (!toggle || !body) return;

  let expanded = true;
  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    expanded = !expanded;
    body.style.display = expanded ? 'block' : 'none';
    toggle.textContent = expanded ? '−' : '+';
  });
  toggle.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });

  // 标题编辑时同步更新 data-title 属性（供序列化/导出使用）
  if (titleEl) {
    titleEl.addEventListener('input', () => {
      const newTitle = (titleEl.textContent || '').trim();
      block.setAttribute('data-title', newTitle || title);
    });
    titleEl.addEventListener('blur', () => {
      const newTitle = (titleEl.textContent || '').trim();
      block.setAttribute('data-title', newTitle || title);
      if (!newTitle) {
        titleEl.textContent = title;
      }
    });
  }
}
