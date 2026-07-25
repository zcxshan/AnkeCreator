// ============================================================
// NGA BBCode 转换器（新版：基于 DOMParser）
//
// 目标：
//   1. 用浏览器的 DOMParser 正确解析节点（替代脆弱的正则）
//   2. 颜色/字号/字体统一查 NGA_* 表输出标准值
//   3. 骰子节点的 data-payload 通过 DOM API 直接读取，避免 JSON 引号截断
//   4. 默认值（100%、simsun、black）不加标签，避免多余 [/color][/size][/font]
// ============================================================

import { renderDiceBlock } from './ngaExporter';
import {
  NGA_COLORS,
  NGA_FONTS,
  NGA_FONT_SIZES,
  NGA_IMAGE_SIZES,
  NGA_DEFAULT_COLOR,
  NGA_DEFAULT_FONT,
  NGA_DEFAULT_FONT_SIZE,
} from '../types';

/** 公开入口：把 HTML 字符串转成 NGA BBCode */
export function htmlToNGABBCode(html: string | null | undefined): string {
  if (!html) return '';
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstChild as HTMLElement | null;
    if (!root) return '';
    // v18 修复:DOM 规范化(在 BBCode 转换前去除冗余嵌套 <b><b>x</b></b> 等)
    normalizeDom(root);
    const lines = processBlockChildren(root);
    const out = lines.filter((l) => l !== null && l !== undefined).join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
    if (!out) return '';
    // 合并连续相同的 [color=*]/[size=*]/[font=*] 开闭 tag，去除无效嵌套
    let result = collapseBbCode(out + '\n');
    // 防御性兜底：工具栏不支持的 bbcode 标签当普通文本处理（转义 [ ] 为字面字符）
    result = escapeUnsupportedBbCode(result);
    // dev 模式：输出原始 HTML 与转换结果，方便手动验证 NGA 导出正确性
    if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) {
      console.groupCollapsed('[NGA export] dev log');
      console.log('HTML input:\n', html);
      console.log('BBCode output:\n', result);
      console.groupEnd();
    }
    return result;
  } catch {
    // 降级：简单 strip HTML
    return html.replace(/<[^>]+>/g, '').trim() + '\n';
  }
}

/**
 * v18 新增:DOM 规范化
 * 1. 移除所有空 inline 标签(<b></b> / <span></span> 等)
 * 2. 合并相邻同名 <span>(相同 color/font-size/font-family)
 * 3. unwrap 嵌套的同语义 inline 标签(外层 <b><b>x</b></b> → <b>x</b>)
 * 4. <strong> → <b>, <em> → <i>, <del> → <s>
 */
function normalizeDom(root: HTMLElement): void {
  // 先做 N 次深度遍历直到稳定(因为 unwrap 会改变结构)
  for (let pass = 0; pass < 10; pass++) {
    const before = root.innerHTML
    // 1) 标准化标签名: <strong>→<b>, <em>→<i>, <del>→<s>
    renameTags(root)
    // 2) 移除空 inline 标签
    removeEmptyInlineTags(root)
    // 3) unwrap 嵌套的同语义 inline 标签
    unwrapNestedSameTag(root)
    // 4) unwrap 嵌套的同属性 span
    unwrapNestedSameStyleSpan(root)
    // 5) 合并相邻同名 span
    mergeAdjacentSameSpan(root)
    if (root.innerHTML === before) break
  }
}

function normalizeStyle(cssText: string): string {
  return cssText.replace(/\s+/g, ' ').trim().toLowerCase().split(';').filter(Boolean).sort().join(';')
}

function unwrapNestedSameStyleSpan(root: HTMLElement): void {
  // <span style="color:red"><span style="color:red">x</span></span> → <span style="color:red">x</span>
  const spans = Array.from(root.querySelectorAll('span'))
  for (const span of spans) {
    const parent = span.parentElement
    if (!parent || parent.tagName !== 'SPAN') continue
    const spanStyle = normalizeStyle(span.style.cssText)
    const parentStyle = normalizeStyle(parent.style.cssText)
    if (spanStyle && spanStyle === parentStyle) {
      while (span.firstChild) parent.insertBefore(span.firstChild, span)
      parent.removeChild(span)
    }
  }
}

function renameTags(root: HTMLElement): void {
  const mapping: Record<string, string> = {
    STRONG: 'B',
    EM: 'I',
    DEL: 'S',
    STRIKE: 'S',
  }
  for (const [from, to] of Object.entries(mapping)) {
    const nodes = root.querySelectorAll(from.toLowerCase())
    nodes.forEach((node) => {
      const newEl = document.createElement(to.toLowerCase())
      while (node.firstChild) newEl.appendChild(node.firstChild)
      // 保留内联样式(如 <span style="color:red"> 内包含 <strong>)
      if ((node as HTMLElement).style?.cssText) {
        newEl.setAttribute('style', (node as HTMLElement).style.cssText)
      }
      node.parentNode?.replaceChild(newEl, node)
    })
  }
}

function removeEmptyInlineTags(root: HTMLElement): void {
  // 反复剥离空 inline 标签
  const inlineTags = ['B', 'I', 'U', 'S', 'SPAN', 'SUP', 'SUB', 'FONT']
  for (let i = 0; i < 5; i++) {
    let changed = false
    for (const tag of inlineTags) {
      const nodes = Array.from(root.querySelectorAll(tag.toLowerCase()))
      for (const node of nodes) {
        if (!node.textContent && !node.querySelector('img')) {
          node.parentNode?.removeChild(node)
          changed = true
        }
      }
    }
    if (!changed) break
  }
}

function unwrapNestedSameTag(root: HTMLElement): void {
  // <b><b>x</b></b> → <b>x</b>
  // 注意:只 unwrap 直接子节点的同名标签
  const samePairs: Array<[string, string]> = [
    ['b', 'b'], ['i', 'i'], ['u', 'u'], ['s', 's'],
  ]
  for (const [outer, inner] of samePairs) {
    const outers = Array.from(root.querySelectorAll(outer))
    for (const out of outers) {
      // 找直接子节点中所有同名标签
      const inners = Array.from(out.children).filter(
        (c) => c.tagName.toLowerCase() === inner,
      )
      for (const inEl of inners) {
        // 把 inEl 的子节点移到 out 后面(把 inEl 从 DOM 中移除)
        const parent = inEl.parentNode
        if (!parent) continue
        while (inEl.firstChild) parent.insertBefore(inEl.firstChild, inEl)
        parent.removeChild(inEl)
      }
    }
  }
}

