import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import type { Chapter, SectionMeta, Volume } from '../../types';
import { ConfirmDialog } from './ConfirmDialog';
import { useToastStore } from '../../store/toastStore';

// 节行高度（与原 renderSectionRow 的 py-1.5 + 文字行高一致）
const SECTION_ROW_HEIGHT = 30;
// 节数超过此阈值时启用虚拟滚动（避免大章节渲染卡顿）
const VIRTUALIZE_THRESHOLD = 20;
// 单章节虚拟列表最大高度（从 400 降至 300，避免与状态栏重叠；降低 overscan 总高度）
const SECTION_LIST_MAX_HEIGHT = 300;
// 章节内 virtual list 上限提到 800，避免少节章节被限制在 300px 时下方出现空白
// （侧栏自身已经 overflow-y: auto 滚动）
const SECTION_LIST_MAX_VIRTUAL_HEIGHT = 800;

interface DirectoryTreeProps {
  volumes: Volume[];
  chapters: Chapter[];
  sections: SectionMeta[];
  activeChapterId: string | null;
  activeSectionId: string | null;
  sectionStats: Record<string, { words: number; dice: number }>;
  expandedVolumeIds: Record<string, boolean>;
  expandedChapterIds: Record<string, boolean>;
  /** 在指定锚点节的前/后插入新节（anchorId=null 表示最前/最后） */
  onCreateSectionAt?: (chapterId: string, anchorId: string | null, position: 'before' | 'after') => void;
  /** 在指定锚点章的前/后插入新章（anchorId=null 表示该卷最前/最后） */
  onCreateChapterAt?: (volumeId: string | null, anchorId: string | null, position: 'before' | 'after') => void;
  /** 在指定锚点卷的前/后插入新卷（anchorId=null 表示最前/最后） */
  onCreateVolumeAt?: (anchorId: string | null, position: 'before' | 'after') => void;
  onSelectChapter: (id: string | null) => void;
  onSelectSection: (id: string) => void;
  onCreateVolume: () => void;
  onCreateChapter: (volumeId: string | null) => void;
  onCreateSection: (chapterId: string) => void;
  onRenameVolume: (id: string, title: string) => void;
  onRenameChapter: (id: string, title: string) => void;
  onRenameSection: (id: string, title: string) => void;
  onDeleteVolume: (id: string) => void;
  onDeleteChapter: (id: string) => void;
  onDeleteSection: (id: string) => void;
  onToggleVolume: (id: string) => void;
  onToggleChapter: (id: string) => void;
  onReorderVolumes: (orderedIds: string[]) => void;
  onReorderChapters: (orderedIds: string[]) => void;
  onReorderSections: (chapterId: string, orderedIds: string[]) => void;
  // 跨卷 / 跨章拖动（同时更新 volume_id / chapter_id）
  onMoveChapters: (targetVolumeId: string | null, orderedIds: string[]) => void;
  onMoveSections: (targetChapterId: string, orderedIds: string[]) => void;
  onSyncToOutline?: () => void;
}

