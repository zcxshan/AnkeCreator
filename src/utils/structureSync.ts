// ============================================================
// 结构同步：大纲 ↔ 目录
//
// 功能：
//  - 构建大纲侧的卷/章结构（从 outlines 列表提取）
//  - 构建目录侧的卷/章结构（从 volumes/chapters 列表提取）
//  - 比对结构差异（新增 / 删除 / 冲突）
//  - 在 store 上应用差异
// ============================================================

import type { Outline, OutlinePayload, Volume, Chapter } from '../types';
import { parseOutlineContent } from '../types';

// ------------------------------------------------------------
// 1. 结构节点（统一描述）
// ------------------------------------------------------------

export interface OutlineVolumeNode {
  outlineId: string;
  title: string;
  linkedVolumeId: string; // 目录侧的 volume.id（空字符串表示未关联）
  orderIndex: number;
  bodyHasContent: boolean;
}

export interface OutlineChapterNode {
  outlineId: string;
  title: string;
  parentOutlineId: string; // 归属的大纲卷 outline.id
  linkedChapterId: string; // 目录侧的 chapter.id（空字符串表示未关联）
  orderIndex: number;
  bodyHasContent: boolean;
}

export interface OutlineStructure {
  volumes: OutlineVolumeNode[];
  chapters: OutlineChapterNode[]; // 所有章（按 parentOutlineId 归属）
}

export interface DirectoryVolumeNode {
  volumeId: string;
  title: string;
  linkedOutlineId: string;
  orderIndex: number;
}

export interface DirectoryChapterNode {
  chapterId: string;
  title: string;
  parentVolumeId: string;
  linkedOutlineId: string;
  orderIndex: number;
}

export interface DirectoryStructure {
  volumes: DirectoryVolumeNode[];
  chapters: DirectoryChapterNode[];
}

// ------------------------------------------------------------
// 2. 构建结构
// ------------------------------------------------------------

export function buildOutlineStructure(outlines: Outline[]): OutlineStructure {
  const volNodes: OutlineVolumeNode[] = [];
  const chNodes: OutlineChapterNode[] = [];

  const sorted = [...outlines].sort((a, b) => a.order_index - b.order_index);

  sorted.forEach((o) => {
    const p: OutlinePayload = parseOutlineContent(o.content);
    const hasBody = !!(
      p.body &&
      p.body.trim().length > 0 &&
      p.body !== '{}' &&
      p.body !== 'null'
    );
    if (p.target_type === 'volume') {
      volNodes.push({
        outlineId: o.id,
        title: p.title,
        linkedVolumeId: p.target_id || '',
        orderIndex: o.order_index,
        bodyHasContent: hasBody,
      });
    } else if (p.target_type === 'chapter') {
      chNodes.push({
        outlineId: o.id,
        title: p.title,
        parentOutlineId: p.parent_outline_id || '',
        linkedChapterId: p.target_id || '',
        orderIndex: o.order_index,
        bodyHasContent: hasBody,
      });
    }
  });

  return { volumes: volNodes, chapters: chNodes };
}

export function buildDirectoryStructure(
  volumes: Volume[],
  chapters: Chapter[],
  outlines: Outline[],
): DirectoryStructure {
  // build volume nodes, look up linked outline by target_id
  const volNodes: DirectoryVolumeNode[] = volumes
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
    .map((v) => {
      const linkedOutline = outlines.find((o) => {
        const p = parseOutlineContent(o.content);
        return p.target_type === 'volume' && p.target_id === v.id;
      });
      return {
        volumeId: v.id,
        title: v.title,
        linkedOutlineId: linkedOutline ? linkedOutline.id : '',
        orderIndex: v.order_index,
      };
    });

  const chNodes: DirectoryChapterNode[] = chapters
    .slice()
    .sort((a, b) => a.order_index - b.order_index)
    .map((c) => {
      const linkedOutline = outlines.find((o) => {
        const p = parseOutlineContent(o.content);
        return p.target_type === 'chapter' && p.target_id === c.id;
      });
      return {
        chapterId: c.id,
        title: c.title,
        parentVolumeId: c.volume_id || '',
        linkedOutlineId: linkedOutline ? linkedOutline.id : '',
        orderIndex: c.order_index,
      };
    });

  return { volumes: volNodes, chapters: chNodes };
}

// ------------------------------------------------------------
// 3. 差异项
// ------------------------------------------------------------

export type DiffKind = 'add' | 'remove' | 'conflict';
export type SyncSource = 'outline' | 'directory';

export interface DiffItem {
  id: string;                    // 唯一 key
  kind: DiffKind;                // 类型
  nodeType: 'volume' | 'chapter';
  title: string;                 // 源侧标题
  /** 冲突时：另一侧的标题 */
  otherTitle?: string;
  /** 在源侧的 id（新增场景用） */
  sourceId?: string;
  /** 在目标侧的 id（删除/冲突场景用） */
  destId?: string;
  /** 源侧的父级（在目标侧创建时需要） */
  sourceParentId?: string;
  /** 目标侧的父级（在目标侧删除/创建时需要） */
  destParentId?: string;
  /** 用户是否勾选应用此差异 */
  selected: boolean;
  /** 冲突场景：保留哪一侧 */
  keep: 'source' | 'dest';
}

