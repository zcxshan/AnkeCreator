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

import {
  NGA_IMAGE_SIZES,
  NGA_DEFAULT_IMAGE_SIZE,
  NGA_CODE_BG,
  NGA_FONTS,
  NGA_FONT_SIZES,
  NGA_COLORS,
  NGA_LINK_COLOR,
} from '../../types';
import type { DiceTextStyle, DiceStyleConfig, DiceBlockPayloadV2 } from '../../types';
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

/**
 * v18 新增:检测当前选区中是否有任何节点(或其祖先)的 style 包含指定 cssProperty=指定值之一
 * 同时检查 inline style、computed style 和 v27 新增的内联元素标签(如 <b>/<strong> 等)
 */
function isStyleActiveInEditor(
  cssProperty: 'font-weight' | 'font-style' | 'text-decoration',
  targetValues: string[],
  inlineTags: string[] = [],
): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  if (range.collapsed) return false

  // 收集选区中的所有文本节点
  // v27 修复:TreeWalker root 不能用 range.commonAncestorContainer
  // 当选区在单 text node 内时 commonAncestor = textNode,
  // 从 textNode 出发 SHOW_TEXT walker.nextNode() 不返回任何节点(textNode 无子节点)
  // 改用 commonAncestor 的 element 父级作为 root
  const root: Node =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : (range.commonAncestorContainer.parentElement ?? range.commonAncestorContainer)
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(n: Node): number {
        if (!n.nodeValue) return NodeFilter.FILTER_REJECT
        // 检查该文本节点是否与选区有交集
        const r = document.createRange()
        r.selectNodeContents(n)
        return r.intersectsNode(range.startContainer) ||
          r.intersectsNode(range.endContainer) ||
          (range.startContainer.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT
      }
    }
  )

  const targets = new Set(targetValues.map((v) => v.toLowerCase()))
  const upperTags = new Set(inlineTags.map((t) => t.toUpperCase()))
  let node: Node | null = walker.nextNode()
  while (node) {
    let el: HTMLElement | null = node.parentElement
    while (el) {
      // v27:检查内联元素标签(优先,happy-dom 不计算 <b>/<i> 默认 computed style)
      if (upperTags.size > 0 && upperTags.has(el.tagName)) return true
      // 检查 inline style
      const inline = el.style.getPropertyValue(cssProperty)
      if (inline) {
        const values = inline.split(/\s+/).map((s) => s.toLowerCase().replace(/[!,].*$/, ''))
        for (const v of values) {
          if (targets.has(v)) return true
        }
      }
      // 检查 computed style
      try {
        const computed = window.getComputedStyle(el).getPropertyValue(cssProperty)
        if (computed) {
          const values = computed.split(/\s+/).map((s) => s.toLowerCase().replace(/[!,].*$/, ''))
          for (const v of values) {
            if (targets.has(v)) return true
          }
        }
      } catch {
        // computed style 不可用,跳过
      }
      el = el.parentElement
    }
    node = walker.nextNode()
  }
  return false
}

/**
 * v30 新增:判断选区是否完全覆盖 node 的全部内容
 * - 返回 true: node 的全部内容都在选区内,可以原样处理 node
 * - 返回 false: node 只有部分内容在选区内,需要先 splitNode 才能精确处理
 * - happy-dom 兼容:不依赖 Range.compareBoundaryPoints(其在 happy-dom 中行为与 Chromium 不同)
 */
export function isRangeFullyInside(
  range: Range,
  node: Node,
): boolean {
  if (!range.intersectsNode(node)) return false;

  // 策略:node 的第一个文本节点必须正好是 range 的起点,最后一个文本节点必须正好是 range 的终点
  // 这样就能保证 node 的全部内容都在 range 内
  if (node.nodeType === Node.TEXT_NODE) {
    // node 自己就是文本节点
    return (
      range.startContainer === node &&
      range.startOffset === 0 &&
      range.endContainer === node &&
      range.endOffset === (node as Text).length
    );
  }

  // node 是 element:找第一个和最后一个文本节点
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const firstText = walker.nextNode() as Text | null;
  if (!firstText) return false;
  let lastText: Text = firstText;
  let cur: Text | null;
  while ((cur = walker.nextNode() as Text | null)) {
    lastText = cur;
  }

  // start 必须正好在 firstText 起点
  const startMatches =
    (range.startContainer === firstText && range.startOffset === 0) ||
    // 或者 start 在 node 起点(此时 firstText 必然是 node 的第一个 child)
    (range.startContainer === node && range.startOffset === 0);
  // end 必须正好在 lastText 终点
  const endMatches =
    (range.endContainer === lastText && range.endOffset === lastText.length) ||
    // 或者 end 在 node 终点(此时 lastText 必然是 node 的最后一个 child)
    (range.endContainer === node && range.endOffset === node.childNodes.length);

  return startMatches && endMatches;
}

/**
 * v30 新增:在选区边界插入隐藏的注释节点标记,用于 mutate 后恢复选区
 * - 调用方必须在 mutate 完成后调用 restoreSelectionFromMarkers
 * - 不要把标记保留在最终 DOM 中(会污染输出)
 * - happy-dom 兼容:不在 text node 内部 insertNode(happy-dom 不可靠),
 *   改为在 parent 中作为 startContainer 之前/endContainer 之后的 sibling 插入
 * - 同一 text node:先 splitText 拆开,然后 tn 之后插 startMarker,mid 之后插 endMarker
 * - v49 Phase C2: 导出此函数,供 EditorToolbar B/I/U/S DISABLE 路径使用
 *   原因: 保存原始 textNode 引用会被 normalize() 合并失效,
 *   Comment 节点不受 normalize 影响,选区恢复更可靠
 */
export function insertMarkersAtRange(range: Range): {
  startMarker: Comment;
  endMarker: Comment;
} {
  const startMarker = document.createComment('v30-start');
  const endMarker = document.createComment('v30-end');

  const startContainer = range.startContainer;
  const endContainer = range.endContainer;
  const startOffset = range.startOffset;
  const endOffset = range.endOffset;

  // 同一 text node,先 splitText 拆开
  if (
    startContainer === endContainer &&
    startContainer.nodeType === Node.TEXT_NODE &&
    startOffset < endOffset
  ) {
    const tn = startContainer as Text;
    const parent = tn.parentNode;
    if (!parent) return { startMarker, endMarker };
    // 顺序:先 endOffset 再 startOffset(否则偏移失效)
    tn.splitText(endOffset);
    tn.splitText(startOffset);
    // 现在 tn = [0, startOffset),midText = [startOffset, endOffset),afterText = [endOffset, ...)
    // startMarker 插在 mid 之前(作为 tn 的 nextSibling 即 mid 的位置)
    // endMarker 插在 after 之前(作为 mid 的 nextSibling 即 after 的位置)
    try {
      const mid = tn.nextSibling;
      parent.insertBefore(startMarker, mid);
      if (mid && mid.nextSibling) {
        parent.insertBefore(endMarker, mid.nextSibling);
      } else if (mid) {
        parent.appendChild(endMarker);
      }
    } catch {
      /* ignore */
    }
  } else {
    // 不同节点 / element 节点:在 startContainer 之前 / endContainer 之后插入
    // v49 Phase C2 Fix: 先插入 endMarker 再插入 startMarker,
    //   避免先插入 startMarker 导致 childNodes 索引偏移,endMarker 被插入到错误位置(markers 相邻)
    try {
      // 先插入 endMarker (使用原始 endOffset,不受 startMarker 插入影响)
      const endParent = endContainer.parentNode;
      if (endParent) {
        if (endContainer.nodeType === Node.TEXT_NODE) {
          if (endContainer.nextSibling) {
            endParent.insertBefore(endMarker, endContainer.nextSibling);
          } else {
            endParent.appendChild(endMarker);
          }
        } else {
          const el = endContainer as HTMLElement;
          el.insertBefore(
            endMarker,
            el.childNodes[endOffset] || null,
          );
        }
      }
      // 再插入 startMarker
      const startParent = startContainer.parentNode;
      if (startParent) {
        if (startContainer.nodeType === Node.TEXT_NODE) {
          startParent.insertBefore(startMarker, startContainer);
        } else {
          const el = startContainer as HTMLElement;
          // sameContainer 时 endMarker 已插入,可能影响 childNodes 索引
          // 但 startMarker 使用 startOffset,且 startOffset <= endOffset,
          // endMarker 插入在 endOffset 位置,不影响 startOffset 之前的节点
          // 所以 startOffset 索引仍然正确
          el.insertBefore(
            startMarker,
            el.childNodes[startOffset] || null,
          );
        }
      }
    } catch {
      /* ignore */
    }
  }
  // v49 Phase C2 Fix: 插入 markers 后,更新 selection 的 range 到 markers 之间的实际内容
  //   原因: 后续 removeInlineStyle/removeInlineTagNoFocus 调用 getSelectionRangeIn
  //   获取 selection 的 range,如果 range 仍是插入 markers 前的过时 offset,
  //   isRangeFullyInside 会错误判断(如 SPAN@0-1 在 markers 插入后 SPAN 有 3 个子节点),
  //   导致 splitElementAtRange 把文本移到 span 外,markers 变相邻,选区恢复失败
  //   修复: 把 range 设置到 markers 之间的文本节点上,让 isRangeFullyInside 正确返回 true
  try {
    const startNode: Node | null = startMarker.nextSibling;
    const endNode: Node | null = endMarker.previousSibling;
    if (startNode && endNode) {
      const newRange = document.createRange();
      if (startNode === endNode) {
        // markers 之间只有一个节点
        if (startNode.nodeType === Node.TEXT_NODE) {
          newRange.setStart(startNode, 0);
          newRange.setEnd(startNode, (startNode as Text).length);
        } else {
          newRange.selectNodeContents(startNode);
        }
      } else {
        // markers 之间有多个节点
        if (startNode.nodeType === Node.TEXT_NODE) {
          newRange.setStart(startNode, 0);
        } else {
          newRange.setStartBefore(startNode);
        }
        if (endNode.nodeType === Node.TEXT_NODE) {
          newRange.setEnd(endNode, (endNode as Text).length);
        } else {
          newRange.setEndAfter(endNode);
        }
      }
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(newRange);
      }
    }
  } catch {
    /* ignore */
  }
  return { startMarker, endMarker };
}

/**
 * v30 新增:从标记恢复选区,然后删除标记
 * v49 Phase C2: 导出此函数,供 EditorToolbar B/I/U/S DISABLE 路径使用
 */
export function restoreSelectionFromMarkers(
  startMarker: Comment,
  endMarker: Comment,
): void {
  const sel = window.getSelection();
  if (!sel) return;
  try {
    const newRange = document.createRange();
    newRange.setStartAfter(startMarker);
    newRange.setEndBefore(endMarker);
    sel.removeAllRanges();
    sel.addRange(newRange);
  } catch {
    // 退化:不恢复
  }
  // 移除标记(防止污染 DOM)
  startMarker.remove();
  endMarker.remove();
}

/**
 * v30 新增:把选区内 el 的内容从 el 中移出,作为 el 的兄弟节点
 * - 用于部分选区场景:选中 el 内的部分内容,需要先把这部分从 el 移出再处理
 * - el 本身不会被删除(由调用方决定是 unwrap 还是保留)
 * - 移出的文本节点会保留在 grandParent 中,位置在 el 之后
 */
