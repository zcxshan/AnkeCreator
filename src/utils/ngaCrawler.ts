// ============================================================
// NGA 抓取工具（基于实际 HTML 验证）
// ------------------------------------------------------------
// 实际 NGA 帖子 HTML 结构（2026 验证）：
//   容器：<table class='forumbox postbox' cellspacing='1px'>
//     <tr id='post1strowN' class='postrow row2'>
//       <td class='c1'>...<span id='posterinfoN' class='posterinfo'>
//         <a href='nuke.php?func=ucp&uid=XXX' id='postauthorN' class='author b'></a>
//       </span></td>
//       <td class='c2' id='postcontainerN'>
//         <a id='pidXXXAnchor'></a>
//         <a name='lN'></a>  ← 楼层号锚点
//         <span id='postcontentandsubjectN'>
//           <span id='postcontentN' class='postcontent ubbcode'>(...内容含 [uid=X]name[/uid] 引用...)</span>
//         </span>
//       </td>
//     </tr>
//   </table>
//   <script>commonui.postArg.proc( N, ..., 'UID', ...)</script>
//
// 关键定位器：
//   - 楼层号：<a name='lN'> 锚点（最稳定）
//   - 内容：<span id='postcontentN' class='postcontent ubbcode'>(...)</span>
//   - UID：<a id='postauthorN' href='...uid=XXX'>
//   - 用户名：[uid=X]name[/uid] 引用中提取（HTML 中 JS 填充，原始为空）
// ============================================================

import { expandNgaImageUrl } from './ngaBBCodeToHtml';

/** 单条帖子（原始） */
export interface RawPost {
  floor: number;
  author: string;
  /** 从 postauthorN 链接的 uid= 提取，用于按用户筛选 */
  uid?: string;
  content: string;
  pid?: string;
  /** post timestamp（秒） */
  time?: number;
}

/** 抓取结果（AnjiaItem = 过滤后的子集） */
export interface AnjiaItem {
  floor: number;
  author: string;
  /** 作者 uid（从 RawPost 透传，供后续扩展使用） */
  uid?: string;
  content: string;
}

/** 抓取结果 */
export interface CollectResult {
  ok: boolean;
  items: AnjiaItem[];
  totalPages: number;
  error?: string;
  failedPages?: number[];
  actualMaxFloor?: number;
}

/**
 * 解析 NGA 主题帖 URL
 * - 支持：nga.178.com / ngabbs.com / bbs.nga.cn
 * - 支持带或不带 page 参数
 * - 支持带或不带 # 锚点
 * - 支持可选的 authorid 参数（用于按用户筛选回复）
 */
export function parseThreadUrl(
  url: string,
): { tid: string; baseUrl: string; authorid?: string } | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(https?:\/\/[^\/]+).*?[?&]tid=(\d+)/i);
  if (!m) return null;
  const authoridMatch = trimmed.match(/[?&]authorid=(\d+)/i);
  return {
    tid: m[2],
    baseUrl: m[1],
    authorid: authoridMatch ? authoridMatch[1] : undefined,
  };
}

/**
 * 计算楼层范围对应的页码
 * NGA 每页 20 楼（已验证）
 * - floor 1-20 → page 1
 * - floor 21-40 → page 2
 */
export function computePageRange(startFloor: number, endFloor: number) {
  const startPage = Math.floor((startFloor - 1) / 20) + 1;
  const endPage = Math.floor((endFloor - 1) / 20) + 1;
  return { startPage, endPage, totalPages: endPage - startPage + 1 };
}

/**
 * 解析 NGA 帖子 HTML → RawPost[]
 * 基于实际验证的结构，2026-06
 */
