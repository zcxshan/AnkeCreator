// ============================================================
// NGA BBCode → HTML 字符串（导入用）
//
// 支持标签：
//   [b][/b] [i][/i] [u][/u] [del][/del]
//   [color=xxx][/color]   颜色值用 NGA_COLORS 反查 css 颜色
//   [size=N%][/size]      百分比 → 12 * N / 100 pt
//   [font=xxx][/font]     NGA_FONTS 反查 css font-family
//   [align=left|center|right][/align]
//   [sup][/sup] [sub][/sub]
//   [url=href][/url]
//   [img]src[/img]
//   [quote]…[/quote]
//   [collapse=title]…[/collapse]
//   [code]…[/code]
//   [list]…[*]…[/list]     无序
//   [list=1]…[*]…[/list]   有序
//   [table][tr][td]…[/td][/tr][/table]
//   [h][/h]  分割线
//   [b]标题 ROLL 1dN=X[/b] 骰子命中行识别 → 还原 dice-card
//
// 解析策略：单趟扫描 + 标签栈
//   - 文本原样写到输出
//   - 遇到开标签入栈（封装为节点对象）
//   - 遇到闭标签出栈
//   - 标签可嵌套（[b][color=red]…[/color][/b] 都能正确闭合）
//   - 未识别的标签对原样输出为 [tag]…[/tag]
//   - 容错：未闭合的开标签在末尾自动闭合
// ============================================================

import {
  NGA_COLORS,
  NGA_FONTS,
  NGA_FONT_SIZES,
  NGA_QUOTE_BG,
  NGA_COLLAPSE_HEAD_BG,
  NGA_COLLAPSE_BODY_BG,
  NGA_CODE_BG,
  NGA_LINK_COLOR,
} from '../types';

/**
 * bbcodeToHtml 显式支持的 BBCode 标签集合。
 * 不在集合中的标签会走 buildOpenNode 的 default 分支，按原始 BBCode 文本透传输出。
 * NGA 坛友标签 [s:xxx:xxx] 与 NGA 骰子标签 [d\d*] 不在此集合，由 tokenize 阶段直接视为文本。
 */
const KNOWN_BB_TAGS = new Set<string>([
  'b', 'i', 'u', 'del', 's',
  'color', 'size', 'font', 'align',
  'sup', 'sub', 'url', 'img',
  'quote', 'collapse', 'code',
  'list', '*', 'table', 'tr', 'td', 'th',
  'h', 'hr', 'br',
]);

/**
 * 判定一段 `[...]` 的内容是否属于 NGA 论坛特有的"非标准标签"语法：
 * - `[s:xxx:xxx]` 坛友标签 / 表情
 * - `[d\d*]` 骰子标签（如 [d]、[d6]、[d100]）
 * 这些标签在 tokenize 阶段直接作为文本处理，不进入标签栈。
 */
function isNgaSpecialTagRaw(raw: string): boolean {
  if (!raw) return false;
  // [s:xxx:xxx] —— 坛友标签，含两个冒号且无 '='
  if (raw.startsWith('s:') && raw.indexOf('=') < 0) return true;
  // [d] / [d6] / [d100] —— 骰子标签
  if (/^d\d*$/i.test(raw)) return true;
  return false;
}

type Node =
  | { kind: 'text'; text: string }
  | {
      kind: 'el';
      tag: string;
      attrs: Record<string, string>;
      children: Node[];
      /**
       * raw 序列化器：把 children 序列化为 BBCode / innerBBCode，
       * 然后拼出最终 HTML 字符串。某些节点（如 collapse）需要特殊处理。
       */
      render: (innerHTML: string, innerBBCode: string) => string;
    };

function textNode(text: string): Node {
  return { kind: 'text', text };
}

function elNode(
  tag: string,
  attrs: Record<string, string>,
  render: (innerHTML: string, innerBBCode: string) => string,
): Node {
  return { kind: 'el', tag, attrs, children: [], render };
}