export function splitElementAtRange(
  el: HTMLElement,
  range: Range,
): void {
  const grandParent = el.parentNode;
  if (!grandParent) return;

  // 收集 el 内与选区相交的所有文本节点
  const walker = document.createTreeWalker(
    el,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(n: Node): number {
        return range.intersectsNode(n)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    },
  );
  const textNodes: Text[] = [];
  let cur = walker.nextNode();
  while (cur) {
    textNodes.push(cur as Text);
    cur = walker.nextNode();
  }

  for (const tn of textNodes) {
    // v30:不在 el 内的文本节点跳过(理论上不会发生,防御性)
    if (!el.contains(tn)) continue;

    let startOffset = 0;
    let endOffset = tn.length;
    if (range.startContainer === tn) startOffset = range.startOffset;
    if (range.endContainer === tn) endOffset = range.endOffset;
    if (startOffset >= endOffset) continue;

    const isPartial = startOffset > 0 || endOffset < tn.length;
    let targetTextNode: Text = tn;
    if (isPartial) {
      // 拆分顺序:先 endOffset 再 startOffset(否则偏移失效)
      tn.splitText(endOffset);
      targetTextNode = tn.splitText(startOffset);
    }
    // v49 Phase C2 Fix: 正确拆分元素以保持文本顺序
    // 原问题: 只把 targetTextNode 移到 el 之后,导致:
    //   1. 文本顺序错误 (中间选中文本被移到末尾: "加粗文字" → "加字粗文")
    //   2. markers (Comment 节点) 留在 el 内,与选中文本分离,选区恢复失败
    // 修复:
    //   - 有 markers 时: 同时移动 targetTextNode 前后的 Comment 节点 (markers),
    //     为 target 之后的内容节点创建 el 的克隆(保持样式),插入顺序:
    //     el | beforeComments | targetTextNode | afterComments | afterClone
    //   - 无 markers 时: 保持旧行为(只移 targetTextNode 到 el 之后),
    //     因为调用方会解包整个 el,不需要克隆

    // 收集 targetTextNode 之后的节点
    const afterNodes: Node[] = [];
    let afterSibling = targetTextNode.nextSibling;
    while (afterSibling) {
      afterNodes.push(afterSibling);
      afterSibling = afterSibling.nextSibling;
    }
    // 分离 afterNodes: Comment 节点 (markers) vs 内容节点
    const afterComments: Node[] = [];
    const afterContent: Node[] = [];
    for (const n of afterNodes) {
      if (n.nodeType === Node.COMMENT_NODE) {
        afterComments.push(n);
      } else {
        afterContent.push(n);
      }
    }
    // 收集 targetTextNode 之前紧邻的 Comment 节点 (markers)
    const beforeComments: Node[] = [];
    let prevSibling = targetTextNode.previousSibling;
    while (prevSibling && prevSibling.nodeType === Node.COMMENT_NODE) {
      beforeComments.unshift(prevSibling);
      prevSibling = prevSibling.previousSibling;
    }

    const hasMarkers = beforeComments.length > 0 || afterComments.length > 0;
    if (hasMarkers) {
      // 有 markers: 新行为 - 移动 markers + target, 为后续内容创建克隆
      let lastInserted: Node = el;
      for (const c of beforeComments) {
        grandParent.insertBefore(c, lastInserted.nextSibling);
        lastInserted = c;
      }
      grandParent.insertBefore(targetTextNode, lastInserted.nextSibling);
      lastInserted = targetTextNode;
      for (const c of afterComments) {
        grandParent.insertBefore(c, lastInserted.nextSibling);
        lastInserted = c;
      }
      if (afterContent.length > 0) {
        // v49 Phase D Fix: 只在 afterContent 有实际内容时创建克隆
        // 原问题: afterContent 只包含空文本节点(来自 splitText 产生的空串)时,
        // 仍然创建空 span 克隆,留下 <span style="..."></span> 残留
        const hasRealContent = afterContent.some((n) => {
          if (n.nodeType === Node.TEXT_NODE) return (n as Text).length > 0;
          return true; // 非文本节点(元素等)视为有内容
        });
        if (hasRealContent) {
          const afterClone = el.cloneNode(false) as HTMLElement;
          for (const n of afterContent) {
            afterClone.appendChild(n);
          }
          grandParent.insertBefore(afterClone, lastInserted.nextSibling);
        }
      }
    } else {
      // 无 markers: 旧行为 - 只移 targetTextNode 到 el 之后
      grandParent.insertBefore(targetTextNode, el.nextSibling);
    }
  }
}

/**
 * v18 新增:从选区中移除所有指定 tagName 的内联元素(如 <u>/<s>/<b>/<i> 等)
 * 保留元素内容(unwrap),仅移除包装
 * v30 修复:选区只覆盖 el 的一部分时,先 splitElementAtRange 把选区部分从 el 移出,
 * 只解包 el 自身,不影响选区外的内容
 */
export function removeInlineTagNoFocus(
  editor: HTMLElement,
  tagName: string,
  options?: { skipFocus?: boolean; skipSelectionRestore?: boolean },
): boolean {
  if (!options?.skipFocus) focusEditor(editor);
  const range = getSelectionRangeIn(editor);
  if (!range) return false;

  // v46 Fix 2: 记录原始选区边界(用于 DOM 修改后恢复选区)
  // 参考 removeTextDecorationPartNoFocus 的 v42 Fix 2 实现
  const origStartContainer = range.startContainer;
  const origStartOffset = range.startOffset;
  const origEndContainer = range.endContainer;
  const origEndOffset = range.endOffset;

  const upperTag = tagName.toUpperCase();
  // v27 修复:TreeWalker root 不能用 range.commonAncestorContainer
  // 当选区在单 text node 内时 commonAncestor = textNode,
  // 从 textNode 出发 SHOW_ELEMENT walker.nextNode() 不返回任何节点(textNode 无 element 子节点)
  // 改用 commonAncestor 的 element 父级作为 root,再用 walker.currentNode 包含 root 本身
  // (nextNode() 不会返回 root,要从 currentNode 开始循环)
  const root: Node =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : (range.commonAncestorContainer.parentElement ?? editor)
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(n: Node): number {
        return range.intersectsNode(n)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    },
  );
  const toUnwrap: HTMLElement[] = [];
  // v27:从 walker.currentNode 开始,确保 root 元素本身被检查（nextNode() 不返回 root）
  let cur: Node | null = walker.currentNode;
  while (cur) {
    const el = cur as HTMLElement;
    if (el.tagName === upperTag) toUnwrap.push(el);
    cur = walker.nextNode();
  }
  if (toUnwrap.length === 0) return false;

  // v30 修复:对每个待解包的 el,如果选区只覆盖其一部分,
  // 先 splitElementAtRange 把选区部分从 el 移出(作为兄弟节点)
  // 这样后续解包 el 时,选区外的内容不会受影响
  for (const el of toUnwrap) {
    if (el.parentNode && !isRangeFullyInside(range, el)) {
      splitElementAtRange(el, range);
    }
  }

  const affectedParents = new Set<HTMLElement>();
  for (const el of toUnwrap) {
    const parent = el.parentNode;
    if (!parent) continue;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    if (parent.nodeType === Node.ELEMENT_NODE) {
      affectedParents.add(parent as HTMLElement);
    }
  }
  // v25d 修复:解包多个 span 后,合并相邻文本节点(避免不知名换行)
  for (const p of affectedParents) {
    if ((p as any).normalize) (p as any).normalize();
  }
  // v46 Fix 2: 恢复选区(与 removeTextDecorationPartNoFocus v42 Fix 2 对齐)
  // 原因: splitElementAtRange + unwrap 标签后选区丢失,
  // 违反"选中文本再点击菜单栏不会取消文本的被选中状态"需求
  // v49 Phase C2: skipSelectionRestore=true 时跳过内部恢复,
  //   让外部 bookmark markers 方案接管选区恢复(避免 origStartContainer
  //   被 normalize 合并失效导致恢复错误选区)
  if (!options?.skipSelectionRestore) {
    try {
      if (editor.contains(origStartContainer) && editor.contains(origEndContainer)) {
        const newRange = document.createRange();
        newRange.setStart(origStartContainer, origStartOffset);
        newRange.setEnd(origEndContainer, origEndOffset);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(newRange);
      }
    } catch {
      // 选区恢复失败不影响标签移除
    }
  }
  // v49 Phase C2: skipSelectionRestore=true 时跳过 dispatchInput,
  //   让外部调用方在 restoreSelectionFromMarkers 之后统一调用,
  //   避免 markers 还在 DOM 中时触发 React re-render 导致选区丢失
  if (!options?.skipSelectionRestore) {
    dispatchInput(editor);
  }
  return true;
}

/**
 * v18 新增:检测当前选区中是否有指定 tagName 的内联元素(如 <u>/<s>/<strike>)
 */
function hasInlineElementInSelection(tagName: string): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  if (range.collapsed) return false

  // v27 修复:TreeWalker root 不能用 range.commonAncestorContainer
  // 当选区在单 text node 内时 commonAncestor = textNode,
  // 从 textNode 出发 SHOW_ELEMENT walker.nextNode() 不返回任何节点(textNode 无 element 子节点)
  // 改用 commonAncestor 的 element 父级作为 root,再用 walker.currentNode 包含 root 本身
  const root: Node =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : (range.commonAncestorContainer.parentElement ?? range.commonAncestorContainer)
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(n: Node): number {
        return range.intersectsNode(n)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT
      },
    },
  )
  // v27:从 walker.currentNode 开始,确保 root 元素本身被检查
  let cur: Node | null = walker.currentNode
  while (cur) {
    const el = cur as HTMLElement
    if (el.tagName === tagName.toUpperCase()) return true
    // 子孙也算
    const descendants = el.querySelectorAll(tagName)
    if (descendants.length > 0) return true
    cur = walker.nextNode()
  }
  return false
}
export function isBoldActive(): boolean {
  return isCommandActive('bold') || isStyleActiveInEditor('font-weight', ['bold', '700', '800', '900'], ['b', 'strong']);
}
export function isItalicActive(): boolean {
  return isCommandActive('italic') || isStyleActiveInEditor('font-style', ['italic'], ['i', 'em']);
}
export function isUnderlineActive(): boolean {
  // v18 修复:同时检测 <u> 元素和 CSS text-decoration
  if (isCommandActive('underline')) return true;
  if (hasInlineElementInSelection('u')) return true;
  return isStyleActiveInEditor('text-decoration', ['underline']);
}
export function isStrikeActive(): boolean {
  // v18 修复:同时检测 <s>/<strike> 元素和 CSS line-through
  if (isCommandActive('strikeThrough')) return true;
  if (hasInlineElementInSelection('s') || hasInlineElementInSelection('strike')) return true;
  return isStyleActiveInEditor('text-decoration', ['line-through']);
}

/**
 * v26 新增:检测选区内"所有文本节点"是否都具备指定样式（ALL 语义）
 * - 选区无文本节点 → 返回 false
 * - 选区内任一文本节点"不"具备样式 → 立即 return false（短路）
 * - 选区内所有文本节点都具备样式 → return true
 *
 * 检测目标:
 * - inline style: cssProperty=targetValue
 * - computed style: cssProperty=targetValue
 * - 内联元素: 如 <b>/<strong> (粗体) / <i>/<em> (斜体) / <u> (下划线) / <s>/<strike> (删除线)
 */