// ------------------------------------------------------------
// 4. 计算差异（核心比对）
//
// 规则：
//  - 先通过强匹配（target_id 关联）确定一对一关系
//  - 剩余项按标题模糊匹配
//  - 最后剩下的 → 新增/删除
// ------------------------------------------------------------

export function computeDiff(
  source: SyncSource,
  outlineStruct: OutlineStructure,
  dirStruct: DirectoryStructure,
): { volumes: DiffItem[]; chapters: DiffItem[] } {
  if (source === 'outline') {
    return computeOutlineToDirectory(outlineStruct, dirStruct);
  }
  return computeDirectoryToOutline(outlineStruct, dirStruct);
}

function computeOutlineToDirectory(
  os: OutlineStructure,
  ds: DirectoryStructure,
): { volumes: DiffItem[]; chapters: DiffItem[] } {
  // ---- 卷 ----
  const volDiffs: DiffItem[] = [];
  const matchedOutlineIds = new Set<string>();
  const matchedDirIds = new Set<string>();

  // 强匹配：大纲卷.linkedVolumeId === 目录卷.volumeId
  os.volumes.forEach((ov) => {
    if (!ov.linkedVolumeId) return;
    const match = ds.volumes.find((dv) => dv.volumeId === ov.linkedVolumeId);
    if (match) {
      matchedOutlineIds.add(ov.outlineId);
      matchedDirIds.add(match.volumeId);
      if (ov.title !== match.title) {
        volDiffs.push({
          id: 'vol-conflict-' + ov.outlineId,
          kind: 'conflict',
          nodeType: 'volume',
          title: ov.title,
          otherTitle: match.title,
          sourceId: ov.outlineId,
          destId: match.volumeId,
          selected: true,
          keep: 'source',
        });
      }
    }
  });

  // 剩余大纲卷 → 按标题与目录卷匹配
  const remainingDirVols = ds.volumes.filter((v) => !matchedDirIds.has(v.volumeId));
  os.volumes
    .filter((ov) => !matchedOutlineIds.has(ov.outlineId))
    .forEach((ov) => {
      const titleMatch = remainingDirVols.find((dv) => dv.title === ov.title);
      if (titleMatch) {
        matchedOutlineIds.add(ov.outlineId);
        matchedDirIds.add(titleMatch.volumeId);
        // 标题相同 → 没有差异（视为隐性已匹配）
      } else {
        // 大纲有，目录没有 → 新增
        volDiffs.push({
          id: 'vol-add-' + ov.outlineId,
          kind: 'add',
          nodeType: 'volume',
          title: ov.title,
          sourceId: ov.outlineId,
          selected: true,
          keep: 'source',
        });
      }
    });

  // 剩余目录卷 → 删除
  ds.volumes
    .filter((dv) => !matchedDirIds.has(dv.volumeId))
    .forEach((dv) => {
      volDiffs.push({
        id: 'vol-remove-' + dv.volumeId,
        kind: 'remove',
        nodeType: 'volume',
        title: dv.title,
        destId: dv.volumeId,
        selected: false,
        keep: 'dest',
      });
    });

  // ---- 章 ----
  const chDiffs: DiffItem[] = [];
  const matchedChOutlineIds = new Set<string>();
  const matchedChDirIds = new Set<string>();

  // 强匹配：大纲章.linkedChapterId === 目录章.chapterId
  os.chapters.forEach((oc) => {
    if (!oc.linkedChapterId) return;
    const match = ds.chapters.find((dc) => dc.chapterId === oc.linkedChapterId);
    if (match) {
      matchedChOutlineIds.add(oc.outlineId);
      matchedChDirIds.add(match.chapterId);
      if (oc.title !== match.title) {
        chDiffs.push({
          id: 'ch-conflict-' + oc.outlineId,
          kind: 'conflict',
          nodeType: 'chapter',
          title: oc.title,
          otherTitle: match.title,
          sourceId: oc.outlineId,
          destId: match.chapterId,
          sourceParentId: oc.parentOutlineId,
          destParentId: match.parentVolumeId,
          selected: true,
          keep: 'source',
        });
      }
    }
  });

  // 剩余大纲章 → 按标题匹配（在对应的父卷下）
  const remainingDirChapters = ds.chapters.filter(
    (c) => !matchedChDirIds.has(c.chapterId),
  );
  os.chapters
    .filter((oc) => !matchedChOutlineIds.has(oc.outlineId))
    .forEach((oc) => {
      const titleMatch = remainingDirChapters.find(
        (dc) => dc.title === oc.title,
      );
      if (titleMatch) {
        matchedChOutlineIds.add(oc.outlineId);
        matchedChDirIds.add(titleMatch.chapterId);
      } else {
        chDiffs.push({
          id: 'ch-add-' + oc.outlineId,
          kind: 'add',
          nodeType: 'chapter',
          title: oc.title,
          sourceId: oc.outlineId,
          sourceParentId: oc.parentOutlineId,
          selected: true,
          keep: 'source',
        });
      }
    });

  // 剩余目录章 → 删除
  ds.chapters
    .filter((dc) => !matchedChDirIds.has(dc.chapterId))
    .forEach((dc) => {
      chDiffs.push({
        id: 'ch-remove-' + dc.chapterId,
        kind: 'remove',
        nodeType: 'chapter',
        title: dc.title,
        destId: dc.chapterId,
        destParentId: dc.parentVolumeId,
        selected: false,
        keep: 'dest',
      });
    });

  return { volumes: volDiffs, chapters: chDiffs };
}