export function extractPostsFromHtml(html: string): RawPost[] {
  if (!html) return [];

  // 步骤 1：建立 UID → 用户名 映射（从 [uid=XXX]username[/uid] 引用中提取）
  const uidToName = buildUidToNameMap(html);

  // 步骤 2：找所有楼层锚点位置
  // - 优先：<tr id='post1strowN'>（行级 anchor，包含两列：用户列 + 内容列）
  // - 兜底：<a name='lN'></a>（内容列内的 floor anchor，但不含 postauthorN）
  const anchorRe = /<tr\s+id=['"]post1strow(\d+)['"]/gi;
  const anchors: { floor: number; index: number; type: 'tr' | 'a' }[] = [];
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    anchors.push({ floor: parseInt(m[1], 10), index: m.index, type: 'tr' });
  }
  if (anchors.length === 0) {
    // 兜底：<a name='lN'></a>
    const aRe = /<a\s+name=['"]l(\d+)['"]\s*><\/a>/gi;
    while ((m = aRe.exec(html)) !== null) {
      anchors.push({ floor: parseInt(m[1], 10), index: m.index, type: 'a' });
    }
  }
  if (anchors.length === 0) {
    console.warn('[ngaCrawler] 未找到任何楼层锚点（<tr id="post1strowN"> / <a name="lN">）');
    return [];
  }

  // 步骤 3：每个 anchor 切出一段（到下一个 anchor 之前），逐个提取
  const posts: RawPost[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i].index;
    const end = i + 1 < anchors.length ? anchors[i + 1].index : html.length;
    const segment = html.substring(start, end);
    const floor = anchors[i].floor;

    try {
      // 提取内容：<span id='postcontentN' ... class='postcontent ubbcode' ...>(...)</span>
      // 兼容属性顺序变化、额外属性等情况
      const contentRe = new RegExp(
        `<span\\b[^>]*\\bid=['"]postcontent${floor}['"][^>]*>([\\s\\S]*?)</span>`,
        'i',
      );
      let contentMatch = segment.match(contentRe);
      // 兜底：如果精确 id 匹配失败，尝试 class 匹配（id 可能有额外后缀）
      if (!contentMatch) {
        const fallbackRe = new RegExp(
          `<span\\b[^>]*\\bclass=['"][^'"]*postcontent\\s+ubbcode[^'"]*['"][^>]*>([\\s\\S]*?)</span>`,
          'i',
        );
        contentMatch = segment.match(fallbackRe);
      }
      // 即使找不到内容 span（楼层被删/特殊帖），也保留该楼层条目以防索引错位
      const rawContent = contentMatch ? contentMatch[1] : '';

      // 提取 UID：<a id='postauthorN' href='...uid=XXX'>
      const uidRe = new RegExp(
        `<a[^>]*id=['"]postauthor${floor}['"][^>]*?uid=(\\d+)|<a[^>]*?uid=(\\d+)[^>]*id=['"]postauthor${floor}['"]`,
        'i',
      );
      const uidMatch = segment.match(uidRe);
      const uid = uidMatch ? (uidMatch[1] || uidMatch[2] || '') : '';

      // 提取时间戳
      const timeMatch = segment.match(/commonui\.postArg\.proc\(\s*\d+\s*,[\s\S]*?'(\d{10})'\s*,/);
      const time = timeMatch ? parseInt(timeMatch[1], 10) : 0;

      // 用户名
      const author = uid && uidToName[uid]
        ? uidToName[uid]
        : uid
          ? `uid:${uid}`
          : '匿名';

      // 清理 HTML 标签
      const content = rawContent ? stripHtmlTags(rawContent).trim() : '';

      posts.push({
        floor,
        author,
        uid: uid || undefined,
        content,
        pid: extractPid(segment, floor),
        time: time || undefined,
      });
    } catch (e) {
      // 解析某层失败时保留占位，不影响其他楼层
      console.warn(`[ngaCrawler] 第 ${floor} 楼解析失败：${(e as Error).message}，保留空内容`);
      posts.push({
        floor,
        author: '未知',
        content: '',
      });
    }
  }

  // 按楼层号排序
  posts.sort((a, b) => a.floor - b.floor);
  console.log(
    `[ngaCrawler] extractPostsFromHtml: ${posts.length} 帖 (html ${html.length} chars, anchors ${anchors.length})`,
  );
  return posts;
}

/**
 * 从内容中提取 [uid=XXX]username[/uid] 形式的引用，建立 UID→用户名 映射
 * - 解决"作者名在 HTML 中为空"的问题
 * - 多次出现时取第一个（最早）
 */
function buildUidToNameMap(html: string): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /\[uid=(\d+)\]([^\[]+?)\[\/uid\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const uid = m[1];
    const name = m[2].trim();
    if (uid && name && !map[uid] && name.length < 32) {
      map[uid] = name;
    }
  }
  return map;
}

/**
 * 清理 HTML 标签（保留 <br/> 转换为换行 + UBB 标签原样保留）
 *
 * 图片特殊处理：NGA 把 [img]./mon_xxx[/img] 预渲染为 <img src="./mon_xxx">，
 * 必须在 <[^>]+> 删除之前先把 <img src="xxx"> 转回 [img]xxx[/img]，
 * 否则图片信息会随 HTML 标签一起被删除。
 * src 走 expandNgaImageUrl 补全为完整 URL（./mon_xxx → https://img.nga.178.com/attachments/mon_xxx）。
 */
function stripHtmlTags(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    // 先把 <img src="xxx"> 转换为 [img]xxx[/img]（保留图片信息 + 补全 NGA 相对路径）
    .replace(/<img[^>]*src=["']([^"']+)["'][^>]*\/?>/gi, (_m, src: string) => {
      const expanded = expandNgaImageUrl(src);
      return `[img]${expanded}[/img]`;
    })
    .replace(/<[^>]+>/g, '') // 此时 img 已转 [img]，安全删除其他 HTML 标签
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(parseInt(code, 10)))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 提取 pid（楼层唯一 id）
 * 例如：<a id='pid870364906Anchor'></a>
 */
function extractPid(segment: string, floor: number): string {
  const m = segment.match(/id=['"]pid(\d+)Anchor['"]/i);
  return m ? m[1] : '';
}

/**
 * 过滤安价帖子
 * - 楼层范围：start <= floor <= end
 * - prefix 匹配（按 matchMode）：
 *   - 'prefix'（默认）：content.trim().startsWith(prefix)
 *   - 'contains'：content.trim().includes(prefix)
 *   - 'regex'：new RegExp(prefix).test(content)，编译失败返回空数组
 *   - prefix 为空 = 不过滤（返回所有范围内帖子，无论 mode）
 * - authorid 匹配：p.uid === authorid
 *   - authorid 为空 = 不过滤
 * - 转换 UBB 引用为纯文本（移除 [uid=XXX]name[/uid] 形式）
 */
export type MatchMode = 'prefix' | 'contains' | 'regex';

export function filterAnjiaPosts(
  posts: RawPost[],
  startFloor: number,
  endFloor: number,
  prefix: string,
  authorid?: string,
  matchMode: MatchMode = 'prefix',
): AnjiaItem[] {
  const trimmedPrefix = prefix.trim();
  const trimmedAuthorid = authorid?.trim();

  let regex: RegExp | null = null;
  if (trimmedPrefix && matchMode === 'regex') {
    try {
      regex = new RegExp(trimmedPrefix);
    } catch {
      return []; // 正则编译失败，返回空（不抛错）
    }
  }

  // 先 removeUbbref 清理引用标签，再做 prefix 过滤
  // 否则 [pid=X]引用[/pid]安价100 这种格式会被 startsWith('安价') 误杀
  // 同时按 floor 去重（保留首次出现），防止后端返回重复楼层导致输出重复
  const seenFloors = new Set<number>();
  const cleaned = posts
    .filter((p) => p.floor >= startFloor && p.floor <= endFloor)
    .filter((p) => {
      if (seenFloors.has(p.floor)) return false;
      seenFloors.add(p.floor);
      return true;
    })
    .map((p) => ({ ...p, content: removeUbbref(p.content) }));

  return cleaned
    .filter((p) => {
      if (!trimmedPrefix) return true;
      const content = p.content.trim();
      if (matchMode === 'prefix') return content.startsWith(trimmedPrefix);
      if (matchMode === 'contains') return content.includes(trimmedPrefix);
      if (matchMode === 'regex') return regex ? regex.test(content) : false;
      return true;
    })
    .filter((p) => !trimmedAuthorid || p.uid === trimmedAuthorid)
    .map((p) => ({
      floor: p.floor,
      author: p.author,
      uid: p.uid,
      content: p.content,
    }));
}

/**
 * 移除 UBB 引用标签（[uid=XXX]name[/uid]、[pid=XXX]name[/pid] 等）
 * - 保留 [b]、[i]、[quote] 等结构标签
 * - 仅移除 [uid]、[pid] 这种用户/帖子引用
 */
function removeUbbref(text: string): string {
  return text
    .replace(/\[uid=\d+\][^\[]*?\[\/uid\]/gi, '')
    .replace(/\[pid=\d+(?:,\d+)*\][^\[]*?\[\/pid\]/gi, '')
    .replace(/\[tid=\d+\][^\[]*?\[\/tid\]/gi, '')
    .replace(/\[\[uid=\d+\]\]\(0,[^)]+\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

/**
 * 格式化为可复制文本（每条 "X楼 用户名：内容"）
 */
export function formatForClipboard(items: AnjiaItem[]): string {
  return items.map((it) => `${it.floor}楼 ${it.author}：${it.content}`).join('\n\n');
}

/**
 * 格式化为 NGA BBCode（标题行加粗，楼与楼之间空一行）
 * - 格式：[b]1楼 用户名[/b]\n内容\n\n[b]2楼 用户名[/b]\n内容
 */
export function formatAsNGABBCode(items: AnjiaItem[]): string {
  return items
    .map((it) => `[b]${it.floor}楼 ${it.author}[/b]\n${it.content}`)
    .join('\n\n');
}

/**
 * 从 HTML 中提取总页数（优先 __PAGE 全局变量）
 */
export function extractTotalPagesFromHtml(html: string): number {
  if (!html) return 0;
  // 优先：var __PAGE = {...,1:N,2:M,...}
  const pageVarMatch = html.match(/var\s+__PAGE\s*=\s*\{[^}]*\}/);
  if (pageVarMatch) {
    const totalPagesMatch = pageVarMatch[0].match(/,1:(\d+),/);
    if (totalPagesMatch) {
      const n = parseInt(totalPagesMatch[1], 10);
      if (n > 0) return n;
    }
  }
  // 兜底：末页链接 / 最大 page= 数
  const lastPageMatch = html.match(/[?&]page=(\d+)[^>]*>(?:末页|>>)/i);
  if (lastPageMatch) {
    const n = parseInt(lastPageMatch[1], 10);
    if (n > 0) return n;
  }
  const allPages = Array.from(html.matchAll(/[?&]page=(\d+)/g))
    .map((m) => parseInt(m[1], 10))
    .filter((n) => !isNaN(n) && n > 0);
  return allPages.length > 0 ? Math.max(...allPages) : 0;
}

/**
 * 从 HTML 中提取帖子里的最大 floor 号（即该页最后一楼号）
 * - 通过解析每楼头部"X楼"标识
 * - 用于在末页确定真实的"末楼号"
 * - 返回 0 表示未找到
 */
export function extractMaxFloorFromHtml(html: string): number {
  if (!html) return 0;
  let max = 0;
  // NGA HTML 中每楼头部都有"X楼"标识，末页最多 20 个匹配
  const matches = html.matchAll(/(\d+)\s*楼/g);
  for (const m of matches) {
    const n = parseInt(m[1], 10);
    if (!isNaN(n) && n > max && n < 1_000_000) max = n;
  }
  return max;
}

/**
 * 检测 HTML 编码
 * - 优先从 <meta charset> 提取
 * - 兜底返回 'GBK'（NGA 默认）
 */
export function detectCharsetFromHtml(buffer: ArrayBuffer | Uint8Array | string): string {
  let head: string;
  if (typeof buffer === 'string') {
    head = buffer.substring(0, 2000);
  } else {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    // TextDecoder 可直接接受 Uint8Array view
    head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 2000));
  }
  const m = head.match(/charset\s*=\s*['"]?([\w-]+)/i);
  if (m) {
    const cs = m[1].toUpperCase();
    if (cs === 'GB2312' || cs === 'GBK') return 'GBK';
    if (cs === 'UTF-8' || cs === 'UTF8') return 'UTF-8';
    return cs;
  }
  return 'GBK';
}
