// ============================================================
// contenteditable 富文本工具集
// 依赖 document.execCommand + Selection API
// ============================================================

/**
 * 模块级"编辑器最后一次选区"
 * - 工具栏 / 弹窗 input 等位置会触发 selectionchange，selectionchange 监听里
 *   同步到这里（仅当光标在 editor 内时记录）
 * - insertDiceCard / insertImageBlock 等插入函数优先用它，避免 focusEditor 把光标重置到 (0,0)
 */
let _lastEditorRange: Range | null = null;

/** 由 RichTextEditor 的 selectionchange 监听调用 */
export function setLastEditorRange(range: Range | null): void {
  _lastEditorRange = range;
}

/** 由插入函数读取 */
export function getLastEditorRange(): Range | null {
  return _lastEditorRange;
}

import {
  NGA_IMAGE_SIZES,
  NGA_DEFAULT_IMAGE_SIZE,
  NGA_CODE_BG,
  NGA_FONTS,
  NGA_FONT_SIZES,
  NGA_COLORS,
  NGA_LINK_COLOR,
} from '../../types';
import { rollDice } from '../../utils/diceEngine';
import { useSettingStore } from '../../store/settingStore';
import { useEditorHistoryStore } from '../../store/editorHistoryStore';
import { playDiceRollSound } from '../../utils/diceSound';
import { ptToSizePercent } from '../../utils/ngaHtmlToBBCode';

/**
 * 原子块 push helper（Phase E — 子卡点 3.3）：
 *   - 推历史快照到 useEditorHistoryStore
 *   - 同时清掉 RichTextEditor 的待推 timer（window.__editorHistoryTimer），
 *     避免 handleInput 的 200ms debounce 在原子操作后又推一次
 *
 * RichTextEditor.handleInput 会写 window.__editorHistoryTimer；
 * 这里 6 处 atomic push（insert/remove × image/dice/collapse）都调它。
 */
function pushAtomicHistory(html: string): void {
  const w = window as any;
  if (w.__editorHistoryTimer != null) {
    window.clearTimeout(w.__editorHistoryTimer);
    w.__editorHistoryTimer = null;
  }
  useEditorHistoryStore.getState().push(html);
}

/** 把 <font> / <b> / <i> / <u> / <s> 等旧标签规范化为带 style 的 <span>。
 *  这里我们保持原生 execCommand 的输出（浏览器默认产出 b/i/u 等），
 *  只有颜色/字号/字体用我们自实现的 span 包裹，以便激活状态能稳定读取。 */

export function isNodeInsideEditor(
  node: Node | null | undefined,
  editor: HTMLElement,
): boolean {
  if (!node) return false;
  let cur: Node | null = node;
  while (cur) {
    if (cur === editor) return true;
    cur = cur.parentNode;
  }
  return false;
}

export function focusEditor(editor: HTMLElement): void {
  editor.focus();
}

/**
 * 统一获取插入位置（光标优先，底部兜底）
 * 1. 优先使用 savedRange（编辑器失焦时由 selectionchange 保存的）
 * 2. 其次使用 window.getSelection() 当前光标
 * 3. 最后 fallback 到编辑器末尾
 * 如果 savedRange 有效，会同步设置到当前 selection
 */
export function getInsertionPoint(
  editor: HTMLElement,
  savedRange: Range | null = null,
): Range {
  // 1. 优先 saved range（参数传入或模块级缓存）
  const range = savedRange ?? _lastEditorRange;
  if (
    range &&
    range.startContainer &&
    editor.contains(range.startContainer)
  ) {
    const sel = window.getSelection();
    if (sel) {
      try {
        sel.removeAllRanges();
        sel.addRange(range);
      } catch {
        // ignore
      }
    }
    return range.cloneRange();
  }

  // 2. 当前 sel
  const sel = window.getSelection();
  if (
    sel &&
    sel.rangeCount > 0 &&
    sel.anchorNode &&
    editor.contains(sel.anchorNode)
  ) {
    return sel.getRangeAt(0).cloneRange();
  }

  // 3. 兜底：末尾
  const fallback = document.createRange();
  fallback.selectNodeContents(editor);
  fallback.collapse(false);
  return fallback;
}

/** 手动派发 input 事件，触发 onChangeContent 保存 */
export function dispatchInput(editor: HTMLElement): void {
  const ev = new Event('input', { bubbles: true, cancelable: true });
  editor.dispatchEvent(ev);
}

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

export function execBold(editor: HTMLElement): boolean {
  return exec(editor, 'bold');
}
export function execItalic(editor: HTMLElement): boolean {
  return exec(editor, 'italic');
}
export function execUnderline(editor: HTMLElement): boolean {
  return exec(editor, 'underline');
}
export function execStrikeThrough(editor: HTMLElement): boolean {
  return exec(editor, 'strikeThrough');
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
export function isBoldActive(): boolean {
  return isCommandActive('bold');
}
export function isItalicActive(): boolean {
  return isCommandActive('italic');
}
export function isUnderlineActive(): boolean {
  return isCommandActive('underline');
}
export function isStrikeActive(): boolean {
  return isCommandActive('strikeThrough');
}
export function isSupActive(): boolean {
  return isCommandActive('superscript');
}
export function isSubActive(): boolean {
  return isCommandActive('subscript');
}

// ------------------------------------------------------------
// 综合读取：当前光标/选区位置上的活动样式（颜色/字号/字体/粗体/斜体/下划线/删除线）
// 返回值用作 useEditorStore.activeStyles
// ------------------------------------------------------------
export function getCurrentStyles(
  editor: HTMLElement,
): {
  color?: string;
  fontSize?: string;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  sup?: boolean;
  sub?: boolean;
} {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) {
    return {};
  }
  const result: {
    color?: string;
    fontSize?: string;
    fontFamily?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    sup?: boolean;
    sub?: boolean;
  } = {};

  // 1) 简单样式：execCommand.queryCommandState
  if (isBoldActive()) result.bold = true;
  if (isItalicActive()) result.italic = true;
  if (isUnderlineActive()) result.underline = true;
  if (isStrikeActive()) result.strike = true;
  if (isSupActive()) result.sup = true;
  if (isSubActive()) result.sub = true;

  // 2) 颜色/字号/字体：walk up anchorNode 找最近的 inline style
  const color = getActiveColor(editor);
  if (color) result.color = color;
  const fontSize = getActiveFontSize(editor);
  if (fontSize) result.fontSize = fontSize;
  const fontFamily = getActiveFontFamily(editor);
  if (fontFamily) result.fontFamily = fontFamily;
  return result;
}

/**
 * 把活动样式应用到当前 range 处下一个即将插入的文本
 * 调用时机：editor onBeforeInput 拦截 insertText 时
 * 若返回 true 表示已接管（已 preventDefault + insertNode），调用方不应再做任何 input 处理
 */
export function applyActiveStylesToInsertion(
  editor: HTMLElement,
  active: {
    color?: string;
    fontSize?: string;
    fontFamily?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    sup?: boolean;
    sub?: boolean;
  },
  text: string,
): boolean {
  if (
    !text ||
    (!active.color &&
      !active.fontSize &&
      !active.fontFamily &&
      !active.bold &&
      !active.italic &&
      !active.underline &&
      !active.strike &&
      !active.sup &&
      !active.sub)
  ) {
    return false;
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  if (!editor.contains(sel.anchorNode)) return false;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return false;

  // 智能合并：找到光标所在 SPAN 继承的样式，从 active 中移除已继承的部分
  // 避免 CSS font-size:% 嵌套相乘（>100% 越大 / <100% 越小）
  const inherited = getInheritedSpanStyles(range.startContainer, editor);

  const remaining: typeof active = {};
  if (active.color && active.color !== inherited.color) remaining.color = active.color;
  if (active.fontSize && !isSameFontSize(active.fontSize, inherited.fontSize)) remaining.fontSize = active.fontSize;
  if (active.fontFamily && active.fontFamily !== inherited.fontFamily) remaining.fontFamily = active.fontFamily;
  // bold/italic/underline/strike/sup/sub 总是需要应用（CSS 不从 SPAN 继承）
  if (active.bold) remaining.bold = active.bold;
  if (active.italic) remaining.italic = active.italic;
  if (active.underline) remaining.underline = active.underline;
  if (active.strike) remaining.strike = active.strike;
  if (active.sup) remaining.sup = active.sup;
  if (active.sub) remaining.sub = active.sub;

  // 如果所有样式都已被继承 → 直接插入文本节点，不创建嵌套 span
  const hasRemaining =
    remaining.color ||
    remaining.fontSize ||
    remaining.fontFamily ||
    remaining.bold ||
    remaining.italic ||
    remaining.underline ||
    remaining.strike ||
    remaining.sup ||
    remaining.sub;
  if (!hasRemaining) {
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  // 只用 remaining 样式创建 wrap span（避免重复 fontSize/color/fontFamily 嵌套）
  // 检测是否有内联样式属性（color/fontSize/fontFamily/bold/italic/underline/strike）
  const hasInlineStyle = !!(
    remaining.color ||
    remaining.fontSize ||
    remaining.fontFamily ||
    remaining.bold ||
    remaining.italic ||
    remaining.underline ||
    remaining.strike
  );

  let outer: HTMLElement;
  if (hasInlineStyle) {
    // 有内联样式 → 创建 wrap span 并应用样式
    const wrap = document.createElement('span');
    if (remaining.color) wrap.style.color = remaining.color;
    if (remaining.fontSize) wrap.style.fontSize = remaining.fontSize;
    if (remaining.fontFamily) wrap.style.fontFamily = remaining.fontFamily;
    if (remaining.bold) wrap.style.fontWeight = 'bold';
    if (remaining.italic) wrap.style.fontStyle = 'italic';
    const deco: string[] = [];
    if (remaining.underline) deco.push('underline');
    if (remaining.strike) deco.push('line-through');
    if (deco.length) wrap.style.textDecoration = deco.join(' ');

    wrap.appendChild(document.createTextNode(text));
    outer = wrap;

    // sup/sub 互斥：如果两者都打开，sup 优先
    if (remaining.sup) {
      const sup = document.createElement('sup');
      sup.appendChild(wrap);
      outer = sup;
    } else if (remaining.sub) {
      const sub = document.createElement('sub');
      sub.appendChild(wrap);
      outer = sub;
    }
  } else {
    // 只有 sup/sub，无内联样式 → 直接用 sup/sub 包裹文本节点，不创建多余 span
    if (remaining.sup) {
      const sup = document.createElement('sup');
      sup.appendChild(document.createTextNode(text));
      outer = sup;
    } else if (remaining.sub) {
      const sub = document.createElement('sub');
      sub.appendChild(document.createTextNode(text));
      outer = sub;
    } else {
      // 理论上不会到这里（hasRemaining 为 true），防御性处理
      range.deleteContents();
      const tn = document.createTextNode(text);
      range.insertNode(tn);
      range.setStartAfter(tn);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    }
  }

  range.deleteContents();
  range.insertNode(outer);

  // 把光标放到 outer 内部末尾，让后续输入继续继承样式（Word 行为）
  const outerLast = outer.lastChild;
  if (outerLast) {
    range.setStartAfter(outerLast);
  } else {
    range.setStartAfter(outer);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

// ------------------------------------------------------------
// Fix #1 辅助：判断 node 的祖先链上是否存在与 active 样式完全一致的 span
// ------------------------------------------------------------
function isStyleMatch(
  el: HTMLElement,
  active: {
    color?: string;
    fontSize?: string;
    fontFamily?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    sup?: boolean;
    sub?: boolean;
  },
): boolean {
  // sup/sub 节点不影响样式匹配（视觉超上下标），不参与判定
  if (active.color != null && el.style.color !== active.color) return false;
  if (active.fontSize != null && el.style.fontSize !== active.fontSize) return false;
  if (active.fontFamily != null && el.style.fontFamily !== active.fontFamily) return false;
  if (active.bold && el.style.fontWeight !== 'bold') return false;
  if (active.italic && el.style.fontStyle !== 'italic') return false;
  if (active.underline) {
    if (!el.style.textDecoration.includes('underline')) return false;
  }
  if (active.strike) {
    if (!el.style.textDecoration.includes('line-through')) return false;
  }
  return true;
}

function findStyleMatchSpan(
  startNode: Node,
  editor: HTMLElement,
  active: {
    color?: string;
    fontSize?: string;
    fontFamily?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    sup?: boolean;
    sub?: boolean;
  },
): HTMLElement | null {
  let cur: Node | null = startNode;
  while (cur && cur !== editor) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      if (el.tagName === 'SPAN' && isStyleMatch(el, active)) {
        return el;
      }
    }
    cur = cur.parentNode;
  }
  return null;
}

// ------------------------------------------------------------
// Fix #1b：通用 Record<string,string> 版样式匹配
// 给 applyInlineStyle 用：检查 range 是否已完全在带相同样式的 span 内，
// 避免重复包裹导致 % 字号相乘反馈。
// ------------------------------------------------------------
function isStyleMatchProps(
  el: HTMLElement,
  styles: Record<string, string>,
): boolean {
  for (const k of Object.keys(styles)) {
    const want = styles[k];
    if (want == null || want === '') continue;
    if (k === 'textDecoration') {
      // textDecoration 是空格分隔的列表，要求所有 want 项都在 have 中
      const wantList = want.split(/\s+/).filter(Boolean);
      const haveList = (el.style.textDecoration || '').split(/\s+/).filter(Boolean);
      for (const w of wantList) {
        if (!haveList.includes(w)) return false;
      }
    } else {
      if ((el.style as any)[k] !== want) return false;
    }
  }
  return true;
}

function findStyleMatchSpanProps(
  startNode: Node,
  editor: HTMLElement,
  styles: Record<string, string>,
): HTMLElement | null {
  let cur: Node | null = startNode;
  while (cur && cur !== editor) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      if (el.tagName === 'SPAN' && isStyleMatchProps(el, styles)) {
        return el;
      }
    }
    cur = cur.parentNode;
  }
  return null;
}