function DirectoryTreeInner(props: DirectoryTreeProps) {
  const {
    volumes,
    chapters,
    sections,
    activeChapterId,
    activeSectionId,
    sectionStats,
    expandedVolumeIds,
    expandedChapterIds,
    onSelectChapter,
    onSelectSection,
    onCreateVolume,
    onCreateChapter,
    onCreateSection,
    onRenameVolume,
    onRenameChapter,
    onRenameSection,
    onDeleteVolume,
    onDeleteChapter,
    onDeleteSection,
    onToggleVolume,
    onToggleChapter,
    onReorderVolumes,
    onReorderChapters,
    onReorderSections,
    onMoveChapters,
    onMoveSections,
    onSyncToOutline,
    onCreateSectionAt,
    onCreateChapterAt,
    onCreateVolumeAt,
  } = props;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<'volume' | 'chapter' | 'section' | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const editingRef = useRef<HTMLInputElement | null>(null);
  const [dragVolumeId, setDragVolumeId] = useState<string | null>(null);
  const [dragChapterId, setDragChapterId] = useState<string | null>(null);
  const [dragSectionId, setDragSectionId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: 'volume' | 'chapter' | 'section' | 'blank';
    id: string;
    title: string;
    /** section 节点：所属 chapter_id；chapter 节点：所属 volume_id（null=未归卷） */
    chapterId?: string;
    volumeId?: string | null;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    type: 'volume' | 'chapter' | 'section';
    id: string;
    title: string;
  } | null>(null);

  useEffect(() => {
    if (editingId && editingRef.current) {
      setTimeout(() => {
        editingRef.current?.focus();
        editingRef.current?.select();
      }, 10);
    }
  }, [editingId]);

  useEffect(() => {
    if (!contextMenu) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      // 如果点击目标在菜单自身内部（.anke-ctxmenu-root），忽略
      const el = target as Element;
      if (el.nodeType === 1 && (el as Element).closest?.('.anke-ctxmenu-root')) return;
      setContextMenu(null);
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, [contextMenu]);

  // 章按卷分组 + 节按章分组（预计算，避免 O(V×C×S) 重复 filter+sort）
  const { sortedVolumes, chaptersByVolume, orphanChapters, sectionsByChapter } = useMemo(() => {
    const sv = [...volumes].sort((a, b) => a.order_index - b.order_index);
    const byVol: Record<string, Chapter[]> = {};
    sv.forEach((v) => (byVol[v.id] = []));
    const orphans: Chapter[] = [];
    [...chapters]
      .sort((a, b) => a.order_index - b.order_index)
      .forEach((c) => {
        if (c.volume_id && byVol[c.volume_id]) {
          byVol[c.volume_id].push(c);
        } else {
          orphans.push(c);
        }
      });
    // 节按 chapter_id 分组并按 order_index 排序
    const byCh: Record<string, SectionMeta[]> = {};
    for (const ch of [...orphans, ...sv.flatMap((v) => byVol[v.id])]) {
      byCh[ch.id] = [];
    }
    [...sections]
      .sort((a, b) => a.order_index - b.order_index)
      .forEach((s) => {
        if (!byCh[s.chapter_id]) byCh[s.chapter_id] = [];
        byCh[s.chapter_id].push(s);
      });
    return {
      sortedVolumes: sv,
      chaptersByVolume: byVol,
      orphanChapters: orphans,
      sectionsByChapter: byCh,
    };
  }, [volumes, chapters, sections]);

  // 章/卷字数预计算（useMemo 缓存，避免每次渲染都 reduce）
  const chapterWordCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const chId of Object.keys(sectionsByChapter)) {
      map[chId] = (sectionsByChapter[chId] || []).reduce(
        (sum, s) => sum + (sectionStats[s.id]?.words || 0), 0,
      );
    }
    return map;
  }, [sectionsByChapter, sectionStats]);

  const volumeWordCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const v of sortedVolumes) {
      map[v.id] = (chaptersByVolume[v.id] || []).reduce(
        (sum, ch) => sum + (chapterWordCounts[ch.id] || 0), 0,
      );
    }
    return map;
  }, [sortedVolumes, chaptersByVolume, chapterWordCounts]);

  const commitRename = () => {
    if (!editingId) return;
    const v = editingValue.trim();
    if (!v) {
      setEditingId(null);
      return;
    }
    if (editingType === 'volume') onRenameVolume(editingId, v);
    else if (editingType === 'chapter') onRenameChapter(editingId, v);
    else if (editingType === 'section') onRenameSection(editingId, v);
    setEditingId(null);
  };

  // 节行数据（虚拟列表用，把所有闭包变量打包传给 SectionRowView）
  // 用 useMemo 避免每次重渲染都创建新对象导致 FixedSizeList 全部 re-render
  const sectionRowData = useMemo(() => ({
    sections,
    sectionStats,
    activeSectionId,
    dragSectionId,
    editingId,
    editingValue,
    setEditingValue,
    editingRef,
    setEditingId,
    setDragSectionId,
    setContextMenu,
    onSelectSection,
    onReorderSections,
    onMoveSections,
    commitRename,
  }), [sections, sectionStats, activeSectionId, dragSectionId, editingId, editingValue, commitRename]);

  const renderChapterGroup = (ch: Chapter, dragScope: Chapter[]) => {
    const chapterSecs = sectionsByChapter[ch.id] || [];
    // 章节内 virtual list 高度：min(节数 × 行高, SECTION_LIST_MAX_VIRTUAL_HEIGHT)
    // 之前固定 300px 上限导致少节章节（11 节 × 30 = 330px > 300）下方出现大片空白
    // 上限改为 800px，让少节章节自然撑开；侧栏自身可滚动
    const virtualHeight = Math.min(
      chapterSecs.length * SECTION_ROW_HEIGHT,
      SECTION_LIST_MAX_VIRTUAL_HEIGHT,
    );
    const isExpanded = expandedChapterIds[ch.id];
    const chapterWordCount = chapterWordCounts[ch.id] || 0;
    const isChapterActive = activeChapterId === ch.id;

    return (
      <div key={ch.id} className="mb-0.5">
        <div
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            setDragChapterId(ch.id);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!dragChapterId || dragChapterId === ch.id) {
              setDragChapterId(null);
              return;
            }
            const dragCh = chapters.find((c) => c.id === dragChapterId);
            if (!dragCh) {
              setDragChapterId(null);
              return;
            }
            const targetVolumeId = ch.volume_id;
            // 取目标卷下所有章（已按 order_index 排序），跨卷时被拖入的章不在其中
            const targetVolumeChapters = chapters
              .filter((c) => c.volume_id === targetVolumeId)
              .sort((a, b) => a.order_index - b.order_index);
            const targetIds = targetVolumeChapters.map((c) => c.id);
            const fromIdx = targetIds.indexOf(dragChapterId);
            const toIdx = targetIds.indexOf(ch.id);
            const newOrder = [...targetIds];
            if (fromIdx >= 0) {
              newOrder.splice(fromIdx, 1);
              newOrder.splice(toIdx, 0, dragChapterId);
            } else {
              // 来自其他卷：直接把拖入章插入到目标位置
              newOrder.splice(toIdx, 0, dragChapterId);
            }
            if (dragCh.volume_id === targetVolumeId) {
              onReorderChapters(newOrder);
            } else {
              onMoveChapters(targetVolumeId, newOrder);
            }
            setDragChapterId(null);
          }}
          onDragEnd={() => setDragChapterId(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              type: 'chapter',
              id: ch.id,
              title: ch.title,
              volumeId: ch.volume_id ?? null,
            });
          }}
          className={[
            'group flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition-all',
            dragChapterId === ch.id ? 'opacity-50' : '',
          ].join(' ')}
          style={{
            color: isChapterActive ? 'var(--accent)' : 'var(--text-primary)',
            background: isChapterActive ? 'var(--accent-soft)' : 'transparent',
          }}
          onClick={() => {
            onSelectChapter(isChapterActive ? null : ch.id);
            onToggleChapter(ch.id);
          }}
        >
          <span className="w-4 h-4 flex items-center justify-center text-[10px] shrink-0" style={{ color: 'var(--text-secondary)' }}>
            {isExpanded ? '▼' : '▶'}
          </span>
          <span className="shrink-0">📖</span>
          {editingId === ch.id ? (
            <input
              ref={editingRef}
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setEditingId(null);
              }}
              className="flex-1 min-w-0 text-xs px-1 py-0.5 rounded border outline-none"
              style={{ borderColor: 'var(--accent)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
            />
          ) : (
            <span className="flex-1 font-medium truncate">{ch.title}</span>
          )}
          <span className="shrink-0 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
            {chapterWordCount > 0 ? `${chapterWordCount}字` : ''}
          </span>
          <div
            className={[
              'shrink-0 flex items-center gap-0.5 transition-opacity min-w-[40px] justify-end',
              // 默认隐藏，hover 时显示（避免视觉拥挤）
              // 编辑时强制显示（用户可能需要重命名）
              editingId === ch.id
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100',
            ].join(' ')}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelectChapter(ch.id);
                onToggleChapter(ch.id);
                onCreateSection(ch.id);
              }}
              className="w-5 h-5 flex items-center justify-center rounded text-xs"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-soft)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = ''; }}
              title="添加节"
            >
              +
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingId(ch.id);
                setEditingType('chapter');
                setEditingValue(ch.title);
              }}
              className="w-5 h-5 flex items-center justify-center rounded text-[10px]"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = ''; }}
              title="重命名"
            >
              ✎
            </button>
          </div>
        </div>

        {isExpanded && chapterSecs.length === 0 && (
          <div className="ml-7 py-1 px-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelectChapter(ch.id);
                onCreateSection(ch.id);
              }}
              className="w-full text-left text-[10px] px-2 py-1 rounded transition-colors"
              style={{ color: 'var(--accent)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-soft)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
            >
              + 新增节
            </button>
          </div>
        )}
        {isExpanded && chapterSecs.length > 0 && (
          <div className="ml-3 border-l pl-1 space-y-0.5" style={{ borderColor: 'var(--border-color)' }}>
            {chapterSecs.length > VIRTUALIZE_THRESHOLD ? (
              // 大章节：虚拟滚动（避免 100+ 节一次性渲染卡顿）
              <FixedSizeList
                key={ch.id}
                height={virtualHeight}
                itemCount={chapterSecs.length}
                itemSize={SECTION_ROW_HEIGHT}
                itemData={sectionRowData}
                width="100%"
                overscanCount={50}
              >
                {VirtualSectionRow}
              </FixedSizeList>
            ) : (
              // 普通章节：直接渲染所有节
              chapterSecs.map((sec) => (
                <SectionRowView key={sec.id} sec={sec} data={sectionRowData} />
              ))
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelectChapter(ch.id);
                onCreateSection(ch.id);
              }}
              className="w-full text-left px-3 py-1.5 text-[10px] rounded-md transition-colors flex items-center gap-2 ml-2"
              style={{ color: 'var(--accent)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-soft)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
            >
              <span>＋</span>
              <span>新增节</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  const hasAnyContent = sortedVolumes.length > 0 || orphanChapters.length > 0;

  return (
    <aside
      className="flex flex-col overflow-hidden h-full"
      style={{ background: 'var(--bg-card)' }}
    >
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>目录</div>
        {onSyncToOutline && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSyncToOutline();
            }}
            className="px-2 py-1 text-[10px] font-medium rounded-md transition-colors"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}
            title="将目录的卷/章结构同步到大纲"
          >
            同步
          </button>
        )}
      </div>

      <div className="shrink-0 px-2 pt-2">
        <button
          onClick={onCreateVolume}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors"
          style={{ color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-soft)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
        >
          <span>＋</span>
          <span>新建卷</span>
        </button>
      </div>

      <div
        className="flex-1 overflow-y-auto py-1.5"
        onContextMenu={(e) => {
          // 行级 onContextMenu 已调用 preventDefault，此处据此跳过
          if (e.defaultPrevented) return;
          e.preventDefault();
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            type: 'blank',
            id: '',
            title: '',
          });
        }}
      >
        {!hasAnyContent && (
          <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
            还没有内容
            <div className="mt-2">点击上方「+ 新建卷」开始</div>
          </div>
        )}

        <div className="space-y-0.5 px-2">
          {sortedVolumes.map((v) => {
            const vChapters = chaptersByVolume[v.id] || [];
            const vExpanded = expandedVolumeIds[v.id];
            const vWordCount = volumeWordCounts[v.id] || 0;
            return (
              <div key={v.id} className="mb-1">
                <div
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    setDragVolumeId(v.id);
                  }}
                  onDragOver={(e) => {
                    // 仅 preventDefault（让 drop 能触发），不调用 setState，避免 100+ 节时拖动卡顿
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!dragVolumeId || dragVolumeId === v.id) {
                      setDragVolumeId(null);
                      return;
                    }
                    const ids = sortedVolumes.map((x) => x.id);
                    const fromIdx = ids.indexOf(dragVolumeId);
                    const toIdx = ids.indexOf(v.id);
                    const newOrder = [...ids];
                    newOrder.splice(fromIdx, 1);
                    newOrder.splice(toIdx, 0, dragVolumeId);
                    onReorderVolumes(newOrder);
                    setDragVolumeId(null);
                  }}
                  onDragEnd={() => setDragVolumeId(null)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      type: 'volume',
                      id: v.id,
                      title: v.title,
                    });
                  }}
                  className={[
                    'group flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer text-xs transition-all',
                    dragVolumeId === v.id ? 'opacity-50' : '',
                  ].join(' ')}
                  style={{ color: 'var(--text-primary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                  onClick={() => onToggleVolume(v.id)}
                >
                  <span className="w-4 h-4 flex items-center justify-center text-[10px] shrink-0" style={{ color: 'var(--text-secondary)' }}>
                    {vExpanded ? '▼' : '▶'}
                  </span>
                  <span className="shrink-0">📚</span>
                  {editingId === v.id ? (
                    <input
                      ref={editingRef}
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="flex-1 min-w-0 text-xs px-1 py-0.5 rounded border outline-none"
                      style={{ borderColor: 'var(--accent)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                    />
                  ) : (
                    <span className="flex-1 font-semibold truncate">{v.title}</span>
                  )}
                  <span className="shrink-0 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                    {vWordCount > 0 ? `${vWordCount}字` : ''}
                  </span>
                  <div
                    className={[
                      'shrink-0 flex items-center gap-0.5 transition-opacity min-w-[40px] justify-end',
                      // 默认隐藏，hover/编辑时显示
                      editingId === v.id
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100',
                    ].join(' ')}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateChapter(v.id);
                      }}
                      className="w-5 h-5 flex items-center justify-center rounded text-xs"
                      style={{ color: 'var(--text-secondary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-soft)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = ''; }}
                      title="添加章"
                    >
                      +
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(v.id);
                        setEditingType('volume');
                        setEditingValue(v.title);
                      }}
                      className="w-5 h-5 flex items-center justify-center rounded text-[10px]"
                      style={{ color: 'var(--text-secondary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = ''; }}
                      title="重命名"
                    >
                      ✎
                    </button>
                  </div>
                </div>

                {vExpanded && (
                  <div className="ml-3 border-l pl-1 space-y-0.5 mt-0.5" style={{ borderColor: 'var(--border-color)' }}>
                    {vChapters.map((c) => renderChapterGroup(c, vChapters))}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateChapter(v.id);
                      }}
                      className="w-full text-left px-3 py-1.5 text-[10px] rounded-md transition-colors flex items-center gap-2 ml-2"
              style={{ color: 'var(--accent)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-soft)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                    >
                      <span>＋</span>
                      <span>新增章</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {orphanChapters.length > 0 && (
            <div className="mt-2">
              <div className="px-2 py-1 text-[10px] uppercase" style={{ color: 'var(--text-secondary)' }}>未归卷</div>
              {orphanChapters.map((c) => renderChapterGroup(c, orphanChapters))}
            </div>
          )}
        </div>
      </div>

      {/* 内容较少时显示底部空状态占位（避免大片空白，固定在列底部） */}
      {hasAnyContent && sortedVolumes.length + orphanChapters.length <= 2 && (
        <div
          className="shrink-0 px-4 py-4 text-center text-xs"
          style={{
            color: 'var(--text-secondary)',
            background: 'var(--bg-card)',
          }}
        >
          <div className="mb-1" style={{ fontSize: 14 }}>💡</div>
          <div>目录已显示所有内容</div>
          <div className="mt-1 text-[10px]">可在右侧编辑区开始写作</div>
        </div>
      )}

      {contextMenu && (
        <div
          className="anke-ctxmenu-root fixed z-50 rounded-xl shadow-xl border py-1.5 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y, background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'blank' ? (
            <ContextMenuItem
              icon="+"
              label="添加卷"
              onClick={() => {
                onCreateVolume();
                setContextMenu(null);
              }}
            />
          ) : (
            <ContextMenuItem
              icon="✎"
              label="重命名"
              onClick={() => {
                setEditingId(contextMenu.id);
                setEditingType(contextMenu.type);
                setEditingValue(contextMenu.title);
                setContextMenu(null);
              }}
            />
          )}
          {contextMenu.type === 'volume' && (
            <>
              <ContextMenuItem
                icon="+"
                label="新增章"
                onClick={() => {
                  onCreateChapter(contextMenu.id);
                  setContextMenu(null);
                }}
              />
              {onCreateVolumeAt && (
                <>
                  <ContextMenuItem
                    icon="↑"
                    label="在此卷前添加卷"
                    onClick={() => {
                      onCreateVolumeAt(contextMenu.id, 'before');
                      setContextMenu(null);
                    }}
                  />
                  <ContextMenuItem
                    icon="↓"
                    label="在此卷后添加卷"
                    onClick={() => {
                      onCreateVolumeAt(contextMenu.id, 'after');
                      setContextMenu(null);
                    }}
                  />
                </>
              )}
            </>
          )}
          {contextMenu.type === 'chapter' && (
            <>
              <ContextMenuItem
                icon="+"
                label="新增节"
                onClick={() => {
                  onSelectChapter(contextMenu.id);
                  onCreateSection(contextMenu.id);
                  setContextMenu(null);
                }}
              />
              {onCreateChapterAt && (
                <>
                  <ContextMenuItem
                    icon="↑"
                    label="在此章前添加章"
                    onClick={() => {
                      onCreateChapterAt(contextMenu.volumeId ?? null, contextMenu.id, 'before');
                      setContextMenu(null);
                    }}
                  />
                  <ContextMenuItem
                    icon="↓"
                    label="在此章后添加章"
                    onClick={() => {
                      onCreateChapterAt(contextMenu.volumeId ?? null, contextMenu.id, 'after');
                      setContextMenu(null);
                    }}
                  />
                </>
              )}
            </>
          )}
          {contextMenu.type === 'section' && onCreateSectionAt && (
            <>
              <ContextMenuItem
                icon="↑"
                label="在此节前添加节"
                onClick={() => {
                  onCreateSectionAt(contextMenu.chapterId ?? contextMenu.id, contextMenu.id, 'before');
                  setContextMenu(null);
                }}
              />
              <ContextMenuItem
                icon="↓"
                label="在此节后添加节"
                onClick={() => {
                  onCreateSectionAt(contextMenu.chapterId ?? contextMenu.id, contextMenu.id, 'after');
                  setContextMenu(null);
                }}
              />
            </>
          )}
          {contextMenu.type !== 'blank' && (
            <>
              <div className="my-1 border-t" style={{ borderColor: 'var(--border-color)' }} />
              <ContextMenuItem
                icon="🗑"
                label="删除"
                danger
                onClick={() => {
                  setPendingDelete({ type: contextMenu.type, id: contextMenu.id, title: contextMenu.title });
                  setContextMenu(null);
                }}
              />
            </>
          )}
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          open={true}
          title="删除确认"
          message={(() => {
            if (pendingDelete.type === 'volume') return `确定删除卷"${pendingDelete.title}"？其下所有章和节都会被删除，此操作不可撤销。`;
            if (pendingDelete.type === 'chapter') return `确定删除章"${pendingDelete.title}"？其下所有节都会被删除，此操作不可撤销。`;
            return `确定删除节"${pendingDelete.title}"？此操作不可撤销。`;
          })()}
          danger
          onConfirm={() => {
            if (pendingDelete.type === 'volume') onDeleteVolume(pendingDelete.id);
            if (pendingDelete.type === 'chapter') onDeleteChapter(pendingDelete.id);
            if (pendingDelete.type === 'section') onDeleteSection(pendingDelete.id);
            useToastStore.getState().showToast('已删除', 'success');
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </aside>
  );
}

// React.memo 包裹：EditorPage 输入时 sectionContent 变化不再触发整树重渲染
export const DirectoryTree = React.memo(DirectoryTreeInner);

function ContextMenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left transition-colors"
      style={{ color: danger ? 'var(--danger)' : 'var(--text-primary)' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = danger ? 'var(--danger-soft, rgba(239,68,68,0.08))' : 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
    >
      <span className="w-4 text-center">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ============================================================================
// 节行渲染（提取为 memo 组件，支持 FixedSizeList 虚拟列表）
// ============================================================================

interface SectionRowData {
  sections: SectionMeta[];
  sectionStats: Record<string, { words: number; dice: number }>;
  activeSectionId: string | null;
  dragSectionId: string | null;
  editingId: string | null;
  editingValue: string;
  setEditingValue: (v: string) => void;
  editingRef: React.MutableRefObject<HTMLInputElement | null>;
  setEditingId: (id: string | null) => void;
  setDragSectionId: (id: string | null) => void;
  setContextMenu: (m: any) => void;
  onSelectSection: (id: string) => void;
  onReorderSections: (chapterId: string, orderedIds: string[]) => void;
  onMoveSections: (targetChapterId: string, orderedIds: string[]) => void;
  commitRename: () => void;
}

const SectionRowView = memo(function SectionRowView({
  sec,
  data,
  style,
}: {
  sec: SectionMeta;
  data: SectionRowData;
  style?: React.CSSProperties;
}) {
  // 注意：sectionStats 从 data 中读取，但 memo 比较函数会做细粒度判断，
  // 仅当本节的 stat 变化时才 re-render，避免编辑时 FixedSizeList 全部行 re-render
  const stats = data.sectionStats[sec.id] || { words: 0, dice: 0 };
  const isSecActive = data.activeSectionId === sec.id;
  return (
    <div
      // 合并 prop 传入的 style（虚拟列表的定位样式）与组件自身的视觉样式
      // 避免 JSX duplicate "style" attribute
      style={{
        ...(style || {}),
        color: isSecActive ? 'var(--accent)' : 'var(--text-primary)',
        background: isSecActive ? 'var(--accent-soft)' : 'transparent',
      }}
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        data.setDragSectionId(sec.id);
      }}
      onDragOver={(e) => {
        // 仅 preventDefault（让 drop 能触发），不调用 setState，避免 100+ 节时拖动卡顿
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!data.dragSectionId || data.dragSectionId === sec.id) {
          data.setDragSectionId(null);
          return;
        }
        const dragSec = data.sections.find((s) => s.id === data.dragSectionId);
        if (!dragSec) {
          data.setDragSectionId(null);
          return;
        }
        const targetChapterId = sec.chapter_id;
        const targetChapterSecs = data.sections
          .filter((s) => s.chapter_id === targetChapterId)
          .sort((a, b) => a.order_index - b.order_index);
        const targetIds = targetChapterSecs.map((s) => s.id);
        const fromIdx = targetIds.indexOf(data.dragSectionId);
        const toIdx = targetIds.indexOf(sec.id);
        const newOrder = [...targetIds];
        if (fromIdx >= 0) {
          newOrder.splice(fromIdx, 1);
          newOrder.splice(toIdx, 0, data.dragSectionId);
        } else {
          newOrder.splice(toIdx, 0, data.dragSectionId);
        }
        if (dragSec.chapter_id === targetChapterId) {
          data.onReorderSections(targetChapterId, newOrder);
        } else {
          data.onMoveSections(targetChapterId, newOrder);
        }
        data.setDragSectionId(null);
      }}
      onDragEnd={() => data.setDragSectionId(null)}
      onContextMenu={(e) => {
        e.preventDefault();
        data.setContextMenu({
          x: e.clientX,
          y: e.clientY,
          type: 'section',
          id: sec.id,
          title: sec.title,
          chapterId: sec.chapter_id,
        });
      }}
      className={[
        'group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer text-xs transition-all relative',
        data.dragSectionId === sec.id ? 'opacity-50' : '',
      ].join(' ')}
      onClick={() => data.onSelectSection(sec.id)}
    >
      {isSecActive && (
        <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r-full" style={{ background: 'var(--accent)' }} />
      )}
      <span className="shrink-0 text-[10px]">📄</span>
      {data.editingId === sec.id ? (
        <input
          ref={data.editingRef}
          value={data.editingValue}
          onChange={(e) => data.setEditingValue(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={data.commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') data.commitRename();
            if (e.key === 'Escape') data.setEditingId(null);
          }}
          className="flex-1 min-w-0 text-xs px-1 py-0.5 rounded border outline-none"
          style={{ borderColor: 'var(--accent)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
        />
      ) : (
        <span className={`flex-1 truncate ${isSecActive ? 'font-medium' : ''}`}>{sec.title}</span>
      )}
      {stats.dice > 0 && (
        <span className="shrink-0 text-[9px] px-1 rounded" style={{ color: 'var(--accent)', background: 'var(--accent-soft)' }}>🎲{stats.dice}</span>
      )}
      <span className="shrink-0 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
        {stats.words > 0 ? `${stats.words}` : ''}
      </span>
    </div>
  );
}, (prevProps, nextProps) => {
  // 自定义比较：仅当影响本行渲染的 prop 变化时才 re-render
  // 关键：sectionStats 变化时只 re-render 对应节，而非全部行
  if (prevProps.sec.id !== nextProps.sec.id) return false;
  if (prevProps.data.activeSectionId !== nextProps.data.activeSectionId) return false;
  if (prevProps.data.dragSectionId !== nextProps.data.dragSectionId) return false;
  if (prevProps.data.editingId !== nextProps.data.editingId) return false;
  if (prevProps.data.editingValue !== nextProps.data.editingValue) return false;
  // 检查本节的 stat 是否变化
  const prevStat = prevProps.data.sectionStats[prevProps.sec.id];
  const nextStat = nextProps.data.sectionStats[nextProps.sec.id];
  if (prevStat?.words !== nextStat?.words || prevStat?.dice !== nextStat?.dice) return false;
  // style 变化（虚拟列表定位）
  if (prevProps.style !== nextProps.style) return false;
  return true; // 跳过 re-render
});

// FixedSizeList 的 row 组件（接收 style + data，从 data.sections[index] 取节）
const VirtualSectionRow = memo(function VirtualSectionRow({
  index,
  style,
  data,
}: ListChildComponentProps<SectionRowData & { sections: SectionMeta[] }>) {
  // 兼容调用方可能传 sections 在 data 顶层
  const sec = data.sections[index];
  if (!sec) return null;
  return <SectionRowView sec={sec} data={data} style={style} />;
});