function mergeAdjacentSameSpan(root: HTMLElement): void {
  // 合并相邻的相同属性 span
  const spans = Array.from(root.querySelectorAll('span'))
  for (const span of spans) {
    // 跳过空白文本节点找到下一个兄弟
    let next = span.nextSibling
    while (next && next.nodeType === Node.TEXT_NODE && next.textContent?.trim() === '') {
      next = next.nextSibling
    }
    if (!next || next.nodeType !== Node.ELEMENT_NODE) continue
    const nextEl = next as HTMLElement
    if (nextEl.tagName !== 'SPAN') continue
    // 比较全部关键样式（v19: 增加 fontWeight/fontStyle/textDecoration）
    if (
      span.style.color === nextEl.style.color &&
      span.style.fontSize === nextEl.style.fontSize &&
      span.style.fontFamily === nextEl.style.fontFamily &&
      span.style.fontWeight === nextEl.style.fontWeight &&
      span.style.fontStyle === nextEl.style.fontStyle &&
      span.style.textDecoration === nextEl.style.textDecoration
    ) {
      // 把 nextEl 的内容移到 span 中,然后移除 nextEl
      while (nextEl.firstChild) span.appendChild(nextEl.firstChild)
      nextEl.remove()
    }
  }
}

// ============================================================
// 公共工具
// ============================================================

/**
 * 判断图片 src 是否为"不可达"（不能直接用于 NGA 论坛的图片 src）
 * NGA 不接受以下情况，导出时统一替换为占位符：
 *   - base64 data URL（`data:image/...` 或含 `;base64,`）
 *   - local:// 协议（本应用上一版本的本地保存协议，NGA 论坛无法访问）
 *   - file:// 协议（操作系统文件协议，NGA 论坛无法访问）
 *   - Windows 绝对路径（如 `C:\foo\bar.png` 或 `C:/foo/bar.png`）
 *   - Unix 绝对路径（如 `/home/user/image.png`）
 */
function isUnreachableImage(src: string): boolean {
  if (!src) return false;
  return (
    /^data:image\//i.test(src) ||        // base64 data URL
    /;base64,/i.test(src) ||              // 含 base64 标识
    /^local:\/\//i.test(src) ||          // 本应用上一版保存协议
    /^file:\/\//i.test(src) ||            // OS 文件协议
    /^[a-zA-Z]:[\\/]/.test(src) ||        // Windows 绝对路径（C:\ / D:/ 等）
    /^\/[^\/]/.test(src)                  // Unix 绝对路径（/开头且第二字符不是 /）
  );
}

// ============================================================
// 合并连续相同的 BBCode tag（避免 [color=x][color=x]...[/color][/color] 无效嵌套）
// 输入形如：  [color=red]aaa[/color][color=red]bbb[/color] [size=150%]xxx[/size][size=150%]yyy[/size]
// 输出形如：  [color=red]aaabbb[/color]                    [size=150%]xxxyyy[/size]
// 规则：相邻且 tag 名+参数完全一致则合并（只处理 color/size/font 三个属性 tag）
// ============================================================
function collapseBbCode(input: string): string {
  // 按行处理（避免跨行合并破坏结构）
  const lines = input.split('\n');
  for (let i = 0; i < lines.length; i++) {
    lines[i] = collapseLine(lines[i]);
  }
  // 整段级别跨行相邻同 tag 合并
  // 先把所有行拼回再合并
  let joined = lines.join('\n');
  // 跨行合并（无属性 + 有属性），多次迭代直到稳定
  let prev = '';
  let guard = 0;
  while (prev !== joined && guard++ < 20) {
    prev = joined;
    joined = mergeAdjacentSameTagNoAttrAcrossLines(joined, 'b');
    joined = mergeAdjacentSameTagNoAttrAcrossLines(joined, 'i');
    joined = mergeAdjacentSameTagNoAttrAcrossLines(joined, 'u');
    joined = mergeAdjacentSameTagNoAttrAcrossLines(joined, 'del');
    joined = mergeAdjacentSameTagNoAttrAcrossLines(joined, 'sup');
    joined = mergeAdjacentSameTagNoAttrAcrossLines(joined, 'sub');
    joined = mergeAdjacentSameTagNoAttrAcrossLines(joined, 'quote');
    joined = mergeAdjacentSameTagAcrossLines(joined, 'color');
    joined = mergeAdjacentSameTagAcrossLines(joined, 'size');
    joined = mergeAdjacentSameTagAcrossLines(joined, 'font');
    joined = mergeAdjacentSameTagAcrossLines(joined, 'align');
    // 跨行被覆盖的嵌套展开
    joined = unwrapOverriddenNested(joined, 'color');
    joined = unwrapOverriddenNested(joined, 'size');
    joined = unwrapOverriddenNested(joined, 'font');
  }
  // v17 修复：清理错配的闭标签（[b]xxx[/b][/i] → [b]xxx[/b]）
  // 注意：必须在整段级别执行（按行执行会把 [code]\n...\n[/code] 这种跨行配对的闭标签误删）
  joined = stripOrphanCloseTags(joined);
  return joined;
}

/**
 * 工具栏支持的 BBCode 标签白名单。
 * 不在白名单内的 [xxx]...[/xxx] 标签会被当成普通文本（[ ] 转义为字面字符）。
 */
const SUPPORTED_BBCODE_TAGS = new Set([
  'b', 'i', 'u', 'del', 's', 'sup', 'sub',
  'color', 'size', 'font', 'align',
  'url', 'img', 'quote', 'collapse', 'code',
  'list', '*', 'table', 'tr', 'td', 'th',
  'h', 'hr', 'br',
]);

/**
 * 防御性兜底：将工具栏不支持的 BBCode 标签转义为普通文本。
 * 仅处理形如 [tag] 或 [tag=val] 的标签头/尾，不影响正文中的 [xxx] 字面文本（无匹配闭标签的）。
 * 已知支持的标签会被原样保留。
 */
function escapeUnsupportedBbCode(input: string): string {
  // 匹配 [tag] 或 [tag=val] 或 [/tag] 形式的标签
  return input.replace(/\[\/?([a-zA-Z]+)(=[^\]]+)?\]/g, (full, tagName) => {
    if (SUPPORTED_BBCODE_TAGS.has(tagName.toLowerCase())) {
      return full; // 支持的标签，原样保留
    }
    // 不支持的标签，转义为字面文本
    return full.replace(/\[/g, '&#91;').replace(/\]/g, '&#93;');
  });
}