/** 判断 range 是否完全在 el 元素内（含 el 自身） */
function isRangeFullyInside(range: Range, el: HTMLElement): boolean {
  const anc = range.commonAncestorContainer;
  if (anc === el) return true;
  if (anc.nodeType === Node.ELEMENT_NODE) {
    return el.contains(anc);
  }
  // anc 是 textNode，el 必须包含它
  return el.contains(anc);
}

/** 把刚插入的 span 解包回父级（用于父级已带相同样式时的清理）。
 *  把 span 的子节点按顺序移到 span 之前，然后从 DOM 中移除 span。
 *  如果父级也是 SPAN 且带相同样式，递归解包直到稳定。 */
function unwrapRedundantSpan(span: HTMLElement): void {
  const parent = span.parentNode;
  if (!parent) return;
  while (span.firstChild) {
    parent.insertBefore(span.firstChild, span);
  }
  parent.removeChild(span);
}

/** Fix #1c 增强：递归解包 root 内部所有带相同样式的 span。
 *  解决"多 span 选区应用同一字号"产生的内层冗余嵌套（>100% 越大 / <100% 越小）。
 *  例：选区跨两个 <span fontSize=150%>，applyInlineStyle 后变成
 *       <span fontSize=150%><span fontSize=150%>a</span><span fontSize=150%>b</span></span>
 *  调用本函数后：<span fontSize=150%>ab</span>（无嵌套，font-size:% 不会相乘）。
 *
 *  注意：只解包完全匹配 styles 的 span，不动无关嵌套（如 bold/italic 等）。 */
function unwrapRedundantSpansDeep(
  root: HTMLElement,
  styles: Record<string, string>,
): void {
  // 收集所有要解包的后代 span（后序遍历：先收集子，再决定 root）
  const toUnwrap: HTMLElement[] = [];
  const collect = (el: HTMLElement): void => {
    for (const child of Array.from(el.children)) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const childEl = child as HTMLElement;
      // 跳过已经收集过的（避免重复）
      if (toUnwrap.includes(childEl)) continue;
      collect(childEl);
      // 收集后判断（确保子 span 已被标记）
      if (childEl.tagName === 'SPAN' && isStyleMatchProps(childEl, styles)) {
        toUnwrap.push(childEl);
      }
    }
  };
  collect(root);
  // 执行解包
  for (const span of toUnwrap) {
    // 解包后可能其父级还在 root 内；解包后的子节点会成为 root 的直接子节点
    // 重复执行直到没有匹配项（处理嵌套中的同式 span）
    let safety = 0;
    while (
      span.parentNode &&
      span.parentNode !== root &&
      (span.parentNode as HTMLElement).tagName === 'SPAN' &&
      isStyleMatchProps(span.parentNode as HTMLElement, styles)
    ) {
      // 父级也匹配 → 解包父级（避免双层冗余）
      const p = span.parentNode as HTMLElement;
      unwrapRedundantSpan(p);
      safety++;
      if (safety > 100) break; // 防御性
    }
    unwrapRedundantSpan(span);
  }
}

/**
 * 比较两个 CSS font-size 值是否表示相同字号。
 * 兼容 pt/px/% 三种单位（通过 ptToSizePercent 统一转成数字百分比比较），
 * 用于智能合并中判断 active.fontSize 是否与继承的 fontSize 相同。
 */
function isSameFontSize(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const pa = ptToSizePercent(a);
  const pb = ptToSizePercent(b);
  if (pa != null && pb != null) return pa === pb;
  return a === b;
}

/**
 * 获取光标所在位置从最近 SPAN 继承的样式（fontSize/color/fontFamily）。
 * 用于 applyActiveStylesToInsertion / applyActiveStylesToRange 的智能合并：
 * 如果 active 样式已从父级 span 继承，不再创建嵌套 span。
 */
function getInheritedSpanStyles(
  startNode: Node,
  editor: HTMLElement,
): { fontSize?: string; color?: string; fontFamily?: string } {
  let cur: Node | null = startNode;
  while (cur && cur !== editor) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      if (el.tagName === 'SPAN') {
        return {
          fontSize: el.style.fontSize || undefined,
          color: el.style.color || undefined,
          fontFamily: el.style.fontFamily || undefined,
        };
      }
    }
    cur = cur.parentNode;
  }
  return {};
}

/**
 * 递归清理 root 内所有 span 的指定属性。
 * 用于 applyInlineStyle 包裹选区后：内层 span 的同属性值会覆盖外层（CSS 优先级），
 * 需要清除内层的冲突属性，让外层样式生效。
 *
 * 例如：应用 color=blue 后，内层 <span color=red> 需要去掉 color，
 * 否则 CSS 中内层 red 覆盖外层 blue。
 */
function removeConflictingStylesDeep(
  root: HTMLElement,
  styles: Record<string, string>,
): void {
  const styleKeys = Object.keys(styles);
  const spans = Array.from(root.querySelectorAll('span'));
  for (const span of spans) {
    let modified = false;
    for (const k of styleKeys) {
      if ((span.style as any)[k]) {
        (span.style as any)[k] = '';
        modified = true;
      }
    }
    // 如果 span 清除后无任何样式 → 解包（减少 DOM 嵌套）
    if (modified && span.style.cssText === '') {
      const parent = span.parentNode;
      if (parent) {
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        span.remove();
      }
    }
  }
}

