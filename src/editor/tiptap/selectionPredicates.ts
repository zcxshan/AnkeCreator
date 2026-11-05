// 选区样式的严格 ALL 语义判定。
// 说明：这组函数原本位于旧 contenteditable 编辑器（src/editor/inlineStyle.ts），
// 但工具栏的 B/I/U/S 激活态仍在依赖它。这里独立出来，避免工具栏通过 barrel
// 引入整套旧编辑器模块。

function isStyleFullyActiveInEditor(
  cssProperty: 'font-weight' | 'font-style' | 'text-decoration',
  targetValues: string[],
  inlineTags: string[],
): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return false;

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

  // 忽略中间空白
  const effectiveNodes = textNodes.filter((tn) => !/^\s*$/.test(tn.textContent ?? ''));
  if (effectiveNodes.length === 0) return false;

  // ALL 语义：所有有效文本节点都具备样式
  for (const tn of effectiveNodes) {
    let has = false;
    let el: HTMLElement | null = tn.parentElement;
    while (el) {
      const inline = el.style.getPropertyValue(cssProperty);
      if (inline) {
        const values = inline.split(/\s+/).map((s) => s.toLowerCase().replace(/[!,].*$/, ''));
        if (values.some((v) => targets.has(v))) {
          has = true;
          break;
        }
      }
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
        // computed style 不可用，跳过
      }
      if (upperTags.has(el.tagName)) {
        has = true;
        break;
      }
      el = el.parentElement;
    }
    if (!has) return false;
  }
  return true;
}

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
