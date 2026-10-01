// contenteditable 富文本工具集 — 选区 / 光标工具
// 原内容来自 src/components/editor/contenteditableUtils.ts（机械拆分，无逻辑改动）

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

/** 读取模块级"编辑器最后一次选区"（供 applyActiveStylesToInsertion 等使用） */
export function getLastEditorRange(): Range | null {
  return _lastEditorRange;
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

export function getSelectionRangeIn(
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

/**
 * 获取编辑器内当前可用的 Range（即使 collapsed 也返回）。
 * 若没有可用选区（编辑器未聚焦），则在编辑器末尾创建一个 collapsed range。
 * 注意：不在此调 focusEditor，以免破坏已有的光标位置。
 */
export function getInsertionRange(editor: HTMLElement): Range {
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
 * 计算光标在编辑器内的文本偏移（供撤销/重做后恢复光标位置用）
 * - 返回编辑器开头到光标之间的可见文本长度（toString 不计 <br>/标签）
 * - 光标不在编辑器内 / 无可用选区 → 返回 -1（表示未知，恢复时回退到末尾）
 */
export function getCaretOffset(editor: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return -1;
  const range = sel.getRangeAt(0);
  const container = range.startContainer;
  if (!editor.contains(container)) return -1;
  try {
    const tmp = document.createRange();
    tmp.selectNodeContents(editor);
    tmp.setEnd(container, range.startOffset);
    return tmp.toString().length;
  } catch {
    return -1;
  }
}

/**
 * 按文本偏移恢复光标（配合 getCaretOffset）
 * - offset < 0 → 光标放到编辑器末尾
 * - 超出内容长度 → 放到最后一个文本节点末尾
 * - 编辑器无文本节点（空内容/<br>）→ 放到开头
 */
export function setCaretAtOffset(editor: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const place = (r: Range) => {
    sel.removeAllRanges();
    sel.addRange(r);
  };
  if (offset < 0) {
    const r = document.createRange();
    r.selectNodeContents(editor);
    r.collapse(false);
    place(r);
    return;
  }
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode() as Text | null;
  let lastText: Text | null = null;
  while (node) {
    lastText = node;
    if (remaining <= node.length) {
      const r = document.createRange();
      r.setStart(node, remaining);
      r.collapse(true);
      place(r);
      return;
    }
    remaining -= node.length;
    node = walker.nextNode() as Text | null;
  }
  if (lastText) {
    const r = document.createRange();
    r.setStart(lastText, lastText.length);
    r.collapse(true);
    place(r);
  } else {
    const r = document.createRange();
    r.selectNodeContents(editor);
    r.collapse(false);
    place(r);
  }
}
