// ============================================================
// NGA「更新」功能：把爬取到的节追加到作品末尾
// - extractSectionsFromCollectJson：从 collectAnkeToWorkJson 产出的 JSON 中取节
// - resolveAppendTarget：定位作品最后一章 + 新节的起始 order_index
// - buildAppendRows：拼装 bulkCreateSections 入参
// 纯函数，便于单测；实际写库在 EditorPage 中复用既有 bulkCreateSections
// ============================================================

import type { Chapter, SectionMeta, Volume } from '../types';

export interface IncomingSection {
  title: string;
  content: string;
}

export interface AppendTarget {
  chapterId: string;
  nextOrder: number;
}

/** 从「收集安科」产出的作品 JSON 中按卷/章顺序提取全部节 */
export function extractSectionsFromCollectJson(jsonData: unknown): IncomingSection[] {
  const data = (jsonData as { data?: { chapters?: unknown } } | null)?.data;
  const chapters = Array.isArray(data?.chapters) ? data.chapters : [];
  const out: IncomingSection[] = [];
  for (const chapter of chapters as Array<{ sections?: unknown }>) {
    const sections = Array.isArray(chapter?.sections) ? chapter.sections : [];
    for (const section of sections as Array<{ title?: unknown; content?: unknown }>) {
      if (typeof section?.content !== 'string' || !section.content.trim()) continue;
      const rawTitle = typeof section.title === 'string' ? section.title.trim() : '';
      out.push({
        title: rawTitle || `第 ${out.length + 1} 节`,
        content: section.content,
      });
    }
  }
  return out;
}

/**
 * 定位追加目标：必须落在「目录显示顺序」的最后一个章。
 * 目录渲染顺序为：按 order_index 排序的各卷 → 卷内按 order_index 排序的章
 * → 最后是「未归卷」章。因此未归卷存在时，末尾就是最后一个未归卷章；
 * 否则取最后一个「有章」的卷里的最后一个章（空卷不参与）。
 * 返回 null 表示作品还没有任何章，需要调用方先创建卷/章。
 */
export function resolveAppendTarget(
  volumes: Volume[],
  chapters: Chapter[],
  sections: SectionMeta[],
): AppendTarget | null {
  if (chapters.length === 0) return null;

  const byOrder = (a: Chapter, b: Chapter) => {
    const d = (a.order_index || 0) - (b.order_index || 0);
    return d !== 0 ? d : a.id < b.id ? -1 : 1;
  };

  // 与 DirectoryTree 保持一致：卷内章 → 未归卷章（渲染在最后）
  const sortedVolumes = [...volumes].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
  const ordered: Chapter[] = [];
  for (const vol of sortedVolumes) {
    ordered.push(...chapters.filter((c) => c.volume_id === vol.id).sort(byOrder));
  }
  ordered.push(...chapters.filter((c) => !c.volume_id || !sortedVolumes.some((v) => v.id === c.volume_id)).sort(byOrder));

  const target = ordered[ordered.length - 1];
  if (!target) return null;

  const nextOrder = sections
    .filter((s) => s.chapter_id === target.id)
    .reduce((max, s) => Math.max(max, (s.order_index || 0) + 1), 0);

  return { chapterId: target.id, nextOrder };
}

/** 拼装 bulkCreateSections 入参（order_index 从 baseOrder 连续递增） */
export function buildAppendRows(
  chapterId: string,
  incoming: IncomingSection[],
  baseOrder: number,
): Array<{ chapter_id: string; title: string; content: string; order_index: number }> {
  return incoming.map((section, i) => ({
    chapter_id: chapterId,
    title: section.title,
    content: section.content,
    order_index: baseOrder + i,
  }));
}