function collapseLine(line: string): string {
  if (!line) return line;
  // 多趟迭代直到稳定（每次至少合并一对）
  let prev = '';
  let cur = line;
  let guard = 0;
  while (prev !== cur && guard++ < 50) {
    prev = cur;
    // 有属性标签合并（color/size/font/align）
    cur = mergeAdjacentSameTag(cur, 'color');
    cur = mergeAdjacentSameTag(cur, 'size');
    cur = mergeAdjacentSameTag(cur, 'font');
    cur = mergeAdjacentSameTag(cur, 'align');
    // 跨行有属性相邻同 tag 合并（[color=red]X[/color]\n[color=red]Y[/color]）
    cur = mergeAdjacentSameTagAcrossLines(cur, 'color');
    cur = mergeAdjacentSameTagAcrossLines(cur, 'size');
    cur = mergeAdjacentSameTagAcrossLines(cur, 'font');
    cur = mergeAdjacentSameTagAcrossLines(cur, 'align');
    // 无属性标签合并（b/i/u/del/sup/sub/quote）
    cur = mergeAdjacentSameTagNoAttr(cur, 'b');
    cur = mergeAdjacentSameTagNoAttr(cur, 'i');
    cur = mergeAdjacentSameTagNoAttr(cur, 'u');
    cur = mergeAdjacentSameTagNoAttr(cur, 'del');
    cur = mergeAdjacentSameTagNoAttr(cur, 'sup');
    cur = mergeAdjacentSameTagNoAttr(cur, 'sub');
    cur = mergeAdjacentSameTagNoAttr(cur, 'quote');
    // 跨行相邻同 tag 合并（[b]X[/b]\n[b]Y[/b] → [b]X\nY[/b]）
    cur = mergeAdjacentSameTagNoAttrAcrossLines(cur, 'b');
    cur = mergeAdjacentSameTagNoAttrAcrossLines(cur, 'i');
    cur = mergeAdjacentSameTagNoAttrAcrossLines(cur, 'u');
    cur = mergeAdjacentSameTagNoAttrAcrossLines(cur, 'del');
    cur = mergeAdjacentSameTagNoAttrAcrossLines(cur, 'sup');
    cur = mergeAdjacentSameTagNoAttrAcrossLines(cur, 'sub');
    cur = mergeAdjacentSameTagNoAttrAcrossLines(cur, 'quote');
    // 冗余嵌套展开（[b][b]X[/b][/b] → [b]X[/b]）
    cur = unwrapRedundantNested(cur, 'b');
    cur = unwrapRedundantNested(cur, 'i');
    cur = unwrapRedundantNested(cur, 'u');
    cur = unwrapRedundantNested(cur, 'del');
    cur = unwrapRedundantNested(cur, 'color');
    cur = unwrapRedundantNested(cur, 'size');
    cur = unwrapRedundantNested(cur, 'font');
    cur = unwrapRedundantNested(cur, 'align');
    cur = unwrapRedundantNested(cur, 'sup');
    cur = unwrapRedundantNested(cur, 'sub');
    cur = unwrapRedundantNested(cur, 'quote');
    cur = unwrapRedundantNested(cur, 'collapse');
    cur = unwrapRedundantNested(cur, 'code');
    // 被覆盖的嵌套展开（[size=150%][size=120%]X[/size][/size] → [size=120%]X[/size]）
    cur = unwrapOverriddenNested(cur, 'color');
    cur = unwrapOverriddenNested(cur, 'size');
    cur = unwrapOverriddenNested(cur, 'font');
    // 深度冗余嵌套展开（[b][i][b]X[/b][/i][/b] → [b][i]X[/i][/b]）
    cur = unwrapDeepRedundant(cur, 'b');
    cur = unwrapDeepRedundant(cur, 'i');
    cur = unwrapDeepRedundant(cur, 'u');
    cur = unwrapDeepRedundant(cur, 'del');
    cur = unwrapDeepRedundant(cur, 'color');
    cur = unwrapDeepRedundant(cur, 'size');
    cur = unwrapDeepRedundant(cur, 'font');
    cur = unwrapDeepRedundant(cur, 'align');
    cur = unwrapDeepRedundant(cur, 'sup');
    cur = unwrapDeepRedundant(cur, 'sub');
    cur = unwrapDeepRedundant(cur, 'quote');
    cur = unwrapDeepRedundant(cur, 'collapse');
    cur = unwrapDeepRedundant(cur, 'code');
    // 清理内层空标签（[b][color=red][/color]X[/b] → [b]X[/b]），下一轮会清掉整体空
    cur = cleanEmptyInnerTags(cur);
  }
  // 清除空 tag（[b][/b] / [color=red][/color] / [quote][/quote] 等）
  // 无属性空标签
  cur = cur.replace(/\[(b|i|u|del|sup|sub|quote|code)\]\s*\[\/\1\]/g, '');
  // 有属性空标签（含带换行的空内容）
  cur = cur.replace(/\[(color|size|font|align|collapse|url)=[^\]]+\]\s*\[\/\1\]/g, '');
  // 空列表/表格（[h][/h] 是分割线的有效写法，不清除）
  cur = cur.replace(/\[list(=\d+)?\]\s*\[\/list\1?\]/g, '');
  cur = cur.replace(/\[table\]\s*\[\/table\]/g, '');
  // v17 修复：多轮迭代清空空标签对（解决 [i][u][/u][/i] 这种嵌套空标签）
  cur = collapseAllEmptyTags(cur);
  return cur;
}

/**
 * v17：反复剥离所有空标签对（多轮迭代直到稳定）。
 * 解决 [i][u][/u][/i] 这种"内层 [u][/u] 清掉后外层 [i][/i] 变空"需要 2 轮清理的场景。
 */
function collapseAllEmptyTags(input: string): string {
  let prev = '';
  let cur = input;
  let guard = 0;
  const reEmptyNoAttr = /\[(b|i|u|del|sup|sub|quote|code)\]\s*\[\/\1\]/g;
  const reEmptyAttr = /\[(color|size|font|align|collapse|url)=[^\]]+\]\s*\[\/\1\]/g;
  while (prev !== cur && guard++ < 20) {
    prev = cur;
    cur = cur.replace(reEmptyNoAttr, '');
    cur = cur.replace(reEmptyAttr, '');
  }
  return cur;
}

/**
 * v17：删除没有匹配开标签的闭标签 [/tag]。
 * 解决 [b]xxx[/b][/i] 这种由 HTML 解析阶段脏 DOM 产生的错配闭标签。
 * 跨整段统计开闭标签（不是逐行），避免 [collapse=...]\nX\n[/collapse] 这种
 * 跨行配对的闭标签被误删。
 */
