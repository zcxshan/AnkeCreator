// ============================================================
// 收集安科：NGA 帖子 → 安科作品 JSON
//
// 流程：解析 URL → 调主进程爬取 → 按 authorid 过滤（如指定） → BBCode 转 HTML
//       → 切分为多个 section → 拼 anke-creator-export JSON
// ============================================================

import { parseThreadUrl, type RawPost } from './ngaCrawler';
import { bbcodeToHtml } from './ngaBBCodeToHtml';

/** 节切分模式 */
export type SectionMode = 'single' | 'one-per-floor' | 'every-n';

/**
 * 收集安科 JSON 的"格式详细设置"：
 * 用占位符自定义卷名/章名/节名/节内容的范围标记。
 *
 * 支持的占位符：
 * - `{volIndex}`: 卷序号（当前仅 1）
 * - `{chapterIndex}`: 章序号（当前仅 1）
 * - `{startFloor}`: 该节起始楼层号
 * - `{endFloor}`: 该节结束楼层号
 *
 * 模板示例：
 * - `第{volIndex}卷` → 渲染为 `第1卷`
 * - `第一章` → 渲染为 `第一章`（无占位符，直接使用）
 * - `第 {startFloor}-{endFloor} 楼` → 渲染为 `第 1-10 楼`
 * - `这节内容是{startFloor}楼到{endFloor}楼` → 渲染为 `这节内容是1楼到10楼`
 *
 * 默认值与原硬编码行为完全一致（向后兼容）。
 */
export interface FormatSettings {
  volumeTitleFormat: string;
  chapterTitleFormat: string;
  sectionTitleFormat: string;
  /**
   * 节内容范围标记（可选，空 = 不加）。
   * 用户填入的字符串会作为节内容的最前面一行插入，例如
   * `这节内容是{startFloor}楼到{endFloor}楼的内容`
   * 占位符替换后会变成 `这节内容是1楼到10楼的内容`。
   */
  sectionContentRangeFormat: string;
}

/** FormatSettings 默认值（与原硬编码行为完全一致，向后兼容） */
export const DEFAULT_FORMAT_SETTINGS: FormatSettings = {
  volumeTitleFormat: '第一卷',
  chapterTitleFormat: '第一章',
  sectionTitleFormat: '第 {startFloor}-{endFloor} 楼',
  sectionContentRangeFormat: '',
};

/**
 * 交互式高级格式设置：用户手动指定卷/章/节结构 + 楼号范围。
 * 启用后爬取数据按用户指定的楼号范围切分到对应节。
 */
export interface ManualSectionConfig {
  title: string;
  startFloor: number;
  endFloor: number;
}
export interface ManualChapterConfig {
  title: string;
  sections: ManualSectionConfig[];
}
export interface ManualVolumeConfig {
  title: string;
  chapters: ManualChapterConfig[];
}
export interface ManualFormatConfig {
  enabled: boolean;
  volumes: ManualVolumeConfig[];
}

/** 切分后的一个节 */
export interface Section {
  title: string;
  order_index: number;
  content: string; // 完整 HTML（含所有楼 + 楼间 hr）
  posts: RawPost[]; // 原始 posts，方便测试断言
}

