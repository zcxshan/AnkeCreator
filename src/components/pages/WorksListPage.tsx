import { useMemo, useRef, useState } from 'react';
import { useStoryStore } from '../../store/storyStore';
import * as db from '../../db/database';
import { parseOutlineContent, stringifyOutlinePayload } from '../../types';
import { WorkCard, type WorkSummary } from '../common/WorkCard';

interface WorksListPageProps {
  onOpenStory: (storyId: string) => void;
  onBack: () => void;
  onShowAuthor?: () => void;
}

type FilterKey = 'all' | 'trash';

interface Category {
  key: FilterKey;
  label: string;
  count: number;
}

function compareWorks(a: WorkSummary, b: WorkSummary): number {
  const pinA = a.is_pinned ? 1 : 0;
  const pinB = b.is_pinned ? 1 : 0;
  if (pinA !== pinB) return pinB - pinA;
  const starA = a.is_starred ? 1 : 0;
  const starB = b.is_starred ? 1 : 0;
  if (starA !== starB) return starB - starA;
  const idxA = a.order_index ?? 0;
  const idxB = b.order_index ?? 0;
  if (idxA !== idxB) return idxA - idxB;
  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
}

/**
 * 作品列表页
 *
 * 布局：
 *   ┌────────────────────────────────────────────────────┐
 *   │ ←  我的安科作品  共 N 部           [回收站][+新建]│
 *   ├────────────────────────────────────────────────────┤
 *   │ [全部(N)] [未分类(N)] [+]          [🔍 搜索作品...] │
 *   ├────────────────────────────────────────────────────┤
 *   │ ┌────┐ ┌────┐ ┌────┐                               │
 *   │ │ 卡 │ │ 卡 │ │ 卡 │  ... 卡片网格（响应式 2-3 列）│
 *   │ └────┘ └────┘ └────┘                               │
 *   └────────────────────────────────────────────────────┘
 */