function stripOrphanCloseTags(input: string): string {
  const tags = [
    'b', 'i', 'u', 'del', 'sup', 'sub',
    'color', 'size', 'font', 'align', 'quote', 'collapse', 'code',
  ];
  for (const tag of tags) {
    const openRe = new RegExp(`\\[${tag}(=[^\\]]+)?\\]`, 'g');
    const opens = (input.match(openRe) || []).length;
    const closeRe = new RegExp(`\\[\\/${tag}\\]`, 'g');
    const closes = (input.match(closeRe) || []).length;
    if (closes > opens) {
      // 从右往左删除多余的闭标签
      let extra = closes - opens;
      const re = new RegExp(`\\[\\/${tag}\\]`, 'g');
      input = input.replace(re, (m) => {
        if (extra > 0) { extra--; return ''; }
        return m;
      });
    }
  }
  return input;
}

function mergeAdjacentSameTag(input: string, tag: string): string {
  // 模式：直接相邻的 [tag=val]X[/tag][tag=val]Y[/tag] → [tag=val]XY[/tag]
  // 注意 body X/Y 内部可能含有其他 tag，需要递归
  const re = new RegExp(`\\[${tag}=([^\\[\\]]+)\\]([\\s\\S]*?)\\[\\/${tag}\\]\\[${tag}=\\1\\]([\\s\\S]*?)\\[\\/${tag}\\]`, 'g');
  return input.replace(re, (_m, val, body1, body2) => `[${tag}=${val}]${body1}${body2}[/${tag}]`);
}

/** 合并无属性标签的相邻同标签（[b]X[/b][b]Y[/b] → [b]XY[/b]） */
function mergeAdjacentSameTagNoAttr(input: string, tag: string): string {
  const re = new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, 'g');
  return input.replace(re, (_m, body1, body2) => `[${tag}]${body1}${body2}[/${tag}]`);
}

/** 展开冗余嵌套（[b][b]X[/b][/b] → [b]X[/b]），支持有属性和无属性 */
function unwrapRedundantNested(input: string, tag: string): string {
  // 无属性：[tag][tag]X[/tag][/tag] → [tag]X[/tag]（允许开标签间有换行/空白）
  const reNoAttr = new RegExp(`\\[${tag}\\][\\s]*\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\][\\s]*\\[\\/${tag}\\]`, 'g');
  let result = input.replace(reNoAttr, (_m, body) => `[${tag}]${body}[/${tag}]`);
  // 有属性：[tag=val][tag=val]X[/tag][/tag] → [tag=val]X[/tag]（允许开标签间有换行/空白）
  const reAttr = new RegExp(`\\[${tag}=([^\\[\\]]+)\\][\\s]*\\[${tag}=\\1\\]([\\s\\S]*?)\\[\\/${tag}\\][\\s]*\\[\\/${tag}\\]`, 'g');
  result = result.replace(reAttr, (_m, val, body) => `[${tag}=${val}]${body}[/${tag}]`);
  return result;
}

/**
 * 展开被覆盖的嵌套（[size=150%][size=120%]X[/size][/size] → [size=120%]X[/size]）
 * 当外层标签体完全被内层同标签（不同属性值）占据时，外层被内层覆盖，移除外层。
 * 只匹配外层开标签和内层开标签之间仅有空白的情况，确保外层没有其他文本内容。
 */
function unwrapOverriddenNested(input: string, tag: string): string {
  const re = new RegExp(
    `\\[${tag}=([^\\[\\]]+)\\]\\s*\\[${tag}=([^\\[\\]]+)\\]([\\s\\S]*?)\\[\\/${tag}\\]\\s*\\[\\/${tag}\\]`,
    'g',
  );
  return input.replace(re, (_m, _val1, val2, body) => `[${tag}=${val2}]${body}[/${tag}]`);
}

/**
 * 跨行相邻无属性同 tag 合并（[b]X[/b]\n[b]Y[/b] → [b]X\nY[/b]）
 * 已有的 mergeAdjacentSameTagNoAttr 只处理 ]\[ 直接相邻，这里补充跨空白/换行场景
 */
function mergeAdjacentSameTagNoAttrAcrossLines(input: string, tag: string): string {
  // 捕获中间的所有空白（包含换行）并保留到结果中
  const re = new RegExp(
    `\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\](\\s*)\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`,
    'g',
  );
  return input.replace(re, (_m, b1, gap, b2) => `[${tag}]${b1}${gap}${b2}[/${tag}]`);
}

/**
 * 跨行相邻有属性同 tag 合并（[color=red]X[/color]\n[color=red]Y[/color] → [color=red]X\nY[/color]）
 */
function mergeAdjacentSameTagAcrossLines(input: string, tag: string): string {
  const re = new RegExp(
    `\\[${tag}=([^\\[\\]]+)\\]([\\s\\S]*?)\\[\\/${tag}\\](\\s*)\\[${tag}=\\1\\]([\\s\\S]*?)\\[\\/${tag}\\]`,
    'g',
  );
  return input.replace(re, (_m, val, b1, gap, b2) => `[${tag}=${val}]${b1}${gap}${b2}[/${tag}]`);
}

/**
 * 深度冗余嵌套展开（[b][i][b]X[/b][/i][/b] → [b][i]X[/i][/b]）
 * 递归处理跨任意中间 tag 的同名嵌套，逐层剥开最内层。
 *
 * v16 修复：用负向前瞻确保 inner 不含任何同名开/闭标签，
 * 使正则只匹配最内层的冗余对，避免从左匹配最外层导致内层永远无法清理的问题。
 */
function unwrapDeepRedundant(input: string, tag: string): string {
  let prev = '';
  let cur = input;
  let guard = 0;

  while (prev !== cur && guard++ < 50) {
    prev = cur;

    // 无属性：[tag]<pre>[tag]inner[/tag]<post>[/tag] → [tag]<pre>inner<post>[/tag]
    // inner 必须是「最内层」——用负向前瞻确保 inner 不含同名开/闭标签
    const reNoAttr = new RegExp(
      `\\[${tag}\\]` +
        `([\\s\\S]*?)` +
        `\\[${tag}\\]((?:(?!\\[${tag}\\]|\\[\\/${tag}\\])[\\s\\S])*)\\[\\/${tag}\\]` +
        `([\\s\\S]*?)` +
        `\\[\\/${tag}\\]`,
      'g',
    );
    cur = cur.replace(reNoAttr, (_m, pre, inner, post) => {
      return `[${tag}]${pre}${inner}${post}[/${tag}]`;
    });

    // 有属性：[tag=val]<pre>[tag=val]inner[/tag]<post>[/tag] → [tag=val]<pre>inner<post>[/tag]
    const reAttr = new RegExp(
      `\\[${tag}=([^\\[\\]]+)\\]` +
        `([\\s\\S]*?)` +
        `\\[${tag}=\\1\\]((?:(?!\\[${tag}=|\\[\\/${tag}\\])[\\s\\S])*)\\[\\/${tag}\\]` +
        `([\\s\\S]*?)` +
        `\\[\\/${tag}\\]`,
      'g',
    );
    cur = cur.replace(reAttr, (_m, val, pre, inner, post) => {
      return `[${tag}=${val}]${pre}${inner}${post}[/${tag}]`;
    });
  }
  return cur;
}