// ------------------------------------------------------------
// IME 补偿：把 activeStyles 应用到一个已有 Range（包裹其中的文本）
// 用于 onCompositionEnd —— IME 提交后浏览器已插入原始文本（无样式），
// 用此函数把刚插入的文本包裹进 <span style="..."> 应用预选样式。
// 返回 true 表示成功应用。
// ------------------------------------------------------------
export function applyActiveStylesToRange(
  range: Range,
  active: {
    color?: string;
    fontSize?: string;
    fontFamily?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    sup?: boolean;
    sub?: boolean;
  },
  editor?: HTMLElement,
): boolean {
  if (
    !active.color &&
    !active.fontSize &&
    !active.fontFamily &&
    !active.bold &&
    !active.italic &&
    !active.underline &&
    !active.strike &&
    !active.sup &&
    !active.sub
  ) {
    return false;
  }
  if (range.collapsed) return false;

  // 智能合并：从 active 中移除已从父级继承的样式（避免 fontSize % 嵌套相乘）
  const inherited = editor
    ? getInheritedSpanStyles(range.startContainer, editor)
    : {};
  const remaining: typeof active = {};
  if (active.color && active.color !== inherited.color) remaining.color = active.color;
  if (active.fontSize && !isSameFontSize(active.fontSize, inherited.fontSize)) remaining.fontSize = active.fontSize;
  if (active.fontFamily && active.fontFamily !== inherited.fontFamily) remaining.fontFamily = active.fontFamily;
  if (active.bold) remaining.bold = active.bold;
  if (active.italic) remaining.italic = active.italic;
  if (active.underline) remaining.underline = active.underline;
  if (active.strike) remaining.strike = active.strike;
  if (active.sup) remaining.sup = active.sup;
  if (active.sub) remaining.sub = active.sub;

  const hasRemaining =
    remaining.color ||
    remaining.fontSize ||
    remaining.fontFamily ||
    remaining.bold ||
    remaining.italic ||
    remaining.underline ||
    remaining.strike ||
    remaining.sup ||
    remaining.sub;
  if (!hasRemaining) return false; // 所有样式已继承，无需包裹

  const wrap = document.createElement('span');
  if (remaining.color) wrap.style.color = remaining.color;
  if (remaining.fontSize) wrap.style.fontSize = remaining.fontSize;
  if (remaining.fontFamily) wrap.style.fontFamily = remaining.fontFamily;
  if (remaining.bold) wrap.style.fontWeight = 'bold';
  if (remaining.italic) wrap.style.fontStyle = 'italic';
  const deco: string[] = [];
  if (remaining.underline) deco.push('underline');
  if (remaining.strike) deco.push('line-through');
  if (deco.length) wrap.style.textDecoration = deco.join(' ');

  // sup/sub 互斥：如果两者都打开，sup 优先
  let outer: HTMLElement = wrap;
  if (remaining.sup) {
    const sup = document.createElement('sup');
    sup.appendChild(wrap);
    outer = sup;
  } else if (remaining.sub) {
    const sub = document.createElement('sub');
    sub.appendChild(wrap);
    outer = sub;
  }

  // 用 wrap 包裹 Range 内的内容
  try {
    range.surroundContents(outer);
  } catch {
    // surroundContents 在 Range 跨越部分元素边界时会抛错
    // 回退：extractContents + insertNode
    const frag = range.extractContents();
    wrap.appendChild(frag);
    range.insertNode(outer);
  }

  // 把光标放到 wrap 末尾之后
  const newRange = document.createRange();
  newRange.setStartAfter(outer);
  newRange.collapse(true);
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(newRange);
  }
  return true;
}

// ------------------------------------------------------------
// 获取选区内某个 CSS 属性的有效值（从 anchorNode 向上遍历）
// ------------------------------------------------------------
function getComputedInSelection(
  editor: HTMLElement,
  styleProp: string,
): string | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) {
    return null;
  }
  let node: Node | null = sel.anchorNode;
  while (node && node !== editor) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const v = (el.style as any)[styleProp];
      if (v && v !== '') return v;
    }
    node = node.parentNode;
  }
  return null;
}

export function getActiveColor(editor: HTMLElement): string | null {
  return getComputedInSelection(editor, 'color');
}
export function getActiveFontSize(editor: HTMLElement): string | null {
  return getComputedInSelection(editor, 'fontSize');
}
export function getActiveFontFamily(editor: HTMLElement): string | null {
  return getComputedInSelection(editor, 'fontFamily');
}

// V2：NGA 友好的 active 读取（识别 NGA 字体表、字号百分比、24 字色名）
// 工具栏用 NGA_FONTS/NGA_COLORS/NGA_FONT_SIZES 显示 label
// 这里通过 _ngaColorValue / _ngaFontValue / _ngaSizePercent 提供。

// ------------------------------------------------------------
// 获取当前块级元素（用于段落 / 标题 / 对齐 / 列表判断）
// ------------------------------------------------------------
const BLOCK_TAGS = new Set([
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

// ------------------------------------------------------------
// 对齐：给当前 block 设 style.textAlign
// ------------------------------------------------------------
export function setBlockAlign(editor: HTMLElement, align: string): void {
  focusEditor(editor);
  const block = getCurrentBlock(editor);
  if (!block) return;
  block.style.textAlign = align;
  dispatchInput(editor);
}

// ------------------------------------------------------------
// 行内样式（颜色 / 字号 / 字体）：用 Selection + span 包裹
// ------------------------------------------------------------
function getSelectionRangeIn(
  editor: HTMLElement,
): Range | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
    return null;
  }
  if (range.collapsed) return null;
  return range;
}

/** 展开 range 的边界，使它完整覆盖所在的 textNode。
 *  这里不做展开，直接使用用户实际选中的 range。 */

/** 尝试在 range 周围包裹一个 <span style="...">，
 *  如果 range 跨多个 block，则退化为对每个文本节点逐段包裹。
 *
 *  options.skipFocus: 跳过 focusEditor(editor)，避免工具栏 input 失焦。
 *    用于"在工具栏 select/number/range 上修改样式"场景，工具栏已通过 savedRangeRef 恢复选区，
 *    无需再调 focus()。
 *
 *  Fix #1b：选区去重
 *  - 若 range 已完全在带相同样式的 span 内 → 不操作（直接成功）
 *  - 包裹完成后，若新 span 的父级也是带相同样式的 span → 解包新 span（避免嵌套）
 *    CSS font-size:% 相对父元素计算，嵌套后实际字号会被反复相乘（>100% 越来越大、<100% 越来越小）。
 */
export function applyInlineStyle(
  editor: HTMLElement,
  styles: Record<string, string>,
  options?: { skipFocus?: boolean },
): boolean {
  if (!options?.skipFocus) focusEditor(editor);
  const range = getSelectionRangeIn(editor);
  if (!range) return false;

  // 折叠选区（无选区）下不直接应用样式：
  // 因为 applyInlineStyle 会插入空 span，但浏览器在用户开始输入时会把字符放到 span 外
  // 改为依赖 onChange 后续的 setActiveStyles + lockActiveStyles + handleBeforeInput 预激活逻辑
  // 由 applyActiveStylesToInsertion 在输入时包裹带样式的 span
  if (range.collapsed) return false;

  // Fix #1b 预检：range 已完全在匹配 span 内 → 不需要再包一层
  const commonMatchSpan = findStyleMatchSpanProps(
    range.commonAncestorContainer,
    editor,
    styles,
  );
  if (commonMatchSpan && isRangeFullyInside(range, commonMatchSpan)) {
    return true;
  }

  // 先尝试直接 surroundContents：仅在选区是单一节点时成功
  try {
    const span = document.createElement('span');
    for (const k of Object.keys(styles)) {
      (span.style as any)[k] = styles[k];
    }
    span.appendChild(range.extractContents());
    range.insertNode(span);
    // Fix #1b：父级已带相同样式时解包新 span（避免嵌套导致 % 相乘）
    if (
      span.parentNode &&
      span.parentNode.nodeType === Node.ELEMENT_NODE &&
      (span.parentNode as HTMLElement).tagName === 'SPAN' &&
      isStyleMatchProps(span.parentNode as HTMLElement, styles)
    ) {
      unwrapRedundantSpan(span);
    }
    // Fix #1c 增强：递归解包新 span 内部所有带相同样式的子 span
    // （多 span 选区应用同一字号时，跨多个老 span 会产生内部嵌套冗余）
    if (span.parentNode) unwrapRedundantSpansDeep(span, styles);
    // 清除内层 span 的同属性冲突值（如内层 color=red 不被外层 color=blue 覆盖）
    if (span.parentNode) removeConflictingStylesDeep(span, styles);
    // 保持选区：选中新 span 的内容
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(newRange);
    dispatchInput(editor);
    return true;
  } catch {
    // surroundContents 失败：退化为对每个文本节点独立包 span
  }

  // 收集 range 内的所有文本节点
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(
    editor,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(n: Node): number {
        return range.intersectsNode(n)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    },
  );
  let cur = walker.nextNode();
  while (cur) {
    textNodes.push(cur as Text);
    cur = walker.nextNode();
  }

  if (textNodes.length === 0) return false;

  const wrappedSpans: HTMLElement[] = [];
  let firstRange: Range | null = null;
  for (const tn of textNodes) {
    try {
      const r = document.createRange();
      // 只包裹这个文本节点中与 range 相交的部分
      const nodeStartOffset = 0;
      const nodeEndOffset = tn.textContent?.length ?? 0;
      const rStart =
        tn === range.startContainer ? range.startOffset : nodeStartOffset;
      const rEnd =
        tn === range.endContainer ? range.endOffset : nodeEndOffset;
      if (rStart >= rEnd) continue;
      r.setStart(tn, rStart);
      r.setEnd(tn, rEnd);

      const span = document.createElement('span');
      for (const k of Object.keys(styles)) {
        (span.style as any)[k] = styles[k];
      }
      span.appendChild(r.extractContents());
      r.insertNode(span);
      wrappedSpans.push(span);
      if (!firstRange) {
        firstRange = document.createRange();
        firstRange.selectNodeContents(span);
      }
    } catch {
      // 忽略单个节点异常
    }
  }

  // Fix #1b 后置清理：所有新 span 若父级已带相同样式则解包（避免嵌套）
  for (const span of wrappedSpans) {
    if (
      span.parentNode &&
      span.parentNode.nodeType === Node.ELEMENT_NODE &&
      (span.parentNode as HTMLElement).tagName === 'SPAN' &&
      isStyleMatchProps(span.parentNode as HTMLElement, styles)
    ) {
      unwrapRedundantSpan(span);
    }
  }
  // Fix #1c 增强：递归解包每个新 span 内部所有带相同样式的子 span
  // （多 span 选区应用同一字号时，跨多个老 span 会产生内部嵌套冗余）
  for (const span of wrappedSpans) {
    if (span.parentNode) unwrapRedundantSpansDeep(span, styles);
  }
  // 清除内层 span 的同属性冲突值（如内层 color=red 不被外层 color=blue 覆盖）
  for (const span of wrappedSpans) {
    if (span.parentNode) removeConflictingStylesDeep(span, styles);
  }

  if (firstRange) {
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(firstRange);
  }
  dispatchInput(editor);
  return true;
}

/** 等价于 applyInlineStyle(editor, styles, { skipFocus: true })，
 *  用于工具栏 select/number/range 修改样式时避免抢焦点。 */
export function applyInlineStyleNoFocus(
  editor: HTMLElement,
  styles: Record<string, string>,
): boolean {
  return applyInlineStyle(editor, styles, { skipFocus: true });
}

/** 清除指定的行内样式：向上查找带 style 的 span 并移除该属性，
 *  如果 span 因此变成空 style，则把 span 打开展平。 */
