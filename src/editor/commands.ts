// contenteditable 富文本工具集 — 块级命令 / 插入命令
// 原内容来自 src/components/editor/contenteditableUtils.ts（机械拆分，无逻辑改动）

import { NGA_CODE_BG, NGA_LINK_COLOR } from '../types';
import { focusEditor, dispatchInput, getInsertionRange, getInsertionPoint } from './selection';
import { escapeHtml } from './diceCard';

// ------------------------------------------------------------
// 基础 execCommand
// ------------------------------------------------------------
export function exec(
  editor: HTMLElement,
  command: string,
  value?: string,
): boolean {
  focusEditor(editor);
  const ok = document.execCommand(command, false, value);
  if (ok) dispatchInput(editor);
  return ok;
}

export function execUndo(editor: HTMLElement): boolean {
  focusEditor(editor);
  return document.execCommand('undo', false);
}
export function execRedo(editor: HTMLElement): boolean {
  focusEditor(editor);
  return document.execCommand('redo', false);
}
export function execRemoveFormat(editor: HTMLElement): boolean {
  focusEditor(editor);
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);

  // 0) 选区/光标在 quote-block 内的整块移除：直接在 editor 范围操作以避免 extractContents 后丢祖先
  //    检测祖先链中是否有 [data-type="quote-block"]（覆盖 blockquote / div 两种渲染形态）
  const findQuoteBlockAncestor = (node: Node | null): HTMLElement | null => {
    let n: Node | null = node;
    while (n && n !== editor) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as HTMLElement;
        if (el.dataset?.type === 'quote-block') return el;
      }
      n = n.parentNode;
    }
    return null;
  };

  // 1) 遍历选区范围内的元素：
  //    - ul/ol 转换为普通段落
  //    - span.inline-quote / span[data-type="quote"] 解除包裹 → 纯文本
  //    - blockquote / div[data-type="quote-block"] → 转为 <p>（保留子节点，去掉引用样式）
  //    - div[data-type="collapse-block"] 删除
  //    - 其他内联样式 span / color 也解除
  if (!range.collapsed) {
    // 自底向上处理：先把 range 内的所有 span 解除
    const frag = range.extractContents();
    // - a) 对于 ul/ol 的处理：拆成若干 <p>
    const lists = Array.from(frag.querySelectorAll('ul, ol'));
    lists.forEach((list) => {
      const items = Array.from(list.children);
      const paragraphs: HTMLElement[] = [];
      items.forEach((li) => {
        const p = document.createElement('p');
        p.innerHTML = (li as HTMLElement).innerHTML;
        paragraphs.push(p);
      });
      paragraphs.forEach((p) => list.parentNode!.insertBefore(p, list));
      list.remove();
    });

    // b) 解除内联 span（包括 inline-quote / data-type="quote" / color/size/font）
    const spans = Array.from(frag.querySelectorAll('span'));
    spans.forEach((s) => {
      const parent = s.parentNode!;
      while (s.firstChild) parent.insertBefore(s.firstChild, s);
      s.remove();
    });

    // c) blockquote / div[data-type="quote-block"] → <p>（保留子节点，去除引用背景）
    const blockquotes = Array.from(frag.querySelectorAll('blockquote, div[data-type="quote-block"]'));
    blockquotes.forEach((bq) => {
      const p = document.createElement('p');
      p.innerHTML = (bq as HTMLElement).innerHTML;
      bq.parentNode!.insertBefore(p, bq);
      bq.remove();
    });

    // d) pre.code-block → <p>（保留纯文本）
    const pre_blocks = Array.from(frag.querySelectorAll('pre'));
    pre_blocks.forEach((pre) => {
      const p = document.createElement('p');
      p.textContent = pre.textContent;
      pre.parentNode!.insertBefore(p, pre);
      pre.remove();
    });

    // e) div[data-type="collapse-block"] → 删除折叠块
    const collapses = Array.from(frag.querySelectorAll('div[data-type="collapse-block"]'));
    collapses.forEach((c) => c.remove());

    // f) 处理 li 内部残余：如果 frag 的顶层节点是 li，将其内容提升
    const topLis = Array.from(frag.childNodes).filter(
      (n) => n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).tagName === 'LI',
    );
    topLis.forEach((li) => {
      const p = document.createElement('p');
      p.innerHTML = (li as HTMLElement).innerHTML;
      frag.replaceChild(p, li);
    });

    range.insertNode(frag);
  } else {
    // 1.5) collapsed 选区：若光标在 quote-block 内部，把该块转为普通 <p>，保留子节点
    const quoteBlock = findQuoteBlockAncestor(range.startContainer);
    if (quoteBlock && quoteBlock.parentNode) {
      const p = document.createElement('p');
      p.innerHTML = quoteBlock.innerHTML;
      quoteBlock.parentNode.replaceChild(p, quoteBlock);
      const r = document.createRange();
      r.selectNodeContents(p);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }

  // 2) 清除 execCommand 清理其他残余的 b/i/u/s
  try {
    document.execCommand('removeFormat', false);
    document.execCommand('unlink', false);
  } catch {}

  // 3) 额外清理：如果光标在 li 内且没有选区，把 li 内容提到外层 p
  if (range.collapsed) {
    const container = range.startContainer;
    const el = container.nodeType === Node.ELEMENT_NODE ? container as HTMLElement : container.parentElement;
    if (el && el.tagName === 'LI' && el.parentNode) {
      const p = document.createElement('p');
      p.innerHTML = el.innerHTML;
      el.parentNode.replaceChild(p, el);
      // 光标移到新 p 内
      const r = document.createRange();
      r.selectNodeContents(p);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }

  dispatchInput(editor);
  return true;
}
export function execInsertHorizontalRule(editor: HTMLElement): boolean {
  return exec(editor, 'insertHorizontalRule');
}
export function execInsertUnorderedList(editor: HTMLElement): boolean {
  return exec(editor, 'insertUnorderedList');
}
export function execInsertOrderedList(editor: HTMLElement): boolean {
  return exec(editor, 'insertOrderedList');
}

// ------------------------------------------------------------
// 激活状态：粗体/斜体/下划线/删除线
// ------------------------------------------------------------
export function isCommandActive(command: string): boolean {
  try {
    return document.queryCommandState(command);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------
// 对齐：给当前 block 设 style.textAlign
// 关键：必须只影响光标所在行 / 选区所在行，不能整块统一。
// 用 document.execCommand 让浏览器原生处理选区内的所有 block，
// 避免我们手动实现时把对齐应用到外层 <div contenteditable> 整块。
// ------------------------------------------------------------
const ALIGN_CMD_MAP: Record<string, string> = {
  left: 'justifyLeft',
  center: 'justifyCenter',
  right: 'justifyRight',
  justify: 'justifyFull',
};

export function setBlockAlign(editor: HTMLElement, align: string): void {
  focusEditor(editor);
  const cmd = ALIGN_CMD_MAP[align] || 'justifyLeft';
  // 浏览器原生 execCommand 自动处理选区内的所有 block 元素，
  // 折叠选区（光标）只影响所在 block，多 block 选区影响所有选中的 block
  document.execCommand(cmd, false);
  dispatchInput(editor);
}

// ------------------------------------------------------------
// 自定义 DOM 节点：table
// ------------------------------------------------------------

/** 在光标处插入 rows x cols 的可编辑表格 */
export function insertTable(editor: HTMLElement, rows: number, cols: number): void {
  const r = Math.max(1, Math.min(20, Math.floor(rows)));
  const c = Math.max(1, Math.min(20, Math.floor(cols)));
  focusEditor(editor);
  const sel = window.getSelection();
  if (!sel) return;
  const range = getInsertionRange(editor);

  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-type', 'table-block');
  wrapper.style.margin = '8px 0';
  wrapper.style.overflowX = 'auto';

  const table = document.createElement('table');
  table.setAttribute('contenteditable', 'true');
  table.setAttribute('contentEditable', 'true');
  table.style.borderCollapse = 'collapse';
  table.style.width = 'auto';
  for (let i = 0; i < r; i++) {
    const tr = document.createElement('tr');
    for (let j = 0; j < c; j++) {
      const td = document.createElement('td');
      td.setAttribute('contenteditable', 'true');
      td.setAttribute('contentEditable', 'true');
      td.style.border = '1px solid #c8b88a';
      td.style.padding = '4px 8px';
      td.style.minWidth = '32px';
      td.textContent = '';
      td.appendChild(document.createElement('br'));
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  wrapper.appendChild(table);
  range.insertNode(wrapper);

  // 后面补空段落
  const trailing = document.createElement('p');
  trailing.appendChild(document.createElement('br'));
  if (wrapper.parentNode) {
    wrapper.parentNode.insertBefore(trailing, wrapper.nextSibling);
  }
  // 光标放到第一个 td
  const firstTd = table.querySelector('td');
  if (firstTd) {
    const rr = document.createRange();
    rr.selectNodeContents(firstTd);
    rr.collapse(true);
    sel.removeAllRanges();
    sel.addRange(rr);
  }
  dispatchInput(editor);
}

// ------------------------------------------------------------
// 自定义 DOM 节点：code-block
// ------------------------------------------------------------

/** 在光标处插入一个 pre.code-block（保留 \n 换行，使用 DOM 插入避免 insertHTML 吞换行） */
export function insertCodeBlock(editor: HTMLElement, code: string): void {
  focusEditor(editor);
  // 同步光标到 saved range
  getInsertionPoint(editor);
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);

  let innerText = code || '';
  if (!range.collapsed) {
    const frag = range.extractContents();
    const div = document.createElement('div');
    div.appendChild(frag);
    // innerText 保留块级元素之间的换行（与 textContent 不同）
    innerText = div.innerText || innerText;
  }
  if (innerText === '') innerText = '';

  // 构建 pre > code DOM 结构
  const pre = document.createElement('pre');
  pre.setAttribute('data-type', 'code-block');
  pre.className = 'code-block';
  pre.setAttribute('contenteditable', 'true');
  pre.style.background = NGA_CODE_BG;
  pre.style.padding = '8px 12px';
  pre.style.borderRadius = '4px';
  pre.style.fontFamily = 'Consolas, Menlo, monospace';
  pre.style.fontSize = '13px';
  pre.style.whiteSpace = 'pre-wrap';
  pre.style.wordBreak = 'break-all';
  pre.style.margin = '6px 0';
  pre.style.color = 'var(--text-primary)';
  pre.style.border = '1px solid var(--border-color)';
  pre.style.outline = 'none';
  const codeEl = document.createElement('code');
  // 将 \n 替换为 <br>，确保 insertHTML 不会吞掉换行
  const lines = innerText.split('\n');
  lines.forEach((line, idx) => {
    codeEl.appendChild(document.createTextNode(line));
    if (idx < lines.length - 1) {
      codeEl.appendChild(document.createElement('br'));
    }
  });
  pre.appendChild(codeEl);

  // 使用 DOM 插入而非 insertHTML，避免浏览器 HTML 解析器把 \n 当空格
  range.deleteContents();
  range.insertNode(pre);

  // 将光标移到代码块末尾
  const afterRange = document.createRange();
  afterRange.setStartAfter(pre);
  afterRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(afterRange);

  dispatchInput(editor);
}

// ------------------------------------------------------------
// 分割线 → <hr data-h="1">
// ------------------------------------------------------------

/** 插入 NGA 风格的分割线 <hr data-h="1"> */
export function insertHorizontalRuleNGA(editor: HTMLElement): void {
  focusEditor(editor);
  // 用 insertHTML 避免被通用 execCommand 改成简单 hr
  const html = '<hr data-h="1"><p><br></p>';
  document.execCommand('insertHTML', false, html);
  dispatchInput(editor);
}

// ------------------------------------------------------------
// 链接 → <a style="color:#0000ee;text-decoration:underline">
// ------------------------------------------------------------

/** 插入 NGA 风格的链接 */
export function insertNgaLink(editor: HTMLElement, url: string, label?: string): void {
  const safeUrl = (url || '').trim();
  if (!safeUrl) return;
  focusEditor(editor);
  const sel = window.getSelection();
  if (!sel) return;
  const range = getInsertionRange(editor);
  const safeLabel = (label || '').trim() || safeUrl;
  // 有选区：把选区包成链接；无选区：插入链接并把光标放中间
  if (range.collapsed) {
    const html = `<a href="${escapeAttr(safeUrl)}" style="color:${NGA_LINK_COLOR};text-decoration:underline">${escapeHtml(safeLabel)}</a>`;
    document.execCommand('insertHTML', false, html);
  } else {
    const selText = range.toString();
    const html = `<a href="${escapeAttr(safeUrl)}" style="color:${NGA_LINK_COLOR};text-decoration:underline">${escapeHtml(selText)}</a>`;
    range.deleteContents();
    document.execCommand('insertHTML', false, html);
  }
  dispatchInput(editor);
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