/**
 * 清理内层空标签（[b][color=red][/color]X[/b] → [b]X[/b]）。
 * 多趟迭代直到稳定：外层因此变空时由外层清空 pass 进一步处理。
 * 注意：不清除外层本身，只清理 body 中的空子标签。
 */
function cleanEmptyInnerTags(input: string): string {
  let prev = '';
  let cur = input;
  let guard = 0;
  while (prev !== cur && guard++ < 20) {
    prev = cur;
    // 匹配 [tag attr]body[/tag]，如果 body 全部由空标签 + 空白组成，则把空标签全部移除
    cur = cur.replace(
      /\[(b|i|u|del|sup|sub|quote|code|color|size|font|align|collapse|url)\b([^\]]*)\]([\s\S]*?)\[\/\1\]/g,
      (_m, tag, attr, body) => {
        // 反复剥离 body 中的空标签
        let cleaned = body;
        let prevCleaned = '';
        let innerGuard = 0;
        while (prevCleaned !== cleaned && innerGuard++ < 20) {
          prevCleaned = cleaned;
          cleaned = cleaned.replace(
            /\[(b|i|u|del|sup|sub|quote|code|color|size|font|align|collapse|url)\b([^\]]*)\]\s*\[\/\1\]/g,
            '',
          );
        }
        // 如果清理后 body 完全是空白，则整体空 → 返回空串（让外层空标签清理删除这个外层）
        if (!cleaned.trim()) return '';
        // 如果清理后 body 全部是空白，则保留外层但 body 只有空白
        if (!cleaned.replace(/\s+/g, '').length) {
          return `[${tag}${attr}][/${tag}]`;
        }
        return `[${tag}${attr}]${cleaned}[/${tag}]`;
      },
    );
  }
  return cur;
}


// ============================================================
// 块级处理：按块元素一行一行输出
// ============================================================

/**
 * 自定义 trim：只裁掉普通空格（U+0020）、\t、\n、\r，保留 U+00A0（&nbsp;）
 * 原生 trim() 会裁掉 U+00A0，导致行首 &nbsp; 缩进丢失
 */
function trimLineKeepNbsp(s: string): string {
  return s.replace(/^[\u0020\t\r\n]+/, '').replace(/[\u0020\t\r\n]+$/, '');
}

function processBlockChildren(container: Node): string[] {
  const lines: string[] = [];
  const hasBlockChild = containsBlockChild(container);
  if (!hasBlockChild) {
    // 纯内联内容（没有 p/div 等块级元素）：整段作为一行
    const line = processInlineChildren(container as HTMLElement);
    const trimmed = trimLineKeepNbsp(line);
    lines.push(trimmed);  // v7: 保留空行（不过滤空字符串）
    return lines;
  }

  // 遍历子节点，把连续的文本+内联元素聚合成 inline run
  const inlineRunNodes: Node[] = [];
  const flushInlineRun = () => {
    if (inlineRunNodes.length === 0) return;
    // 用临时 div 包裹 inline run，调 processInlineChildren
    const tmp = document.createElement('div');
    inlineRunNodes.forEach((n) => tmp.appendChild(n.cloneNode(true)));
    const line = processInlineChildren(tmp);
    const trimmed = trimLineKeepNbsp(line);
    lines.push(trimmed);  // v7: 保留空行（不过滤空字符串）
    inlineRunNodes.length = 0;
  };

  for (let i = 0; i < container.childNodes.length; i++) {
    const child = container.childNodes[i];
    if (child.nodeType === 3) {
      // 文本节点：加入 inline run
      inlineRunNodes.push(child);
    } else if (child.nodeType === 1) {
      const el = child as HTMLElement;
      if (isInlineElement(el)) {
        // 内联元素：加入 inline run
        inlineRunNodes.push(el);
      } else {
        // 块元素：先 flush inline run，再处理块
        flushInlineRun();
        const res = processBlockElement(el);
        for (const r of res) lines.push(r);  // v7: 保留空行（不过滤空字符串）
      }
    }
  }
  flushInlineRun();
  return lines;
}

/** 判断是否为内联元素（无自定义块 data-type 且 tag 在内联集合中） */
function isInlineElement(el: HTMLElement): boolean {
  const dt = el.dataset?.type;
  if (dt === 'dice-card' || dt === 'image-block' || dt === 'collapse-block' || dt === 'quote-block' || dt === 'quote-line' || dt === 'table-block') {
    return false; // 自定义块
  }
  const tag = el.tagName.toLowerCase();
  return ['b','i','u','del','s','strong','em','strike','span','a','img','sup','sub','br','font','mark','code','small'].includes(tag);
}

function containsBlockChild(container: Node): boolean {
  for (let i = 0; i < container.childNodes.length; i++) {
    const child = container.childNodes[i];
    if (child.nodeType === 1) {
      const el = child as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'pre', 'table', 'hr', 'blockquote'].includes(tag)) {
        return true;
      }
      const dt = el.dataset?.type;
      if (dt === 'dice-card' || dt === 'image-block' || dt === 'collapse-block' || dt === 'quote-line' || dt === 'table-block') return true;
      // 后备：通过类名识别（data-type 被浏览器 drag/drop 剥离时使用）
      if (tag === 'div' && el.querySelector('.collapse-head')) return true;
      if (tag === 'div' && el.querySelector('.dice-card')) return true;
    }
  }
  return false;
}