export function removeInlineStyle(
  editor: HTMLElement,
  styleProps: string[],
): boolean {
  focusEditor(editor);
  const range = getSelectionRangeIn(editor);
  if (!range) return false;

  // 简单策略：遍历 range 内的所有元素节点，对每个 span 清掉指定属性
  const walker = document.createTreeWalker(
    editor,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(n: Node): number {
        return range.intersectsNode(n)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    },
  );
  const candidates: HTMLElement[] = [];
  let cur = walker.nextNode();
  while (cur) {
    const el = cur as HTMLElement;
    if (el.tagName === 'SPAN') candidates.push(el);
    cur = walker.nextNode();
  }

  for (const span of candidates) {
    for (const p of styleProps) {
      span.style.removeProperty(p);
    }
    // 如果 span 没有任何 style 和属性，展平
    if (
      !span.getAttribute('style') ||
      span.getAttribute('style')?.trim() === ''
    ) {
      if (span.attributes.length === 0) {
        const parent = span.parentNode;
        if (parent) {
          while (span.firstChild) parent.insertBefore(span.firstChild, span);
          parent.removeChild(span);
        }
      }
    }
  }
  dispatchInput(editor);
  return true;
}

/** 颜色：若传空值则清除 color；否则用 span 包裹。 */
export function applyColor(editor: HTMLElement, color: string | '' | null): void {
  if (!color) {
    removeInlineStyle(editor, ['color']);
    return;
  }
  applyInlineStyle(editor, { color });
}

export function applyFontSize(
  editor: HTMLElement,
  fontSize: string | '' | null,
): void {
  if (!fontSize) {
    removeInlineStyle(editor, ['fontSize']);
    return;
  }
  applyInlineStyle(editor, { fontSize });
}

export function applyFontFamily(
  editor: HTMLElement,
  fontFamily: string | '' | null,
): void {
  if (!fontFamily) {
    removeInlineStyle(editor, ['fontFamily']);
    return;
  }
  applyInlineStyle(editor, { fontFamily });
}

// ============================================================
// 图片块：image-block
// ============================================================

const IMAGE_BLOCK_SELECTOR = 'div[data-type="image-block"]';

export function isImageBlock(el: HTMLElement | null | undefined): boolean {
  return !!(el && el.dataset && el.dataset.type === 'image-block');
}

/** 从节点向上查找最近的 image-block 容器（含自身） */
export function findImageBlockAncestor(
  node: Node | null | undefined,
  editor: HTMLElement,
): HTMLElement | null {
  if (!node) return null;
  let cur: Node | null = node;
  while (cur && cur !== editor) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      if (isImageBlock(el)) return el;
    }
    cur = cur.parentNode;
  }
  return null;
}

/** 取消所有图片块的选中态 */
export function clearImageSelection(editor: HTMLElement): void {
  const list = editor.querySelectorAll<HTMLElement>(IMAGE_BLOCK_SELECTOR);
  list.forEach((el) => el.removeAttribute('data-selected'));
}

/** 选中指定图片块（高亮蓝色 outline），返回该元素 */
export function selectImageBlock(
  editor: HTMLElement,
  block: HTMLElement,
): void {
  clearImageSelection(editor);
  block.setAttribute('data-selected', 'true');
}

/** 返回当前选中的图片块（如果有） */
export function getSelectedImageBlock(editor: HTMLElement): HTMLElement | null {
  const list = editor.querySelectorAll<HTMLElement>(IMAGE_BLOCK_SELECTOR);
  for (let i = 0; i < list.length; i++) {
    if (list[i].getAttribute('data-selected') === 'true') return list[i];
  }
  return null;
}

/** 在光标位置插入 image-block（NGA 5 档尺寸预设），光标落块后 */
export function insertImageBlock(
  editor: HTMLElement,
  src: string,
  opts?: { size?: string; alt?: string; name?: string },
): HTMLElement | null {
  // 关键：不要先 focusEditor！focus 会把 contenteditable 的 selection 重置到 (0,0)
  // getInsertionPoint 内部会优先用 _lastEditorRange（用户最后在 editor 内的光标）
  const sel = window.getSelection();
  if (!sel) return null;

  const sizeValue = opts?.size ?? NGA_DEFAULT_IMAGE_SIZE;
  const sizeInfo = NGA_IMAGE_SIZES.find((s) => s.value === sizeValue) ?? NGA_IMAGE_SIZES[0];

  const range = getInsertionPoint(editor);

  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-type', 'image-block');
  wrapper.setAttribute('data-size', sizeInfo.value);
  wrapper.setAttribute('contenteditable', 'false');
  wrapper.setAttribute('contentEditable', 'false');
  wrapper.setAttribute('draggable', 'true');
  wrapper.setAttribute('tabindex', '-1');
  wrapper.style.display = 'block';
  wrapper.style.margin = '2px 4px';
  wrapper.style.verticalAlign = 'middle';
  wrapper.style.outline = 'none';
  wrapper.style.userSelect = 'auto';
  wrapper.style.cursor = 'grab';

  const img = document.createElement('img');
  img.src = src;
  // alt 用可读名字，不要用 src（src 可能是 base64 data URL 巨长）
  img.alt = opts?.alt || opts?.name || '本地图片';
  if (opts?.name) img.setAttribute('data-name', opts.name);
  img.style.maxWidth = '100%';
  img.style.height = 'auto';
  img.style.display = 'inline-block';
  img.style.cursor = 'pointer';
  img.style.userSelect = 'auto';
  img.style.pointerEvents = 'none';
  if (sizeInfo.width) img.style.width = `${sizeInfo.width}px`;
  if (sizeInfo.height) img.style.height = `${sizeInfo.height}px`;

  img.addEventListener('error', () => {
    img.style.minHeight = '60px';
    img.style.background = 'var(--bg-hover, #f0f0f0)';
    img.alt = `图片加载失败: ${src.slice(0, 80)}`;
    if (!img.nextSibling || !(img.nextSibling as HTMLElement).classList?.contains('img-error-hint')) {
      const hint = document.createElement('span');
      hint.className = 'img-error-hint';
      hint.textContent = '[图片无法加载]';
      hint.style.cssText = 'display:block;color:#999;font-size:12px;padding:4px;';
      img.parentNode?.insertBefore(hint, img.nextSibling);
    }
  });
  img.addEventListener('load', () => {
    const hint = img.nextElementSibling;
    if (hint && (hint as HTMLElement).classList?.contains('img-error-hint')) {
      hint.remove();
    }
  });

  wrapper.setAttribute('data-width', sizeInfo.width ? String(sizeInfo.width) : '');
  wrapper.setAttribute('data-height', sizeInfo.height ? String(sizeInfo.height) : '');

  wrapper.appendChild(img);

  range.insertNode(wrapper);

  // 紧跟 wrapper 之后插入 <br> 占位，让用户可以点击空行放下光标
  const placeholder = document.createElement('br');
  wrapper.parentNode?.insertBefore(placeholder, wrapper.nextSibling);

  // 移动光标到 <br> 占位之后；这样连续插入会接在 <br> 之后，
  // 形成 wrapper → <br> → 新块 的结构
  focusEditor(editor);
  const newRange = document.createRange();
  newRange.setStartAfter(placeholder);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
  // 把新的"块后位置"也同步到模块，让下一次插入仍接在后面
  setLastEditorRange(newRange.cloneRange());

  dispatchInput(editor);
  // 原子块插入立即 push 历史（跳过 200ms 防抖，让每次插入可独立撤销）
  pushAtomicHistory(editor.innerHTML);
  return wrapper;
}

/** 获取图片块的当前尺寸 */
export function getImageBlockSize(block: HTMLElement): { width: number; height: number } {
  const img = block.querySelector('img');
  if (!img) return { width: 400, height: 0 };
  const w = parseInt(block.getAttribute('data-width') || '', 10);
  const h = parseInt(block.getAttribute('data-height') || '', 10);
  return {
    width: isNaN(w) ? img.clientWidth || 400 : w,
    height: isNaN(h) ? img.clientHeight || 0 : h,
  };
}

/** 设置图片块的尺寸（按 NGA 预设 size value） */
export function setImageBlockSize(
  editor: HTMLElement,
  block: HTMLElement,
  size: string,
): void {
  const img = block.querySelector('img');
  if (!img) return;
  const sizeInfo = NGA_IMAGE_SIZES.find((s) => s.value === size) ?? NGA_IMAGE_SIZES[0];
  if (sizeInfo.width) img.style.width = `${sizeInfo.width}px`;
  else img.style.width = 'auto';
  if (sizeInfo.height) img.style.height = `${sizeInfo.height}px`;
  else img.style.height = 'auto';
  img.style.maxWidth = '100%';
  block.setAttribute('data-size', sizeInfo.value);
  block.setAttribute('data-width', sizeInfo.width ? String(sizeInfo.width) : '');
  block.setAttribute('data-height', sizeInfo.height ? String(sizeInfo.height) : '');
  dispatchInput(editor);
}

/** 更新选中图片块的 src、data-size 并应用尺寸 */
export function updateSelectedImage(
  editor: HTMLElement,
  block: HTMLElement,
  opts: { src?: string; size?: string },
): void {
  const img = block.querySelector('img');
  if (!img) return;
  if (opts.src !== undefined) {
    img.setAttribute('src', opts.src);
  }
  if (opts.size !== undefined) {
    block.setAttribute('data-size', opts.size);
    const sizeInfo = NGA_IMAGE_SIZES.find((s) => s.value === opts.size);
    if (sizeInfo) {
      if (sizeInfo.width) img.style.width = `${sizeInfo.width}px`;
      else img.style.width = 'auto';
      if (sizeInfo.height) img.style.height = `${sizeInfo.height}px`;
      else img.style.height = 'auto';
      img.style.maxWidth = '100%';
      block.setAttribute('data-width', String(sizeInfo.width || ''));
      block.setAttribute('data-height', String(sizeInfo.height || ''));
    }
  }
  dispatchInput(editor);
}

