// ============================================================
// contenteditable 富文本工具集 — 粘贴规范化
// ------------------------------------------------------------
// 职责：
//   - 从剪贴板 HTML 清洗出编辑器支持的安全内容
//     （白名单标签 + 白名单内联样式 + 危险/无关节点剥离）
//   - 提供纯文本插入（Ctrl+Shift+V / 无 HTML 时兜底）
// 参考 Quill / ProseMirror 的粘贴清洗思路：黑名单删除 + 白名单属性
// ============================================================

import { focusEditor, getInsertionRange, dispatchInput } from './selection';

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'BLOCKQUOTE', 'UL', 'OL', 'LI',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
  'PRE', 'CODE',
  'B', 'I', 'U', 'S', 'STRIKE', 'EM', 'STRONG',
  'SPAN', 'A', 'IMG', 'HR',
]);

const DROP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'TITLE',
  'HEAD', 'NOSCRIPT', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA',
  'VIDEO', 'AUDIO', 'SOURCE', 'CANVAS', 'SVG', 'MATH', 'FRAME', 'FRAMESET',
]);

/** 标签名 → 允许保留的属性白名单（其余属性一律剥离） */
const ATTR_WHITELIST: Record<string, Set<string>> = {
  A: new Set(['href']),
  IMG: new Set(['src', 'width', 'height']),
  TD: new Set(['colspan', 'rowspan']),
  TH: new Set(['colspan', 'rowspan']),
  OL: new Set(['start', 'type']),
};

/** span 内联样式白名单（与编辑器支持的样式范围一致） */
const STYLE_ALLOWLIST = new Set([
  'color', 'background-color', 'font-size', 'font-family',
  'font-weight', 'font-style', 'text-decoration',
]);

/** URL 安全性校验：剥离 javascript:/vbscript: 等危险协议 */
function isSafeUrl(url: string, allowDataImage: boolean): boolean {
  const u = (url || '').trim().toLowerCase();
  if (!u) return false;
  if (allowDataImage && u.startsWith('data:image/')) return true;
  if (u.startsWith('data:') && !allowDataImage) return false;
  if (u.startsWith('javascript:') || u.startsWith('vbscript:')) return false;
  if (u.startsWith('http:') || u.startsWith('https:') || u.startsWith('mailto:') || u.startsWith('tel:')) return true;
  if (/^[a-z]+:/i.test(u)) return false;
  return true; // 相对路径 / 锚点
}

/** 递归清洗 parent 的所有子节点 */
function sanitizeChildren(parent: Node): Node[] {
  const out: Node[] = [];
  for (const child of Array.from(parent.childNodes)) {
    const cleaned = sanitizeNode(child);
    if (cleaned == null) continue;
    if (Array.isArray(cleaned)) out.push(...cleaned);
    else out.push(cleaned);
  }
  return out;
}

/**
 * 清洗单个节点
 * - 返回 null：删除该节点（危险/无关标签）
 * - 返回 Node：保留（重建白名单副本）
 * - 返回 Node[]：解包为多个子节点（未知标签 / 无安全 href 的链接）
 */
