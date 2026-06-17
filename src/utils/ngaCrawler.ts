// NGA 安价抓取工具
// - 解析 NGA 主题帖 URL（read.php?tid=XXX）
// - 从 HTML 中提取帖子信息（楼层号、层主、内容）
// - 按"以指定文本开头"过滤
// - HTML/BBCode → 纯文本
//
// 注意：本工具不直接抓取 HTML（由主进程通过 IPC 完成），
// 仅在拿到 HTML 后做解析。渲染端可在调试或备用场景下手动调用。

export interface RawPost {
  floor: number;
  author: string;
  /** 纯文本（去 HTML、去 BBCode 标签） */
  content: string;
}

export interface AnjiaItem {
  floor: number;
  author: string;
  content: string;
}

export interface CollectInput {
  url: string;
  startFloor: number;
  endFloor: number;
  /** 前缀文本（默认 "安价"） */
  prefix: string;
  /** NGA Cookie 字符串（可选） */
  cookies?: string;
}

export interface CollectResult {
  ok: boolean;
  items: AnjiaItem[];
  totalPages: number;
  error?: string;
}

const FLOORS_PER_PAGE = 20;

/**
 * 从 URL 解析 tid + 基础域名
 * 支持格式：
 *   - https://nga.178.com/read.php?tid=12345
 *   - https://bbs.nga.cn/read.php?tid=12345
 *   - https://nga.178.com/read.php?tid=12345&page=2
 *   - https://nga.178.com/thread.php?fid=1&tid=12345
 */
export function parseThreadUrl(url: string): { tid: number; baseUrl: string } | null {
  if (!url) return null;
  const m = url.match(/^(https?:\/\/[^\/]+).*?[?&]tid=(\d+)/i);
  if (!m) return null;
  const baseUrl = m[1];
  const tid = parseInt(m[2], 10);
  if (!tid) return null;
  return { tid, baseUrl };
}

/**
 * 计算页码范围
 * - NGA 每页 20 楼
 * - page = Math.ceil(floor / 20)
 */
export function computePageRange(
  startFloor: number,
  endFloor: number,
): { startPage: number; endPage: number; totalPages: number } {
  const startPage = Math.max(1, Math.ceil(startFloor / FLOORS_PER_PAGE));
  const endPage = Math.max(startPage, Math.ceil(endFloor / FLOORS_PER_PAGE));
  return { startPage, endPage, totalPages: endPage - startPage + 1 };
}

/**
 * 从 NGA HTML 中提取所有帖子（楼层号、层主、内容）
 * 使用 regex 解析；解析失败 / 单页失败时返回空数组（不抛错）
 */
export function extractPostsFromHtml(html: string): RawPost[] {
  if (!html) return [];
  const posts: RawPost[] = [];

  // 1) 找所有 <table id="post_XXX"> 容器
  //    注：NGA 也用 <table class="forumbox postbox">，但 id="post_XXX" 更精准
  //    使用非贪婪匹配 + dotAll 等价（用 [\s\S]）
  const tableRe = /<table[^>]*\bid="post(\d+)"[\s\S]*?<\/table>/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRe.exec(html)) !== null) {
    const tableHtml = tableMatch[0];
    const postId = parseInt(tableMatch[1], 10);
    if (!postId) continue;

    // 楼层号：<a id="floor_1" name="floor_1"> 或 <a id="l_post_1"> 之类
    // 优先匹配 floor_X
    const floorMatch =
      tableHtml.match(/\bid="floor_(\d+)"/i) ||
      tableHtml.match(/\bname="floor_(\d+)"/i);
    let floor: number;
    if (floorMatch) {
      floor = parseInt(floorMatch[1], 10);
    } else {
      // 兜底：用 postId（虽然 NGA 的 postId 跟楼层号通常一致）
      floor = postId;
    }

    // 层主：<a href="...uid=XXX...">username</a>
    // 注意：层主在第一个出现的 uid 链接
    const authorMatch = tableHtml.match(
      /<a[^>]*\bhref="[^"]*\buid=(\d+)[^"]*"[^>]*>([^<]+)<\/a>/i,
    );
    const author = authorMatch ? authorMatch[2].trim() : '匿名';

    // 内容：<div class="postMessage">...</div>
    // 注意：NGA 内容可能嵌套 div（quote、折叠等），需要最小闭合匹配
    const contentMatch = matchPostMessage(tableHtml);
    const content = contentMatch ? htmlToPlainText(contentMatch) : '';

    posts.push({ floor, author, content });
  }

  return posts;
}