function computeDirectoryToOutline(
  os: OutlineStructure,
  ds: DirectoryStructure,
): { volumes: DiffItem[]; chapters: DiffItem[] } {
  // 方向反的版本：源是目录，目标是大纲
  const volDiffs: DiffItem[] = [];
  const matchedOutlineIds = new Set<string>();
  const matchedDirIds = new Set<string>();

  // 强匹配
  ds.volumes.forEach((dv) => {
    if (!dv.linkedOutlineId) return;
    const match = os.volumes.find((ov) => ov.outlineId === dv.linkedOutlineId);
    if (match) {
      matchedOutlineIds.add(match.outlineId);
      matchedDirIds.add(dv.volumeId);
      if (dv.title !== match.title) {
        volDiffs.push({
          id: 'vol-conflict-' + dv.volumeId,
          kind: 'conflict',
          nodeType: 'volume',
          title: dv.title,
          otherTitle: match.title,
          sourceId: dv.volumeId,
          destId: match.outlineId,
          selected: true,
          keep: 'source',
        });
      }
    }
  });

  const remainingOsVols = os.volumes.filter((v) => !matchedOutlineIds.has(v.outlineId));
  ds.volumes
    .filter((dv) => !matchedDirIds.has(dv.volumeId))
    .forEach((dv) => {
      const titleMatch = remainingOsVols.find((ov) => ov.title === dv.title);
      if (titleMatch) {
        matchedOutlineIds.add(titleMatch.outlineId);
        matchedDirIds.add(dv.volumeId);
      } else {
        volDiffs.push({
          id: 'vol-add-' + dv.volumeId,
          kind: 'add',
          nodeType: 'volume',
          title: dv.title,
          sourceId: dv.volumeId,
          selected: true,
          keep: 'source',
        });
      }
    });

  os.volumes
    .filter((ov) => !matchedOutlineIds.has(ov.outlineId))
    .forEach((ov) => {
      volDiffs.push({
        id: 'vol-remove-' + ov.outlineId,
        kind: 'remove',
        nodeType: 'volume',
        title: ov.title,
        destId: ov.outlineId,
        selected: false,
        keep: 'dest',
      });
    });

  // 章
  const chDiffs: DiffItem[] = [];
  const matchedChOutlineIds = new Set<string>();
  const matchedChDirIds = new Set<string>();

  ds.chapters.forEach((dc) => {
    if (!dc.linkedOutlineId) return;
    const match = os.chapters.find((oc) => oc.outlineId === dc.linkedOutlineId);
    if (match) {
      matchedChDirIds.add(dc.chapterId);
      matchedChOutlineIds.add(match.outlineId);
      if (dc.title !== match.title) {
        chDiffs.push({
          id: 'ch-conflict-' + dc.chapterId,
          kind: 'conflict',
          nodeType: 'chapter',
          title: dc.title,
          otherTitle: match.title,
          sourceId: dc.chapterId,
          destId: match.outlineId,
          sourceParentId: dc.parentVolumeId,
          destParentId: match.parentOutlineId,
          selected: true,
          keep: 'source',
        });
      }
    }
  });

  const remainingOsChapters = os.chapters.filter(
    (c) => !matchedChOutlineIds.has(c.outlineId),
  );
  ds.chapters
    .filter((dc) => !matchedChDirIds.has(dc.chapterId))
    .forEach((dc) => {
      const titleMatch = remainingOsChapters.find((oc) => oc.title === dc.title);
      if (titleMatch) {
        matchedChOutlineIds.add(titleMatch.outlineId);
        matchedChDirIds.add(dc.chapterId);
      } else {
        chDiffs.push({
          id: 'ch-add-' + dc.chapterId,
          kind: 'add',
          nodeType: 'chapter',
          title: dc.title,
          sourceId: dc.chapterId,
          sourceParentId: dc.parentVolumeId,
          selected: true,
          keep: 'source',
        });
      }
    });

  os.chapters
    .filter((oc) => !matchedChOutlineIds.has(oc.outlineId))
    .forEach((oc) => {
      chDiffs.push({
        id: 'ch-remove-' + oc.outlineId,
        kind: 'remove',
        nodeType: 'chapter',
        title: oc.title,
        destId: oc.outlineId,
        destParentId: oc.parentOutlineId,
        selected: false,
        keep: 'dest',
      });
    });

  return { volumes: volDiffs, chapters: chDiffs };
}