/** 删除指定 image-block，并把光标放在它原来的位置（前面的段落末尾） */
export function removeImageBlock(editor: HTMLElement, block: HTMLElement): void {
  if (!block.parentNode) return;
  const parent = block.parentNode;
  const prev = block.previousSibling;
  parent.removeChild(block);

  // 尽量把光标放到前一个兄弟节点末尾，否则放到 parent 末尾
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

/** 清除图片块上的 resize 手柄和删除按钮 */
function clearImageBlockHandles(block: HTMLElement): void {
  const handles = block.querySelectorAll<HTMLElement>('[data-role="image-handle"], [data-role="image-delete"]');
  handles.forEach((h) => h.remove());
}

/** 清除所有图片块上的手柄 */
function clearAllImageBlockHandles(editor: HTMLElement): void {
  const list = editor.querySelectorAll<HTMLElement>(IMAGE_BLOCK_SELECTOR);
  list.forEach((b) => clearImageBlockHandles(b));
}

/** 在选中的图片块上添加四角手柄和删除按钮 */
function renderImageBlockHandles(
  editor: HTMLElement,
  block: HTMLElement,
): void {
  clearImageBlockHandles(block);
  const img = block.querySelector('img');
  if (!img) return;

  // 图片容器是 block，但 img 本身是 inline-block 居中显示
  // 需要用一个 wrapper 来确定 img 的位置信息
  const wrapper = block;
  wrapper.style.position = 'relative';

  // 创建四角手柄
  const positions: Array<{
    key: string;
    style: Partial<CSSStyleDeclaration>;
    cursor: string;
  }> = [
    { key: 'nw', style: { top: '-6px', left: '-6px' }, cursor: 'nwse-resize' },
    { key: 'ne', style: { top: '-6px', right: '-6px' }, cursor: 'nesw-resize' },
    { key: 'sw', style: { bottom: '-6px', left: '-6px' }, cursor: 'nesw-resize' },
    { key: 'se', style: { bottom: '-6px', right: '-6px' }, cursor: 'nwse-resize' },
  ];

  positions.forEach(({ key, style, cursor }) => {
    const handle = document.createElement('span');
    handle.setAttribute('data-role', 'image-handle');
    handle.setAttribute('data-handle', key);
    handle.contentEditable = 'false';
    Object.assign(handle.style, {
      position: 'absolute',
      width: '12px',
      height: '12px',
      background: 'var(--accent)',
      border: '2px solid var(--text-on-accent)',
      borderRadius: '50%',
      boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
      zIndex: '5',
      cursor: cursor,
      ...style,
    } as CSSStyleDeclaration);

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startImageResize(editor, block, img, key, e.clientX, e.clientY);
    });

    wrapper.appendChild(handle);
  });

  // 删除按钮
  const deleteBtn = document.createElement('button');
  deleteBtn.setAttribute('data-role', 'image-delete');
  deleteBtn.contentEditable = 'false';
  deleteBtn.textContent = '×';
  Object.assign(deleteBtn.style, {
    position: 'absolute',
    top: '-10px',
    right: '-10px',
    width: '24px',
    height: '24px',
    background: 'var(--danger, #ef4444)',
    color: 'var(--text-on-accent, #fff)',
    border: '2px solid var(--text-on-accent, #fff)',
    borderRadius: '50%',
    fontSize: '14px',
    lineHeight: '1',
    fontWeight: '700',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
    zIndex: '6',
    padding: '0',
  } as CSSStyleDeclaration);

  deleteBtn.addEventListener('mousedown', (e) => e.preventDefault());
  deleteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    removeImageBlock(editor, block);
    // 通知外层选中状态取消
    const ev = new CustomEvent('anke-image-deselected', { bubbles: true });
    editor.dispatchEvent(ev);
  });

  wrapper.appendChild(deleteBtn);
}

/** 计算图片的宽高比（优先从图片本身读取） */
function getImageAspectRatio(img: HTMLImageElement): number {
  const datasetRatio = parseFloat(img.parentElement?.getAttribute('data-ratio') || '');
  if (!isNaN(datasetRatio) && datasetRatio > 0) return datasetRatio;
  if (img.naturalWidth && img.naturalHeight) {
    const r = img.naturalWidth / img.naturalHeight;
    if (img.parentElement) img.parentElement.setAttribute('data-ratio', String(r));
    return r;
  }
  if (img.width && img.height) {
    return img.width / img.height;
  }
  return 1.5; // 默认值
}

/** 开始拖拽调整图片大小 */
function startImageResize(
  editor: HTMLElement,
  block: HTMLElement,
  img: HTMLImageElement,
  handle: string,
  startX: number,
  startY: number,
): void {
  const startWidth = img.clientWidth || 400;
  const aspectRatio = getImageAspectRatio(img);

  // 如果图片还在加载中，等待一下并存储原始尺寸
  if (!img.naturalWidth || !img.naturalHeight) {
    img.onload = () => {
      block.setAttribute('data-ratio', String(img.naturalWidth / img.naturalHeight));
    };
  }

  let latestWidth = startWidth;

  const onMove = (ev: MouseEvent) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;

    // 根据手柄位置决定放大/缩小方向
    // nw: 左上 → 右/下拖动为缩小
    // ne: 右上 → 左/下拖动为缩小
    // sw: 左下 → 右/上拖动为缩小
    // se: 右下 → 右/下拖动为放大
    let deltaW = 0;
    if (handle === 'se' || handle === 'ne') deltaW = dx;
    else deltaW = -dx;

    // 结合 dy 计算（保持宽高比，取绝对值较大的维度）
    const absByH = Math.abs(dy) * aspectRatio;
    const absByW = Math.abs(dx);
    const effectiveDelta = absByH > absByW ? (dy > 0 ? absByH : -absByH) : deltaW;

    let newWidth = startWidth + effectiveDelta;
    newWidth = Math.max(80, Math.min(2000, newWidth));
    latestWidth = newWidth;

    img.style.width = `${Math.round(newWidth)}px`;
    img.style.height = 'auto';
    block.setAttribute('data-width', String(Math.round(newWidth)));
  };

  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);

    const newHeight = Math.round(latestWidth / aspectRatio);
    block.setAttribute('data-height', String(newHeight));
    img.style.height = `${newHeight}px`;

    // 通知外层尺寸变化
    const ev = new CustomEvent('anke-image-size-changed', {
      bubbles: true,
      detail: { width: Math.round(latestWidth), height: newHeight },
    });
    editor.dispatchEvent(ev);

    dispatchInput(editor);
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

/** 给编辑器挂载图片块的交互：点击选中 + 拖拽手柄 + Delete/Backspace 删除 */
export function attachImageBlockHandlers(
  editor: HTMLElement,
): () => void {
  const onMouseDown = (e: MouseEvent) => {
    const target = e.target as Node | null;
    if (!target || !editor.contains(target)) return;

    // 如果点在手柄或删除按钮上，不做选中处理（由它们自己的事件处理）
    const targetEl = target as HTMLElement;
    if (targetEl.dataset?.role === 'image-handle' || targetEl.dataset?.role === 'image-delete') {
      return;
    }

    const block = findImageBlockAncestor(target, editor);
    if (block) {
      // 不调用 e.preventDefault()！否则浏览器不会触发 dragstart。
      // 只设置自定义选中态和"忽略文本选区"（通过 selectstart 事件）
      selectImageBlock(editor, block);
      renderImageBlockHandles(editor, block);
      const size = getImageBlockSize(block);
      const img = block.querySelector('img');
      const src = img?.getAttribute('src') || '';
      const dataSize = block.getAttribute('data-size') || 'original';
      const ev = new CustomEvent('anke-image-selected', {
        bubbles: true,
        detail: { width: size.width, height: size.height, src, dataSize },
      });
      editor.dispatchEvent(ev);
      return;
    }

    // 点击其他地方：清除图片选中态
    clearImageSelection(editor);
    clearAllImageBlockHandles(editor);
    const ev = new CustomEvent('anke-image-deselected', { bubbles: true });
    editor.dispatchEvent(ev);
  };

  // 用 selectstart 阻止文本选区出现在图片块内（不阻止 dragstart）
  const onSelectStart = (e: Event) => {
    const target = e.target as Node | null;
    if (!target || !editor.contains(target)) return;
    if (findImageBlockAncestor(target, editor)) {
      e.preventDefault();
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const selected = getSelectedImageBlock(editor);
    if (selected) {
      e.preventDefault();
      removeImageBlock(editor, selected);
      const ev = new CustomEvent('anke-image-deselected', { bubbles: true });
      editor.dispatchEvent(ev);
      return;
    }
    // 若光标刚好贴在某个 image-block 旁边（前后），按 Backspace/Delete 也删
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
        if (target && target.nodeType === Node.ELEMENT_NODE && isImageBlock(target)) {
          e.preventDefault();
          removeImageBlock(editor, target);
          return;
        }
      } else {
        const target = el.childNodes[offset] as HTMLElement | undefined;
        if (target && target.nodeType === Node.ELEMENT_NODE && isImageBlock(target)) {
          e.preventDefault();
          removeImageBlock(editor, target);
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
        if (prev && prev.nodeType === Node.ELEMENT_NODE && isImageBlock(prev)) {
          e.preventDefault();
          removeImageBlock(editor, prev);
          return;
        }
      } else if (
        e.key === 'Delete' &&
        offset === (container.textContent?.length ?? 0)
      ) {
        const next = parent.childNodes[idx + 1] as HTMLElement | undefined;
        if (next && next.nodeType === Node.ELEMENT_NODE && isImageBlock(next)) {
          e.preventDefault();
          removeImageBlock(editor, next);
          return;
        }
      }
    }
  };

  editor.addEventListener('mousedown', onMouseDown, true);
  editor.addEventListener('selectstart', onSelectStart, true);
  editor.addEventListener('keydown', onKeyDown, true);
  return () => {
    editor.removeEventListener('mousedown', onMouseDown, true);
    editor.removeEventListener('selectstart', onSelectStart, true);
    editor.removeEventListener('keydown', onKeyDown, true);
  };
}

// ============================================================
// 骰子卡片：dice-card
// ============================================================

const DICE_CARD_SELECTOR = 'div[data-type="dice-card"]';

export function isDiceCard(el: HTMLElement | null | undefined): boolean {
  return !!(el && el.dataset && el.dataset.type === 'dice-card');
}

/** 从节点向上查找最近的 dice-card */
export function findDiceCardAncestor(
  node: Node | null | undefined,
  editor: HTMLElement,
): HTMLElement | null {
  if (!node) return null;
  let cur: Node | null = node;
  while (cur && cur !== editor) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      if (isDiceCard(el)) return el;
    }
    cur = cur.parentNode;
  }
  return null;
}

/** 读取 payload（用 try/catch 保护 dataset.payload 可能为旧值 / 空） */
export function getDicePayload(block: HTMLElement): {
  payload: any;
  payloadStr: string;
} {
  const raw = block.getAttribute('data-payload') || '{}';
  try {
    return { payload: JSON.parse(raw), payloadStr: raw };
  } catch {
    return {
      payload: { version: 2, config: { id: '', kind: 'option', name: '骰子' }, lastResult: null },
      payloadStr: raw,
    };
  }
}

/** 写入 payload（同时更新 data-payload），返回 JSON 字符串 */
export function setDicePayload(block: HTMLElement, payload: any): string {
  const str = JSON.stringify(payload);
  block.setAttribute('data-payload', str);
  return str;
}

/** 选中态管理 */
export function clearDiceSelection(editor: HTMLElement): void {
  const list = editor.querySelectorAll<HTMLElement>(DICE_CARD_SELECTOR);
  list.forEach((el) => el.removeAttribute('data-selected'));
}