export interface AnkeCollectOptions {
  url: string;
  startFloor: number;
  endFloor: number;
  workTitle: string;
  /** 切分模式：'single' / 'one-per-floor' / 'every-n'（默认 'every-n'） */
  sectionMode?: SectionMode;
  /** 每 N 楼一节（仅 sectionMode='every-n' 时有效，默认 10） */
  floorsPerSection?: number;
  /** NGA Cookie（登录受限帖子需要） */
  cookies?: string;
  /** 只看该作者（从 URL 的 &authorid=XXX 解析，或显式传入） */
  authorid?: string;
  /**
   * JSON 格式详细设置（卷/章/节命名模板）。可选，缺省使用 DEFAULT_FORMAT_SETTINGS。
   * 详见 FormatSettings 注释。
   */
  formatSettings?: FormatSettings;
  /**
   * 交互式高级格式设置：用户手动指定卷/章/节结构 + 楼号范围。
   * 启用后忽略 formatSettings 与 sectionMode/floorsPerSection，按用户指定结构切分。
   */
  manualFormat?: ManualFormatConfig;
  /**
   * 重试模式：只抓取 retryPages 里的页码，结果会按 floor 去重合并到 jsonData。
   * 失败页会出现在返回值的 failedPages 中供再次重试。
   * 配合 existingItems 可以把上一轮已抓到的内容做 floor 去重补齐。
   */
  retryPages?: number[];
  /**
   * 已有抓取结果（重试模式下用于按 floor 去重补齐）。可空。
   */
  existingItems?: RawPost[];
}

export interface AnkeCollectResult {
  ok: boolean;
  error?: string;
  jsonData?: unknown;
  fileName?: string;
  stats?: { totalFloors: number; sectionCount: number };
  /** 抓取失败的页码列表（透传自主进程） */
  failedPages?: number[];
  /** 帖子实际最高楼层（透传自主进程，用于超范围提示） */
  actualMaxFloor?: number;
  /**
   * 本次构建 JSON 所用到的全部 posts（按 floor 排序）。
   * 配合 retryPages + existingItems 可实现"重试失败页"自动补齐。
   */
  items?: RawPost[];
}

/**
 * 在 [startFloor, endFloor] 范围内，补齐 posts 中缺失的楼层。
 * 缺失的楼层插入占位 RawPost，内容为醒目的红色粗体提示，
 * 用于抓取失败/被吞楼后提示用户手动补充。
 * authorid 模式下不应调用（楼层间隔是其他作者回复，属于正常间隙）。
 */
export function insertPlaceholderPosts(
  posts: RawPost[],
  startFloor: number,
  endFloor: number,
): RawPost[] {
  if (posts.length === 0) return posts;
  const existing = new Set(posts.map((p) => p.floor));
  const placeholders: RawPost[] = [];
  for (let f = startFloor; f <= endFloor; f++) {
    if (!existing.has(f)) {
      placeholders.push({
        floor: f,
        author: '[未知]',
        content: '[color=red][b]楼层内容获取失败，请补充！！！[/b][/color]',
        time: 0,
      });
    }
  }
  if (placeholders.length === 0) return posts;
  const merged = [...posts, ...placeholders];
  merged.sort((a, b) => a.floor - b.floor);
  return merged;
}

/**
 * 根据用户自定义的卷/章/节结构 + 楼号范围构建作品 JSON。
 * 高内聚低耦合：UI 在 AnkeCollectPage，逻辑在此，NGA / 骨碌碌共用。
 * 唯一差异点是 buildSectionHtml：NGA 用 buildSectionHtml，骨碌碌用 buildGululuSectionHtml。
 */
export interface BuildManualFormatJsonOpts {
  manualFormat: ManualFormatConfig;
  posts: RawPost[];
  buildSectionHtml: (posts: RawPost[]) => string;
  baseData: Record<string, unknown>;
  baseMeta: Record<string, unknown>;
}

export interface BuildManualFormatJsonResult {
  jsonData: unknown;
  sectionCount: number;
}