/**
 * 匹配 <div class="postMessage">...</div> 的最浅闭合位置
 * 处理嵌套 div（如引用块）
 */
function matchPostMessage(html: string): string | null {
  const openRe = /<div[^>]*\bclass="postMessage"[^>]*>/i;
  const openMatch = openRe.exec(html);
  if (!openMatch) return null;
  const openEnd = openMatch.index + openMatch[0].length;

  // 从 openEnd 开始，遇到 </div> 且 div 嵌套层数为 0 时停止
  let depth = 1;
  const tagRe = /<(\/?)div\b[^>]*>/gi;
  tagRe.lastIndex = openEnd;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    if (m[1] === '/') {
      depth--;
      if (depth === 0) {
        return html.substring(openEnd, m.index);
      }
    } else {
      depth++;
    }
  }
  // 没找到闭合 div，返回从 openEnd 到末尾（兜底）
  return html.substring(openEnd);
}

/**
 * 按楼层范围 + 前缀过滤
 * - 过滤条件：floor ∈ [startFloor, endFloor] && content.trimStart().startsWith(prefix)
 */
export function filterAnjiaPosts(
  posts: RawPost[],
  startFloor: number,
  endFloor: number,
  prefix: string,
): AnjiaItem[] {
  if (!prefix) {
    // 没有前缀 → 只过滤楼层
    return posts
      .filter((p) => p.floor >= startFloor && p.floor <= endFloor)
      .map((p) => ({ floor: p.floor, author: p.author, content: p.content }));
  }
  return posts
    .filter(
      (p) =>
        p.floor >= startFloor &&
        p.floor <= endFloor &&
        p.content.trimStart().startsWith(prefix),
    )
    .map((p) => ({ floor: p.floor, author: p.author, content: p.content }))
    .sort((a, b) => a.floor - b.floor);
}

/**
 * HTML 标签 + BBCode → 纯文本
 * - 移除所有 <...> 标签
 * - 解码常见 HTML 实体
 * - 移除 BBCode 标签 [b] [i] [u] [color=...] [/color]
 * - 保留换行：<br> → \n，</p> → \n\n
 * - 合并多余空白
 */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  let s = html;

  // 1) 换行处理（先做，避免被 strip 标签时丢失）
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/p>/gi, '\n\n');
  s = s.replace(/<\/div>/gi, '\n');

  // 2) 移除所有 HTML 标签
  s = s.replace(/<[^>]+>/g, '');

  // 3) 移除 BBCode 标签：[b] [i] [u] [s] [color=red] [/color] 等
  s = s.replace(/\[\/?[a-zA-Z]+(?:=[^\]]+)?\]/g, '');

  // 4) 解码 HTML 实体
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

  // 5) 合并连续空白（保留换行）
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === '')) // 合并连续空行
    .join('\n');

  return s.trim();
}

/**
 * 拼装复制文本（用于剪贴板）
 * 格式：1楼 用户名：内容
 */
export function formatForClipboard(items: AnjiaItem[]): string {
  return items.map((it) => `${it.floor}楼 ${it.author}：${it.content}`).join('\n');
}

/**
 * 拼装 NGA BBCode 格式（用于直接贴到 NGA 编辑器）
 * 格式：[b]1楼 用户名[/b]\n内容\n\n[b]2楼 用户名[/b]\n内容
 * - 标题行加粗
 * - 楼与楼之间空一行
 */
export function formatAsNGABBCode(items: AnjiaItem[]): string {
  return items
    .map((it) => `[b]${it.floor}楼 ${it.author}[/b]\n${it.content}`)
    .join('\n\n');
}