export function selectDiceCard(editor: HTMLElement, block: HTMLElement): void {
  clearDiceSelection(editor);
  block.setAttribute('data-selected', 'true');
}

export function getSelectedDiceCard(editor: HTMLElement): HTMLElement | null {
  const list = editor.querySelectorAll<HTMLElement>(DICE_CARD_SELECTOR);
  for (let i = 0; i < list.length; i++) {
    if (list[i].getAttribute('data-selected') === 'true') return list[i];
  }
  return null;
}

/** 渲染 / 刷新 dice-card 的 DOM。用 data-payload 驱动。 */
export function renderDiceCard(block: HTMLElement): void {
  const { payload } = getDicePayload(block);
  const cfg: any = (payload && payload.config) || { name: '骰子', kind: 'option' };
  const kind: string = cfg.kind || 'option';
  const lastResult: any = payload?.lastResult || null;

  // 为元素设置一些基础样式（第一次）
  if (!block.dataset.initialized) {
    block.setAttribute('contenteditable', 'false');
    block.setAttribute('contentEditable', 'false');
    block.style.display = 'block';
    block.style.margin = '12px 0';
    block.style.padding = '12px 14px';
    block.style.borderRadius = '10px';
    block.style.background = 'var(--dice-card-bg)';
    block.style.border = '1px solid var(--dice-card-border)';
    block.style.fontSize = '13px';
    block.style.lineHeight = '1.6';
    block.style.color = 'var(--dice-card-ink)';
    block.style.outline = 'none';
    block.style.userSelect = 'auto'; // 允许被选中以便拖动
    block.dataset.initialized = '1';
  }

  // 名称
  const nameEl = block.querySelector<HTMLElement>('[data-slot="name"]');
  const kindEl = block.querySelector<HTMLElement>('[data-slot="kind"]');
  const optionsEl = block.querySelector<HTMLElement>('[data-slot="options"]');
  const resultEl = block.querySelector<HTMLElement>('[data-slot="result"]');

  // 首次构建内部结构
  let ensureName = nameEl;
  if (!ensureName) {
    const head = document.createElement('div');
    head.style.display = 'flex';
    head.style.alignItems = 'center';
    head.style.justifyContent = 'space-between';
    head.style.gap = '8px';

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'baseline';
    left.style.gap = '8px';

    const name = document.createElement('div');
    name.setAttribute('data-slot', 'name');
    name.style.fontWeight = '600';
    name.style.fontSize = '13px';
    name.style.color = 'var(--dice-card-ink)';

    const kindLabel = document.createElement('div');
    kindLabel.setAttribute('data-slot', 'kind');
    kindLabel.style.fontSize = '11px';
    kindLabel.style.padding = '2px 8px';
    kindLabel.style.borderRadius = '999px';
    kindLabel.style.background = 'var(--dice-card-kind-bg)';
    kindLabel.style.color = 'var(--dice-card-kind-fg)';
    kindLabel.style.fontWeight = '500';

    left.appendChild(name);
    left.appendChild(kindLabel);

    const rollBtn = document.createElement('button');
    rollBtn.setAttribute('data-role', 'roll');
    rollBtn.textContent = '🎲 掷骰';
    rollBtn.style.fontSize = '12px';
    rollBtn.style.fontWeight = '500';
    rollBtn.style.padding = '4px 10px';
    rollBtn.style.borderRadius = '6px';
    rollBtn.style.border = '1px solid var(--dice-card-roll-bg)';
    rollBtn.style.background = 'var(--dice-card-roll-bg)';
    rollBtn.style.color = 'var(--text-on-accent)';
    rollBtn.style.cursor = 'pointer';
    rollBtn.style.userSelect = 'none';
    rollBtn.addEventListener('mouseenter', () => {
      rollBtn.style.background = 'var(--dice-card-roll-hover)';
      rollBtn.style.borderColor = 'var(--dice-card-roll-hover)';
    });
    rollBtn.addEventListener('mouseleave', () => {
      rollBtn.style.background = 'var(--dice-card-roll-bg)';
      rollBtn.style.borderColor = 'var(--dice-card-roll-bg)';
    });

    head.appendChild(left);
    head.appendChild(rollBtn);

    // 滚动展示区（投掷动画时显示，投后隐藏；DOM 始终保留，避免重复创建）
    const rollDisplay = document.createElement('div');
    rollDisplay.setAttribute('data-slot', 'roll-display');
    rollDisplay.style.display = 'none';
    rollDisplay.style.alignItems = 'center';
    rollDisplay.style.gap = '6px';
    rollDisplay.style.fontSize = '12px';
    rollDisplay.style.fontFamily = 'Consolas, Menlo, monospace';
    rollDisplay.style.color = 'var(--dice-card-ink)';
    rollDisplay.style.fontWeight = '500';

    const rollEmoji = document.createElement('span');
    rollEmoji.setAttribute('data-slot', 'roll-emoji');
    rollEmoji.textContent = '🎲';
    rollEmoji.style.fontSize = '16px';
    rollEmoji.style.display = 'inline-block';

    const rollNumber = document.createElement('span');
    rollNumber.setAttribute('data-slot', 'roll-number');
    rollNumber.style.minWidth = '52px';
    rollNumber.style.textAlign = 'right';

    rollDisplay.appendChild(rollEmoji);
    rollDisplay.appendChild(rollNumber);
    head.appendChild(rollDisplay);

    block.appendChild(head);

    // 选项区
    const options = document.createElement('div');
    options.setAttribute('data-slot', 'options');
    options.style.marginTop = '8px';
    options.style.display = 'flex';
    options.style.flexDirection = 'column';
    options.style.gap = '4px';
    block.appendChild(options);

    // 结果区
    const result = document.createElement('div');
    result.setAttribute('data-slot', 'result');
    result.style.marginTop = '10px';
    result.style.padding = '8px 10px';
    result.style.background = 'var(--dice-card-kind-bg)';
    result.style.border = '1px dashed var(--dice-card-border)';
    result.style.borderRadius = '8px';
    result.style.color = 'var(--dice-card-kind-fg)';
    result.style.fontSize = '12px';
    result.style.display = 'none';
    block.appendChild(result);
  }

  // 填值：名称
  const finalNameEl = block.querySelector<HTMLElement>('[data-slot="name"]');
  if (finalNameEl) finalNameEl.textContent = cfg.name || '';

  // 填值：类型标签
  const finalKindEl = block.querySelector<HTMLElement>('[data-slot="kind"]');
  if (finalKindEl) {
    finalKindEl.textContent =
      kind === 'numeric'
        ? `数值 · ${formatNumericExpressionFromConfig(cfg)}`
        : `选项 · D${cfg.faces ?? 2}`;
  }

  // 一次性约束：已投掷过 → 隐藏掷骰按钮（投掷动画结束后保持隐藏）
  const finalRollBtn = block.querySelector<HTMLButtonElement>('button[data-role="roll"]');
  if (finalRollBtn) {
    finalRollBtn.style.display = lastResult ? 'none' : '';
  }

  // 填值：选项（仅选项骰子）
  const finalOptionsEl = block.querySelector<HTMLElement>('[data-slot="options"]');
  if (finalOptionsEl) {
    finalOptionsEl.innerHTML = '';
    if (kind === 'option') {
      const opts: any[] = cfg.options || [];
      const hitId: string | null = lastResult?.hitOptionId || null;
      opts.forEach((opt) => {
        const row = document.createElement('div');
        row.setAttribute('data-option-id', opt.id);
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.padding = '3px 6px';
        row.style.borderRadius = '6px';
        if (hitId && opt.id === hitId) {
          row.style.background = 'var(--dice-card-hit-bg)';
          row.style.color = 'var(--dice-card-hit-fg)';
          row.style.fontWeight = '600';
          row.style.border = '1px solid var(--dice-card-hit-border)';
          row.classList.add('anke-dice-hit');
        } else {
          row.style.background = 'var(--dice-card-bg)';
          row.style.color = 'var(--dice-card-ink)';
        }
        const val = document.createElement('span');
        val.textContent = opt.displayValue || '';
        val.style.fontSize = '11px';
        val.style.fontFamily = 'Consolas, Menlo, monospace';
        val.style.padding = '1px 6px';
        val.style.borderRadius = '4px';
        val.style.background = hitId && opt.id === hitId ? 'var(--dice-card-roll-hover)' : 'var(--dice-card-kind-bg)';
        val.style.color = hitId && opt.id === hitId ? 'var(--text-on-accent)' : 'var(--dice-card-kind-fg)';
        val.style.fontWeight = '600';
        val.style.minWidth = '36px';
        val.style.textAlign = 'center';

        const content = document.createElement('span');
        content.textContent = opt.content || '';
        content.style.fontSize = '12px';
        content.style.flex = '1';

        row.appendChild(val);
        row.appendChild(content);
        finalOptionsEl.appendChild(row);
      });
    }
  }

  // 填值：结果
  const finalResultEl = block.querySelector<HTMLElement>('[data-slot="result"]');
  if (finalResultEl) {
    if (!lastResult) {
      finalResultEl.style.display = 'none';
      finalResultEl.textContent = '';
    } else {
      finalResultEl.style.display = 'block';
      const headText = lastResult.displayText || '';
      let bodyText = '';
      if (lastResult.kind === 'option') {
        bodyText = lastResult.hitOptionContent
          ? `命中：${lastResult.hitOptionContent}`
          : '未命中任何选项';
      } else {
        bodyText = `结果：${lastResult.total}`;
      }
      finalResultEl.innerHTML =
        `<div style="font-family:Consolas,Menlo,monospace;font-size:12px;margin-bottom:4px;">${escapeHtml(
          headText,
        )}</div>` + `<div>${escapeHtml(bodyText)}</div>`;
    }
  }
}

