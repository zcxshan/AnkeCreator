import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { Chapter, Section, SectionMeta, Volume } from '../../types';
import { ConfirmDialog } from './ConfirmDialog';
import { useToastStore } from '../../store/toastStore';

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
    type: 'volume' | 'chapter' | 'section';
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

  const renderSectionRow = (sec: Section, chapterSecs: Section[]) => {
    const stats = sectionStats[sec.id] || { words: 0, dice: 0 };
    const isSecActive = activeSectionId === sec.id;
    return (
      <div
        key={sec.id}
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          setDragSectionId(sec.id);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!dragSectionId || dragSectionId === sec.id) {
            setDragSectionId(null);
            return;
          }
          const dragSec = sections.find((s) => s.id === dragSectionId);
          if (!dragSec) {
            setDragSectionId(null);
            return;
          }
          const targetChapterId = sec.chapter_id;
          // 取目标章下所有节（已按 order_index 排序），跨章时包含被拖入的节不在其中
          const targetChapterSecs = sections
            .filter((s) => s.chapter_id === targetChapterId)
            .sort((a, b) => a.order_index - b.order_index);
          const targetIds = targetChapterSecs.map((s) => s.id);
          const fromIdx = targetIds.indexOf(dragSectionId);
          const toIdx = targetIds.indexOf(sec.id);
          const newOrder = [...targetIds];
          if (fromIdx >= 0) {
            newOrder.splice(fromIdx, 1);
            newOrder.splice(toIdx, 0, dragSectionId);
          } else {
            // 来自其他章：直接把拖入节插入到目标位置
            newOrder.splice(toIdx, 0, dragSectionId);
          }
          if (dragSec.chapter_id === targetChapterId) {
            onReorderSections(targetChapterId, newOrder);
          } else {
            onMoveSections(targetChapterId, newOrder);
          }
          setDragSectionId(null);
        }}
        onDragEnd={() => setDragSectionId(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({
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
          isSecActive ? '' : '',
          dragSectionId === sec.id ? 'opacity-50' : '',
        ].join(' ')}
        style={{
          color: isSecActive ? 'var(--accent)' : 'var(--text-primary)',
          background: isSecActive ? 'var(--accent-soft)' : 'transparent',
        }}
        onClick={() => onSelectSection(sec.id)}
      >
        {isSecActive && (
          <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r-full" style={{ background: 'var(--accent)' }} />
        )}
        <span className="shrink-0 text-[10px]">📄</span>
        {editingId === sec.id ? (
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
  };

  const renderChapterGroup = (ch: Chapter, dragScope: Chapter[]) => {
    const chapterSecs = sectionsByChapter[ch.id] || [];
    const isExpanded = expandedChapterIds[ch.id];
    const chapterWordCount = chapterSecs.reduce((sum, s) => sum + (sectionStats[s.id]?.words || 0), 0);
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
          <div className="shrink-0 flex items-center gap-0.5 transition-opacity">
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
            {chapterSecs.map((sec) => renderSectionRow(sec, chapterSecs))}
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

      <div className="flex-1 overflow-y-auto py-1.5">
        {!hasAnyContent && (
          <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
            还没有内容
            <div className="mt-2">点击下方「+ 新建卷」开始</div>
          </div>
        )}

        <div className="space-y-0.5 px-2">
          {sortedVolumes.map((v) => {
            const vChapters = chaptersByVolume[v.id] || [];
            const vExpanded = expandedVolumeIds[v.id];
            const vWordCount = vChapters.reduce(
              (sum, c) =>
                sum +
                (sectionsByChapter[c.id] || []).reduce(
                  (s, sec) => s + (sectionStats[sec.id]?.words || 0),
                  0,
                ),
              0,
            );
            return (
              <div key={v.id} className="mb-1">
                <div
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    setDragVolumeId(v.id);
                  }}
                  onDragOver={(e) => {
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
                  <div className="shrink-0 flex items-center gap-0.5">
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

      <div className="shrink-0 p-2 border-t space-y-1" style={{ borderColor: 'var(--border-color)' }}>
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

      {contextMenu && (
        <div
          className="anke-ctxmenu-root fixed z-50 rounded-xl shadow-xl border py-1.5 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y, background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
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