function isStyleFullyActiveInEditor(
  cssProperty: 'font-weight' | 'font-style' | 'text-decoration',
  targetValues: string[],
  inlineTags: string[],
): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return false;

  // 收集选区内的所有文本节点（精确过滤：与 range 有交集）
  // v26 修复:TreeWalker 从 Text 节点作 root 时,nextNode() 不会返回 root 本身
  // 需用 walker.currentNode 包含 root 节点
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
    null,
  );
  let node: Node | null = walker.currentNode;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE && range.intersectsNode(node)) {
      textNodes.push(node as Text);
    }
    node = walker.nextNode();
  }
  if (textNodes.length === 0) return false;

  const targets = new Set(targetValues.map((v) => v.toLowerCase()));
  const upperTags = new Set(inlineTags.map((t) => t.toUpperCase()));

  // 过滤纯空白文本节点（v25d 约定：忽略中间空白）
  const effectiveNodes = textNodes.filter(
    (tn) => !/^\s*$/.test(tn.textContent ?? ''),
  );
  // 选区完全由空白组成 → 视为不具有样式
  if (effectiveNodes.length === 0) return false;

  // ALL 语义：所有有效文本节点都具备样式
  for (const tn of effectiveNodes) {
    let has = false;
    let el: HTMLElement | null = tn.parentElement;
    while (el) {
      // 1. 检查 inline style
      const inline = el.style.getPropertyValue(cssProperty);
      if (inline) {
        const values = inline.split(/\s+/).map((s) => s.toLowerCase().replace(/[!,].*$/, ''));
        if (values.some((v) => targets.has(v))) {
          has = true;
          break;
        }
      }
      // 2. 检查 computed style
      try {
        const computed = window.getComputedStyle(el).getPropertyValue(cssProperty);
        if (computed) {
          const values = computed.split(/\s+/).map((s) => s.toLowerCase().replace(/[!,].*$/, ''));
          if (values.some((v) => targets.has(v))) {
            has = true;
            break;
          }
        }
      } catch {
        // computed style 不可用,跳过
      }
      // 3. 检查内联元素标签
      if (upperTags.has(el.tagName)) {
        has = true;
        break;
      }
      el = el.parentElement;
    }
    if (!has) return false; // 短路：任一文本节点不具有样式 → false
  }
  return true;
}

/**
 * v26 新增:严格 ALL 语义的 B/I/U/S 激活状态检测
 * 与 isBoldActive/isItalicActive/isUnderlineActive/isStrikeActive (ANY 语义) 区分
 * - ALL 语义：选区所有文本节点都具备样式 → true
 * - ANY 语义：选区任一文本节点具备样式 → true
 */
// v42 Fix 1: 移除 isCommandActive (document.queryCommandState 不可靠,在程序化设置 innerHTML 后返回 stale 值)
// 仅使用 isStyleFullyActiveInEditor (DOM 遍历检查 inline style + computed style + 标签名),作为可靠超集
export function isBoldFullyActive(): boolean {
  return isStyleFullyActiveInEditor('font-weight', ['bold', '700', '800', '900'], ['b', 'strong']);
}
export function isItalicFullyActive(): boolean {
  return isStyleFullyActiveInEditor('font-style', ['italic'], ['i', 'em']);
}
export function isUnderlineFullyActive(): boolean {
  return isStyleFullyActiveInEditor('text-decoration', ['underline'], ['u']);
}
export function isStrikeFullyActive(): boolean {
  return isStyleFullyActiveInEditor('text-decoration', ['line-through'], ['s', 'strike', 'del']);
}
export function isSupActive(): boolean {
  return isCommandActive('superscript');
}
export function isSubActive(): boolean {
  return isCommandActive('subscript');
}

/**
 * Fix v25c 回车继承:从 node 的祖先链中收集 inline span 样式
 * 用途:普通段落按 Enter 时,继承父 inline span 的 B/I/U/S 样式到新段落
 * 仅返回 B/I/U/S 相关的样式属性(fontWeight/fontStyle/textDecoration)
 *
 * 合并策略:
 * - fontWeight / fontStyle: 取最浅祖先(最靠近 node)的值
 * - textDecoration: 合并所有祖先的 part(underline + line-through 可叠加)
 *
 * @param node - 光标所在节点（可能是 TextNode 或 Element）
 * @param editor - 编辑器根元素（用于限定查找范围）
 * @returns 收集到的 inline 样式，如果没有则返回 null
 */
export function collectInlineStyleFromAncestors(
  node: Node | null,
  editor: HTMLElement,
): { fontWeight?: string; fontStyle?: string; textDecoration?: string } | null {
  if (!node) return null;
  const result: { fontWeight?: string; fontStyle?: string; textDecoration?: string } = {};
  const decoParts = new Set<string>();
  let cur: Node | null = node;
  while (cur && cur !== editor) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      if (el.tagName === 'SPAN' || el.tagName === 'B' || el.tagName === 'I' || el.tagName === 'U' || el.tagName === 'S') {
        // SPAN 读取内联 style
        if (el.tagName === 'SPAN') {
          if (!result.fontWeight && el.style.fontWeight) {
            result.fontWeight = el.style.fontWeight;
          }
          if (!result.fontStyle && el.style.fontStyle) {
            result.fontStyle = el.style.fontStyle;
          }
          if (el.style.textDecoration) {
            el.style.textDecoration.split(/\s+/).filter(Boolean).forEach((p) => decoParts.add(p));
          }
        } else {
          // B/I/U/S 元素 → 推断样式
          if (el.tagName === 'B' && !result.fontWeight) {
            result.fontWeight = 'bold';
          }
          if (el.tagName === 'I' && !result.fontStyle) {
            result.fontStyle = 'italic';
          }
          if (el.tagName === 'U') decoParts.add('underline');
          if (el.tagName === 'S') decoParts.add('line-through');
        }
      }
    }
    cur = cur.parentNode;
  }
  // 合并 textDecoration
  if (decoParts.size > 0) {
    // 标准顺序:underline 在前,line-through 在后
    const ordered: string[] = [];
    if (decoParts.has('underline')) ordered.push('underline');
    if (decoParts.has('line-through')) ordered.push('line-through');
    // 其他 part 保持原顺序
    decoParts.forEach((p) => {
      if (p !== 'underline' && p !== 'line-through') ordered.push(p);
    });
    result.textDecoration = ordered.join(' ');
  }
  // 三个样式都为空 → 返回 null
  if (!result.fontWeight && !result.fontStyle && !result.textDecoration) {
    return null;
  }
  return result;
}

// ------------------------------------------------------------
// v31: 把 activeStyles 转换为 inline style 描述
// 用于 Enter 创建新行时把激活的样式应用到新行
//
// 设计哲学:用户主动激活的样式(B/I/U/S 工具栏高亮)就是用户意图,
// 后续输入/新行都应该延续这个意图,不管光标当前位置是否有该样式。
// 这与 Word/Quill/Typora 的"基于意图"行为一致。
//
// 保留 collectInlineStyleFromAncestors 作为反向工具
// (用于"移除 B 按钮 → 工具栏回到光标处实际样式"等场景)
// ------------------------------------------------------------
export function getInlineStylesFromActive(active: {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}): { fontWeight?: string; fontStyle?: string; textDecoration?: string } | null {
  const result: { fontWeight?: string; fontStyle?: string; textDecoration?: string } = {};
  if (active.bold) result.fontWeight = 'bold';
  if (active.italic) result.fontStyle = 'italic';
  const decoParts: string[] = [];
  if (active.underline) decoParts.push('underline');
  if (active.strike) decoParts.push('line-through');
  if (decoParts.length > 0) result.textDecoration = decoParts.join(' ');
  if (!result.fontWeight && !result.fontStyle && !result.textDecoration) return null;
  return result;
}

// ------------------------------------------------------------
// v31: 在 afterNode 之后插入新 <p>,可选择带 inline 样式 span
// 与 v25c 方案的差别:
// - v25c: <p style="..."><br></p> + 光标在 <br> 之前 → <br> 撑起空行 + <p> style 不被新输入字符继承
// - v31: <p><span style="..."></span></p> + 光标在 <span> 内 → 无 <br> 占位 + 新输入字符进入 <span> 继承样式
//
// 参考专业编辑器:Word 按 Enter 后新行也加粗,样式作为 inline span 应用
//
// @returns 光标位置 Range(已 collapse,调用方需 addRange)
// ------------------------------------------------------------
export function insertStyledParagraphAfter(
  editor: HTMLElement,
  afterNode: Node,
  styles: { fontWeight?: string; fontStyle?: string; textDecoration?: string } | null,
): Range {
  const newP = document.createElement('p');

  if (styles) {
    // v37 修复: <br> 作为 span 的子节点,而非兄弟节点
    // v36 错误方案: <p><br><span style=""></span></p>
    //   - <br> 是空 span 的兄弟节点 → 不是 trailing br → 产生真实换行 → 多出一行空行
    //   - 空 span 自身行高为 0 → 光标在 span 内不可见
    //   - 用户看到"按 Enter 没生效但编辑区域变长"
    // v37 正确方案: <p><span style="..."><br></span></p>
    //   - <br> 作为 span 子节点 → span 有真实内容获得行高 → 光标可见
    //   - 光标设在 span 内 <br> 之前 → 新输入字符进入 span 继承样式
    //   - 不会多出额外空行
    const inlineSpan = document.createElement('span');
    if (styles.fontWeight) inlineSpan.style.fontWeight = styles.fontWeight;
    if (styles.fontStyle) inlineSpan.style.fontStyle = styles.fontStyle;
    if (styles.textDecoration) inlineSpan.style.textDecoration = styles.textDecoration;
    inlineSpan.appendChild(document.createElement('br')); // br 作为 span 子节点
    newP.appendChild(inlineSpan);
  } else {
    // v34 修复:无样式时添加 <br> 占位,确保空 <p> 可见且光标能定位
    newP.appendChild(document.createElement('br'));
  }

  // 插入到 afterNode 之后(同 parent 内)
  const parent = afterNode.parentNode;
  if (parent) {
    if (afterNode.nextSibling) {
      parent.insertBefore(newP, afterNode.nextSibling);
    } else {
      parent.appendChild(newP);
    }
  } else {
    editor.appendChild(newP);
  }

  // 光标位置:v37 结构为 <span style="..."><br></span>,光标放在 span 内 br 之前
  // 无样式时为 <br>,光标放在 <p> 内 br 之前
  const cursor = document.createRange();
  const firstChild = newP.firstChild;
  if (firstChild && firstChild.nodeType === Node.ELEMENT_NODE && (firstChild as HTMLElement).tagName === 'SPAN') {
    // v37: <span style="..."><br></span> 模式,光标放在 span 内(br 之前)
    cursor.setStart(firstChild, 0);
  } else {
    // br 模式:光标放在 <p> 内(br 之前)
    cursor.setStart(newP, 0);
  }
  cursor.collapse(true);
  return cursor;
}