function sanitizeNode(node: Node): Node | Node[] | null {
  if (node.nodeType === Node.TEXT_NODE) return node;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as HTMLElement;
  let tag = el.tagName;

  // 1) 危险/无关标签直接删除
  if (DROP_TAGS.has(tag)) return null;

  // 2) 编辑器内部原子块（图片/骰子/折叠块）→ 降级为纯文本
  //    避免粘贴出无法重新初始化的交互节点
  if (el.getAttribute('data-type')) {
    return document.createTextNode(el.textContent || '');
  }

  // 3) 标签归一化：strong→b、em→i、strike→s；div→p（统一段落模型）
  if (tag === 'STRONG') tag = 'B';
  if (tag === 'EM') tag = 'I';
  if (tag === 'STRIKE') tag = 'S';
  if (tag === 'DIV') tag = 'P';

  // 4) font → span（保留颜色/字号/字体族）
  if (tag === 'FONT') {
    const span = document.createElement('span');
    if (el.style.color) span.style.color = el.style.color;
    if (el.style.fontSize) span.style.fontSize = el.style.fontSize;
    if (el.style.fontFamily) span.style.fontFamily = el.style.fontFamily;
    for (const child of Array.from(el.childNodes)) {
      const cleaned = sanitizeNode(child);
      if (cleaned == null) continue;
      if (Array.isArray(cleaned)) cleaned.forEach((n) => span.appendChild(n));
      else span.appendChild(cleaned);
    }
    return span;
  }

  // 5) 不在白名单内的标签（article/section/figure/header/footer 等）→ 解包保留子内容
  if (!ALLOWED_TAGS.has(tag)) {
    return sanitizeChildren(el);
  }

  // 6) 白名单标签：重建干净副本（只保留白名单属性）
  const clean = document.createElement(tag);
  if (tag === 'SPAN') {
    for (const prop of Array.from(el.style)) {
      if (STYLE_ALLOWLIST.has(prop)) {
        clean.style.setProperty(prop, el.style.getPropertyValue(prop));
      }
    }
  } else if (tag === 'A') {
    const href = el.getAttribute('href') || '';
    if (!isSafeUrl(href, false)) {
      // 无安全 href → 解包为纯文本（保留链接文字）
      return sanitizeChildren(el);
    }
    clean.setAttribute('href', href);
  } else if (tag === 'IMG') {
    const src = el.getAttribute('src') || '';
    if (!isSafeUrl(src, true)) return null;
    const w = el.getAttribute('width');
    const h = el.getAttribute('height');
    if (w) clean.setAttribute('width', w);
    if (h) clean.setAttribute('height', h);
  } else {
    const whitelist = ATTR_WHITELIST[tag];
    if (whitelist) {
      for (const attr of whitelist) {
        const v = el.getAttribute(attr);
        if (v) clean.setAttribute(attr, v);
      }
    }
  }

  // 子节点递归清洗
  for (const child of Array.from(el.childNodes)) {
    const cleaned = sanitizeNode(child);
    if (cleaned == null) continue;
    if (Array.isArray(cleaned)) cleaned.forEach((n) => clean.appendChild(n));
    else clean.appendChild(cleaned);
  }

  // 7) li 不在 ul/ol 内 → 转为 p（避免无效列表结构）
  if (tag === 'LI') {
    const parent = el.parentElement;
    if (!parent || (parent.tagName !== 'UL' && parent.tagName !== 'OL')) {
      const p = document.createElement('p');
      for (const child of Array.from(clean.childNodes)) p.appendChild(child);
      return p;
    }
  }

  return clean;
}

/** 是否有真实内容（文本 / 图片 / 表格 / 分割线 / 换行） */
function hasRealContent(el: HTMLElement): boolean {
  if ((el.textContent || '').trim() !== '') return true;
  return !!el.querySelector('img, table, hr, br');
}

/** 压缩空段落：删除完全为空的 <p></p>（保留 <p><br></p> 这种浏览器标准空行） */
function compressEmptyParagraphs(container: HTMLElement): void {
  const ps = container.querySelectorAll('p');
  for (const p of Array.from(ps)) {
    if (p.childNodes.length === 0) p.remove();
  }
}

/**
 * 清洗剪贴板 HTML → 可安全插入编辑器的规范化 HTML
 * - 返回 '' 表示没有可保留的内容（调用方应回退到纯文本插入）
 */
export function normalizePastedHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const container = document.createElement('div');
  for (const child of sanitizeChildren(doc.body)) container.appendChild(child);
  if (!hasRealContent(container)) return '';
  compressEmptyParagraphs(container);
  return container.innerHTML;
}

/**
 * 插入清洗后的 HTML（白名单内已剥离危险内容）。
 * 用 execCommand('insertHTML') 让浏览器原生解析插入，
 * 自动处理块级嵌套修正与光标定位。
 */
export function insertNormalizedHtml(editor: HTMLElement, html: string): void {
  if (!html) return;
  focusEditor(editor);
  const ok = document.execCommand('insertHTML', false, html);
  if (ok) dispatchInput(editor);
}

/**
 * 纯文本插入（Ctrl+Shift+V / 剪贴板无 HTML 时兜底）
 * - \n 转 <br>（保留换行）
 * - 插入位置为当前光标（编辑器失焦时回退到末尾）
 */
export function insertPlainTextAtCursor(editor: HTMLElement, text: string): void {
  if (!text) return;
  focusEditor(editor);
  const sel = window.getSelection();
  if (!sel) return;
  const range = getInsertionRange(editor);
  if (!range.collapsed) range.deleteContents();
  const lines = text.split('\n');
  const frag = document.createDocumentFragment();
  lines.forEach((line, i) => {
    if (i > 0) frag.appendChild(document.createElement('br'));
    frag.appendChild(document.createTextNode(line));
  });
  const last = frag.lastChild;
  range.insertNode(frag);
  if (last) {
    const r = document.createRange();
    r.setStartAfter(last);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  dispatchInput(editor);
}