export function WorksListPage({ onOpenStory, onBack, onShowAuthor }: WorksListPageProps) {
  const { stories, createStory, deleteStory, renameStory, setActiveStory, toggleStarred, togglePinned, setStoryOrder } = useStoryStore();

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [showNewModal, setShowNewModal] = useState(false);
  const [newStoryTitle, setNewStoryTitle] = useState('');
  const [newStoryDescription, setNewStoryDescription] = useState('');
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const gridRef = useRef<HTMLDivElement | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [trashStories, setTrashStories] = useState<WorkSummary[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('anke-trash') || '[]');
    } catch { return []; }
  });

  // 聚合所有作品的展示数据（排除已在回收站中的）
  const trashIdSet = useMemo(() => new Set(trashStories.map((t) => t.id)), [trashStories]);
  const works = useMemo<WorkSummary[]>(() => {
    return stories
      .filter((s) => !trashIdSet.has(s.id))
      .map((story) => {
        let wordCount = 0;
        let diceCount = 0;
        let sectionCount = 0;
        const chapters = db.listChapters(story.id);
        chapters.forEach((chapter) => {
          const sections = db.listSections(chapter.id);
          sectionCount += sections.length;
          sections.forEach((section) => {
            const content = section.content;
            if (content) {
              const { words, dice } = countContent(content);
              wordCount += words;
              diceCount += dice;
            }
          });
        });
        return {
          ...story,
          wordCount,
          diceCount,
          sectionCount,
          chapterCount: chapters.length,
        };
      });
  }, [stories, trashIdSet]);

  // 简化筛选：仅全部 / 回收站
  const categories: Category[] = useMemo(() => {
    return [
      { key: 'all', label: '全部', count: works.length },
      { key: 'trash', label: '回收站', count: trashStories.length },
    ];
  }, [works, trashStories]);

  // 筛选 + 搜索
  const filteredWorks = useMemo(() => {
    let list: WorkSummary[] = [];
    if (activeFilter === 'trash') list = [...trashStories];
    else list = works;

    const keyword = search.trim().toLowerCase();
    if (keyword) {
      list = list.filter(
        (w) =>
          w.title.toLowerCase().includes(keyword) ||
          (w.description || '').toLowerCase().includes(keyword),
      );
    }
    return [...list].sort(compareWorks);
  }, [works, trashStories, activeFilter, search]);

  // 拖拽排序处理 —— 在 grid 上做事件委托，避免 per-card 新建闭包
  const getDragTargetId = (e: React.DragEvent<HTMLDivElement>): string | null => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLDivElement>('div[data-story-id]');
    return el?.getAttribute('data-story-id') ?? null;
  };

  const handleGridDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    const id = getDragTargetId(e);
    if (!id) return;
    dragIdRef.current = id;
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', id);
    } catch {}
  };

  const handleGridDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dragIdRef.current) return;
    const id = getDragTargetId(e);
    if (!id || dragIdRef.current === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverId !== id) setDragOverId(id);
  };

  const handleGridDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // 只有真正离开整个卡片区时才清除高亮
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setDragOverId(null);
  };

  const handleGridDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const targetId = getDragTargetId(e);
    const srcId = dragIdRef.current || e.dataTransfer.getData('text/plain');
    setDragOverId(null);
    dragIdRef.current = null;
    if (!srcId || !targetId || srcId === targetId) return;
    // 基于 filteredWorks 的当前顺序重新分配 order_index
    const orderedIds = filteredWorks.map((w) => w.id);
    const srcIdx = orderedIds.indexOf(srcId);
    const targetIdx = orderedIds.indexOf(targetId);
    if (srcIdx < 0 || targetIdx < 0) return;
    const newOrder = [...orderedIds];
    newOrder.splice(srcIdx, 1);
    const insertAt = newOrder.indexOf(targetId) + 1;
    newOrder.splice(insertAt, 0, srcId);
    newOrder.forEach((id, i) => setStoryOrder(id, i + 1));
  };

  const handleGridDragEnd = () => {
    setDragOverId(null);
    dragIdRef.current = null;
  };

  const handleCreateStory = () => {
    const title = newStoryTitle.trim() || `未命名作品 ${new Date().toLocaleDateString()}`;
    const storyId = createStory(title, newStoryDescription.trim());
    setShowNewModal(false);
    setNewStoryTitle('');
    setNewStoryDescription('');
    setActiveStory(storyId);
    onOpenStory(storyId);
  };

  const moveToTrash = (work: WorkSummary) => {
    if (!window.confirm(`确定将"${work.title}"移入回收站？`)) return;
    const next = [...trashStories, work];
    setTrashStories(next);
    try { sessionStorage.setItem('anke-trash', JSON.stringify(next)); } catch {}
  };

  const restoreFromTrash = (work: WorkSummary) => {
    const next = trashStories.filter((t) => t.id !== work.id);
    setTrashStories(next);
    try { sessionStorage.setItem('anke-trash', JSON.stringify(next)); } catch {}
  };

  const permanentDelete = (work: WorkSummary) => {
    if (!window.confirm(`将永久删除"${work.title}"及其所有内容，无法恢复！确定继续？`)) return;
    deleteStory(work.id);
    restoreFromTrash(work);
  };

  const handleExportStory = (id: string) => {
    const story = stories.find((s) => s.id === id);
    if (!story) return;
    const full = db.getStoryWithAll(id);
    if (!full) return;
    const blob = new Blob([JSON.stringify(full, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${full.title || 'anke-work'}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  // 处理复制作品
  const handleDuplicateStory = (id: string) => {
    const full = db.getStoryWithAll(id);
    if (!full) return;
    const newTitle = `${full.title} · 副本`;
    const created = db.createStory({
      title: newTitle,
      description: full.description || '',
    });

    // 1. 复制 volumes（卷），并记录 oldId -> newId 映射
    const volumeIdMap: Record<string, string> = {};
    full.volumes.forEach((vol) => {
      const newVol = db.createVolume({
        story_id: created.id,
        title: vol.title,
        order_index: vol.order_index,
      });
      volumeIdMap[vol.id] = newVol.id;
    });

    // 2. 复制 chapters + sections（保留 volume_id 归属和富文本 content）
    full.chapters.forEach((ch) => {
      const mappedVolumeId = ch.volume_id ? volumeIdMap[ch.volume_id] || null : null;
      const newChapter = db.createChapter({
        story_id: created.id,
        title: ch.title,
        volume_id: mappedVolumeId,
        order_index: ch.order_index,
      });
      ch.sections.forEach((sec) => {
        db.createSection({
          chapter_id: newChapter.id,
          title: sec.title,
          order_index: sec.order_index,
          content: sec.content,
        });
      });
    });

    // 3. 复制 outlines（大纲）。
    //    大纲内部有 parent_outline_id 依赖，需要先处理卷类型，再处理章类型。
    const outlineIdMap: Record<string, string> = {};
    // 先复制所有卷类型的大纲（parent_outline_id = null）
    full.outlines
      .filter((o) => {
        const p = parseOutlineContent(o.content);
        return p.target_type === 'volume';
      })
      .forEach((o) => {
        const payload = parseOutlineContent(o.content);
        // 同步到新作品时，target_id 指向旧作品的目录项，需要清零（否则指向无效）
        payload.target_id = '';
        const newOutline = db.createOutline({
          story_id: created.id,
          content: stringifyOutlinePayload(payload),
          order_index: o.order_index,
        });
        outlineIdMap[o.id] = newOutline.id;
      });
    // 再复制所有章类型的大纲，并更新 parent_outline_id 指向新创建的卷大纲
    full.outlines
      .filter((o) => {
        const p = parseOutlineContent(o.content);
        return p.target_type === 'chapter';
      })
      .forEach((o) => {
        const payload = parseOutlineContent(o.content);
        // 重新映射 parent_outline_id
        payload.parent_outline_id = payload.parent_outline_id
          ? outlineIdMap[payload.parent_outline_id] || null
          : null;
        // 清零 target_id（指向旧作品的目录项）
        payload.target_id = '';
        db.createOutline({
          story_id: created.id,
          content: stringifyOutlinePayload(payload),
          order_index: o.order_index,
        });
      });

    useStoryStore.getState().loadStories();
  };

  return (
    <div className="h-full w-full flex flex-col" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {/* 顶部栏 */}
      <header 
        className="sticky top-0 z-20 backdrop-blur"
        style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)' }}
      >
        <div className="max-w-6xl mx-auto px-6 sm:px-8 py-4 flex items-center gap-4">
          <button
            onClick={onBack}
            className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
            title="返回"
          >
            ←
          </button>
          <div className="flex items-baseline gap-3 min-w-0">
            <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>我的安科作品</h1>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>共 {works.length} 部</span>
          </div>
          {onShowAuthor && (
            <button
              onClick={onShowAuthor}
              className="ml-auto text-sm transition-colors"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              关于作者
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setActiveFilter('trash')}
              className="px-3 py-2 text-xs rounded-lg transition-colors inline-flex items-center gap-1.5"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = ''}
              title="回收站"
            >
              <span>🗑️</span>
              <span>回收站{trashStories.length > 0 ? `(${trashStories.length})` : ''}</span>
            </button>
            <button
              onClick={() => setShowNewModal(true)}
              className="px-4 py-2 text-xs rounded-lg font-medium transition-colors inline-flex items-center gap-1.5"
              style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
            >
              <span className="text-base leading-none">+</span>
              <span>新建安科</span>
            </button>
          </div>
        </div>

        {/* 筛选栏 */}
        <div className="max-w-6xl mx-auto px-6 sm:px-8 pb-4 flex items-center gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto flex-1 min-w-0 scrollbar-hide">
            {categories.map((cat) => {
              const active = activeFilter === cat.key;
              return (
                <button
                  key={cat.key}
                  onClick={() => setActiveFilter(cat.key)}
                  className="shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium inline-flex items-center gap-1.5 transition-all"
                  style={{
                    background: active ? 'var(--text-primary)' : 'var(--bg-card)',
                    color: active ? 'var(--bg-card)' : 'var(--text-secondary)',
                    border: `1px solid ${active ? 'transparent' : 'var(--border-color)'}`,
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.color = 'var(--text-primary)';
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.color = 'var(--text-secondary)';
                  }}
                >
                  <span>{cat.label}</span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full"
                    style={{
                      background: active ? 'rgba(255,255,255,0.2)' : 'var(--bg-hover)',
                      color: active ? 'var(--bg-card)' : 'var(--text-secondary)',
                    }}
                  >
                    {cat.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative shrink-0">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              🔍
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索作品..."
              className="w-48 sm:w-56 pl-8 pr-3 py-1.5 text-xs rounded-full outline-none transition-all"
              style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>
      </header>

      {/* 主区域 */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 sm:px-8 py-8">
        {activeFilter === 'trash' ? (
          <>
            <div className="flex items-center gap-3 mb-6">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>🗑️ 回收站</h2>
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{trashStories.length} 个作品</span>
              {trashStories.length > 0 && (
                <button
                  onClick={() => {
                    if (window.confirm('确定清空回收站？所有作品将被永久删除！')) {
                      trashStories.forEach((t) => deleteStory(t.id));
                      setTrashStories([]);
                      try { sessionStorage.removeItem('anke-trash'); } catch {}
                    }
                  }}
                  className="ml-auto px-3 py-1.5 text-xs rounded-lg transition-colors"
                  style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--danger)';
                    e.currentTarget.style.color = 'var(--text-on-accent)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--danger-soft)';
                    e.currentTarget.style.color = 'var(--danger)';
                  }}
                >
                  清空回收站
                </button>
              )}
            </div>
            {trashStories.length === 0 ? (
              <div className="text-center py-16 text-sm" style={{ color: 'var(--text-secondary)' }}>回收站为空</div>
            ) : (
              <div className="space-y-3">
                {filteredWorks.map((work) => (
                  <TrashCard
                    key={work.id}
                    work={work}
                    onRestore={() => restoreFromTrash(work)}
                    onPermanentDelete={() => permanentDelete(work)}
                  />
                ))}
              </div>
            )}
          </>
        ) : works.length === 0 ? (
          <EmptyState />
        ) : filteredWorks.length === 0 ? (
          <div className="text-center py-20 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <div className="text-4xl mb-3">🔍</div>
            没有找到匹配的作品，换个关键词试试吧
          </div>
        ) : (
          <div
            ref={gridRef}
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-5"
            onDragStart={handleGridDragStart}
            onDragOver={handleGridDragOver}
            onDragLeave={handleGridDragLeave}
            onDrop={handleGridDrop}
            onDragEnd={handleGridDragEnd}
          >
            {filteredWorks.map((work) => (
              <div
                key={work.id}
                style={{
                  transform: dragOverId === work.id ? 'translateY(-4px) scale(1.02)' : undefined,
                  transition: 'transform 150ms ease',
                  opacity: dragIdRef.current === work.id ? 0.6 : 1,
                  boxShadow: dragOverId === work.id ? '0 0 0 2px var(--accent)' : undefined,
                  borderRadius: '1rem',
                }}
              >
                <WorkCard
                  work={work}
                  onOpen={(id) => {
                    setActiveStory(id);
                    onOpenStory(id);
                  }}
                  onDelete={(id) => {
                    const w = works.find((x) => x.id === id);
                    if (w) moveToTrash(w);
                  }}
                  onRename={(id) => {
                    setRenameTargetId(id);
                    setRenameValue(work.title);
                  }}
                  onExport={(id) => handleExportStory(id)}
                  onDuplicate={(id) => handleDuplicateStory(id)}
                  onStarred={(id) => toggleStarred(id)}
                  onPinned={(id) => togglePinned(id)}
                />
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className="text-center py-6 text-xs" style={{ color: 'var(--text-secondary)' }}>
        用骰子编织故事 · Anke Creator
      </footer>

      {/* 新建作品弹窗 */}
      {showNewModal && (
        <Modal title="新建安科作品" onClose={() => setShowNewModal(false)}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>作品标题</label>
              <input
                autoFocus
                type="text"
                value={newStoryTitle}
                onChange={(e) => setNewStoryTitle(e.target.value)}
                placeholder="给你的安科起个名字"
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border outline-none transition-all"
                style={{ 
                  background: 'var(--bg-input)', 
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-primary)'
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateStory();
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>作品简介（可选）</label>
              <textarea
                rows={3}
                value={newStoryDescription}
                onChange={(e) => setNewStoryDescription(e.target.value)}
                placeholder="一句话介绍这个安科世界…"
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border outline-none transition-all resize-none"
                style={{ 
                  background: 'var(--bg-input)', 
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-primary)'
                }}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2 text-sm rounded-lg transition-colors"
                style={{ 
                  background: 'var(--bg-card)', 
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-card)'}
              >
                取消
              </button>
              <button
                onClick={handleCreateStory}
                className="px-4 py-2 text-sm rounded-lg transition-colors"
                style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              >
                创建并进入
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 重命名弹窗 */}
      {renameTargetId && (
        <Modal title="重命名作品" onClose={() => setRenameTargetId(null)}>
          <div className="space-y-4">
            <input
              autoFocus
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="作品标题"
              className="w-full px-3.5 py-2.5 text-sm rounded-lg border outline-none transition-all"
              style={{ 
                background: 'var(--bg-input)', 
                borderColor: 'var(--border-color)',
                color: 'var(--text-primary)'
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = renameValue.trim();
                  if (v) {
                    renameStory(renameTargetId, v);
                    setRenameTargetId(null);
                  }
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRenameTargetId(null)}
                className="px-4 py-2 text-sm rounded-lg transition-colors"
                style={{ 
                  background: 'var(--bg-card)', 
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-card)'}
              >
                取消
              </button>
              <button
                onClick={() => {
                  const v = renameValue.trim();
                  if (v) {
                    renameStory(renameTargetId, v);
                    setRenameTargetId(null);
                  }
                }}
                className="px-4 py-2 text-sm rounded-lg transition-colors"
                style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              >
                保存
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** 空状态 —— 还没有任何作品时展示 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="relative mb-6">
        <div 
          className="w-32 h-32 rounded-full flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, var(--accent-soft) 0%, var(--accent-bg) 100%)' }}
        >
          <div className="text-6xl">🎲</div>
        </div>
        <div className="absolute -top-2 -right-2 w-10 h-10 rounded-full flex items-center justify-center text-2xl" style={{ background: 'var(--accent-bg)' }}>
          ✨
        </div>
        <div className="absolute -bottom-1 -left-3 w-8 h-8 rounded-full flex items-center justify-center text-lg" style={{ background: 'var(--accent-soft)' }}>
          📖
        </div>
      </div>
      <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        还没有安科作品，点击上方"新建安科"开始第一个作品吧
      </h2>
      <p className="text-sm max-w-md" style={{ color: 'var(--text-secondary)' }}>
        从一张白纸开始，用骰子决定命运，让故事由此展开。
      </p>
    </div>
  );
}

/** 通用弹窗组件 */
function Modal({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm p-4"
      style={{ background: 'var(--bg-overlay)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl shadow-xl w-full max-w-md p-6 border"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 基于 HTML 字符串统计字数（用于 contenteditable 编辑器） */
function countWordsFromHtml(html: string): { words: number; dice: number } {
  if (!html) return { words: 0, dice: 0 };
  try {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    let words = 0;
    let dice = 0;
    const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_ALL, {
      acceptNode(node: Node): number {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          if (
            el.dataset?.type === 'image-block' ||
            el.dataset?.type === 'dice-card'
          ) {
            dice++;
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_SKIP;
        }
        if (node.nodeType === Node.TEXT_NODE) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      },
    });
    let node: Node | null = walker.nextNode();
    while (node) {
      const text = (node.textContent || '').replace(/\s/g, '');
      words += text.length;
      node = walker.nextNode();
    }
    return { words, dice };
  } catch {
    return { words: 0, dice: 0 };
  }
}

/** 兼容两种格式：先尝试旧版 JSON（TipTap），失败则走 HTML（contenteditable） */
function countContent(content: string): { words: number; dice: number } {
  if (!content) return { words: 0, dice: 0 };
  try {
    const json = JSON.parse(content);
    if (json && typeof json === 'object') {
      return countWordsAndDice(json);
    }
  } catch {
    // fallthrough
  }
  return countWordsFromHtml(content);
}

/** 从富文本 JSON 中统计字数和骰点数 */
function countWordsAndDice(json: any): { words: number; dice: number } {
  let words = 0;
  let dice = 0;
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.text === 'string') {
      words += node.text.replace(/\s/g, '').length;
    }
    if (node.type === 'dice-card' || node.type === 'dice') {
      dice++;
    }
    if (Array.isArray(node.content)) {
      node.content.forEach(walk);
    }
  };
  walk(json);
  return { words, dice };
}

function TrashCard({ work, onRestore, onPermanentDelete }: { work: WorkSummary; onRestore: () => void; onPermanentDelete: () => void }) {
  return (
    <div 
      className="flex items-center gap-4 px-4 py-3 rounded-xl border"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <span className="text-2xl">📖</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{work.title}</div>
        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{work.wordCount} 字 · {work.chapterCount} 章</div>
      </div>
      <button 
        onClick={onRestore} 
        className="px-3 py-1.5 text-xs rounded-lg transition-colors"
        style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--accent)';
          e.currentTarget.style.color = 'var(--text-on-accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--accent-bg)';
          e.currentTarget.style.color = 'var(--accent)';
        }}
      >还原</button>
      <button 
        onClick={onPermanentDelete} 
        className="px-3 py-1.5 text-xs rounded-lg transition-colors"
        style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--danger)';
          e.currentTarget.style.color = 'var(--text-on-accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--danger-soft)';
          e.currentTarget.style.color = 'var(--danger)';
        }}
      >彻底删除</button>
    </div>
  );
}