// ------------------------------------------------------------
// v32: 在 block 元素内光标位置拆分,把光标后的内容移到新 <p>
// 用于"加粗文本中间按 Enter"场景
// - 光标在文本中间时,splitText 拆分文本节点,后半段保留样式移到新 <p>
// - 光标在 block 末尾时,新 <p> 为空(加 <br> 占位)
// @returns 光标位置 Range(已 collapse,调用方需 addRange)
// ------------------------------------------------------------
export function splitBlockAtCursor(
  editor: HTMLElement,
  blockEl: HTMLElement,
  range: Range,
): Range {
  // v40: 移除 v39 防御性 return,支持编辑器根 div 的 split
  // (裸文本中间按 Enter 时,需要 splitText 拆分文本,后半段移到新 <p>)
  const container = range.startContainer;
  const offset = range.startOffset;

  // 1. 如果光标在文本节点中间,先 splitText 拆分文本节点
  let afterNode: Node | null = null;
  if (
    container.nodeType === Node.TEXT_NODE &&
    offset > 0 &&
    offset < (container as Text).length
  ) {
    afterNode = (container as Text).splitText(offset);
  }

  // 2. 创建新 <p>
  const newP = document.createElement('p');

  // 3. 确定 blockEl 层面要移动的子节点
  // 找到 container/afterNode 在 blockEl 中的直接子节点
  let moveStartChild: Node | null = null;

  if (afterNode) {
    // splitText 成功:afterNode 是后半段
    // 如果 afterNode 在 span 内 → 需要把 afterNode 从 span 移出,用新 span(复制样式)包装
    const parentEl = afterNode.parentNode;
    if (parentEl && parentEl !== blockEl && parentEl.nodeType === Node.ELEMENT_NODE) {
      // afterNode 在某个元素(如 span)内
      const styledParent = parentEl as HTMLElement;
      // 创建新元素(同标签),复制 inline style
      const newWrapper = document.createElement(styledParent.tagName);
      if (styledParent.style.cssText) {
        (newWrapper as HTMLElement).style.cssText = styledParent.style.cssText;
      }
      // 把 afterNode 放入新 wrapper
      newWrapper.appendChild(afterNode);
      // 把新 wrapper 插入到 styledParent 之后(作为 blockEl 的子节点)
      const grandParent = styledParent.parentNode;
      if (grandParent) {
        grandParent.insertBefore(newWrapper, styledParent.nextSibling);
        moveStartChild = newWrapper;
      }
    } else {
      // afterNode 是 blockEl 的直接子节点(裸文本)
      moveStartChild = afterNode;
    }
  } else {
    // 没有 split(光标在文本节点边界或元素节点上)
    if (container.nodeType === Node.TEXT_NODE) {
      // 找 container 所在的 blockEl 直接子节点
      let directChild: Node = container;
      while (directChild.parentNode && directChild.parentNode !== blockEl) {
        directChild = directChild.parentNode;
      }
      if (offset >= (container as Text).length) {
        // 光标在文本末尾 → 从下一个 sibling 开始
        moveStartChild = directChild.nextSibling;
      } else {
        // offset == 0 → 从 container 所在的直接子节点开始
        moveStartChild = directChild;
      }
    } else {
      // container 是元素节点 → 从 childNodes[offset] 开始
      moveStartChild = container.childNodes[offset] ?? null;
    }
  }

  // 4. 把 moveStartChild 之后的所有 blockEl 子节点移到 newP
  while (moveStartChild) {
    const next = moveStartChild.nextSibling;
    newP.appendChild(moveStartChild);
    moveStartChild = next;
  }

  // 5. 如果 newP 为空(光标在 block 末尾),添加 <br> 占位
  if (newP.childNodes.length === 0) {
    newP.appendChild(document.createElement('br'));
  }

  // 6. 插入 newP 到 blockEl 之后
  // v40: 当 blockEl === editor 时,直接在编辑器内追加(不插到 editor.parentNode)
  if (blockEl === editor) {
    editor.appendChild(newP);
  } else {
    const parent = blockEl.parentNode;
    if (parent) {
      if (blockEl.nextSibling) {
        parent.insertBefore(newP, blockEl.nextSibling);
      } else {
        parent.appendChild(newP);
      }
    } else {
      editor.appendChild(newP);
    }
  }

  // 7. 光标放到 newP 开头
  const cursor = document.createRange();
  cursor.setStart(newP, 0);
  cursor.collapse(true);
  return cursor;
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
  activeStylesLocked: boolean = false,
): boolean {
  if (!text) return false;
  // 修复 B/I/U/S 取消 bug：
  // 原版用 `!active.color && !active.bold && ...` 判断空对象。
  // 但这会在 { bold: false }（用户刚把 B 关闭）时也 early return，
  // 导致后续"退出当前 span"逻辑永远走不到，新文字会继承父 span 样式。
  // 改为：只有当 active 是空对象（无任何 key）时才 early return。
  if (
    active.color === undefined &&
    active.fontSize === undefined &&
    active.fontFamily === undefined &&
    active.bold === undefined &&
    active.italic === undefined &&
    active.underline === undefined &&
    active.strike === undefined &&
    active.sup === undefined &&
    active.sub === undefined
  ) {
    return false;
  }
  const sel = window.getSelection();
  // Fallback：用 _lastEditorRange（用户在编辑器内的最后光标位置）
  // 修复"点工具栏色块/字号后输入文字样式丢失"——此时 sel 可能因工具栏抢焦点
  // 变得不可折叠或不在编辑器内。
  if ((!sel || sel.rangeCount === 0 || !sel.isCollapsed) && _lastEditorRange && _lastEditorRange.collapsed) {
    const curSel = sel ?? window.getSelection();
    if (curSel) {
      curSel.removeAllRanges();
      curSel.addRange(_lastEditorRange.cloneRange());
    }
  }
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  if (!editor.contains(sel.anchorNode)) return false;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return false;

  // 智能合并：找到光标所在 SPAN 继承的样式，从 active 中移除已继承的部分
  // 避免 CSS font-size:% 嵌套相乘（>100% 越大 / <100% 越小）
  const inherited = getInheritedSpanStyles(range.startContainer, editor);

  // v19 修复：activeStylesLocked 时也检查 inherited，
  // 避免在已有相同样式的 span 内再包一层（产生冗余嵌套）
  if (activeStylesLocked) {
    const remaining: typeof active = {};
    if (active.color && active.color !== inherited.color) remaining.color = active.color;
    if (active.fontSize && !isSameFontSize(active.fontSize, inherited.fontSize)) remaining.fontSize = active.fontSize;
    if (active.fontFamily && active.fontFamily !== inherited.fontFamily) remaining.fontFamily = active.fontFamily;
    if (active.bold && !inherited.bold) remaining.bold = active.bold;
    if (active.italic && !inherited.italic) remaining.italic = active.italic;
    if (active.underline && !inherited.underline) remaining.underline = active.underline;
    if (active.strike && !inherited.strike) remaining.strike = active.strike;
    if (active.sup) remaining.sup = active.sup;
    if (active.sub) remaining.sub = active.sub;

    // 如果所有样式已被 inherited，直接插入文本节点（避免嵌套 span）
    const hasRemaining = !!(
      remaining.color ||
      remaining.fontSize ||
      remaining.fontFamily ||
      remaining.bold ||
      remaining.italic ||
      remaining.underline ||
      remaining.strike ||
      remaining.sup ||
      remaining.sub
    );
    if (!hasRemaining) {
      // v21: 显式取消场景需要跳出带样式 span（与非锁定路径一致）
      const hasExplicitCancel =
        active.bold === false ||
        active.italic === false ||
        active.underline === false ||
        active.strike === false ||
        active.color === '' ||
        active.fontSize === '' ||
        active.fontFamily === '';
      if (hasExplicitCancel) {
        // v21 核心修复：计算期望样式（active 优先，否则继承）
        // 场景：B+I+U 高亮，取消 B → desired = { italic: true, underline: true }
        // → 在父 span 之外创建新 span（italic + underline），保留剩余样式
        const desired = computeDesiredStyles(active, inherited);
        const hasDesiredInline = !!(
      desired.color || desired.fontSize || desired.fontFamily ||
      desired.bold || desired.italic || desired.underline || desired.strike ||
      desired.sup || desired.sub
    );
        if (hasDesiredInline && insertStyledTextOutsideStyledSpan(range, text, desired, editor)) {
          dispatchInput(editor);
          return true;
        }
        // 无期望样式 → 插入纯文本（跳出父 span）
        if (insertTextOutsideStyledSpan(range, text, editor)) {
          dispatchInput(editor);
          return true;
        }
      }
      range.deleteContents();
      const tn = document.createTextNode(text);
      range.insertNode(tn);
      range.setStartAfter(tn);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      dispatchInput(editor);
      return true;
    }

    const forceApply: typeof active = remaining;
    const hasInlineStyle = !!(
      forceApply.color ||
      forceApply.fontSize ||
      forceApply.fontFamily ||
      forceApply.bold ||
      forceApply.italic ||
      forceApply.underline ||
      forceApply.strike
    );

    let outer: HTMLElement;
    if (hasInlineStyle) {
      const wrap = document.createElement('span');
      if (forceApply.color) wrap.style.color = forceApply.color;
      if (forceApply.fontSize) wrap.style.fontSize = forceApply.fontSize;
      if (forceApply.fontFamily) wrap.style.fontFamily = forceApply.fontFamily;
      if (forceApply.bold) wrap.style.fontWeight = 'bold';
      if (forceApply.italic) wrap.style.fontStyle = 'italic';
      const deco: string[] = [];
      if (forceApply.underline) deco.push('underline');
      if (forceApply.strike) deco.push('line-through');
      if (deco.length) wrap.style.textDecoration = deco.join(' ');

      // v21 修复：locked 路径也添加取消覆盖（与非锁定路径一致）
      // 当 active.bold === false 等显式取消时，remaining 不含该字段，但 CSS 会从父 span 继承
      // 所以需要显式设 normal/none 来阻止继承
      if (active.bold === false) wrap.style.fontWeight = 'normal';
      if (active.italic === false) wrap.style.fontStyle = 'normal';
      if (active.underline === false || active.strike === false) {
        const wantUnderline = active.underline === true;
        const wantStrike = active.strike === true;
        const cancelDecos: string[] = [];
        if (wantUnderline) cancelDecos.push('underline');
        if (wantStrike) cancelDecos.push('line-through');
        wrap.style.textDecoration = cancelDecos.length > 0 ? cancelDecos.join(' ') : 'none';
      }

      wrap.appendChild(document.createTextNode(text));
      outer = wrap;

      if (forceApply.sup) {
        const sup = document.createElement('sup');
        sup.appendChild(wrap);
        outer = sup;
      } else if (forceApply.sub) {
        const sub = document.createElement('sub');
        sub.appendChild(wrap);
        outer = sub;
      }
    } else {
      if (forceApply.sup) {
        const sup = document.createElement('sup');
        sup.appendChild(document.createTextNode(text));
        outer = sup;
      } else if (forceApply.sub) {
        const sub = document.createElement('sub');
        sub.appendChild(document.createTextNode(text));
        outer = sub;
      } else {
        // 修复 B/I/U/S 取消 bug：所有样式都被关闭时（如 B 关闭后输入），
        // 不能让浏览器默认行为把新文字插入到带样式的 span 内（会继承样式）。
        // 必须手动跳出当前带样式的 span，把新文字插入到 span 之外的"中性"位置。
        if (insertTextOutsideStyledSpan(range, text, editor)) {
          dispatchInput(editor);
          return true;
        }
        // v9 修复：无父 span 时的兜底 ——
        // 在 forceApply 路径下（locked=true），RichTextEditor 已准备 preventDefault，
        // 如果这里 return false，浏览器默认插入会被阻止 → "编辑都编辑不了"
        // 因此直接插入文本节点，主动接管输入
        range.deleteContents();
        const tn = document.createTextNode(text);
        range.insertNode(tn);
        range.setStartAfter(tn);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        dispatchInput(editor);
        return true;
      }
    }

    range.deleteContents();
    range.insertNode(outer);
    // 修复：清除新 span 父级链上同属性冲突值（如外层 color=red 不被内层 color=blue 覆盖）
    if (outer.parentNode) {
      removeConflictingStylesDeep(outer, forceApply as Record<string, string>);
    }
    // 把光标放到 outer 内部末尾
    const newRange = document.createRange();
    if (outer.lastChild) {
      newRange.setStartAfter(outer.lastChild);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }
    return true;
  }

  const remaining: typeof active = {};
  if (active.color && active.color !== inherited.color) remaining.color = active.color;
  if (active.fontSize && !isSameFontSize(active.fontSize, inherited.fontSize)) remaining.fontSize = active.fontSize;
  if (active.fontFamily && active.fontFamily !== inherited.fontFamily) remaining.fontFamily = active.fontFamily;
  // v19: bold/italic/underline/strike 也检查 inherited（CSS 从父 span 继承）
  if (active.bold && !inherited.bold) remaining.bold = active.bold;
  if (active.italic && !inherited.italic) remaining.italic = active.italic;
  if (active.underline && !inherited.underline) remaining.underline = active.underline;
  if (active.strike && !inherited.strike) remaining.strike = active.strike;
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
    // v21 修复 B/I/U/S 取消 bug（v5 通用修复 + v21 期望样式）：
    // 当 activeStyles 中的 B/I/U/S **显式**被关闭时（如工具栏 B 关闭后输入），
    // activeStylesLocked=false 走非锁定路径 → L561 过滤后 hasRemaining=false →
    // 之前直接 range.insertNode 会让新文字继承父 span 样式
    // 现在先尝试跳出带样式 span，跳不出去再走默认插入路径
    //
    // 关键：只在"显式取消"场景下跳出 span。如果 active 是空对象或值与 inherited 相同
    // （用户没显式取消），应该让新文字留在原 span 中（继承样式是合理的）
    const hasExplicitCancel =
      active.bold === false ||
      active.italic === false ||
      active.underline === false ||
      active.strike === false ||
      active.color === '' ||
      active.fontSize === '' ||
      active.fontFamily === '';
    if (hasExplicitCancel) {
      // v21 核心修复：计算期望样式（active 优先，否则继承）
      const desired = computeDesiredStyles(active, inherited);
      const hasDesiredInline = !!(
        desired.color || desired.fontSize || desired.fontFamily ||
        desired.bold || desired.italic || desired.underline || desired.strike
      );
      if (hasDesiredInline && insertStyledTextOutsideStyledSpan(range, text, desired, editor)) {
        dispatchInput(editor);
        return true;
      }
      if (insertTextOutsideStyledSpan(range, text, editor)) {
        dispatchInput(editor);
        return true;
      }
    }
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

    // v7 修复：B/I/U/S 显式取消时，设 normal/none 覆盖父 span 继承
    // 当 active.bold === false 等显式取消时，remaining 不含该字段，但 CSS 会从父 span 继承
    // 所以需要显式设 normal/none 来阻止继承
    if (active.bold === false) wrap.style.fontWeight = 'normal';
    if (active.italic === false) wrap.style.fontStyle = 'normal';
    if (active.underline === false || active.strike === false) {
      // text-decoration 是复合属性，需要保留另一个的 true 状态
      const wantUnderline = active.underline === true;
      const wantStrike = active.strike === true;
      const cancelDecos: string[] = [];
      if (wantUnderline) cancelDecos.push('underline');
      if (wantStrike) cancelDecos.push('line-through');
      wrap.style.textDecoration = cancelDecos.length > 0 ? cancelDecos.join(' ') : 'none';
    }

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
): {
  fontSize?: string;
  color?: string;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
} {
  let cur: Node | null = startNode;
  while (cur && cur !== editor) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      if (el.tagName === 'SPAN') {
        const deco = el.style.textDecoration || '';
        return {
          fontSize: el.style.fontSize || undefined,
          color: el.style.color || undefined,
          fontFamily: el.style.fontFamily || undefined,
          bold: el.style.fontWeight === 'bold' || /^(700|800|900)$/.test(el.style.fontWeight),
          italic: el.style.fontStyle === 'italic',
          underline: deco.split(/\s+/).includes('underline'),
          strike: deco.split(/\s+/).includes('line-through'),
        };
      }
    }
    cur = cur.parentNode;
  }
  return {};
}

