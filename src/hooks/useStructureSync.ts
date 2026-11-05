// ============================================================
// 目录 ↔ 大纲 双向同步（从 EditorPage 抽出）
// 只负责计算差异、打开弹窗与按要求应用差异；UI 由 SyncDialog 承担。
// ============================================================

import { useState } from 'react';
import { useStoryStore } from '../store/storyStore';
import {
  computeDiff,
  buildOutlineStructure,
  buildDirectoryStructure,
  type DiffItem,
  type SyncSource,
} from '../utils/structureSync';
import { parseOutlineContent } from '../types';

export function useStructureSync() {
  const {
    activeStoryId,
    outlines,
    volumes,
    chapters,
    createOutlineVolume,
    createOutlineChapter,
    updateOutline,
    renameOutline,
    deleteOutline,
    createVolume,
    createChapter,
    renameVolume,
    renameChapter,
    deleteVolume,
    deleteChapter,
  } = useStoryStore();

  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<SyncSource>('directory');
  const [volumeDiffs, setVolumeDiffs] = useState<DiffItem[]>([]);
  const [chapterDiffs, setChapterDiffs] = useState<DiffItem[]>([]);

  const openDialog = (src: SyncSource = 'directory') => {
    if (!activeStoryId) return;
    const outlineStruct = buildOutlineStructure(outlines);
    const dirStruct = buildDirectoryStructure(volumes, chapters, outlines);
    const { volumes: volDiffs, chapters: chDiffs } = computeDiff(src, outlineStruct, dirStruct);
    setSource(src);
    setVolumeDiffs(volDiffs);
    setChapterDiffs(chDiffs);
    setOpen(true);
  };

  const applySync = async (confirmedVolDiffs: DiffItem[], confirmedChDiffs: DiffItem[]) => {
    if (!activeStoryId) return;

    if (source === 'directory') {
      // === 目录 → 大纲：新增缺失的 outline，删除多余的 outline ===
      const outlineVolumeIdByDirId: Record<string, string> = {};
      for (const d of confirmedVolDiffs.filter((d) => d.selected)) {
        if (d.kind === 'add') {
          const id = await createOutlineVolume(d.title);
          outlineVolumeIdByDirId[d.sourceId || ''] = id;
          if (d.sourceId) {
            updateOutline(id, { target_id: d.sourceId });
          }
        } else if (d.kind === 'remove') {
          if (d.destId) deleteOutline(d.destId);
        } else if (d.kind === 'conflict') {
          if (d.keep === 'source') {
            if (d.destId) renameOutline(d.destId, d.title);
          } else {
            if (d.sourceId) renameVolume(d.sourceId, d.otherTitle || d.title);
          }
        }
      }
      for (const d of confirmedChDiffs.filter((d) => d.selected)) {
        if (d.kind === 'add') {
          const chapter = d.sourceId ? chapters.find((c) => c.id === d.sourceId) : null;
          const parentDirVolumeId = chapter?.volume_id || null;
          let parentOutlineVolumeId: string | null = null;
          if (parentDirVolumeId) {
            const parentOutline = outlines.find((o) => {
              const p = parseOutlineContent(o.content);
              return p.target_type === 'volume' && p.target_id === parentDirVolumeId;
            });
            if (parentOutline) parentOutlineVolumeId = parentOutline.id;
            if (!parentOutlineVolumeId && outlineVolumeIdByDirId[parentDirVolumeId]) {
              parentOutlineVolumeId = outlineVolumeIdByDirId[parentDirVolumeId];
            }
          }
          if (parentOutlineVolumeId) {
            const newId = await createOutlineChapter(parentOutlineVolumeId, d.title);
            if (d.sourceId) {
              updateOutline(newId, { target_id: d.sourceId });
            }
          } else {
            // 没有归属的卷，创建一个卷作为容器
            const containerId = await createOutlineVolume('未归卷容器');
            const newId = await createOutlineChapter(containerId, d.title);
            if (d.sourceId) {
              updateOutline(newId, { target_id: d.sourceId });
            }
          }
        } else if (d.kind === 'remove') {
          if (d.destId) deleteOutline(d.destId);
        } else if (d.kind === 'conflict') {
          if (d.keep === 'source') {
            if (d.destId) renameOutline(d.destId, d.title);
          } else {
            if (d.sourceId) renameChapter(d.sourceId, d.otherTitle || d.title);
          }
        }
      }
    } else {
      // === 大纲 → 目录：新增缺失的 volume/chapter，删除多余的 volume/chapter ===
      const dirVolumeIdByOutlineId: Record<string, string> = {};
      for (const d of confirmedVolDiffs.filter((d) => d.selected)) {
        if (d.kind === 'add') {
          const newVolId = await createVolume(activeStoryId, d.title);
          dirVolumeIdByOutlineId[d.sourceId || ''] = newVolId;
          if (d.sourceId) updateOutline(d.sourceId, { target_id: newVolId });
        } else if (d.kind === 'remove') {
          if (d.destId) deleteVolume(d.destId);
        } else if (d.kind === 'conflict') {
          if (d.keep === 'source') {
            if (d.destId) renameVolume(d.destId, d.title);
          } else {
            if (d.sourceId) renameOutline(d.sourceId, d.otherTitle || d.title);
          }
        }
      }
      for (const d of confirmedChDiffs.filter((d) => d.selected)) {
        if (d.kind === 'add') {
          const outline = d.sourceId ? outlines.find((o) => o.id === d.sourceId) : null;
          const payload = outline ? parseOutlineContent(outline.content) : null;
          const parentOutlineId = payload?.parent_outline_id;
          let parentVolumeId: string | null = null;
          if (parentOutlineId) {
            const parentOutline = outlines.find((o) => o.id === parentOutlineId);
            if (parentOutline) {
              const parentPayload = parseOutlineContent(parentOutline.content);
              parentVolumeId = parentPayload.target_id || null;
            }
            if (!parentVolumeId && dirVolumeIdByOutlineId[parentOutlineId]) {
              parentVolumeId = dirVolumeIdByOutlineId[parentOutlineId];
            }
          }
          const newChapterId = await createChapter(activeStoryId, d.title, parentVolumeId);
          if (d.sourceId && outline) updateOutline(d.sourceId, { target_id: newChapterId });
        } else if (d.kind === 'remove') {
          if (d.destId) deleteChapter(d.destId);
        } else if (d.kind === 'conflict') {
          if (d.keep === 'source') {
            if (d.destId) renameChapter(d.destId, d.title);
          } else {
            if (d.sourceId) renameOutline(d.sourceId, d.otherTitle || d.title);
          }
        }
      }
    }

    setOpen(false);
  };

  return {
    open,
    close: () => setOpen(false),
    source,
    volumeDiffs,
    chapterDiffs,
    openDialog,
    applySync,
  };
}