/** 把数值骰子的配置格式化为 "3d6+2" 或表达式 */
function formatNumericExpressionFromConfig(cfg: any): string {
  if (cfg.expression) return cfg.expression;
  const count = Math.max(1, Math.floor(cfg.count ?? 1));
  const faces = Math.max(1, Math.floor(cfg.numericFaces ?? 100));
  const modifier = Math.floor(cfg.modifier ?? 0);
  const mod = modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : `${modifier}`;
  return `${count}d${faces}${mod}`;
}

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 在光标处插入 dice-card，后补空段落并把光标落进去 */
export function insertDiceCard(
  editor: HTMLElement,
  payload: any,
): HTMLElement | null {
  // 关键：不要先 focusEditor！focus 会把 contenteditable 的 selection 重置到 (0,0)
  // getInsertionPoint 内部会优先用 _lastEditorRange（用户最后在 editor 内的光标）
  const range = getInsertionPoint(editor);

  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-type', 'dice-card');
  wrapper.setAttribute('draggable', 'true');
  wrapper.setAttribute('tabindex', '-1');
  wrapper.style.userSelect = 'auto';
  wrapper.style.cursor = 'grab';
  wrapper.style.outline = 'none';
  wrapper.style.display = 'block';
  setDicePayload(wrapper, payload);
  renderDiceCard(wrapper);

  range.insertNode(wrapper);

  // 紧跟 wrapper 之后插入 <br> 占位，让用户可以点击空行放下光标
  const placeholder = document.createElement('br');
  wrapper.parentNode?.insertBefore(placeholder, wrapper.nextSibling);

  // 移动光标到 <br> 占位之后；这样连续插入会接在 <br> 之后，
  // 形成 wrapper → <br> → 新块 的结构（与测试期望一致）
  const sel = window.getSelection();
  if (sel) {
    const newRange = document.createRange();
    newRange.setStartAfter(placeholder);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
    // 同步到模块，让连续插入接在后面
    setLastEditorRange(newRange.cloneRange());
  }
  focusEditor(editor);

  dispatchInput(editor);
  // 原子块插入立即 push 历史（跳过 200ms 防抖，让每次插入可独立撤销）
  pushAtomicHistory(editor.innerHTML);
  return wrapper;
}