/**
 * v21 新增：计算期望样式（active 优先，否则继承 inherited）。
 * - active.bold === true → desired.bold = true
 * - active.bold === false → 不设（取消）
 * - active.bold === undefined → 继承 inherited.bold
 * - active.color === 'red' → desired.color = 'red'
 * - active.color === '' → 不设（取消）
 * - active.color === undefined → 继承 inherited.color
 *
 * 用于"部分取消"场景：B+I+U 高亮后取消 B → desired = { italic: true, underline: true }
 */
function computeDesiredStyles(
  active: { color?: string; fontSize?: string; fontFamily?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; sup?: boolean; sub?: boolean },
  inherited: { fontSize?: string; color?: string; fontFamily?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean },
): { color?: string; fontSize?: string; fontFamily?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; sup?: boolean; sub?: boolean } {
  const desired: { color?: string; fontSize?: string; fontFamily?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; sup?: boolean; sub?: boolean } = {};
  if (active.color) desired.color = active.color;
  else if (active.color === undefined && inherited.color) desired.color = inherited.color;
  if (active.fontSize) desired.fontSize = active.fontSize;
  else if (active.fontSize === undefined && inherited.fontSize) desired.fontSize = inherited.fontSize;
  if (active.fontFamily) desired.fontFamily = active.fontFamily;
  else if (active.fontFamily === undefined && inherited.fontFamily) desired.fontFamily = inherited.fontFamily;
  if (active.bold === true) desired.bold = true;
  else if (active.bold === undefined && inherited.bold) desired.bold = true;
  if (active.italic === true) desired.italic = true;
  else if (active.italic === undefined && inherited.italic) desired.italic = true;
  if (active.underline === true) desired.underline = true;
  else if (active.underline === undefined && inherited.underline) desired.underline = true;
  if (active.strike === true) desired.strike = true;
  else if (active.strike === undefined && inherited.strike) desired.strike = true;
  if (active.sup) desired.sup = active.sup;
  if (active.sub) desired.sub = active.sub;
  return desired;
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

/** 找到 node 所在的最浅（最靠近根）的带 style 的 span 祖先。
 *  用于 forceApply 路径在无样式时"跳出"当前带样式的 span，避免继承样式。 */
function findEnclosingStyledSpan(
  node: Node,
  root: HTMLElement,
): HTMLElement | null {
  let cur: Node | null = node;
  let result: HTMLElement | null = null;
  while (cur && cur !== root) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      if (el.tagName === 'SPAN' && el.getAttribute('style')) {
        result = el;
      }
    }
    cur = cur.parentNode;
  }
  return result;
}

/**
 * v22 新增：找到 node 所在的最近（最内层）的带 style 的 span 祖先。
 * 用于 insertStyledTextOutsideStyledSpan —— 部分取消样式时只需跳出最近的
 * 带样式 span，保留外层 span 的继承（如 color）。
 *
 * 与 findEnclosingStyledSpan 的区别：
 * - findEnclosingStyledSpan 返回最外层（用于 insertTextOutsideStyledSpan，取消所有样式时跳出全部）
 * - findImmediateStyledSpan 返回最内层（用于 insertStyledTextOutsideStyledSpan，部分取消时只跳出一层）
 */
function findImmediateStyledSpan(
  node: Node,
  root: HTMLElement,
): HTMLElement | null {
  let cur: Node | null = node;
  while (cur && cur !== root) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      if (el.tagName === 'SPAN' && el.getAttribute('style')) {
        return el; // 第一个匹配即返回（最内层）
      }
    }
    cur = cur.parentNode;
  }
  return null;
}

/**
 * 在带样式 span 之外插入文本节点（用于"取消样式"场景，避免继承父 span 样式）。
 * - 如果光标不在带样式 span 内：返回 false，让调用方走默认路径
 * - 如果在带样式 span 内：插入到 span 之后/末尾，光标移到新文本后，返回 true
 *
 * 用于：
 * - forceApply 路径（activeStylesLocked=true）所有样式都关闭时
 * - 非锁定路径（activeStylesLocked=false）!hasRemaining 时（v5 新增）
 */
function insertTextOutsideStyledSpan(
  range: Range,
  text: string,
  editor: HTMLElement,
): boolean {
  const styledSpan = findEnclosingStyledSpan(range.startContainer, editor);
  if (!styledSpan) return false;
  const parent = styledSpan.parentNode;
  if (!parent) return false;

  // v40 修复: 在光标实际位置 split span,而非整 span 之后插入
  // 修复光标在 span 中间(如 "bo|ld")时,新输入字符错位到 span 末尾的问题
  const container = range.startContainer;
  const offset = range.startOffset;

  if (
    container.nodeType === Node.TEXT_NODE &&
    container.parentNode === styledSpan
  ) {
    // 光标在 styledSpan 的文本节点内
    const textNode = container as Text;
    if (offset > 0 && offset < textNode.length) {
      // 光标在文本中间 → splitText 拆分,后半段留在 span 内
      textNode.splitText(offset);
    }
    // 在 split 点之后插入新文本节点(在 span 外)
    const newText = document.createTextNode(text);
    if (offset === 0) {
      // 光标在 span 开头 → 在 span 之前插入
      parent.insertBefore(newText, styledSpan);
    } else {
      // 光标在 span 末尾或 split 后 → 在 span 之后插入
      const next = styledSpan.nextSibling;
      if (next) {
        parent.insertBefore(newText, next);
      } else {
        parent.appendChild(newText);
      }
    }
    // 光标移到新文本之后
    const sel = window.getSelection();
    if (sel) {
      const newRange = document.createRange();
      newRange.setStartAfter(newText);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }
    return true;
  }

  // fallback: 原有逻辑(整 span 之后插入) - 用于光标不在 span 内文本节点的情况
  const newText = document.createTextNode(text);
  const next = styledSpan.nextSibling;
  if (next) {
    parent.insertBefore(newText, next);
  } else {
    parent.appendChild(newText);
  }
  // 把光标移到新文字之后
  const sel = window.getSelection();
  if (sel) {
    const newRange = document.createRange();
    newRange.setStartAfter(newText);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }
  return true;
}

/**
 * v21 新增：在带样式 span 之外插入带样式的新 span（用于"部分取消"场景）。
 * - 找到光标所在的带样式父 span
 * - 在父 span 之后插入新的 span（带 desired 样式 + 文本）
 * - 光标移到新 span 内部末尾
 * - 返回 true 表示成功；false 表示没找到父 span，调用方走 fallback
 */
