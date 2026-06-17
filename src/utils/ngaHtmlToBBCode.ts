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
    const lines = processBlockChildren(root);
    const out = lines.filter((l) => l !== null && l !== undefined).join('\n').trim();
    if (!out) return '';
    // 合并连续相同的 [color=*]/[size=*]/[font=*] 开闭 tag，去除无效嵌套
    const result = collapseBbCode(out + '\n');
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

// ============================================================
// 公共工具
// ============================================================

/**
 * 判断图片 src 是否为"不可达"（不能直接用于 NGA 论坛的图片 src）
 * NGA 不接受以下情况，导出时统一替换为占位符：
 *   - base64 data URL（`data:image/...` 或含 `;base64,`）
 *   - local:// 协议（本应用本地保存的图片，NGA 论坛无法访问）
 */
function isUnreachableImage(src: string): boolean {
  if (!src) return false;
  return (
    /^data:image\//i.test(src) ||      // base64 data URL
    /;base64,/i.test(src) ||            // 含 base64 标识
    /^local:\/\//i.test(src)            // 本地保存协议
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
  return lines.join('\n');
}

function collapseLine(line: string): string {
  if (!line) return line;
  // 多趟迭代直到稳定（每次至少合并一对）
  let prev = '';
  let cur = line;
  let guard = 0;
  while (prev !== cur && guard++ < 50) {
    prev = cur;
    cur = mergeAdjacentSameTag(cur, 'color');
    cur = mergeAdjacentSameTag(cur, 'size');
    cur = mergeAdjacentSameTag(cur, 'font');
  }
  return cur;
}

function mergeAdjacentSameTag(input: string, tag: string): string {
  // 模式：直接相邻的 [tag=val]X[/tag][tag=val]Y[/tag] → [tag=val]XY[/tag]
  // 注意 body X/Y 内部可能含有其他 tag，需要递归
  const re = new RegExp(`\\[${tag}=([^\\[\\]]+)\\]([\\s\\S]*?)\\[\\/${tag}\\]\\[${tag}=\\1\\]([\\s\\S]*?)\\[\\/${tag}\\]`, 'g');
  return input.replace(re, (_m, val, body1, body2) => `[${tag}=${val}]${body1}${body2}[/${tag}]`);
}

// ============================================================
// 块级处理：按块元素一行一行输出
// ============================================================
function processBlockChildren(container: Node): string[] {
  const lines: string[] = [];
  const hasBlockChild = containsBlockChild(container);
  if (!hasBlockChild) {
    // 纯内联内容（没有 p/div 等块级元素）：整段作为一行
    const line = processInlineChildren(container as HTMLElement);
    if (line.trim()) lines.push(line.trim());
    return lines;
  }
  for (let i = 0; i < container.childNodes.length; i++) {
    const child = container.childNodes[i];
    if (child.nodeType === 3) {
      const t = (child as Text).textContent || '';
      // 保留换行符，只压缩连续空格（不吞掉 \n）
      const trimmed = t.replace(/[^\S\n]+/g, ' ').trim();
      if (trimmed) lines.push(trimmed);
    } else if (child.nodeType === 1) {
      const res = processBlockElement(child as HTMLElement);
      for (const r of res) if (r) lines.push(r);
    }
  }
  return lines;
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
  if (!inner.trim()) return [];

  const textAlign = el.style.textAlign?.toLowerCase() || '';
  if (textAlign && textAlign !== 'left' && textAlign !== 'justify') {
    return [`[align=${textAlign}]${inner.trim()}[/align]`];
  }
  return [inner.trim()];
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
  if (tag === 'b' || tag === 'strong') return `[b]${processInlineChildren(el)}[/b]`;
  if (tag === 'i' || tag === 'em') return `[i]${processInlineChildren(el)}[/i]`;
  if (tag === 'u') return `[u]${processInlineChildren(el)}[/u]`;
  if (tag === 's' || tag === 'strike' || tag === 'del') return `[del]${processInlineChildren(el)}[/del]`;
  if (tag === 'sup') return `[sup]${processInlineChildren(el)}[/sup]`;
  if (tag === 'sub') return `[sub]${processInlineChildren(el)}[/sub]`;
  if (tag === 'br') return '';
  if (tag === 'a') {
    const href = el.getAttribute('href') || '';
    const text = processInlineChildren(el) || href;
    return href ? `[url=${href}]${text}[/url]` : text;
  }
  if (tag === 'img') {
    const src = el.getAttribute('src') || '';
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
  const src = imgEl?.getAttribute('src') || '';
  if (!src) return [];

  // NGA 不接受 base64 data URL 和 local:// 协议巨长字符串，替换为占位符
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
  const bodyBBCode = bodyContent.filter((l) => l).join('\n');
  if (title) return [`[collapse=${title}]`, bodyBBCode, '[/collapse]'];
  return ['[collapse]', bodyBBCode, '[/collapse]'];
}

function processQuoteLine(el: HTMLElement): string[] {
  const inner = processBlockChildren(el);
  return ['[quote]', inner.filter((l) => l).join('\n'), '[/quote]'];
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
        const validLines = innerLines.filter((l) => l && l.trim());
        if (validLines.length === 0) continue;
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
        const trimmed = inner.replace(/\s+/g, ' ').trim();
        if (trimmed) items.push(`[*]${trimmed}`);
      }
    }
  }
  return [openTag, ...items, '[/list]'];
}

function processTable(el: HTMLElement): string[] {
  const lines: string[] = ['[table]'];
  const rows = el.querySelectorAll('tr');
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
      if (nearest && nearest.percent !== NGA_DEFAULT_FONT_SIZE) {
        tags.push(`[size=${nearest.percent}%]`);
        closers.push('[/size]');
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