export function buildManualFormatJson(
  opts: BuildManualFormatJsonOpts,
): BuildManualFormatJsonResult {
  const mf = opts.manualFormat;
  const volumes: any[] = [];
  const chapters: any[] = [];
  let secIdx = 0;
  for (let vi = 0; vi < mf.volumes.length; vi++) {
    const vol = mf.volumes[vi];
    const volId = `vol-${vi}`;
    volumes.push({ id: volId, title: vol.title, order_index: vi });
    for (let ci = 0; ci < vol.chapters.length; ci++) {
      const ch = vol.chapters[ci];
      const chapterSections = ch.sections.map((sec, si) => {
        const sectionPosts = opts.posts.filter(
          (p) => p.floor >= sec.startFloor && p.floor <= sec.endFloor,
        );
        const inner = opts.buildSectionHtml(sectionPosts);
        const content = sectionPosts.length > 1
          ? `<div class="anke-section">${inner}</div>`
          : inner;
        return { title: sec.title, order_index: si, content };
      });
      chapters.push({
        title: ch.title,
        volume_id: volId,
        order_index: ci,
        sections: chapterSections,
      });
      secIdx += ch.sections.length;
    }
  }
  return {
    sectionCount: secIdx,
    jsonData: {
      ...opts.baseData,
      data: {
        ...opts.baseMeta,
        volumes,
        chapters,
        characters: [],
        world_settings: [],
        outlines: [],
        character_relations: [],
        dice_history: [],
      },
    },
  };
}

