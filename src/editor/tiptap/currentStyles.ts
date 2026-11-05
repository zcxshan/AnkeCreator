// ============================================================
// 安科编辑器 —— 光标处活动样式读取（Tiptap 内核）
//
// 从旧 contenteditable 模块 inlineStyle.ts 机械搬迁 getCurrentStyles 及其
// 最小依赖闭包（活动态判定 + 祖先内联样式读取），函数体与语义逐字保留。
// 不包含任何编辑命令实现（applyInlineStyle / removeInlineStyle 等）。
// ============================================================

/**
 * 读取 execCommand 的激活状态。
 * 旧实现位于 commands.ts（isCommandActive），此处按最小闭包内联复制，语义不变。
 */
function isCommandActive(command: string): boolean {
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
export function isSupActive(): boolean {
  return isCommandActive('superscript');
}
export function isSubActive(): boolean {
  return isCommandActive('subscript');
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