function processBlockElement(el: HTMLElement): string[] {
  const dt = el.dataset?.type;
  const tag = el.tagName.toLowerCase();

  // 收集安科 v1.0 兼容：<div class="anke-section"> 仅作包装，展开其子节点递归处理。
  // 必须放在 collapse-block 后备匹配之前（anke-section 可能包裹 collapse-block，
  // 内部含 .collapse-head/.collapse-title/.collapse-body，会被后备误识别成 collapse-block）。
  if (tag === 'div' && el.classList.contains('anke-section')) {
    return processBlockChildren(el);
  }

  if (dt === 'dice-card') return processDiceCard(el);
  if (dt === 'image-block') return processImageBlock(el);
  if (dt === 'collapse-block') return processCollapseBlock(el);
  if (dt === 'quote-block' || dt === 'quote-line' || el.classList?.contains('quote-line')) return processQuoteLine(el);
  if (dt === 'table-block') {
    // 表格包装 div：递归找内部 table
    const inner = el.querySelector('table');
    if (inner) return processTable(inner as HTMLElement);
    return [];
  }
  // 后备：即使 data-type 被浏览器 drag/drop 剥离，也能通过内部结构识别
  if (tag === 'div' && el.querySelector('.collapse-head') && (el.querySelector('.collapse-title') || el.querySelector('.collapse-body'))) {
    return processCollapseBlock(el);
  }
  if (tag === 'div' && el.querySelector('.dice-card')) {
    const inner = el.querySelector('.dice-card') as HTMLElement;
    if (inner) return processDiceCard(inner);
  }
  // 普通 <blockquote> 元素也按引用处理（兼容 contenteditable 浏览器自动生成的 blockquote）

  if (tag === 'ul') return processList(el, '[list]');
  if (tag === 'ol') return processList(el, '[list=1]');
  if (tag === 'pre' && el.classList?.contains('code-block')) {
    // 保留所有换行（不 trim）—— 用户多行代码块不能被压缩成一行
    const raw = (el.textContent || '').replace(/\r\n?/g, '\n');
    return ['[code]', raw, '[/code]'];
  }
  if (tag === 'table') return processTable(el);
  if (tag === 'hr') return ['[h][/h]'];

  if (tag === 'blockquote') return processQuoteLine(el);

  // 普通块（p/div/h1-6）
  // 如果包含块级子元素（如 ul/ol/dice-card 等），递归处理
  if (containsBlockChild(el)) {
    return processBlockChildren(el);
  }

  const inner = processInlineChildren(el);
  const trimmedInner = trimLineKeepNbsp(inner);
  if (!trimmedInner) return [''];  // v7: 空块保留为空行（不丢弃）

  const textAlign = el.style.textAlign?.toLowerCase() || '';
  if (textAlign && textAlign !== 'left' && textAlign !== 'justify') {
    // v6 修复：如果 inner 已被相同 align 包裹（开头+结尾匹配），不再重复包裹
    const alignOpen = `[align=${textAlign}]`;
    const alignClose = '[/align]';
    if (trimmedInner.startsWith(alignOpen) && trimmedInner.endsWith(alignClose)) {
      return [trimmedInner];
    }
    return [`[align=${textAlign}]${trimmedInner}[/align]`];
  }
  return [trimmedInner];
}

// ============================================================
// 内联处理：b/i/u/del/sup/sub/a/img/span
// ============================================================
function processInlineChildren(el: Node): string {
  let out = '';
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes[i];
    if (child.nodeType === 3) out += (child as Text).textContent || '';
    else if (child.nodeType === 1) out += processInlineElement(child as HTMLElement);
  }
  return out;
}

function processInlineElement(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();

  // Returns true if el has exactly one child element whose tag is in `sameTags`,
  // OR whose parseSpanStyle output contains the same bbTag (indirect nesting via styled span).
  // 例：<b><span style="font-weight:bold">X</span></b> → parseSpanStyle 产出含 [b] → 去重
  const hasSingleChildWithTag = (sameTags: string[]): boolean => {
    if (el.childNodes.length !== 1) return false;
    const child = el.childNodes[0];
    if (child.nodeType !== 1) return false;
    const childEl = child as HTMLElement;
    const childTag = childEl.tagName.toLowerCase();
    // 直接同名标签：[b][b]X[/b][/b]
    if (sameTags.includes(childTag)) return true;
    // 间接：唯一子是 span 且其 style 会产出相同 bbTag
    if (childTag === 'span') {
      const childStyle = parseSpanStyle(childEl);
      if (childStyle.open.includes(`[${sameTags[0]}]`)) return true;
    }
    return false;
  };

  // 内联标签自身带 style 时，提取样式并去重（避免 [b][b]x[/b][/b]）。
  // 顺序：[tag] 在外，styleWrap 在内（如 <b style="color:red">x</b> → [b][color=red]x[/color][/b]）。
  // 若 styleWrap 已含相同 tag（来自 font-weight/font-style/text-decoration），则去重不再加 [tag]。
  const wrapInlineWithStyle = (bbTag: string, sameTags: string[]): string => {
    const styleWrap = parseSpanStyle(el);
    const inner = processInlineChildren(el);
    const tagOpen = `[${bbTag}]`;
    const tagClose = `[/${bbTag}]`;
    if (hasSingleChildWithTag(sameTags)) {
      return `${styleWrap.open}${inner}${styleWrap.close}`;
    }
    if (styleWrap.open.includes(tagOpen)) {
      return `${styleWrap.open}${inner}${styleWrap.close}`;
    }
    return `${tagOpen}${styleWrap.open}${inner}${styleWrap.close}${tagClose}`;
  };

  if (tag === 'b' || tag === 'strong') return wrapInlineWithStyle('b', ['b', 'strong']);
  if (tag === 'i' || tag === 'em') return wrapInlineWithStyle('i', ['i', 'em']);
  if (tag === 'u') return wrapInlineWithStyle('u', ['u']);
  if (tag === 's' || tag === 'strike' || tag === 'del') return wrapInlineWithStyle('del', ['s', 'strike', 'del']);
  if (tag === 'sup') return wrapInlineWithStyle('sup', ['sup']);
  if (tag === 'sub') return wrapInlineWithStyle('sub', ['sub']);
  if (tag === 'br') return '\n';
  if (tag === 'a') {
    const href = el.getAttribute('href') || '';
    const text = processInlineChildren(el) || href;
    return href ? `[url=${href}]${text}[/url]` : text;
  }
  if (tag === 'img') {
    // v35: 优先读 data-original-src，防止 base64 兜底污染 src 后丢失原始 URL
    const src = el.getAttribute('data-original-src') || el.getAttribute('src') || '';
    if (!src) return '';
    // NGA 不支持 base64 data URL 和 local:// 协议，替换为占位符
    if (isUnreachableImage(src)) {
      const altRaw = el.getAttribute('data-name') || el.getAttribute('alt') || '';
      const safeName = altRaw.length > 20 ? altRaw.slice(0, 20) + '…' : altRaw;
      const name = safeName || '本地图片';
      return `[本地图片：${name}（已用占位符替换）]`;
    }
    return `[img]${src}[/img]`;
  }
  if (tag === 'font') {
    const opens: string[] = [];
    const closes: string[] = [];
    const color = el.getAttribute('color');
    let colorOpen = '';
    if (color) {
      const ngaColor = cssColorToNga(color) || color;
      if (ngaColor && ngaColor !== NGA_DEFAULT_COLOR) {
        colorOpen = `[color=${ngaColor}]`;
      }
    }
    const size = el.getAttribute('size');
    let sizeOpen = '';
    if (size) {
      // HTML font size 1-7 映射到 NGA 百分比
      const sizeMap: Record<string, number> = { '1': 80, '2': 100, '3': 120, '4': 140, '5': 160, '6': 180, '7': 200 };
      const percent = sizeMap[size];
      if (percent && percent !== NGA_DEFAULT_FONT_SIZE) {
        sizeOpen = `[size=${percent}%]`;
      }
    }
    const face = el.getAttribute('face');
    let fontOpen = '';
    if (face) {
      const ngaFont = cssFontToNga(face) || face;
      if (ngaFont && ngaFont !== NGA_DEFAULT_FONT) {
        fontOpen = `[font=${ngaFont}]`;
      }
    }
    const inner = processInlineChildren(el);
    // v6 修复：检查 inner 是否已以相同标签开头（避免 font+span 双包裹重复）
    if (colorOpen && inner.startsWith(colorOpen)) {
      // inner 已有相同 color 标签，不再重复包裹
    } else if (colorOpen) {
      opens.push(colorOpen);
      closes.unshift('[/color]');
    }
    if (sizeOpen && inner.startsWith(sizeOpen)) {
      // inner 已有相同 size 标签
    } else if (sizeOpen) {
      opens.push(sizeOpen);
      closes.unshift('[/size]');
    }
    if (fontOpen && inner.startsWith(fontOpen)) {
      // inner 已有相同 font 标签
    } else if (fontOpen) {
      opens.push(fontOpen);
      closes.unshift('[/font]');
    }
    return `${opens.join('')}${inner}${closes.join('')}`;
  }
  if (tag === 'span') {
    // 内联引用 span
    if (el.classList.contains('inline-quote') || el.getAttribute('data-type') === 'quote') {
      const inner = processInlineChildren(el);
      if (!inner.trim()) return '';
      return `[quote]${inner}[/quote]`;
    }
    const { open, close } = parseSpanStyle(el);
    const inner = processInlineChildren(el);
    return open + inner + close;
  }
  return processInlineChildren(el);
}