/** 主入口：爬取 → 转换 → 切分 → 拼作品 JSON */
export async function collectAnkeToWorkJson(
  opts: AnkeCollectOptions,
): Promise<AnkeCollectResult> {
  // 1. 解析 URL
  const parsed = parseThreadUrl(opts.url);
  if (!parsed) {
    return { ok: false, error: 'URL 格式不正确，请确认包含 ?tid=XXX' };
  }

  // 2. 楼层范围校验
  if (
    !Number.isFinite(opts.startFloor) ||
    !Number.isFinite(opts.endFloor) ||
    opts.startFloor < 1 ||
    opts.endFloor < opts.startFloor
  ) {
    return { ok: false, error: '楼层范围不合法' };
  }

  // 3. 调主进程（用与 collectNga 一致的 IPC shape）
  //    后端已有单页自动重试 3 次，此处不再外层重试（避免重复爬全部页面且丢失 failedPages）
  //    authorid 优先用 opts.authorid，其次从 URL 解析（兼容旧调用方）
  const parsedAuthorid = opts.authorid || parsed.authorid;
  const collectRes = await window.electronAPI?.collectNga?.({
    url: opts.url,
    startFloor: opts.startFloor,
    endFloor: opts.endFloor,
    prefix: '',
    authorid: parsedAuthorid,
    cookies: opts.cookies,
    // 透传重试页（主进程会按此过滤）
    ...(opts.retryPages && opts.retryPages.length > 0
      ? { retryPages: opts.retryPages }
      : {}),
  });
  if (!collectRes || !collectRes.ok) {
    return { ok: false, error: collectRes?.error || '抓取失败：主进程不可用' };
  }

  // 4. 主进程已按 authorid 抓取"只看该作者"页面，无需渲染进程二次 uid 过滤
  let posts = collectRes.items || [];
  // 5. 楼层范围裁剪
  //    - authorid 模式：主进程已按作者回复序号裁剪，这里直接用返回结果
  //    - 非 authorid 模式：按楼层号过滤
  if (!parsedAuthorid) {
    posts = posts.filter(
      (p: any) => p.floor >= opts.startFloor && p.floor <= opts.endFloor,
    );
  }
  // 6. 按 floor 去重（保留首次出现），防止任何来源的重复楼层进入 JSON
  const seenFloors = new Set<number>();
  posts = posts.filter((p: any) => {
    if (seenFloors.has(p.floor)) return false;
    seenFloors.add(p.floor);
    return true;
  });
  // 6.5 重试模式：把上一轮已抓到的 items 按 floor 去重补齐（被本轮新抓到的覆盖）
  if (opts.existingItems && opts.existingItems.length > 0) {
    const newFloors = new Set(posts.map((p: any) => p.floor));
    const leftovers = opts.existingItems.filter((p) => !newFloors.has(p.floor));
    posts = [...posts, ...leftovers];
  }
  // 7. 排序
  posts.sort((a: any, b: any) => a.floor - b.floor);

  // 7.5 非 authorid 模式下，补齐 [startFloor, endFloor] 范围内缺失的楼层（插入占位），
  //     失败/被吞楼层的内容会变成醒目的占位提示，方便用户手动补充。
  //     authorid 模式下楼层间隔是其他作者的帖子，属于正常间隙，不插占位。
  if (!parsedAuthorid) {
    posts = insertPlaceholderPosts(posts as RawPost[], opts.startFloor, opts.endFloor);
  }

  if (posts.length === 0) {
    return { ok: false, error: '指定范围内无内容' };
  }

  // 7. 拼作品 JSON
  const finalTitle = opts.workTitle?.trim() || `安科-${parsed.tid}`;
  const baseData = {
    format: 'anke-creator-export' as const,
    version: '1.1',
    exportedAt: new Date().toISOString(),
    appVersion: '0.1.0',
  };
  const baseMeta = {
    title: finalTitle,
    description: `源：NGA tid=${parsed.tid}，第 ${opts.startFloor}-${opts.endFloor} 楼`,
    category: '安科',
  };

  let jsonData: unknown;
  let sectionCount: number;

  if (opts.manualFormat?.enabled && opts.manualFormat.volumes.length > 0) {
    // 交互式高级格式：按用户指定的卷/章/节 + 楼号范围切分（共享逻辑，NGA/骨碌碌共用）
    const result = buildManualFormatJson({
      manualFormat: opts.manualFormat,
      posts: posts as RawPost[],
      buildSectionHtml: (secPosts) => buildSectionHtml(secPosts),
      baseData,
      baseMeta,
    });
    jsonData = result.jsonData;
    sectionCount = result.sectionCount;
  } else {
    // 原有逻辑：按 sectionMode + floorsPerSection 切分，单卷单章
    const sections = splitPostsIntoSections(
      posts as RawPost[],
      opts.sectionMode ?? 'every-n',
      opts.floorsPerSection ?? 10,
    );
    sectionCount = sections.length;
    // 合并 formatSettings（用户自定义覆盖默认值）
    const fmt: FormatSettings = {
      ...DEFAULT_FORMAT_SETTINGS,
      ...(opts.formatSettings || {}),
    };
    // 当前只支持单卷单章：{volIndex}=1, {chapterIndex}=1
    const volIndex = 1;
    const chapterIndex = 1;
    const volumeTitle = fmt.volumeTitleFormat
      .replace(/\{volIndex\}/g, String(volIndex))
      .replace(/\{chapterIndex\}/g, String(chapterIndex));
    const chapterTitle = fmt.chapterTitleFormat
      .replace(/\{volIndex\}/g, String(volIndex))
      .replace(/\{chapterIndex\}/g, String(chapterIndex));
    jsonData = {
      ...baseData,
      data: {
        ...baseMeta,
        volumes: [
          {
            id: 'vol-default',
            title: volumeTitle,
            order_index: 0,
          },
        ],
        chapters: [
          {
            title: chapterTitle,
            volume_id: 'vol-default',
            order_index: 0,
            sections: sections.map((s) => {
              const startF = s.posts[0]?.floor ?? 0;
              const endF = s.posts[s.posts.length - 1]?.floor ?? 0;
              const sectionTitle = fmt.sectionTitleFormat
                .replace(/\{startFloor\}/g, String(startF))
                .replace(/\{endFloor\}/g, String(endF))
                .replace(/\{volIndex\}/g, String(volIndex))
                .replace(/\{chapterIndex\}/g, String(chapterIndex));
              const rangeLine = fmt.sectionContentRangeFormat
                ? `<p class="anke-section-range">${fmt.sectionContentRangeFormat
                    .replace(/\{startFloor\}/g, String(startF))
                    .replace(/\{endFloor\}/g, String(endF))}</p>\n\n`
                : '';
              return {
                title: sectionTitle,
                order_index: s.order_index,
                content: rangeLine + s.content,
              };
            }),
          },
        ],
        characters: [],
        world_settings: [],
        outlines: [],
        character_relations: [],
        dice_history: [],
      },
    };
  }

  const safeTitle = finalTitle.replace(/[\/:*?"<>|]/g, '_');
  return {
    ok: true,
    jsonData,
    fileName: safeTitle,
    stats: { totalFloors: posts.length, sectionCount },
    failedPages: collectRes.failedPages,
    actualMaxFloor: collectRes.actualMaxFloor,
    items: posts as RawPost[],
  };
}

/**
 * 把 posts 切成多个 section（mode + n 控制粒度）
 * - 'single' 整段一节
 * - 'one-per-floor' 每楼一节
 * - 'every-n' 每 N 楼一节（N=1 等价于 one-per-floor）
 */
export function splitPostsIntoSections(
  posts: RawPost[],
  mode: SectionMode,
  n: number = 10,
): Section[] {
  if (posts.length === 0) return [];

  const groups: RawPost[][] = [];
  if (mode === 'single') {
    groups.push(posts);
  } else if (mode === 'one-per-floor') {
    for (const p of posts) groups.push([p]);
  } else {
    // every-n
    const step = Math.max(1, Math.floor(n));
    for (let i = 0; i < posts.length; i += step) {
      groups.push(posts.slice(i, i + step));
    }
  }

  return groups.map((g, i) => {
    const startF = g[0].floor;
    const endF = g[g.length - 1].floor;
    const inner = buildSectionHtml(g);
    // 多楼合节用 <div class="anke-section"> 整体包装（BBCode 同步可整体处理）；
    // 单楼 section 不嵌包装，避免 BBCode 同步时被丢弃。
    const content = g.length > 1
      ? `<div class="anke-section">${inner}</div>`
      : inner;
    return {
      title: g.length === 1
        ? `第 ${startF} 楼`
        : `第 ${startF}-${endF} 楼`,
      order_index: i,
      content,
      posts: g,
    };
  });
}

/**
 * 一节内容：每楼前加 h4 小标题"—— 3 楼 @作者 · 时间 ——" + 楼间虚线 <hr>。
 * 返回纯 inner HTML（不含 <div class="anke-section"> 包装），由 splitPostsIntoSections
 * 根据是否多楼决定是否补一层包装。
 * 保留原帖图片（含 image-block），导入后可视化视图可正常显示。
 */
export function buildSectionHtml(posts: RawPost[]): string {
  const blocks = posts.map((p) => {
    const inner = bbcodeToHtml(p.content);
    const timeStr = formatPostTime(p.time);
    const header = timeStr
      ? `—— ${p.floor} 楼 @${escapeHtml(p.author)} · ${timeStr} ——`
      : `—— ${p.floor} 楼 @${escapeHtml(p.author)} ——`;
    return `<h4 style="margin: 12px 0 8px; color: var(--accent); font-size: 14px; font-weight: 600;">${header}</h4>${inner}`;
  });
  return blocks.join(
    '<hr style="border:none; border-top:1px dashed var(--border-color); margin:16px 0;" />',
  );
}

/** 剥离 image-block 元素（收集安科不应把原帖 [img] 带入新作品，避免 BBCode 同步时混入旧骰点图） */
export function stripImageBlocks(html: string): string {
  if (typeof html !== 'string' || !html) return html || '';
  if (typeof document === 'undefined') {
    // happy-dom / Node 环境无 document：退化为正则兜底，匹配 <div ... data-type="image-block" ...>...</div>
    return html.replace(/<div\b[^>]*data-type="image-block"[^>]*>[\s\S]*?<\/div>/gi, '');
  }
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('[data-type="image-block"]').forEach((el) => el.remove());
  return tmp.innerHTML;
}

/** 把秒级时间戳格式化为 YYYY-MM-DD HH:mm（本地时区）；非法值返回空字符串 */
export function formatPostTime(ts: number | undefined | null): string {
  if (ts === undefined || ts === null) return '';
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[c] as string),
  );
}