/** 删除指定 dice-card，光标落到前一个兄弟末尾，触发 input */
export function removeDiceCard(editor: HTMLElement, block: HTMLElement): void {
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

/** 对 dice-card 执行掷骰：读取 payload → rollDice → 更新 payload → 重渲染 → dispatchInput
 *  - 一次性约束：已投掷过（payload.lastResult 存在）则直接返回
 *  - 动画：600ms 内 🎲 emoji 旋转 + 数字快速滚动（老虎机效果）
 *  - 投后：按钮消失（display:none），结果区显示最终结果
 */
export function rollDiceOnCard(editor: HTMLElement, block: HTMLElement): void {
  const { payload } = getDicePayload(block);
  if (!payload || !payload.config) return;

  // 一次性约束：已投掷过则不再触发（renderDiceCard 已隐藏按钮，双保险）
  if (payload.lastResult) return;

  // 1. 启动动画：摇一摇卡片 + 按钮按压 + 显示滚动区
  const rollBtn = block.querySelector<HTMLButtonElement>('button[data-role="roll"]');
  const rollDisplay = block.querySelector<HTMLElement>('[data-slot="roll-display"]');
  const rollEmoji = block.querySelector<HTMLElement>('[data-slot="roll-emoji"]');
  const rollNumber = block.querySelector<HTMLElement>('[data-slot="roll-number"]');

  // 播放音效（仅在设置开启时；playDiceRollSound 内部 try/catch，失败安全 no-op）
  if (useSettingStore.getState().soundEnabled) {
    void playDiceRollSound();
  }

  // 摇一摇卡片（350ms 后自动清除 class）
  block.classList.add('anke-dice-shaking');
  window.setTimeout(() => block.classList.remove('anke-dice-shaking'), 350);

  // 按钮按压（180ms 后清除，180ms 后再隐藏）
  if (rollBtn) rollBtn.classList.add('anke-dice-btn-press');
  window.setTimeout(() => {
    if (rollBtn) {
      rollBtn.classList.remove('anke-dice-btn-press');
      rollBtn.style.display = 'none';
    }
  }, 180);

  if (rollDisplay) {
    rollDisplay.style.display = 'inline-flex';
    rollDisplay.classList.add('anke-dice-rolling');
  }
  if (rollEmoji) rollEmoji.classList.add('anke-dice-spin');

  // 2. 同步计算结果（动画期间不渲染结果区，等动画结束再统一更新）
  const cfg: any = payload.config;
  const result: any = rollDicePure(cfg);
  const history: any[] = Array.isArray(payload.history) ? [...payload.history, result] : [result];
  const nextPayload = {
    ...payload,
    lastResult: result,
    history: history.slice(-20),
  };

  // 3. 数字滚动：渐进减速节奏（6 快速 + 4 中速 + 2 慢速 = 800ms）
  const kind: string = cfg.kind || 'option';
  const maxValue =
    kind === 'numeric'
      ? Math.max(1, Math.floor(cfg.numericFaces ?? 100))
      : Math.max(1, Math.floor(cfg.faces ?? 2));
  const displayText = kind === 'numeric' ? `${cfg.count ?? 1}d${maxValue}` : `D${maxValue}`;

  const tickDelays = [50, 50, 50, 50, 50, 50, 75, 75, 75, 75, 100, 100];
  const ROLL_TOTAL_MS = tickDelays.reduce((a, b) => a + b, 0); // 800
  let tickIdx = 0;
  const tickFn = () => {
    const v = Math.floor(Math.random() * maxValue) + 1;
    if (rollNumber) rollNumber.textContent = `[${displayText}=${v}]`;
    if (tickIdx < tickDelays.length) {
      window.setTimeout(tickFn, tickDelays[tickIdx]);
      tickIdx++;
    }
  };
  tickFn();

  // 4. ROLL_TOTAL_MS 后：写入 payload、隐藏滚动区、清空动画
  window.setTimeout(() => {
    if (rollDisplay) {
      rollDisplay.classList.remove('anke-dice-rolling');
      rollDisplay.style.display = 'none';
    }
    if (rollEmoji) rollEmoji.classList.remove('anke-dice-spin');
    if (rollNumber) rollNumber.textContent = '';

    // 写入 payload → renderDiceCard 内 lastResult 存在 → rollBtn 永久隐藏
    setDicePayload(block, nextPayload);
    renderDiceCard(block);
    dispatchInput(editor);

    // 通知外层（例如 RichTextEditor）：骰子被掷出
    try {
      editor.dispatchEvent(
        new CustomEvent('anke-dice-rolled', {
          bubbles: true,
          detail: { payload: nextPayload, blockElement: block },
        }),
      );
    } catch {
      // ignore
    }
  }, ROLL_TOTAL_MS);
}

/** 纯函数版 rollDice：不依赖 store，直接调 diceEngine.rollDice
 *  - diceEngine.rollDice 已正确处理：
 *    · 数值骰子简单模式：count 上限 NUMERIC_MAX_COUNT (100)，faces 上限 NUMERIC_MAX_FACES (9999999)
 *    · 数值骰子表达式模式：自动走 rollExpression（支持 + - * / 和括号）
 *    · 选项骰子：1Dfaces 投掷 + 命中选项
 */
function rollDicePure(cfg: any): any {
  return rollDice(cfg as any);
}

/** 给编辑器挂载 dice-card 交互：点击选中、Delete/Backspace 删除、掷骰按钮；并对所有已有 dice-card 重渲染 */
export function attachDiceCardHandlers(editor: HTMLElement): () => void {
  // 首次挂载：对已有的 dice-card（从 innerHTML 恢复出来）重渲染以确保内部结构
  // 注意：已初始化的（data-initialized=1）只刷新内容，不再清空重建，避免 rollBtn 引用变化导致 hover/click 状态丢失
  const existing = editor.querySelectorAll<HTMLElement>(DICE_CARD_SELECTOR);
  existing.forEach((el) => {
    if (el.dataset.initialized) {
      renderDiceCard(el);
    } else {
      el.innerHTML = '';
      renderDiceCard(el);
    }
  });

  const onMouseDown = (e: MouseEvent) => {
    const target = e.target as Node | null;
    if (!target || !editor.contains(target)) return;
    // 点击到掷骰按钮：不做选中（click 事件会处理）
    const btn = findAncestorWithAttr(target as HTMLElement, 'data-role', 'roll');
    if (btn) return;
    const block = findDiceCardAncestor(target, editor);
    if (block) {
      // 不调用 e.preventDefault()！否则浏览器不会触发 dragstart。
      selectDiceCard(editor, block);
      return;
    }
    clearDiceSelection(editor);
  };

  // 用 selectstart 阻止文本选区出现在骰子卡片内（不阻止 dragstart）
  const onSelectStart = (e: Event) => {
    const target = e.target as Node | null;
    if (!target || !editor.contains(target)) return;
    if (findDiceCardAncestor(target, editor)) {
      e.preventDefault();
    }
  };

  const onClick = (e: MouseEvent) => {
    const target = e.target as Node | null;
    if (!target || !editor.contains(target)) return;
    const btn = findAncestorWithAttr(target as HTMLElement, 'data-role', 'roll');
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();
    const block = findDiceCardAncestor(target, editor);
    if (!block) return;
    rollDiceOnCard(editor, block);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const selected = getSelectedDiceCard(editor);
    if (selected) {
      e.preventDefault();
      removeDiceCard(editor, selected);
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
        if (target && target.nodeType === Node.ELEMENT_NODE && isDiceCard(target)) {
          e.preventDefault();
          removeDiceCard(editor, target);
          return;
        }
      } else {
        const target = el.childNodes[offset] as HTMLElement | undefined;
        if (target && target.nodeType === Node.ELEMENT_NODE && isDiceCard(target)) {
          e.preventDefault();
          removeDiceCard(editor, target);
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
        if (prev && prev.nodeType === Node.ELEMENT_NODE && isDiceCard(prev)) {
          e.preventDefault();
          removeDiceCard(editor, prev);
          return;
        }
      } else if (
        e.key === 'Delete' &&
        offset === (container.textContent?.length ?? 0)
      ) {
        const next = parent.childNodes[idx + 1] as HTMLElement | undefined;
        if (next && next.nodeType === Node.ELEMENT_NODE && isDiceCard(next)) {
          e.preventDefault();
          removeDiceCard(editor, next);
          return;
        }
      }
    }
  };

  editor.addEventListener('mousedown', onMouseDown, true);
  editor.addEventListener('selectstart', onSelectStart, true);
  editor.addEventListener('click', onClick, true);
  editor.addEventListener('keydown', onKeyDown, true);
  return () => {
    editor.removeEventListener('mousedown', onMouseDown, true);
    editor.removeEventListener('selectstart', onSelectStart, true);
    editor.removeEventListener('click', onClick, true);
    editor.removeEventListener('keydown', onKeyDown, true);
  };
}

/** 给定历史记录的 payload JSON 字符串，在编辑器中找到对应的 dice-card 并滚动到它，选中并闪烁高亮 */
export function scrollToDiceCard(editor: HTMLElement, payloadSnapshot: string): boolean {
  if (!editor || !payloadSnapshot) return false;
  let snapshot: any = null;
  try {
    snapshot = JSON.parse(payloadSnapshot);
  } catch {
    return false;
  }
  const snapshotId: string =
    (snapshot && snapshot.config && (snapshot.config.id || snapshot.config.name)) || '';
  const snapshotTimestamp: number | null =
    snapshot && snapshot.lastResult && typeof snapshot.lastResult.timestamp === 'number'
      ? snapshot.lastResult.timestamp
      : null;

  const candidates = editor.querySelectorAll<HTMLElement>(DICE_CARD_SELECTOR);
  if (candidates.length === 0) return false;

  let best: HTMLElement | null = null;
  let bestScore = -1;

  candidates.forEach((el) => {
    let cur: any = null;
    try {
      cur = JSON.parse(el.getAttribute('data-payload') || '{}');
    } catch {
      return;
    }
    const curId: string =
      (cur && cur.config && (cur.config.id || cur.config.name)) || '';
    const curTimestamp: number | null =
      cur && cur.lastResult && typeof cur.lastResult.timestamp === 'number'
        ? cur.lastResult.timestamp
        : null;

    let score = 0;
    if (snapshotId && curId === snapshotId) score += 100;
    if (
      snapshotTimestamp != null &&
      curTimestamp != null &&
      Math.abs(curTimestamp - snapshotTimestamp) < 1000
    ) {
      score += 50;
    }
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  });

  if (!best) {
    // 降级策略：找编辑器中第一个 dice-card
    best = candidates[0] || null;
  }

  if (best) {
    selectDiceCard(editor, best);
    try {
      (best as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      // ignore
    }
    // 简单高亮闪烁
    const original = (best as HTMLElement).style.boxShadow;
    (best as HTMLElement).style.boxShadow = '0 0 0 3px var(--accent-bg)';
    window.setTimeout(() => {
      if (best) (best as HTMLElement).style.boxShadow = original;
    }, 1200);
    return true;
  }
  return false;
}

/**
 * 纯检查函数（无副作用）：判断 payloadSnapshot 对应的骰子是否仍在编辑器中。
 * 匹配规则与 scrollToDiceCard 一致（id/name +100 分，timestamp +50 分），
 * 但不滚动/不选中/不闪烁，且不降级到第一个 dice-card。
 * 返回 true 表示骰子还在编辑区（恢复按钮应 disabled）。
 */
export function isDiceCardInEditor(editor: HTMLElement, payloadSnapshot: string): boolean {
  if (!editor || !payloadSnapshot) return false;
  let snapshot: any = null;
  try {
    snapshot = JSON.parse(payloadSnapshot);
  } catch {
    return false;
  }
  const snapshotId: string =
    (snapshot && snapshot.config && (snapshot.config.id || snapshot.config.name)) || '';
  const snapshotTimestamp: number | null =
    snapshot && snapshot.lastResult && typeof snapshot.lastResult.timestamp === 'number'
      ? snapshot.lastResult.timestamp
      : null;

  const candidates = editor.querySelectorAll<HTMLElement>(DICE_CARD_SELECTOR);
  if (candidates.length === 0) return false;

  let bestScore = -1;
  candidates.forEach((el) => {
    let cur: any = null;
    try {
      cur = JSON.parse(el.getAttribute('data-payload') || '{}');
    } catch {
      return;
    }
    const curId: string =
      (cur && cur.config && (cur.config.id || cur.config.name)) || '';
    const curTimestamp: number | null =
      cur && cur.lastResult && typeof cur.lastResult.timestamp === 'number'
        ? cur.lastResult.timestamp
        : null;

    let score = 0;
    if (snapshotId && curId === snapshotId) score += 100;
    if (
      snapshotTimestamp != null &&
      curTimestamp != null &&
      Math.abs(curTimestamp - snapshotTimestamp) < 1000
    ) {
      score += 50;
    }
    if (score > bestScore) {
      bestScore = score;
    }
  });

  // 有实际匹配（score >= 50）才算"还在"
  return bestScore >= 50;
}

function findAncestorWithAttr(
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

// ============================================================
// 折叠块：collapse-block（支持删除、撤销）
// ============================================================

const COLLAPSE_BLOCK_SELECTOR = 'div[data-type="collapse-block"]';

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

/** 给编辑器挂载 collapse-block 交互：点击选中、Delete/Backspace 删除、点击 head 展开/折叠 */
export function attachCollapseBlockHandlers(
  editor: HTMLElement,
): () => void {
  // 对已有的 collapse-block 设置 draggable
  const existing = editor.querySelectorAll<HTMLElement>(COLLAPSE_BLOCK_SELECTOR);
  existing.forEach((el) => { if (!el.hasAttribute('draggable')) el.setAttribute('draggable', 'true'); });

  const onMouseDown = (e: MouseEvent) => {
    const target = e.target as Node | null;
    if (!target || !editor.contains(target)) return;
    const targetEl = target as HTMLElement;
    // 点击到 head/title 或其子元素不做选中，允许正常编辑标题
    if (targetEl.classList?.contains('collapse-head')) return;
    if (targetEl.classList?.contains('collapse-title')) return;
    if (targetEl.closest?.('.collapse-head')) return;
    const block = findCollapseBlockAncestor(target, editor);
    if (block) {
      // 不调用 e.preventDefault()，允许 HTML5 拖动正常启动
      clearCollapseSelection(editor);
      selectCollapseBlock(editor, block);
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

    // Shift+Enter：在折叠块 body 内 = 块内换行（与 Enter 行为一致，走浏览器默认）
    // 因此不在 onKeyDown 拦截 Shift+Enter，让浏览器处理块内换行

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
 * 获取编辑器内当前可用的 Range（即使 collapsed 也返回）。
 * 若没有可用选区（编辑器未聚焦），则在编辑器末尾创建一个 collapsed range。
 * 注意：不在此调 focusEditor，以免破坏已有的光标位置。
 */
function getInsertionRange(editor: HTMLElement): Range {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const r = sel.getRangeAt(0);
    if (editor.contains(r.startContainer)) return r.cloneRange();
  }
  const r = document.createRange();
  r.selectNodeContents(editor);
  r.collapse(false);
  return r;
}

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
  block.setAttribute('draggable', 'true');
  block.style.display = 'block';
  block.style.margin = '6px 0';
  block.style.borderRadius = '4px';
  block.style.overflow = 'hidden';
  block.style.outline = 'none';
  block.style.cursor = 'grab';
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

// ------------------------------------------------------------
// 图片块（带尺寸下拉）：复用现有 insertImageBlock，再加 data-size
// ------------------------------------------------------------

/** 插入带尺寸的 image-block（NGA 5 档预设 size value） */
export function insertImageBlockWithSize(
  editor: HTMLElement,
  src: string,
  size: typeof NGA_IMAGE_SIZES[number]['value'],
): HTMLElement | null {
  return insertImageBlock(editor, src, { size });
}

/** 设置当前选中（或光标紧邻）的 image-block 的对齐方式
 *  align: 'left' | 'center' | 'right'
 */
export function setImageBlockAlign(editor: HTMLElement, align: 'left' | 'center' | 'right'): void {
  focusEditor(editor);
  const block = findSelectedImageBlock(editor);
  if (!block) return;
  // 找到或创建一个包含该 block 的块级父容器来控制对齐
  let blockParent = block.parentElement;
  // 若父容器是编辑器本身，则创建一个 <p> 将 block 包起来
  if (blockParent === editor) {
    const p = document.createElement('p');
    block.parentNode?.insertBefore(p, block);
    p.appendChild(block);
    blockParent = p;
  }
  if (blockParent && blockParent !== editor) {
    blockParent.style.textAlign = align;
  }
  dispatchInput(editor);
}

/** 在编辑器内查找当前选区或光标邻近的 image-block */
function findSelectedImageBlock(editor: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel) return null;

  const closestFrom = (node: Node | null): HTMLElement | null => {
    if (!node) return null;
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.getAttribute?.('data-type') === 'image-block') return el;
    }
    let cur: Node | null = node;
    while (cur && cur !== editor) {
      if (cur.nodeType === Node.ELEMENT_NODE) {
        const el = cur as HTMLElement;
        if (el.getAttribute?.('data-type') === 'image-block') return el;
      }
      cur = cur.parentNode;
    }
    return null;
  };

  // 1) 从选区锚点/焦点向上冒泡查找
  const anchorHit = closestFrom(sel.anchorNode);
  if (anchorHit) return anchorHit;
  if (sel.focusNode && sel.focusNode !== sel.anchorNode) {
    const focusHit = closestFrom(sel.focusNode);
    if (focusHit) return focusHit;
  }

  // 2) 选区非折叠时：扫描 range 共同祖先内的子节点，找 image-block
  if (sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    if (!range.collapsed) {
      const root = range.commonAncestorContainer;
      const container =
        root.nodeType === Node.ELEMENT_NODE ? (root as HTMLElement) : (root.parentElement ?? editor);
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, {
        acceptNode(n) {
          if ((n as HTMLElement).getAttribute?.('data-type') === 'image-block') {
            return NodeFilter.FILTER_ACCEPT;
          }
          // 忽略嵌套的 contenteditable 子编辑器
          if ((n as HTMLElement).getAttribute?.('contenteditable') === 'true' && n !== editor) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_SKIP;
        },
      });
      let node: Node | null = walker.nextNode();
      while (node) {
        if (range.intersectsNode(node)) return node as HTMLElement;
        node = walker.nextNode();
      }
    } else {
      // 3) 光标紧邻一个 image-block（前/后兄弟节点）
      const start = range.startContainer;
      const startOffset = range.startOffset;
      if (start.nodeType === Node.ELEMENT_NODE) {
        const el = start as HTMLElement;
        const children = el.children;
        // 检查光标位置的前后孩子是否是 image-block
        const prev = children[startOffset - 1] as HTMLElement | undefined;
        const next = children[startOffset] as HTMLElement | undefined;
        if (prev && prev.getAttribute?.('data-type') === 'image-block') return prev;
        if (next && next.getAttribute?.('data-type') === 'image-block') return next;
      } else if (start.nodeType === Node.TEXT_NODE) {
        // 文本节点紧贴其 parent 的前后兄弟也可
        const parent = start.parentElement;
        if (parent) {
          const pPrev = parent.previousElementSibling as HTMLElement | null;
          const pNext = parent.nextElementSibling as HTMLElement | null;
          if (pPrev && pPrev.getAttribute?.('data-type') === 'image-block') return pPrev;
          if (pNext && pNext.getAttribute?.('data-type') === 'image-block') return pNext;
        }
      }
    }
  }

  return null;
}