// ============================================================
// 自定义节点处理
// ============================================================
function processDiceCard(el: HTMLElement): string[] {
  try {
    const payloadStr = el.getAttribute('data-payload') || '';
    if (!payloadStr) return [];
    const payload = JSON.parse(payloadStr);
    const result = renderDiceBlock(payload, { mark_hit: true });
    if (!result) return [];
    return [result];
  } catch {
    return [];
  }
}

function processImageBlock(el: HTMLElement): string[] {
  const size = el.getAttribute('data-size') || 'original';
  const imgEl = el.querySelector('img');
  // v35: 优先读 data-original-src，防止 base64 兜底污染 src 后丢失原始 URL
  const src = imgEl?.getAttribute('data-original-src') || imgEl?.getAttribute('src') || '';
  if (!src) return [];

  // NGA 不接受 base64 data URL、local://、file:// 和绝对路径，替换为占位符
  if (isUnreachableImage(src)) {
    // 优先 data-name（文件名），再 alt（可读名），截断防爆长
    const altRaw = imgEl?.getAttribute('data-name') || imgEl?.getAttribute('alt') || '';
    const safeName = altRaw.length > 20 ? altRaw.slice(0, 20) + '…' : altRaw;
    const name = safeName || '本地图片';
    return [`[本地图片：${name}（已用占位符替换）]`];
  }

  const sizeInfo = NGA_IMAGE_SIZES.find((s) => s.value === size);
  const sfx = sizeInfo?.suffix || '';
  if (!sfx) return [`[img]${src}[/img]`];

  // 在完整 URL 后面追加后缀（在查询字符串之前）
  // 例如 image.jpg → image.jpg.medium.jpg
  try {
    const urlObj = new URL(src);
    urlObj.pathname = urlObj.pathname + sfx;
    return [`[img]${urlObj.toString()}[/img]`];
  } catch {
    // 非 URL 格式（如 data: 或相对路径），简单追加
    const qIdx = src.indexOf('?');
    const hIdx = src.indexOf('#');
    let cut = src.length;
    if (qIdx >= 0) cut = Math.min(cut, qIdx);
    if (hIdx >= 0) cut = Math.min(cut, hIdx);
    const base = src.slice(0, cut);
    const rest = src.slice(cut);
    return [`[img]${base}${sfx}${rest}[/img]`];
  }
}

function processCollapseBlock(el: HTMLElement): string[] {
  const titleEl = el.querySelector<HTMLElement>('.collapse-title');
  const title = (titleEl?.textContent || el.getAttribute('data-title') || '折叠').trim();
  const bodyEl = el.querySelector('.collapse-body');
  const bodyContent = bodyEl ? processBlockChildren(bodyEl) : processBlockChildren(el);
  // v8: 保留空行（不 filter 空字符串），空内容兜底用 trim 判断
  const bodyBBCode = bodyContent.join('\n');
  // 空内容兜底：不输出空 collapse 标签对
  if (!bodyBBCode.trim()) return [];
  if (title) return [`[collapse=${title}]`, bodyBBCode, '[/collapse]'];
  return ['[collapse]', bodyBBCode, '[/collapse]'];
}

function processQuoteLine(el: HTMLElement): string[] {
  const inner = processBlockChildren(el);
  // v8: 保留空行（不 filter 空字符串）
  const body = inner.join('\n');
  // 空内容兜底：不输出空 quote 标签对
  if (!body.trim()) return [];
  return ['[quote]', body, '[/quote]'];
}

function processList(el: HTMLElement, openTag: string): string[] {
  const items: string[] = [];
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i] as HTMLElement;
    if (child.tagName.toLowerCase() === 'li') {
      // 检查 li 内部是否有块级子元素（骰子、折叠块、嵌套列表等）
      const hasBlockContent = containsBlockChild(child);
      if (hasBlockContent) {
        // 有块级内容：逐块处理
        const innerLines = processBlockChildren(child);
        // v8: 保留空行（只过滤 null/undefined，保留空字符串）
        const validLines = innerLines.filter((l) => l !== null && l !== undefined);
        // 全部为空字符串时跳过（避免输出纯空行的列表项）
        const hasContent = validLines.some((l) => l.trim());
        if (!hasContent) continue;
        if (validLines.length === 1) {
          // 单行内容：合并到 [*] 后
          items.push(`[*]${validLines[0].trim()}`);
        } else {
          // 多行内容：第一行 [*] 前缀，其余直接输出
          items.push(`[*]${validLines[0].trim()}`);
          for (let j = 1; j < validLines.length; j++) {
            items.push(validLines[j]);
          }
        }
      } else {
        // 纯内联内容
        const inner = processInlineChildren(child);
        // v8: 保留换行（不压缩 \s+ 为单空格），只裁首尾空白
        const trimmed = trimLineKeepNbsp(inner);
        if (trimmed) items.push(`[*]${trimmed}`);
      }
    }
  }
  // 空内容兜底：无 li 项时不输出空 list 标签对
  if (items.length === 0) return [];
  return [openTag, ...items, '[/list]'];
}