/** 单趟 token 扫描 */
function tokenize(input: string): Array<{ type: 'text' | 'open' | 'close' | 'selfclose'; tag: string; attrs: string }> {
  const tokens: Array<{ type: 'text' | 'open' | 'close' | 'selfclose'; tag: string; attrs: string }> = [];
  let i = 0;
  const len = input.length;
  let buf = '';
  while (i < len) {
    const ch = input[i];
    if (ch === '[') {
      // 尝试匹配 [tag] / [tag=attrs] / [/tag]
      const close = input[i + 1] === '/';
      const start = close ? i + 2 : i + 1;
      let end = start;
      while (end < len && input[end] !== ']') end++;
      if (end < len) {
        // 找到完整的 [..]
        if (buf) {
          tokens.push({ type: 'text', tag: buf, attrs: '' });
          buf = '';
        }
        const raw = input.slice(start, end).trim();
        // NGA 坛友标签 [s:xxx:xxx] / 骰子标签 [d\d*] —— 整段视为文本
        if (!close && isNgaSpecialTagRaw(raw)) {
          buf += `[${input.slice(start, end)}]`;
          i = end + 1;
          continue;
        }
        if (close) {
          tokens.push({ type: 'close', tag: raw.toLowerCase(), attrs: '' });
        } else if (raw.endsWith('/')) {
          // [h/] 自闭和
          tokens.push({ type: 'selfclose', tag: raw.slice(0, -1).trim().toLowerCase(), attrs: '' });
        } else {
          const eq = raw.indexOf('=');
          if (eq >= 0) {
            const tag = raw.slice(0, eq).trim().toLowerCase();
            const attrs = raw.slice(eq + 1).trim();
            tokens.push({ type: 'open', tag, attrs });
          } else {
            tokens.push({ type: 'open', tag: raw.toLowerCase(), attrs: '' });
          }
        }
        i = end + 1;
        continue;
      }
      // 没找到 ] 视为文本
      buf += ch;
      i++;
    } else {
      buf += ch;
      i++;
    }
  }
  if (buf) tokens.push({ type: 'text', tag: buf, attrs: '' });
  return tokens;
}

