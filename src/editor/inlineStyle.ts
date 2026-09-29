// contenteditable 富文本工具集 — 内联样式
// 原内容来自 src/components/editor/contenteditableUtils.ts（机械拆分，无逻辑改动）

import { ptToSizePercent } from '../utils/ngaHtmlToBBCode';
import {
  focusEditor,
  dispatchInput,
  getSelectionRangeIn,
  isRangeFullyInside,
  splitElementAtRange,
  getLastEditorRange,
} from './selection';
import { findAncestorSpan } from './dom';
import { isCommandActive } from './commands';

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
  const lastEditorRange = getLastEditorRange();
  if ((!sel || sel.rangeCount === 0 || !sel.isCollapsed) && lastEditorRange && lastEditorRange.collapsed) {
    const curSel = sel ?? window.getSelection();
    if (curSel) {
      curSel.removeAllRanges();
      curSel.addRange(lastEditorRange.cloneRange());
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

// ------------------------------------------------------------
// 应用内联样式到选区（Fix #1b/#1c 增强）
// ------------------------------------------------------------

/**
 * 给选区应用一组内联样式（color / fontSize / fontFamily / fontWeight / fontStyle / textDecoration）
 * - 折叠选区（无选区）不应用（return false）
 * - 若 range 已完全在带相同样式的 span 内 → 不操作（直接成功）
 * - 包裹完成后，若新 span 的父级也是带相同样式的 span → 解包新 span（避免嵌套）
 *   CSS font-size:% 相对父元素计算，嵌套后实际字号会被反复相乘（>100% 越来越大、<100% 越来越小）。
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