function insertStyledTextOutsideStyledSpan(
  range: Range,
  text: string,
  desired: { color?: string; fontSize?: string; fontFamily?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; sup?: boolean; sub?: boolean },
  editor: HTMLElement,
): boolean {
  const styledSpan = findImmediateStyledSpan(range.startContainer, editor);
  if (!styledSpan) return false;
  const parent = styledSpan.parentNode;
  if (!parent) return false;

  // 创建新 span 并应用 desired 样式
  const wrap = document.createElement('span');
  if (desired.color) wrap.style.color = desired.color;
  if (desired.fontSize) wrap.style.fontSize = desired.fontSize;
  if (desired.fontFamily) wrap.style.fontFamily = desired.fontFamily;
  if (desired.bold) wrap.style.fontWeight = 'bold';
  if (desired.italic) wrap.style.fontStyle = 'italic';
  const deco: string[] = [];
  if (desired.underline) deco.push('underline');
  if (desired.strike) deco.push('line-through');
  if (deco.length) wrap.style.textDecoration = deco.join(' ');
  wrap.appendChild(document.createTextNode(text));

  // v22 新增：sup/sub 支持
  let outer: HTMLElement = wrap;
  if (desired.sup) {
    const sup = document.createElement('sup');
    sup.appendChild(wrap);
    outer = sup;
  } else if (desired.sub) {
    const sub = document.createElement('sub');
    sub.appendChild(wrap);
    outer = sub;
  }

  // 插入到 styledSpan 之后
  const next = styledSpan.nextSibling;
  if (next) {
    parent.insertBefore(outer, next);
  } else {
    parent.appendChild(outer);
  }

  // 光标移到新 span 内部末尾
  const sel = window.getSelection();
  if (sel) {
    const newRange = document.createRange();
    if (outer.lastChild) {
      newRange.setStartAfter(outer.lastChild);
    } else {
      newRange.setStartAfter(outer);
    }
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }
  return true;
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
  activeStylesLocked: boolean = false,
): boolean {
  // v40: 增加 hasExplicitCancel 检查(IME 输入时取消 B/I/U/S 无效的修复)
  //   active.bold === false 等显式取消不应被早期返回吞掉
  const hasExplicitCancel =
    active.bold === false || active.italic === false ||
    active.underline === false || active.strike === false;
  const hasStyle = active.color || active.fontSize || active.fontFamily ||
    active.bold || active.italic || active.underline || active.strike ||
    active.sup || active.sub;
  if (!hasStyle && !hasExplicitCancel) return false;
  if (range.collapsed) return false;

  // v40: 显式取消样式 —— 对选区调用 removeInline*NoFocus 移除对应样式
  //   (IME 场景:compositionend 后选区是刚输入的文本,通常在父 span 内,
  //    需要移除父级继承的对应样式;skipFocus 避免抢走编辑器焦点)
  if (hasExplicitCancel && editor) {
    if (active.bold === false) {
      removeInlineTagNoFocus(editor, 'b', { skipFocus: true });
      removeInlineTagNoFocus(editor, 'strong', { skipFocus: true });
      removeInlineStyleNoFocus(editor, ['fontWeight']);
    }
    if (active.italic === false) {
      removeInlineTagNoFocus(editor, 'i', { skipFocus: true });
      removeInlineTagNoFocus(editor, 'em', { skipFocus: true });
      removeInlineStyleNoFocus(editor, ['fontStyle']);
    }
    if (active.underline === false) {
      removeTextDecorationPartNoFocus(editor, 'underline', { skipFocus: true });
    }
    if (active.strike === false) {
      removeTextDecorationPartNoFocus(editor, 'line-through', { skipFocus: true });
    }
    return true;
  }

  // 智能合并：从 active 中移除已从父级继承的样式（避免 fontSize % 嵌套相乘）
  // lock 状态下跳过 inherited 吞并（用户显式设置必须忠实应用）
  const inherited = !activeStylesLocked && editor
    ? getInheritedSpanStyles(range.startContainer, editor)
    : {};
  const remaining: typeof active = {};
  if (activeStylesLocked) {
    if (active.color) remaining.color = active.color;
    if (active.fontSize) remaining.fontSize = active.fontSize;
    if (active.fontFamily) remaining.fontFamily = active.fontFamily;
  } else {
    if (active.color && active.color !== inherited.color) remaining.color = active.color;
    if (active.fontSize && !isSameFontSize(active.fontSize, inherited.fontSize)) remaining.fontSize = active.fontSize;
    if (active.fontFamily && active.fontFamily !== inherited.fontFamily) remaining.fontFamily = active.fontFamily;
  }
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
    const frag = range.extractContents();
    // v40 修复: 检查 fragment 是否含 block 元素,若是则走退化路径(逐文本节点包裹)
    // 避免 extractContents + span.appendChild 产生非法嵌套(block 塞进 inline span)
    const hasBlock = frag.querySelector(
      'p, div, h1, h2, h3, h4, h5, h6, blockquote, li, ul, ol, table, tr, td, th, pre',
    );
    if (hasBlock) {
      // 退化路径: 先恢复选区内容,再走下面 TreeWalker 逐文本节点包裹逻辑
      range.insertNode(frag);
      throw new Error('cross-block selection');
    }
    const span = document.createElement('span');
    for (const k of Object.keys(styles)) {
      (span.style as any)[k] = styles[k];
    }
    span.appendChild(frag);
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

  // Fix v25c 选区应用不彻底:退化路径前,先剥除选区内现有相同样式
  // 解决"部分选区已加粗 + 部分未加粗"应用 bold 时产生的嵌套 span 问题
  // 策略:遍历选区内的 span,对每个 span 清除指定的 style 属性(仅当它在 range 范围内)
  const styleKeys = Object.keys(styles);
  const spansInRange: HTMLElement[] = [];
  const spanWalker = document.createTreeWalker(
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
  let sp = spanWalker.nextNode();
  while (sp) {
    if ((sp as HTMLElement).tagName === 'SPAN') {
      spansInRange.push(sp as HTMLElement);
    }
    sp = spanWalker.nextNode();
  }
  for (const span of spansInRange) {
    let modified = false;
    for (const k of styleKeys) {
      if ((span.style as any)[k]) {
        (span.style as any)[k] = '';
        modified = true;
      }
    }
    // Fix v25c 突然换行:解包空样式 span 后,合并相邻文本节点
    if (modified && span.style.cssText === '') {
      const parent = span.parentNode;
      if (parent) {
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        span.remove();
        // 合并相邻文本节点(避免遗留空文本节点导致的意外换行)
        if (parent.firstChild && parent.normalize) parent.normalize();
      }
    }
  }

  // v25d 修复:纯空白文本节点不参与应用样式,避免空 span 导致的不知名换行
  // 过滤后,选区完全空白 → 直接 return false(无应用目标)
  const effectiveTextNodes = textNodes.filter((tn) => !/^\s*$/.test(tn.textContent ?? ''));
  if (effectiveTextNodes.length === 0) return false;

  const wrappedSpans: HTMLElement[] = [];
  for (const tn of effectiveTextNodes) {
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

  // v32 修复:用第一个和最后一个 wrappedSpan 精确恢复选区
  // (旧版只用 firstRange 选中第一个 span,跨多 text node 时选区不完整)
  if (wrappedSpans.length > 0) {
    // 后置清理可能 unwrap 了部分 span,需要找到仍在 DOM 中的首尾
    let firstSpan: HTMLElement | null = null;
    let lastSpan: HTMLElement | null = null;
    for (const span of wrappedSpans) {
      if (span.parentNode) {
        if (!firstSpan) firstSpan = span;
        lastSpan = span;
      }
    }
    if (firstSpan && lastSpan) {
      const newRange = document.createRange();
      newRange.setStart(firstSpan, 0);
      newRange.setEnd(lastSpan, lastSpan.childNodes.length);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(newRange);
    }
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
  options?: { skipFocus?: boolean; skipSelectionRestore?: boolean },
): boolean {
  if (!options?.skipFocus) focusEditor(editor);
  const range = getSelectionRangeIn(editor);
  if (!range) return false;

  // v46 Fix 1: 记录原始选区边界(用于 DOM 修改后恢复选区)
  // 参考 removeTextDecorationPartNoFocus 的 v42 Fix 2 实现
  const origStartContainer = range.startContainer;
  const origStartOffset = range.startOffset;
  const origEndContainer = range.endContainer;
  const origEndOffset = range.endOffset;
  let changed = false;

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
    // v30 修复:如果选区只覆盖 span 的一部分,先 splitElementAtRange
    // 把选区部分移出(作为 span 的兄弟节点),然后对移出的部分做移除
    if (!isRangeFullyInside(range, span)) {
      // 1) 拆分 span:选区部分移出到 grandParent
      splitElementAtRange(span, range);
      // 2) 对移出的文本节点(作为 span 的兄弟),如果它们原本有 style,
      //    需要复制 style 去掉被移除的 props,但用户场景里移出的文本节点是裸文本
      //    不会有原来的 style,所以直接忽略
      // v48 Fix 2: splitElementAtRange 后检查原 span 是否为空,空则清理
      // 原问题: 如果选区恰好覆盖了 span 的全部内容,splitElementAtRange 后
      // 原 span 变成空 span(无文本内容),但 style 属性仍残留,留下 <span style="..."></span>
      if (!span.textContent || span.textContent.trim() === '') {
        const parent = span.parentNode;
        if (parent) {
          while (span.firstChild) parent.insertBefore(span.firstChild, span);
          parent.removeChild(span);
          if ((parent as any).normalize) (parent as any).normalize();
        }
      }
    } else {
      // 选区完全覆盖 span → 移除 style(原行为)
      for (const p of styleProps) {
        const kebab = p.replace(/([A-Z])/g, '-$1').toLowerCase();
        span.style.removeProperty(kebab);
      }
      // v46 Fix 3: 清理空 span 残留
      // 原问题: removeProperty 后 style 属性为空字符串,但 attributes.length 为 1
      // (style 属性仍存在),走 else 分支只 removeAttribute('style'),留下 <span>文本</span>
      // 修复: 检查 style 是否为空,空则移除 style 属性;若此时无其他属性,展平 span
      const styleVal = span.getAttribute('style');
      if (!styleVal || styleVal.trim() === '') {
        span.removeAttribute('style');
        // 移除 style 属性后,如果 span 无任何属性,展平(unwrap)
        if (span.attributes.length === 0) {
          const parent = span.parentNode;
          if (parent) {
            while (span.firstChild) parent.insertBefore(span.firstChild, span);
            parent.removeChild(span);
            // v25d 修复:解包后合并相邻文本节点
            if ((parent as any).normalize) (parent as any).normalize();
          }
        }
      }
    }
    changed = true;
  }
  // v46 Fix 1: 恢复选区(与 removeTextDecorationPartNoFocus v42 Fix 2 对齐)
  // 原因: splitElementAtRange + span 解包后选区丢失,
  // 违反"选中文本再点击菜单栏不会取消文本的被选中状态"需求
  // v49 Phase C2: skipSelectionRestore=true 时跳过内部恢复,
  //   让外部 bookmark markers 方案接管选区恢复(避免 origStartContainer
  //   被 normalize 合并失效导致恢复错误选区)
  if (changed) {
    if (!options?.skipSelectionRestore) {
      try {
        if (editor.contains(origStartContainer) && editor.contains(origEndContainer)) {
          const newRange = document.createRange();
          newRange.setStart(origStartContainer, origStartOffset);
          newRange.setEnd(origEndContainer, origEndOffset);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(newRange);
        }
      } catch {
        // 选区恢复失败不影响样式移除
      }
    }
    // v49 Phase C2: skipSelectionRestore=true 时跳过 dispatchInput,
    //   让外部调用方在 restoreSelectionFromMarkers 之后统一调用,
    //   避免 markers 还在 DOM 中时触发 React re-render 导致选区丢失
    if (!options?.skipSelectionRestore) {
      dispatchInput(editor);
    }
  }
  return true;
}

/** 等价于 removeInlineStyle(editor, styleProps, { skipFocus: true })，
 *  用于工具栏按钮取消样式时避免抢焦点（不抢 input/select 焦点）。
 *  v49 Phase C2: 支持 skipSelectionRestore 选项,供外部 bookmark markers 方案使用。 */
export function removeInlineStyleNoFocus(
  editor: HTMLElement,
  styleProps: string[],
  options?: { skipSelectionRestore?: boolean },
): boolean {
  return removeInlineStyle(editor, styleProps, {
    skipFocus: true,
    skipSelectionRestore: options?.skipSelectionRestore,
  });
}

/** 细粒度 textDecoration 移除：从选区内的所有 span 的 textDecoration 字段中移除指定 part
 *  （如 'underline' 或 'line-through'），保留其他部分（如同时有下划线和删除线时，只移除下划线）。
 *  skipFocus: 不抢 input/select 焦点。 */
export function removeTextDecorationPartNoFocus(
  editor: HTMLElement,
  part: 'underline' | 'line-through',
  options?: { skipFocus?: boolean; skipSelectionRestore?: boolean },
): boolean {
  if (!options?.skipFocus) focusEditor(editor);
  const range = getSelectionRangeIn(editor);
  if (!range) return false;

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

  let changed = false;
  // v42 Fix 2: 记录原始选区边界(用于 DOM 修改后恢复选区)
  // span 可能被解包(remove),不能用 span 重建选区,用原始 range 重建
  const origStartContainer = range.startContainer;
  const origStartOffset = range.startOffset;
  const origEndContainer = range.endContainer;
  const origEndOffset = range.endOffset;
  for (const span of candidates) {
    const cur = span.style.textDecoration;
    if (!cur || !cur.split(/\s+/).includes(part)) continue;
    // v30 修复:如果选区只覆盖 span 的一部分,先 splitElementAtRange
    // 把选区部分移出到 grandParent(作为 span 的兄弟节点),
    // 然后只对 span 自身移除 part(因为移出的部分没有原 span 的 text-decoration)
    if (!isRangeFullyInside(range, span)) {
      splitElementAtRange(span, range);
    }
    // 选区完全在 span 内 OR 已 split 后:从 span 自身移除 part
    const remaining = span.style.textDecoration || '';
    const parts = remaining.split(/\s+/).filter((p) => p && p !== part);
    if (parts.length === 0) {
      span.style.removeProperty('text-decoration');
    } else {
      span.style.textDecoration = parts.join(' ');
    }
    changed = true;
    // 如果 span 清除后无任何样式 → 解包
    if (span.style.cssText === '') {
      const parent = span.parentNode;
      if (parent) {
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        span.remove();
        // v25d 修复:解包后合并相邻文本节点(避免不知名换行)
        if ((parent as any).normalize) (parent as any).normalize();
      }
    }
  }
  // v42 Fix 2: 恢复选区(与 applyInlineStyle 对齐)
  // 原因: splitElementAtRange + span 解包后选区丢失,
  // 违反"选中文本再点击菜单栏不会取消文本的被选中状态"需求
  // v49 Phase C2: skipSelectionRestore=true 时跳过内部恢复,
  //   让外部 bookmark markers 方案接管选区恢复(避免 origStartContainer
  //   被 normalize 合并失效导致恢复错误选区)
  if (changed) {
    if (!options?.skipSelectionRestore) {
      try {
        // 原始 range 的 startContainer/endContainer 可能仍存在于 DOM 中
        // (splitElementAtRange 只移动 span 内部内容,不改变 startContainer/endContainer 本身)
        if (editor.contains(origStartContainer) && editor.contains(origEndContainer)) {
          const newRange = document.createRange();
          newRange.setStart(origStartContainer, origStartOffset);
          newRange.setEnd(origEndContainer, origEndOffset);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(newRange);
        }
      } catch {
        // 选区恢复失败不影响样式移除
      }
    }
    // v49 Phase C2: skipSelectionRestore=true 时跳过 dispatchInput,
    //   让外部调用方在 restoreSelectionFromMarkers 之后统一调用,
    //   避免 markers 还在 DOM 中时触发 React re-render 导致选区丢失
    if (!options?.skipSelectionRestore) {
      dispatchInput(editor);
    }
  }
  return changed;
}

/** 细粒度 textDecoration 应用：选区内所有文本节点追加指定 part（underline 或 line-through），
 *  - 裸文本（不在 span 内）→ 包新 span 加 part
 *  - 已在 span 内 → 追加 part，保留已有部分（如已有 line-through 时再应用 underline → 'underline line-through'）
 *  - 纯空白文本节点 → 跳过（避免空 span 导致的不知名换行）
 *  - v29 修复：选区只覆盖文本节点的一部分时，先用 splitText 拆分文本节点，只对选中的部分包 span
 *  skipFocus: 不抢 input/select 焦点。 */
export function applyTextDecorationPartNoFocus(
  editor: HTMLElement,
  part: 'underline' | 'line-through',
  options?: { skipFocus?: boolean },
): boolean {
  if (!options?.skipFocus) focusEditor(editor);
  const range = getSelectionRangeIn(editor);
  if (!range) return false;

  const changedNodes = new Set<HTMLElement>();

  // 1. 遍历选区内所有文本节点
  const textWalker = document.createTreeWalker(
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
  let tn = textWalker.nextNode() as Text | null;
  while (tn) {
    const text = tn.textContent ?? '';

    // v25d:跳过纯空白文本节点(用户需求 - 忽略选中文本中间的空白)
    if (/^\s*$/.test(text)) {
      tn = textWalker.nextNode() as Text | null;
      continue;
    }

    // v29 修复:计算本文本节点内的实际选区范围(不是整个文本节点)
    // 例如文本节点 "hello world"(11 字符)被选 [2,7) → startOffset=2, endOffset=7
    let startOffset = 0;
    let endOffset = tn.length;
    if (range.startContainer === tn) startOffset = range.startOffset;
    if (range.endContainer === tn) endOffset = range.endOffset;
    if (startOffset >= endOffset) {
      tn = textWalker.nextNode() as Text | null;
      continue;
    }

    // v29 修复:如果选区只覆盖文本节点的一部分,先用 splitText 拆分成 3 段
    // 例如 "hello world" 选 [2,7) → "he" + "llo wo" + "rld"
    // 拆分顺序:先 endOffset 再 startOffset(否则偏移会失效)
    // isPartial 必须在 split 之前计算(split 后 tn.length 已变)
    const isPartial = startOffset > 0 || endOffset < tn.length;
    let targetTextNode: Text = tn;
    if (isPartial) {
      tn.splitText(endOffset);  // tn=[0,endOffset),新节点=[endOffset,...)
      targetTextNode = tn.splitText(startOffset);  // tn=[0,startOffset),targetTextNode=[startOffset,endOffset)
    }

    // 2. 找到最近 span 祖先(用拆分后的 targetTextNode)
    const span = findAncestorSpan(targetTextNode);

    if (!span) {
      // 3a. 裸文本 → 包新 span 加 part(只包 targetTextNode,不再 selectNodeContents 整个文本节点)
      try {
        const newSpan = document.createElement('span');
        newSpan.style.textDecoration = part;
        const r = document.createRange();
        r.selectNodeContents(targetTextNode);
        r.surroundContents(newSpan);
        changedNodes.add(newSpan);
      } catch {
        // surroundContents 失败(选区跨越多个节点) → 退化:包整个 targetTextNode
        const newSpan = document.createElement('span');
        newSpan.style.textDecoration = part;
        const parent = targetTextNode.parentNode;
        if (parent) {
          while (targetTextNode.firstChild) newSpan.appendChild(targetTextNode.firstChild);
          parent.insertBefore(newSpan, targetTextNode);
          parent.removeChild(targetTextNode);
          changedNodes.add(newSpan);
        }
      }
    } else {
      // 3b. 已在 span 内 → 追加 part(细粒度合并)
      // v29 修复:部分选区时,把 targetTextNode 从原 span 移出,用新 span 包装
      // 避免原 span 的其他文本被错误地一起加上 part
      // 用 split 前的 isPartial 判定(用 split 后的 tn.length 会判断错误)
      if (isPartial) {
        // v32 修复:递归处理多层 span 嵌套
        // 旧版 v29 只拆最近一层 span,如果有多层嵌套(bold > color > italic > text),
        // 只拆了 italic,外层 bold/color 丢失
        // v32: 收集所有祖先 span,合并样式到新 span,把 targetTextNode 移到最外层 span 的兄弟位置
        const allSpans: HTMLElement[] = [];
        let curSpan: HTMLElement | null = span;
        while (curSpan) {
          allSpans.unshift(curSpan); // 从外到内存储
          const parent = curSpan.parentNode;
          if (parent && parent.nodeType === Node.ELEMENT_NODE && (parent as HTMLElement).tagName === 'SPAN') {
            curSpan = parent as HTMLElement;
          } else {
            curSpan = null;
          }
        }

        // 从最外层 span 的 parent 开始插入
        const outermostSpan = allSpans[0];
        const grandParent = outermostSpan.parentNode;
        if (grandParent) {
          // 创建新 span,复制所有祖先 span 的样式 + 添加 part
          const newSpan = document.createElement('span');
          // 收集所有祖先 span 的 inline style(从外到内,内层覆盖外层同属性)
          // 用 cssText 解析(兼容 happy-dom,style.length/style[i] 在 happy-dom 中不可靠)
          const combinedStyles: Record<string, string> = {};
          for (const s of allSpans) {
            const cssText = s.style.cssText;
            if (cssText) {
              // 解析 "font-weight: bold; color: red;" 形式
              const declarations = cssText.split(';').filter((d) => d.trim());
              for (const decl of declarations) {
                const colonIdx = decl.indexOf(':');
                if (colonIdx > 0) {
                  const prop = decl.substring(0, colonIdx).trim();
                  const val = decl.substring(colonIdx + 1).trim();
                  if (prop && val) {
                    combinedStyles[prop] = val;
                  }
                }
              }
            }
          }
          // 添加 part(细粒度合并 textDecoration)
          if (combinedStyles['text-decoration']) {
            const parts = new Set(combinedStyles['text-decoration'].split(/\s+/).filter(Boolean));
            parts.add(part);
            combinedStyles['text-decoration'] = Array.from(parts).join(' ');
          } else {
            combinedStyles['text-decoration'] = part;
          }
          // 应用合并样式到新 span
          // v32 修复:用 setProperty 设置 kebab-case 属性名
          // (style['font-weight']=v 方括号语法不生效,需用 setProperty 或 camelCase)
          for (const [k, v] of Object.entries(combinedStyles)) {
            newSpan.style.setProperty(k, v);
          }
          // 在最外层 span 前插入新 span
          grandParent.insertBefore(newSpan, outermostSpan);
          // 把 targetTextNode 移到新 span
          newSpan.appendChild(targetTextNode);
          changedNodes.add(newSpan);
        }
      } else {
        // 完整文本节点在选区内 → 整 span 应用(原行为)
        const cur = span.style.textDecoration || '';
        const parts = new Set(cur.split(/\s+/).filter(Boolean));
        if (parts.has(part)) {
          // 已经有这个 part → 跳过
          tn = textWalker.nextNode() as Text | null;
          continue;
        }
        parts.add(part);
        span.style.textDecoration = Array.from(parts).join(' ');
        changedNodes.add(span);
      }
    }

    tn = textWalker.nextNode() as Text | null;
  }

  // 4. 对修改过的 span 调 normalize (避免不知名换行)
  for (const el of changedNodes) {
    const parent = el.parentNode;
    if (parent && (parent as any).normalize) {
      (parent as any).normalize();
    }
  }

  // v42 Fix 2: 恢复选区(与 applyInlineStyle L2351-2356 对齐)
  // 原因: splitText + surroundContents + DOM 移动后选区会丢失,
  // 违反"选中文本再点击菜单栏不会取消文本的被选中状态"需求
  if (changedNodes.size > 0) {
    try {
      const nodes = Array.from(changedNodes);
      const newRange = document.createRange();
      newRange.setStartBefore(nodes[0]);
      newRange.setEndAfter(nodes[nodes.length - 1]);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(newRange);
    } catch {
      // 选区恢复失败不影响样式应用
    }
    dispatchInput(editor);
  }
  return changedNodes.size > 0;
}

/** 找到 node 的最近 span 祖先(用于 applyTextDecorationPartNoFocus) */
function findAncestorSpan(node: Node): HTMLElement | null {
  let cur: Node | null = node.parentNode;
  while (cur && cur.nodeType === Node.ELEMENT_NODE) {
    if ((cur as HTMLElement).tagName === 'SPAN') return cur as HTMLElement;
    cur = cur.parentNode;
  }
  return null;
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

/**
 * v48 Fix 3: 为 img 元素挂载 base64 兜底 error listener
 *
 * 当 img.src 是 local:// 协议且加载失败时，通过 readAsDataUrl IPC
 * 读取文件内容并转为 base64 dataUrl 作为兜底。
 *
 * 提取此函数是为了在 content useEffect 重写 innerHTML 后
 * 重新挂载 error listener（reattachImageErrorHandlers）。
 */
export function attachImageErrorHandler(img: HTMLImageElement, src: string): void {
  let fallbackTried = false;
  img.addEventListener('error', async () => {
    if (src.startsWith('local://') && !fallbackTried) {
      fallbackTried = true;
      try {
        const res = await window.electronAPI?.readAsDataUrl?.(src);
        if (res?.ok && res.dataUrl) {
          img.src = res.dataUrl;
          return; // 重新设置 src 会触发 load/error，无需走下面的错误显示
        }
      } catch {
        // 忽略异常，继续走错误显示
      }
    }
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
}

/**
 * v48 Fix 4: 重新挂载所有 img 元素的 error listener
 *
 * 在 content useEffect 重写 innerHTML 后调用，确保章节切换/视图切换后
 * 新创建的 img 元素仍有 base64 兜底能力。
 *
 * 仅对 data-original-src 或 src 以 local:// 开头的 img 挂载，
 * 避免对已成功 base64 兜底的 img（src 是 data:）重复挂载。
 */
export function reattachImageErrorHandlers(editor: HTMLElement): void {
  const imgs = editor.querySelectorAll<HTMLImageElement>('img');
  imgs.forEach((img) => {
    // 优先读 data-original-src（保留原始 local:// URL），降级读 src
    const originalSrc = img.getAttribute('data-original-src') || img.src || '';
    // 只对 local:// 图片挂载（data: base64 图片不需要兜底）
    if (originalSrc.startsWith('local://')) {
      // 用 data-original-src 作为兜底 IPC 参数（而非可能已被污染的 src）
      attachImageErrorHandler(img, originalSrc);
    }
  });
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
  // v35: 保存原始 src，防止 base64 兜底污染后丢失原始 local:// URL
  img.setAttribute('data-original-src', src);
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

  // v24: IPC 兜底 — 与 v23 CompactImageLibraryPanel / ImageLibraryPage 保持一致
  // v48 Fix 3: 提取 error listener 到 attachImageErrorHandler 函数,便于 reattachImageErrorHandlers 复用
  attachImageErrorHandler(img, src);

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
    // v38 修复: 同步更新 data-original-src,保证下次选中读到最新值
    img.setAttribute('data-original-src', opts.src);
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
      // v38 修复: 优先读取 data-original-src,防止 base64 兜底污染 src 后 URL 输入框显示空或 base64
      // 与 ngaHtmlToBBCode.ts 中的读取模式保持一致
      const src = img?.getAttribute('data-original-src') || img?.getAttribute('src') || '';
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

/** 需求4:把 DiceTextStyle 转换为内联 CSS 属性对象 */
function diceTextStyleToCss(style: DiceTextStyle | undefined): Partial<CSSStyleDeclaration> {
  if (!style) return {};
  const css: Partial<CSSStyleDeclaration> = {};
  if (style.bold !== undefined) css.fontWeight = style.bold ? '700' : '400';
  if (style.italic !== undefined) css.fontStyle = style.italic ? 'italic' : 'normal';
  if (style.underline !== undefined || style.strike !== undefined) {
    const decos: string[] = [];
    if (style.underline) decos.push('underline');
    if (style.strike) decos.push('line-through');
    css.textDecoration = decos.length > 0 ? decos.join(' ') : 'none';
  }
  if (style.color) css.color = style.color;
  if (style.fontFamily) css.fontFamily = style.fontFamily;
  if (style.fontSize) css.fontSize = style.fontSize;
  return css;
}

/** 需求4:把样式对象应用到 HTMLElement */
function applyTextStyle(el: HTMLElement, style: DiceTextStyle | undefined): void {
  if (!style) return;
  const css = diceTextStyleToCss(style);
  Object.assign(el.style, css);
}

/** 渲染 / 刷新 dice-card 的 DOM。用 data-payload 驱动。 */
export function renderDiceCard(block: HTMLElement): void {
  const { payload } = getDicePayload(block);
  const cfg: any = (payload && payload.config) || { name: '骰子', kind: 'option' };
  const kind: string = cfg.kind || 'option';
  const lastResult: any = payload?.lastResult || null;
  const styleConfig: DiceStyleConfig | undefined = payload?.style;

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
    // 需求4:hover dice-card 时显示编辑按钮
    block.addEventListener('mouseenter', () => {
      const eb = block.querySelector<HTMLButtonElement>('button[data-role="edit"]');
      if (eb) eb.style.opacity = '1';
    });
    block.addEventListener('mouseleave', () => {
      const eb = block.querySelector<HTMLButtonElement>('button[data-role="edit"]');
      if (eb) eb.style.opacity = '0';
    });
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

    // 需求4:右侧按钮组(编辑 + 掷骰)
    const rightBtns = document.createElement('div');
    rightBtns.style.display = 'flex';
    rightBtns.style.alignItems = 'center';
    rightBtns.style.gap = '6px';

    // 需求4:编辑按钮(hover dice-card 时显示)
    const editBtn = document.createElement('button');
    editBtn.setAttribute('data-role', 'edit');
    editBtn.textContent = '✏️';
    editBtn.title = '编辑骰子配置';
    editBtn.style.fontSize = '12px';
    editBtn.style.padding = '4px 8px';
    editBtn.style.borderRadius = '6px';
    editBtn.style.border = '1px solid var(--dice-card-border)';
    editBtn.style.background = 'transparent';
    editBtn.style.color = 'var(--dice-card-ink)';
    editBtn.style.cursor = 'pointer';
    editBtn.style.userSelect = 'none';
    editBtn.style.opacity = '0';
    editBtn.style.transition = 'opacity 0.15s';
    editBtn.addEventListener('mouseenter', () => {
      editBtn.style.background = 'var(--bg-hover)';
    });
    editBtn.addEventListener('mouseleave', () => {
      editBtn.style.background = 'transparent';
    });

    rightBtns.appendChild(editBtn);
    rightBtns.appendChild(rollBtn);
    head.appendChild(rightBtns);

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
    // 需求4:应用用户配置的骰子点数文本样式(覆盖默认)
    if (styleConfig?.resultText) applyTextStyle(rollDisplay, styleConfig.resultText);
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
          // 需求4:应用用户配置的选中选项文本样式(覆盖默认)
          if (styleConfig?.selectedOption) applyTextStyle(row, styleConfig.selectedOption);
        } else {
          row.style.background = 'var(--dice-card-bg)';
          row.style.color = 'var(--dice-card-ink)';
          // 需求4:应用用户配置的未选中选项文本样式(覆盖默认)
          if (styleConfig?.unselectedOption) applyTextStyle(row, styleConfig.unselectedOption);
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
      finalResultEl.innerHTML = '';
      const headDiv = document.createElement('div');
      headDiv.style.fontFamily = 'Consolas, Menlo, monospace';
      headDiv.style.fontSize = '12px';
      headDiv.style.marginBottom = '4px';
      // 需求4:应用用户配置的骰子点数文本样式(覆盖默认)
      if (styleConfig?.resultText) applyTextStyle(headDiv, styleConfig.resultText);
      headDiv.textContent = headText;
      finalResultEl.appendChild(headDiv);

      const bodyDiv = document.createElement('div');
      bodyDiv.textContent = bodyText;
      finalResultEl.appendChild(bodyDiv);
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
  // 需求4:设置 data-block-id 用于编辑时定位(优先用 config.id)
  wrapper.setAttribute('data-block-id', payload?.config?.id || Math.random().toString(36).slice(2, 10));
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

/** 需求4:更新已有 dice-card 的 payload 并重新渲染(编辑保存后回填) */
export function updateDiceBlock(
  editor: HTMLElement,
  blockId: string,
  payload: DiceBlockPayloadV2,
): boolean {
  const block = editor.querySelector<HTMLElement>(
    `${DICE_CARD_SELECTOR}[data-block-id="${blockId}"]`,
  );
  if (!block) return false;
  block.setAttribute('data-payload', JSON.stringify(payload));
  // 同步更新 data-block-id(以防 config.id 变化)
  if (payload?.config?.id) {
    block.setAttribute('data-block-id', payload.config.id);
  }
  // 重置 initialized 标记以强制重建内部结构(确保编辑按钮等正确挂载)
  delete block.dataset.initialized;
  block.innerHTML = '';
  renderDiceCard(block);
  dispatchInput(editor);
  pushAtomicHistory(editor.innerHTML);
  return true;
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
    // 需求4:补全 data-block-id(从 innerHTML 恢复的 dice-card 可能没有)
    if (!el.getAttribute('data-block-id')) {
      const { payload } = getDicePayload(el);
      el.setAttribute('data-block-id', payload?.config?.id || Math.random().toString(36).slice(2, 10));
    }
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

    // 需求4:编辑按钮点击 → 分发 CustomEvent 给 RichTextEditor
    const editBtn = findAncestorWithAttr(target as HTMLElement, 'data-role', 'edit');
    if (editBtn) {
      e.stopPropagation();
      e.preventDefault();
      const block = findDiceCardAncestor(target, editor);
      if (!block) return;
      const { payload } = getDicePayload(block);
      const blockId = block.getAttribute('data-block-id') || '';
      editor.dispatchEvent(new CustomEvent('dice-edit-request', {
        detail: { blockId, payload },
        bubbles: false,
      }));
      return;
    }

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