/** 把 attr 字符串 "title ROLL 1d100=52" 解码（保持原样） */
function decodeAttr(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** children → HTML（递归） */
function childrenToHTML(children: Node[], inPre: boolean = false): string {
  return children
    .map((c) => {
      if (c.kind === 'text') {
        const escaped = escapeHtml(c.text);
        return inPre ? escaped : escaped.replace(/\n/g, '<br>');
      }
      const childPre = inPre || (c.kind === 'el' && c.tag === 'code');
      const inner = childrenToHTML(c.children, childPre);
      const innerBBCode = childrenToBBCode(c.children);
      return c.render(inner, innerBBCode);
    })
    .join('');
}

/** children → 原始 BBCode 文本（用于骰子识别等场景） */
function childrenToBBCode(children: Node[]): string {
  return children
    .map((c) => {
      if (c.kind === 'text') return c.text;
      const inner = childrenToBBCode(c.children);
      const attrStr = Object.entries(c.attrs)
        .map(([k, v]) => `${k}=${v}`)
        .join('|');
      // 简化：把 [b]…[/b]、[color=]…[/color] 还原
      return tagToBBCode(c.tag, attrStr, inner);
    })
    .join('');
}

function tagToBBCode(tag: string, attrStr: string, inner: string): string {
  if (!attrStr) return `[${tag}]${inner}[/${tag}]`;
  return `[${tag}=${attrStr}]${inner}[/${tag}]`;
}

const SELF_CLOSING_TAGS = new Set(['h', 'hr', 'br']);

/** 主入口：BBCode → HTML 字符串 */
export function bbcodeToHtml(input: string | null | undefined): string {
  if (!input) return '';
  const tokens = tokenize(input);

  // 节点栈
  const root: Node = elNode('root', {}, (inner) => inner);
  const stack: Node[] = [root];

  for (const tok of tokens) {
    const top = stack[stack.length - 1];

    if (tok.type === 'text') {
      if (top.kind === 'el') {
        top.children.push(textNode(tok.tag));
      } else if (top.kind === 'text') {
        // 不可能：text 不能 push child
      }
      continue;
    }

    if (tok.type === 'selfclose') {
      const tag = tok.tag;
      if (tag === 'h' || tag === 'hr') {
        if (top.kind === 'el') {
          top.children.push(
            elNode('hr', {}, () => `<hr data-h="1">`),
          );
        }
      } else if (tag === 'br') {
        if (top.kind === 'el') {
          top.children.push(textNode('\n'));
        }
      } else if (tag === 'img') {
        // 自闭合的 [img] 没有意义
      }
      continue;
    }

    if (tok.type === 'open') {
      const tag = tok.tag;
      const attrRaw = decodeAttr(tok.attrs);
      const node = buildOpenNode(tag, attrRaw);
      if (top.kind === 'el') {
        top.children.push(node);
      }
      if (!SELF_CLOSING_TAGS.has(tag)) {
        stack.push(node);
      }
      continue;
    }

    if (tok.type === 'close') {
      // 找到匹配的开标签并弹栈
      const idx = findMatchingOpenIndex(stack, tok.tag);
      if (idx >= 0) {
        // 把多余的开标签闭合：把 idx 之后所有未闭合的节点弹出来
        const toClose = stack.splice(idx + 1);
        for (let i = toClose.length - 1; i >= 0; i--) {
          if (stack.length > 0) {
            stack.pop();
          }
        }
        // 再把当前标签也弹掉
        if (stack.length > 0) stack.pop();
        // 压回最后一个节点的 children：实际上 pop 已经完成，无需操作
        // 但要确保 top 仍然是 root
        // 防御：确保栈里有 root
        if (stack.length === 0) {
          stack.push(root);
        }
      }
      // 未匹配：忽略
      continue;
    }
  }

  // 收尾：未闭合的开标签全部弹栈
  while (stack.length > 1) stack.pop();

  // 渲染：root 的 children 拼出最终 HTML
  const html = root.kind === 'el' ? childrenToHTML(root.children) : '';

  // 兜底：把纯文本中的连续空行压缩，但保留段落换行
  return collapseBlankLines(html);
}

function findMatchingOpenIndex(stack: Node[], tag: string): number {
  for (let i = stack.length - 1; i >= 0; i--) {
    const n = stack[i];
    if (n.kind === 'el' && n.tag === tag) return i;
  }
  return -1;
}

function buildOpenNode(tag: string, attrRaw: string): Node {
  switch (tag) {
    case 'b':
      return elNode('b', {}, (inner) => `<b>${inner}</b>`);
    case 'i':
      return elNode('i', {}, (inner) => `<i>${inner}</i>`);
    case 'u':
      return elNode('u', {}, (inner) => `<u>${inner}</u>`);
    case 'del':
    case 's':
      return elNode('del', {}, (inner) => `<del>${inner}</del>`);
    case 'color': {
      const css = lookupColor(attrRaw);
      return elNode('color', { v: attrRaw }, (inner) =>
        `<span style="color:${css}">${inner}</span>`,
      );
    }
    case 'size': {
      const m = attrRaw.match(/^(\d+)\s*%?$/);
      const percent = m ? parseInt(m[1], 10) : 100;
      const cssSize = lookupSize(percent);
      return elNode('size', { v: String(percent) }, (inner) =>
        `<span style="font-size:${cssSize}">${inner}</span>`,
      );
    }
    case 'font': {
      const css = lookupFont(attrRaw);
      return elNode('font', { v: attrRaw }, (inner) =>
        `<span style="font-family:${css}">${inner}</span>`,
      );
    }
    case 'align': {
      const a = (attrRaw || 'left').toLowerCase();
      return elNode('align', { v: a }, (inner) =>
        `<p style="text-align:${a}">${inner}</p>`,
      );
    }
    case 'sup':
      return elNode('sup', {}, (inner) => `<sup>${inner}</sup>`);
    case 'sub':
      return elNode('sub', {}, (inner) => `<sub>${inner}</sub>`);
    case 'url': {
      const href = attrRaw || '#';
      return elNode('url', { v: href }, (inner) =>
        `<a href="${escapeHtml(href)}" style="color:${NGA_LINK_COLOR};text-decoration:underline">${inner}</a>`,
      );
    }
    case 'img': {
      // src 走 content
      const src = attrRaw || '';
      void src;
      // [img]xxx[/img] 这种会通过 children 形式被处理
      return elNode('img', {}, (_inner, innerBBCode) => {
        const url = expandNgaImageUrl((innerBBCode || '').trim());
        // onerror 兜底：图片加载失败时显示占位（保持和 insertImageBlock 一致）
        // 用内联 JS 而非 base64 SVG 占位图，因为图片可能在 Electron 渲染进程/Capacitor 加载
        const onerror = `this.onerror=null;this.style.minHeight='40px';this.style.background='var(--bg-hover, #f0f0f0)';this.alt='图片加载失败';this.insertAdjacentHTML('afterend','<span style=&quot;display:inline-block;color:#999;font-size:12px;padding:4px 6px;background:var(--bg-hover,#f0f0f0);border-radius:3px;margin:2px 4px&quot;>[图片无法加载]</span>');`;
        return `<div data-type="image-block" data-size="original" style="display:inline-block;margin:2px 4px;vertical-align:middle;outline:none;user-select:none"><img src="${escapeHtml(url)}" onerror="${onerror}" style="max-width:100%;height:auto;display:inline-block;cursor:pointer;user-select:none" alt=""></div>`;
      });
    }
    case 'quote': {
      const title = attrRaw || '';
      void title;
      return elNode('quote', {}, (inner) => {
        // 行级 [quote] 用 blockquote[data-type="quote-block"]（CSS 风格与 NGA 一致）
        return `<blockquote data-type="quote-block" style="background:${NGA_QUOTE_BG};padding:8px 12px;border-radius:4px;margin:6px 0;border-left:3px solid #c8b88a">${inner}</blockquote>`;
      });
    }
    case 'collapse': {
      const title = attrRaw || '折叠';
      return elNode('collapse', { title }, (inner) => {
        // 与 insertCollapseBlock 保持一致结构（toggle span + title span + data-collapsed）
        // 让 BBCode 转换产物和工具栏插入的 collapse-block 都能被 attachCollapseBlockHandlers
        // 的 click toggle 识别。head 设 contenteditable="false" 避免点击被吞。
        return `<div data-type="collapse-block" data-title="${escapeHtml(title)}" data-collapsed="true" style="display:block;margin:6px 0;border-radius:4px;overflow:hidden;outline:none"><div class="collapse-head" contenteditable="false" style="background:${NGA_COLLAPSE_HEAD_BG};padding:6px 10px;font-weight:600;display:flex;align-items:center;gap:4px;user-select:none;cursor:pointer"><span class="collapse-toggle" style="cursor:pointer;user-select:none;flex-shrink:0">+</span><span class="collapse-title" style="flex:1;min-width:0">${escapeHtml(title)}</span></div><div class="collapse-body" style="background:${NGA_COLLAPSE_BODY_BG};padding:8px 12px;display:none">${inner}</div></div>`;
      });
    }
    case 'code':
      return elNode('code', {}, (inner) => {
        return `<pre class="code-block" style="background:${NGA_CODE_BG};padding:10px 12px;border-radius:4px;font-family:Consolas,Menlo,monospace;font-size:13px;white-space:pre-wrap;margin:6px 0">${inner}</pre>`;
      });
    case '*':
      return elNode('li', {}, (inner) => `<li>${inner}</li>`);
    case 'list': {
      const ordered = attrRaw === '1';
      return elNode('list', { ordered: ordered ? '1' : '0' }, (inner) => {
        if (ordered) {
          return `<ol style="padding-left:24px;margin:6px 0">${inner}</ol>`;
        }
        return `<ul style="padding-left:24px;margin:6px 0">${inner}</ul>`;
      });
    }
    case 'table':
      return elNode('table', {}, (inner) => {
        return `<table style="border-collapse:collapse;margin:8px 0;width:auto">${inner}</table>`;
      });
    case 'tr':
      return elNode('tr', {}, (inner) => {
        return `<tr>${inner}</tr>`;
      });
    case 'td':
    case 'th':
      return elNode('td', {}, (inner) => {
        return `<td style="border:1px solid #c8b88a;padding:4px 8px;min-width:32px">${inner}</td>`;
      });
    case 'h':
    case 'hr':
      return elNode('h', {}, () => `<hr data-h="1">`);
    default:
      // 未识别：原样输出
      return elNode(tag, { v: attrRaw }, (inner) => `[${tag}${attrRaw ? `=${attrRaw}` : ''}]${inner}[/${tag}]`);
  }
}

function lookupColor(name: string): string {
  const c = NGA_COLORS.find((x) => x.value === name);
  if (c) return c.cssColor;
  // 兜底：直接当 hex / 颜色名
  return name || '#000000';
}

function lookupSize(percent: number): string {
  const s = NGA_FONT_SIZES.find((x) => x.percent === percent);
  if (s) return s.cssSize;
  // 兜底：自定义百分比 → 按 12pt * percent / 100
  return `${(12 * percent) / 100}pt`;
}

function lookupFont(value: string): string {
  const f = NGA_FONTS.find((x) => x.value === value);
  if (f) return f.cssFamily;
  return value || 'serif';
}

/**
 * 把 NGA 论坛里的相对图片路径补全为可访问的完整 URL
 * - 已带 http(s):// 或 // 开头 → 原样返回
 * - 以 ./ 开头（如 ./mon_xxx）→ 补全为 https://img.nga.178.com/attachments/...
 * - 以 mon_ 开头（无 ./）→ 同样补全
 * - 其余（带 [img] 属性的）原样返回
 */
export function expandNgaImageUrl(url: string): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('//')) return url;
  if (url.startsWith('./')) {
    return `https://img.nga.178.com/attachments/${url.slice(2)}`;
  }
  if (url.startsWith('mon_')) {
    return `https://img.nga.178.com/attachments/${url}`;
  }
  return url;
}

function collapseBlankLines(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