function processTable(el: HTMLElement): string[] {
  const rows = el.querySelectorAll('tr');
  // 空内容兜底：无行时不输出空 table 标签对
  if (rows.length === 0) return [];
  const lines: string[] = ['[table]'];
  rows.forEach((row) => {
    let line = '[tr]';
    const cells = row.querySelectorAll('td,th');
    cells.forEach((cell) => {
      // 取出单元格文本：保留 b/i/u 等行内 BBCode，空 cell 兜底为单个空格
      const inner = processInlineChildren(cell as HTMLElement).trim() || ' ';
      line += `[td]${inner}[/td]`;
    });
    line += '[/tr]';
    lines.push(line);
  });
  lines.push('[/table]');
  return lines;
}

// ============================================================
// span style 解析：颜色/字号/字体查表，只对非默认值加 tag
// ============================================================
function parseSpanStyle(el: HTMLElement): { open: string; close: string } {
  const tags: string[] = [];
  const closers: string[] = [];

  const rawColor = el.style.color;
  if (rawColor) {
    const ngaColor = cssColorToNga(rawColor);
    if (ngaColor && ngaColor !== NGA_DEFAULT_COLOR) {
      tags.push(`[color=${ngaColor}]`);
      closers.push('[/color]');
    }
  }

  const rawSize = el.style.fontSize;
  if (rawSize) {
    const pct = ptToSizePercent(rawSize);
    if (pct != null) {
      const nearest = nearestFontSize(pct);
      if (nearest) {
        // 自定义百分比（与最近档位差距 > 1）原值保留，不强制匹配
        const sizePercent = Math.abs(nearest.percent - pct) > 1 ? pct : nearest.percent;
        if (sizePercent !== NGA_DEFAULT_FONT_SIZE) {
          tags.push(`[size=${sizePercent}%]`);
          closers.push('[/size]');
        }
      }
    }
  }

  const rawFont = el.style.fontFamily;
  if (rawFont) {
    const ngaFont = cssFontToNga(rawFont);
    if (ngaFont && ngaFont !== NGA_DEFAULT_FONT) {
      tags.push(`[font=${ngaFont}]`);
      closers.push('[/font]');
    }
  }

  // font-weight（bold/700 等）→ [b]
  const fontWeight = el.style.fontWeight;
  if (fontWeight && fontWeight !== 'normal' && fontWeight !== '400') {
    tags.push('[b]');
    closers.push('[/b]');
  }

  // font-style（italic/oblique）→ [i]
  const fontStyle = el.style.fontStyle;
  if (fontStyle && fontStyle !== 'normal') {
    tags.push('[i]');
    closers.push('[/i]');
  }

  // text-decoration → [u] / [del]
  // v23 修复：用两个独立 if 而非 if-else，支持同时有下划线和删除线（如 underline line-through）
  const textDecoration = el.style.textDecoration;
  if (textDecoration) {
    if (textDecoration.includes('underline')) {
      tags.push('[u]');
      closers.push('[/u]');
    }
    if (
      textDecoration.includes('line-through') ||
      textDecoration.includes('strike')
    ) {
      tags.push('[del]');
      closers.push('[/del]');
    }
  }

  return { open: tags.join(''), close: closers.reverse().join('') };
}

// --- CSS color → NGA color name ---
export function cssColorToNga(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  if (!normalized || normalized === 'black' || normalized === '#000000' || normalized === '#000') return NGA_DEFAULT_COLOR;

  let hit = NGA_COLORS.find((c) => c.cssColor.toLowerCase() === normalized);
  if (hit) return hit.value;

  hit = NGA_COLORS.find((c) => c.value.toLowerCase() === normalized);
  if (hit) return hit.value;

  const rgbMatch = normalized.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    const hex = `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
    hit = NGA_COLORS.find((c) => c.cssColor.toLowerCase() === hex);
    if (hit) return hit.value;
  }

  const shortHexMatch = normalized.match(/^#([0-9a-f]{3})$/);
  if (shortHexMatch) {
    const h = shortHexMatch[1];
    const fullHex = `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    hit = NGA_COLORS.find((c) => c.cssColor.toLowerCase() === fullHex);
    if (hit) return hit.value;
  }

  return null;
}

// --- pt/px → 百分比（12pt = 100%）---
export function ptToSizePercent(raw: string): number | null {
  const m = raw.trim().match(/^([0-9.]+)\s*(pt|px|%)?/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (isNaN(value)) return null;
  const unit = (m[2] || 'pt').toLowerCase();
  if (unit === '%') return Math.round(value);
  if (unit === 'px') return Math.round((value * 100) / 16);
  return Math.round((value * 100) / 12);
}

export function nearestFontSize(pct: number): typeof NGA_FONT_SIZES[number] | null {
  if (!NGA_FONT_SIZES || NGA_FONT_SIZES.length === 0) return null;
  let best = NGA_FONT_SIZES[0];
  let minDist = Math.abs(best.percent - pct);
  for (let i = 1; i < NGA_FONT_SIZES.length; i++) {
    const d = Math.abs(NGA_FONT_SIZES[i].percent - pct);
    if (d < minDist) { best = NGA_FONT_SIZES[i]; minDist = d; }
  }
  return best;
}

// --- CSS font-family → NGA font value ---
export function cssFontToNga(raw: string): string | null {
  const family = raw.trim();
  if (!family) return null;

  const names = family.split(',').map((n) => n.trim().replace(/^["']|["']$/g, '').toLowerCase());

  for (const name of names) {
    const hit = NGA_FONTS.find((f) => f.value.toLowerCase() === name);
    if (hit) return hit.value;
  }
  for (const f of NGA_FONTS) {
    const cssClean = f.cssFamily.toLowerCase().replace(/["']/g, '').replace(/\s+/g, '');
    for (const name of names) {
      if (cssClean.includes(name.replace(/\s+/g, ''))) return f.value;
    }
  }
  return null;
}
