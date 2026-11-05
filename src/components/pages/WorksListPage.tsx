import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useStoryStore } from '../../store/storyStore';
import { useToastStore } from '../../store/toastStore';
import * as db from '../../db/index';
import type { WorkSummary } from '../common/WorkCard';
import {
  WorksEmptyState,
  WorksNoMatchState,
  WorksLoadingState,
  WorksErrorState,
  WorksGridView,
  TrashView,
} from '../works/WorksViews';
import {
  WorksHeader,
  type WorksCategory,
  type WorksFilterKey,
} from '../works/WorksHeader';
import {
  NewStoryDialog,
  RenameStoryDialog,
  ImportProgressDialog,
} from '../works/WorksDialogs';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { InputDialog } from '../common/InputDialog';
import { EpubExportProgressDialog } from '../common/EpubExportProgressDialog'
import {
  EpubExportOptionsDialog,
  type EpubExportOptions,
} from '../common/EpubExportOptionsDialog';
import { AddToFavoriteDialog } from '../common/AddToFavoriteDialog';
import { validateImportFormat, ensureDefaultVolumeAndChapter } from '../../utils/storyImport';
import { useDiceHistoryStore } from '../../store/diceHistoryStore';
import * as favoritesDb from '../../db/favorites';
import type { Favorite } from '../../types/story';

interface WorksListPageProps {
  onOpenStory: (storyId: string) => void;
  onBack: () => void;
  onShowAuthor?: () => void;
  onOpenReader?: (storyId: string) => void;
}

type FilterKey = WorksFilterKey;

type Category = WorksCategory;

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

export function WorksListPage({ onOpenStory, onBack, onShowAuthor, onOpenReader }: WorksListPageProps) {
  const { stories, trashedStories, loadTrashedStories, softDeleteStory, restoreStory, permanentlyDeleteStory, renameStory, updateStoryDescription, setActiveStory, toggleStarred, togglePinned, setStoryOrder } = useStoryStore();
  const showToast = useToastStore((s) => s.showToast);

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [showNewModal, setShowNewModal] = useState(false);
  const [pendingRename, setPendingRename] = useState<WorkSummary | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<null | { type: 'soft-delete' | 'permanent-delete' | 'clear-trash' | 'duplicate'; work?: WorkSummary }>(null);
  // 修改简介弹窗目标
  const [pendingEditDescription, setPendingEditDescription] = useState<WorkSummary | null>(null);
  const [importState, setImportState] = useState<null | { originalTitle: string; description?: string; data: any }>(null);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; message: string } | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  // EPUB 导出进度弹窗
  const [epubExportOpen, setEpubExportOpen] = useState(false);
  // EPUB 导出选项弹窗（先弹选项再弹进度）
  const [epubOptionsOpen, setEpubOptionsOpen] = useState(false);
  const [pendingEpubExport, setPendingEpubExport] = useState<
    { id: string; safeTitle: string } | null
  >(null);
  // 已确认的 EPUB 导出选项（用于失败后重试）
  const [confirmedEpubOptions, setConfirmedEpubOptions] = useState<EpubExportOptions | null>(null);

  // 收藏夹
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [activeFavoriteId, setActiveFavoriteId] = useState<string | null>(null);
  const [favoriteStoryIds, setFavoriteStoryIds] = useState<Set<string>>(new Set());
  // 收藏夹操作弹窗
  const [showNewFavorite, setShowNewFavorite] = useState(false);
  const [renameFavoriteTarget, setRenameFavoriteTarget] = useState<Favorite | null>(null);
  const [deleteFavoriteTarget, setDeleteFavoriteTarget] = useState<Favorite | null>(null);
  const [favoriteMenuOpenId, setFavoriteMenuOpenId] = useState<string | null>(null);
  // 加入收藏夹子菜单（multi 模式：勾选 toggle）
  const [addToFavoriteStoryId, setAddToFavoriteStoryId] = useState<string | null>(null);
  // 打开弹窗时该作品已在的收藏夹 id 列表（外部缓存，避免弹窗内首屏抖动）
  const [addToFavoriteInitial, setAddToFavoriteInitial] = useState<string[]>([]);
  // 移动到收藏夹子菜单（single 模式：单选）
  const [moveToFavoriteStoryId, setMoveToFavoriteStoryId] = useState<string | null>(null);

  useEffect(() => {
    loadTrashedStories();
  }, [loadTrashedStories]);

  // 加载收藏夹列表
  const reloadFavorites = useRef<() => Promise<void>>(async () => {});
  reloadFavorites.current = async () => {
    try {
      const list = await favoritesDb.listFavorites();
      setFavorites(list);
      // 当前激活收藏夹被删除时回退到「全部」
      if (activeFavoriteId && !list.find((f) => f.id === activeFavoriteId)) {
        setActiveFavoriteId(null);
      }
    } catch (e) {
      console.warn('[WorksListPage] 加载收藏夹失败：', e);
    }
  };
  useEffect(() => {
    reloadFavorites.current();
  }, [stories]);

  // 加载当前收藏夹的作品 id 集合
  useEffect(() => {
    if (!activeFavoriteId) {
      setFavoriteStoryIds(new Set());
      return;
    }
    let cancelled = false;
    favoritesDb.getStoryIdsInFavorite(activeFavoriteId).then((ids) => {
      if (!cancelled) setFavoriteStoryIds(new Set(ids));
    });
    return () => { cancelled = true; };
  }, [activeFavoriteId, favorites]);

  // 聚合所有作品的展示数据
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [worksLoading, setWorksLoading] = useState(false);
  const [worksError, setWorksError] = useState<string | null>(null);
  // 列表加载代次：切换作品库时让旧请求的结果失效
  const loadWorksTokenRef = useRef(0);

  const loadWorks = useCallback(async () => {
    const token = ++loadWorksTokenRef.current;
    setWorksLoading(true);
    setWorksError(null);
    try {
      // 一次性聚合查询：3 次文件读 vs 原来 N×M 次（消灭 N+1）
      const storiesWithStats = await db.listStoriesWithStats();
      if (token !== loadWorksTokenRef.current) return;
      const diceRecords = useDiceHistoryStore.getState().records;
      const result: WorkSummary[] = storiesWithStats.map((story: any) => ({
        ...story,
        wordCount: story.wordCount || 0,
        diceCount: diceRecords.filter((r: any) => r.storyId === story.id).length,
        sectionCount: story.sectionCount || 0,
        chapterCount: story.chapterCount || 0,
      }));
      setWorks(result);
    } catch (e) {
      if (token !== loadWorksTokenRef.current) return;
      console.error('[WorksListPage] 加载作品列表失败：', e);
      setWorksError((e as Error)?.message || String(e));
    } finally {
      if (token === loadWorksTokenRef.current) setWorksLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorks();
    return () => { loadWorksTokenRef.current += 1; };
  }, [loadWorks, stories]);

  // 简化筛选：仅全部 / 回收站
  // 从 Story[] 派生为 WorkSummary[]，为 TrashCard 提供所需字段
  const trashSummaries = useMemo<WorkSummary[]>(() =>
    trashedStories.map((s) => ({
      ...s,
      wordCount: 0,
      diceCount: 0,
      sectionCount: 0,
      chapterCount: 0,
    })),
  [trashedStories]);
  const categories: Category[] = useMemo(() => {
    const favCats: Category[] = favorites.map((f) => ({
      key: `fav:${f.id}`,
      label: f.name,
      count: 0, // 占位，渲染时按需替换为收藏夹内作品数
    }));
    return [
      { key: 'all', label: '全部', count: works.length },
      ...favCats,
      { key: 'trash', label: '回收站', count: trashSummaries.length },
    ];
  }, [works, trashSummaries, favorites]);

  // 当前激活的收藏夹（从 activeFilter 解析出来）
  const activeFavorite = useMemo(() => {
    if (!activeFilter || !activeFilter.startsWith('fav:')) return null;
    const id = activeFilter.slice(4);
    return favorites.find((f) => f.id === id) || null;
  }, [activeFilter, favorites]);

  // 筛选 + 搜索
  const filteredWorks = useMemo(() => {
    let list: WorkSummary[] = [];
    if (activeFilter === 'trash') {
      list = [...trashSummaries];
    } else if (activeFavorite) {
      list = works.filter((w) => favoriteStoryIds.has(w.id));
    } else {
      list = works;
    }

    const keyword = search.trim().toLowerCase();
    if (keyword) {
      list = list.filter(
        (w) =>
          w.title.toLowerCase().includes(keyword) ||
          (w.description || '').toLowerCase().includes(keyword),
      );
    }
    return [...list].sort(compareWorks);
  }, [works, trashedStories, activeFilter, search, activeFavorite, favoriteStoryIds]);

  // 拖拽排序处理
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
    const toIdx = orderedIds.indexOf(targetId);
    if (srcIdx < 0 || toIdx < 0) return;
    const newOrder = [...orderedIds];
    newOrder.splice(srcIdx, 1);
    newOrder.splice(toIdx, 0, srcId);
    newOrder.forEach((id, i) => setStoryOrder(id, i + 1));
  };

  const handleGridDragEnd = () => {
    setDragOverId(null);
    dragIdRef.current = null;
  };

  const handleCreateStory = async (rawTitle: string, description: string) => {
    const title = rawTitle.trim() || `未命名作品 ${new Date().toLocaleDateString()}`;
    const { createStory } = useStoryStore.getState();
    const storyId = await createStory(title, description.trim());
    setShowNewModal(false);
    setActiveStory(storyId);
    onOpenStory(storyId);
  };

  const moveToTrash = (work: WorkSummary) => {
    setConfirmState({ type: 'soft-delete', work });
  };

  const restoreFromTrash = (work: WorkSummary) => {
    restoreStory(work.id);
    showToast(`已还原「${work.title}」`, 'success');
  };

  const permanentDelete = (work: WorkSummary) => {
    setConfirmState({ type: 'permanent-delete', work });
  };

  const handleExportStory = async (id: string) => {
    const story = stories.find((s) => s.id === id);
    if (!story) return;
    const full = await db.getStoryWithAll(id);
    if (!full) return;
    const relations = await db.listCharacterRelations(id);
    // 导出时剥离每个小节里的旧版 content_blocks（已切到新版富文本编辑器，导入完全不用）
    // 同时剥离 bbcode（导出 JSON 不带 bbcode，导入时 DB 留空，用户在 BBCode 视图主动加载可视化得到）
    const sanitizedChapters = (full.chapters || []).map((ch: any) => ({
      ...ch,
      sections: (ch.sections || []).map((sec: any) => {
        const { blocks, bbcode, ...rest } = sec;
        return rest;
      }),
    }));
    const diceHistory = useDiceHistoryStore.getState().getRecordsByStory(id);
    const exportData = {
      format: 'anke-creator-export',
      version: '1.1',
      exportedAt: new Date().toISOString(),
      appVersion: '0.1.0',
      data: {
        ...full,
        chapters: sanitizedChapters,
        character_relations: relations,
        dice_history: diceHistory,
      },
    };
    const safeTitle = (full.title || 'anke-work').replace(/[\/:*?"<>|]/g, '_');

    // 优先使用 Electron 系统保存对话框
    if (window.electronAPI?.saveStoryAsFile) {
      const res = await window.electronAPI.saveStoryAsFile(exportData, safeTitle);
      if (res.canceled) return;
      if (res.ok) {
        showToast(`已另存为：${res.filePath}`, 'success');
      } else {
        showToast(`另存为失败：${res.error || '未知错误'}`, 'error');
      }
      return;
    }

    // 浏览器降级：触发下载
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    showToast(`作品「${full.title || '未命名作品'}」导出成功`, 'success');
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeTitle}.anke.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 100);
    }, 200);
  };

  // 导出为 EPUB 电子书（仅桌面端，含图片离线化 + 进度推送）
  // 流程：先弹选项框 → 用户确认 → 开始导出
  const handleExportEpub = async (id: string) => {
    const story = stories.find((s) => s.id === id);
    if (!story) return;
    if (!window.electronAPI?.exportEpub) {
      showToast('EPUB 导出仅在桌面版可用', 'info');
      return;
    }
    const safeTitle = (story.title || '安科作品').replace(/[\/:*?"<>|]/g, '_');
    setPendingEpubExport({ id, safeTitle });
    setEpubOptionsOpen(true);
  };

  /** 用户在选项框中确认后，开始实际导出 */
  const handleEpubOptionsConfirm = async (options: EpubExportOptions) => {
    if (!pendingEpubExport) return;
    const { id, safeTitle } = pendingEpubExport;
    setConfirmedEpubOptions(options);
    setEpubOptionsOpen(false);
    setEpubExportOpen(true);
    const res = await window.electronAPI.exportEpub(id, safeTitle, options);
    if (res.canceled) {
      setEpubExportOpen(false);
      setPendingEpubExport(null);
      setConfirmedEpubOptions(null);
      return;
    }
    if (!res.ok) {
      showToast(`EPUB 导出失败：${res.error || '未知错误'}`, 'error');
      setEpubExportOpen(false);
      setPendingEpubExport(null);
      setConfirmedEpubOptions(null);
      return;
    }
    // 成功时不立即关闭弹窗，等收到 done 进度后再由弹窗内部关闭
    // 若有失败图片，弹窗内会显示重试按钮
  };

  /** 重试 EPUB 导出（用相同的选项重新导出，让 fetchImage 内置重试处理之前失败的图片） */
  const handleEpubRetry = async () => {
    if (!pendingEpubExport || !confirmedEpubOptions) return;
    const { id, safeTitle } = pendingEpubExport;
    setEpubExportOpen(true);
    const res = await window.electronAPI.exportEpub(id, safeTitle, confirmedEpubOptions);
    if (res.canceled || !res.ok) {
      setEpubExportOpen(false);
      setPendingEpubExport(null);
      setConfirmedEpubOptions(null);
      return;
    }
  };

  /** 关闭选项框（用户取消） */
  const handleEpubOptionsCancel = () => {
    setEpubOptionsOpen(false);
    setPendingEpubExport(null);
  };

  // 批量导出（无 JSZip 降级：逐个下载，间隔 300ms）
  const handleBatchExport = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      await handleExportStory(id);
      await new Promise((r) => setTimeout(r, 300)); // small delay between downloads
    }
    setBatchMode(false);
    setSelectedIds(new Set());
    showToast(`已导出 ${ids.length} 个作品`, 'success');
  };

  // 创建收藏夹
  const handleCreateFavorite = async (name: string) => {
    try {
      const fav = await favoritesDb.createFavorite({ name });
      await reloadFavorites.current();
      setActiveFilter(`fav:${fav.id}`);
      showToast(`已创建收藏夹「${fav.name}」`, 'success');
    } catch (e) {
      showToast(`创建失败：${(e as Error).message}`, 'error');
    }
  };

  // 重命名收藏夹
  const handleRenameFavorite = async (id: string, name: string) => {
    try {
      await favoritesDb.renameFavorite(id, name);
      await reloadFavorites.current();
      showToast(`已重命名为「${name}」`, 'success');
    } catch (e) {
      showToast(`重命名失败：${(e as Error).message}`, 'error');
    }
  };

  // 删除收藏夹（仅空时成功）
  const handleDeleteFavorite = async (id: string) => {
    const res = await favoritesDb.deleteFavoriteIfEmpty(id);
    if (res.ok) {
      await reloadFavorites.current();
      if (activeFilter === `fav:${id}`) setActiveFilter('all');
      showToast('收藏夹已删除', 'success');
    } else {
      showToast(res.error || '删除失败', 'error');
    }
  };

  // WorkCard 的 onAddToFavorite 回调：预加载作品当前所在的收藏夹，然后打开弹窗
  const handleOpenAddToFavorite = async (storyId: string) => {
    try {
      const list = await favoritesDb.getFavoritesForStory(storyId);
      setAddToFavoriteInitial(list.map((f) => f.id));
    } catch (err) {
      console.error('加载作品收藏夹状态失败:', err);
      setAddToFavoriteInitial([]);
    }
    setAddToFavoriteStoryId(storyId);
  };

  // 切换作品在收藏夹中的加入/移出状态
  // inFav 由 AddToFavoriteDialog 维护的本地状态传入，避免依赖 activeFavoriteId 的脆弱判断
  const handleToggleStoryInFavorite = async (
    storyId: string,
    favoriteId: string,
    inFav: boolean,
  ) => {
    if (inFav) {
      await favoritesDb.removeStoryFromFavorite(storyId, favoriteId);
      showToast('已移出收藏夹', 'success');
    } else {
      await favoritesDb.addStoryToFavorite(storyId, favoriteId);
      showToast('已加入收藏夹', 'success');
    }
    // 刷新当前收藏夹下的作品 id 集合
    if (activeFavoriteId) {
      const ids = await favoritesDb.getStoryIdsInFavorite(activeFavoriteId);
      setFavoriteStoryIds(new Set(ids));
    }
    // 全部视图下不影响显示，但让 categories 的 count 重新计算
    await reloadFavorites.current();
  };

  // WorkCard 的 onMoveToFavorite 回调：预加载作品当前所在收藏夹，然后打开单选弹窗
  const handleOpenMoveToFavorite = async (storyId: string) => {
    try {
      const list = await favoritesDb.getFavoritesForStory(storyId);
      setAddToFavoriteInitial(list.map((f) => f.id));
    } catch (err) {
      console.error('加载作品收藏夹状态失败:', err);
      setAddToFavoriteInitial([]);
    }
    setMoveToFavoriteStoryId(storyId);
  };

  // single 模式：选中目标收藏夹 → 移出所有其他 + 加入这一个
  const handleSelectMoveTarget = async (storyId: string, targetFavoriteId: string) => {
    try {
      const current = await favoritesDb.getFavoritesForStory(storyId);
      // 移出所有非目标的关联
      for (const f of current) {
        if (f.id !== targetFavoriteId) {
          await favoritesDb.removeStoryFromFavorite(storyId, f.id);
        }
      }
      // 加入目标（如果还没在）
      if (!current.some((f) => f.id === targetFavoriteId)) {
        await favoritesDb.addStoryToFavorite(storyId, targetFavoriteId);
      }
      showToast('已移动到收藏夹', 'success');
      // 刷新当前收藏夹下的作品 id 集合
      if (activeFavoriteId) {
        const ids = await favoritesDb.getStoryIdsInFavorite(activeFavoriteId);
        setFavoriteStoryIds(new Set(ids));
      }
      await reloadFavorites.current();
    } catch (err) {
      console.error('移动到收藏夹失败:', err);
      showToast('移动失败', 'error');
    } finally {
      setMoveToFavoriteStoryId(null);
      setAddToFavoriteInitial([]);
    }
  };

  // 处理导入作品（优先使用 Electron 系统打开对话框，回退到 input file）
  const handleImportStory = async () => {
    // 1) Electron 系统对话框
    if (window.electronAPI?.openStoryFile) {
      try {
        const res = await window.electronAPI.openStoryFile();
        if (res.canceled) return;
        if (!res.ok || !res.data) {
          showToast(`导入失败：${res.error || '未知错误'}`, 'error');
          return;
        }
        const validation = validateImportFormat(res.data);
        if (!validation.valid) {
          showToast(`导入失败：${validation.error}`, 'error');
          return;
        }
        const data = unwrapExportData(res.data);
        if (!data || !data.title) {
          showToast('文件格式不正确，无法导入', 'error');
          return;
        }
        setImportState({
          originalTitle: data.title || '导入作品',
          description: data.description || '',
          data,
        });
      } catch (err) {
        console.error('[import] 导入失败:', err);
        showToast('导入失败，请检查文件格式是否正确', 'error');
      }
      return;
    }
    // 2) 浏览器 fallback
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.anke.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const validation = validateImportFormat(parsed);
        if (!validation.valid) {
          showToast(`导入失败：${validation.error}`, 'error');
          return;
        }
        const data = unwrapExportData(parsed);
        if (!data || !data.title) {
          showToast('文件格式不正确，无法导入', 'error');
          return;
        }
        setImportState({
          originalTitle: data.title || '导入作品',
          description: data.description || '',
          data,
        });
      } catch (err) {
        console.error('[import] 导入失败:', err);
        showToast('导入失败，请检查文件格式是否正确', 'error');
      }
    };
    input.click();
  };

  // 兼容新旧导出格式
  const unwrapExportData = (parsed: any): any => {
    if (parsed?.format === 'anke-creator-export' || parsed?.format === 'anke-creator-story') {
      return parsed.data;
    }
    return parsed;
  };

  // 实际执行导入：写入数据库并刷新列表
  const performImportStory = async (customTitle: string) => {
    if (!importState) return;
    const data = importState.data;
    const rollbackState: { storyId?: string } = {};

    // 计算总任务数（用于进度条）
    const volumeCount = Array.isArray(data.volumes) ? data.volumes.length : 1;
    const chapterCount = Array.isArray(data.chapters) ? data.chapters.length : 1;
    const sectionCount = Array.isArray(data.chapters)
      ? data.chapters.reduce((acc: number, ch: any) => acc + (Array.isArray(ch.sections) ? ch.sections.length : 0), 0)
      : Array.isArray(data.sections) ? data.sections.length : 0;
    const wsCount = Array.isArray(data.world_settings) ? data.world_settings.length : 0;
    const charCount = Array.isArray(data.characters) ? data.characters.length : 0;
    const relCount = Array.isArray(data.character_relations) ? data.character_relations.length : 0;
    const outlineCount = Array.isArray(data.outlines) ? data.outlines.length : 0;
    // 批量模式下结构创建只用 3-4 个 tick（批量卷/章/节），而非 volumeCount+chapterCount+sectionCount 个
    const useBulkForStructure = Array.isArray(data.volumes) && data.volumes.length > 0
      && Array.isArray(data.chapters) && data.chapters.length > 0;
    const structureTicks = useBulkForStructure
      ? 4 // 上限：1 外层 + 1 批量卷 + 1 批量章 + 1 批量节
      : (1 + volumeCount + chapterCount + sectionCount);
    // +1 for word_count recompute step (导入完成后校准卷/章/节字数)
    const totalSteps = 1 + structureTicks + wsCount + charCount + relCount + outlineCount + 1 + 1;
    let currentStep = 0;

    const tick = (msg: string) => {
      currentStep++;
      setImportProgress({ current: currentStep, total: totalSteps, message: msg });
    };
    const yieldUI = () => new Promise((r) => setTimeout(r, 0));

    try {
      tick('创建作品...');
      await yieldUI();
      const newStory = await db.createStory({
        title: customTitle,
        description: data.description || '',
        category: data.category,
      });
      rollbackState.storyId = newStory.id;

      tick('创建卷/章/节结构...');
      await yieldUI();
      const { sectionIdMap } = await ensureDefaultVolumeAndChapter(
        newStory.id,
        data,
        {
          createVolume: db.createVolume,
          createChapter: db.createChapter,
          createSection: db.createSection,
          bulkCreateVolumes: db.bulkCreateVolumes,
          bulkCreateChapters: db.bulkCreateChapters,
          bulkCreateSections: db.bulkCreateSections,
        },
        (current, total, msg) => {
          tick(msg);
        },
      );
      // 不再强制跳跃 currentStep——让 onProgress 回调的 tick 自然驱动进度
      // （批量模式 tick 数已通过 structureTicks 计入 totalSteps）

      if (data.world_settings) {
        for (const ws of data.world_settings) {
          tick(`导入世界观：${ws.title || '未命名'}...`);
          await db.createWorldSetting({
            story_id: newStory.id,
            title: ws.title,
            content: ws.content || '',
            order_index: ws.order_index,
          });
        }
      }

      const characterIdMap: Record<string, string> = {};
      if (data.characters) {
        for (const char of data.characters) {
          tick(`导入角色：${char.name || '未命名'}...`);
          await yieldUI();
          const newChar = await db.createCharacter({
            story_id: newStory.id,
            name: char.name,
            avatar: char.avatar || '',
            personality: char.personality || '',
            attributes: char.attributes,
            notes: char.notes || '',
          });
          characterIdMap[char.id] = newChar.id;
          if (char.variants) {
            for (const v of char.variants) {
              await db.createCharacterVariant({
                character_id: newChar.id,
                name: v.name,
                url: v.url,
                order_index: v.order_index,
              });
            }
          }
        }
      }

      if (data.character_relations) {
        for (const rel of data.character_relations) {
          tick(`导入人物关系...`);
          const newSourceId = characterIdMap[rel.source_id];
          const newTargetId = characterIdMap[rel.target_id];
          if (newSourceId && newTargetId) {
            await db.createCharacterRelation({
              story_id: newStory.id,
              source_id: newSourceId,
              target_id: newTargetId,
              relation: rel.relation,
              note: rel.note || '',
              order_index: rel.order_index,
            });
          }
        }
      }

      const outlineIdMap: Record<string, string> = {};
      if (data.outlines) {
        for (const o of data.outlines) {
          const payload = typeof o.content === 'string' ? JSON.parse(o.content) : o.content;
          if (payload.target_type === 'volume') {
            tick(`导入大纲：${payload.title || '卷纲'}...`);
            await yieldUI();
            payload.target_id = '';
            const newOutline = await db.createOutline({
              story_id: newStory.id,
              content: JSON.stringify(payload),
              order_index: o.order_index,
            });
            outlineIdMap[o.id] = newOutline.id;
          }
        }
        for (const o of data.outlines) {
          const payload = typeof o.content === 'string' ? JSON.parse(o.content) : o.content;
          if (payload.target_type === 'chapter') {
            payload.parent_outline_id = payload.parent_outline_id
              ? outlineIdMap[payload.parent_outline_id] || null
              : null;
            payload.target_id = '';
            await db.createOutline({
              story_id: newStory.id,
              content: JSON.stringify(payload),
              order_index: o.order_index,
            });
          }
        }
      }

      // 导入骰子记录
      if (Array.isArray((data as any).dice_history)) {
        tick('导入骰子记录...');
        const newRecords = (data as any).dice_history.map((r: any) => ({
          ...r,
          // 保留原 id：同一作品重复导入时可被 addRecords 按 id 去重
          id: r.id || '',
          storyId: newStory.id,
          // sectionId 映射失败时保留原值而非清空,避免骰子记录丢失
          sectionId: (r.sectionId && sectionIdMap[r.sectionId]) || r.sectionId || '',
        }));
        useDiceHistoryStore.getState().addRecords(newRecords);
      }

      // 校准所有卷/章/节 word_count，确保进度条走完时字数已全部落盘
      tick('计算卷/章/节字数...');
      await yieldUI();
      try {
        await db.recomputeStoryWordCounts(newStory.id);
      } catch (e) {
        console.warn('[import] recomputeStoryWordCounts failed:', e);
      }

      tick('完成，刷新列表...');
      await yieldUI();
      // 仅刷新列表,不自动选首作(避免误触 loadSection 链路造成并发写入)
      await useStoryStore.getState().loadStoriesList();
      setImportProgress(null);
      showToast(`导入成功：${customTitle}`, 'success');
    } catch (err) {
      console.error('[import] 导入失败:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (rollbackState.storyId) {
        try {
          await db.permanentlyDeleteStory(rollbackState.storyId);
          await useStoryStore.getState().loadTrashedStories();
        } catch (rollbackErr) {
          console.error('[import] 回滚失败:', rollbackErr);
        }
      }
      setImportProgress(null);
      showToast(`导入失败：${errMsg}（已自动清理临时数据）`, 'error');
    } finally {
      setImportState(null);
    }
  };

  /** 批量模式下勾选/取消勾选；非批量模式无操作 */
  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  /** 打开作品：批量模式改为勾选；否则先切数据再跳转（避免编辑器渲染旧作品数据） */
  const handleOpenWork = (id: string) => {
    if (batchMode) {
      handleToggleSelect(id);
      return;
    }
    void (async () => {
      await setActiveStory(id);
      onOpenStory(id);
    })();
  };

  return (
    <div className="bg-[var(--bg-base)] text-[var(--text-primary)] min-h-full w-full flex flex-col">
      {/* 顶部栏（sticky 在 TitleBar 下方 32px 处，z-40） */}
      <WorksHeader
        totalCount={works.length}
        trashCount={trashedStories.length}
        categories={categories}
        activeFilter={activeFilter}
        favoriteStoryIds={favoriteStoryIds}
        favorites={favorites}
        favoriteMenuOpenId={favoriteMenuOpenId}
        search={search}
        batchMode={batchMode}
        selectedCount={selectedIds.size}
        actionMenuOpen={actionMenuOpen}
        canShowAuthor={!!onShowAuthor}
        onBack={onBack}
        onShowAuthor={onShowAuthor}
        onOpenTrash={() => setActiveFilter('trash')}
        onNewStory={() => setShowNewModal(true)}
        onImportStory={handleImportStory}
        onToggleBatch={() => {
          setBatchMode(!batchMode);
          setSelectedIds(new Set());
        }}
        onBatchExport={handleBatchExport}
        onFilterChange={setActiveFilter}
        onFavoriteMenuOpen={setFavoriteMenuOpenId}
        onRenameFavorite={setRenameFavoriteTarget}
        onDeleteFavorite={setDeleteFavoriteTarget}
        onNewFavorite={() => setShowNewFavorite(true)}
        onSearchChange={setSearch}
        onActionMenuOpenChange={setActionMenuOpen}
      />
      {/* 主区域 */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 sm:px-8 py-8">
        {activeFilter === 'trash' ? (
          <TrashView
            totalCount={trashedStories.length}
            works={filteredWorks}
            onClearTrash={() => setConfirmState({ type: 'clear-trash' })}
            onRestore={restoreFromTrash}
            onPermanentDelete={permanentDelete}
          />
        ) : worksError ? (
          <WorksErrorState message={worksError} onRetry={() => void loadWorks()} />
        ) : worksLoading && works.length === 0 ? (
          <WorksLoadingState />
        ) : works.length === 0 ? (
          <WorksEmptyState />
        ) : filteredWorks.length === 0 ? (
          <WorksNoMatchState />
        ) : (
          <WorksGridView
            works={filteredWorks}
            batchMode={batchMode}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            dragId={dragIdRef.current}
            dragOverId={dragOverId}
            onDragStart={handleGridDragStart}
            onDragOver={handleGridDragOver}
            onDragLeave={handleGridDragLeave}
            onDrop={handleGridDrop}
            onDragEnd={handleGridDragEnd}
            onOpen={handleOpenWork}
            onDelete={(id) => {
              const w = works.find((x) => x.id === id);
              if (w) moveToTrash(w);
            }}
            onRename={(id) => {
              const w = works.find((x) => x.id === id);
              if (w) setPendingRename(w);
            }}
            onEditDescription={(id) => {
              const w = works.find((x) => x.id === id);
              if (w) setPendingEditDescription(w);
            }}
            onExport={(id) => handleExportStory(id)}
            onPinned={(id) => togglePinned(id)}
            onMoveToFavorite={(id) => handleOpenMoveToFavorite(id)}
            onExportEpub={(id) => handleExportEpub(id)}
            onReader={onOpenReader ? (id) => onOpenReader(id) : undefined}
          />
        )}
      </main>

      <footer className="text-[var(--text-secondary)] text-center py-6 text-xs">
        用骰子编织故事 · Anke Creator
      </footer>

      {/* 新建作品弹窗 */}
      <NewStoryDialog
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        onCreate={handleCreateStory}
      />

      {/* 重命名弹窗 */}
      {pendingRename && (
        <RenameStoryDialog
          work={pendingRename}
          onClose={() => setPendingRename(null)}
          onRename={(id, title) => {
            renameStory(id, title);
            showToast(`已重命名为「${title}」`, 'success');
          }}
        />
      )}

      {/* 修改简介弹窗（多行文本，最多 500 字） */}
      <InputDialog
        open={pendingEditDescription !== null}
        title={`修改「${pendingEditDescription?.title || ''}」的简介`}
        placeholder="一句话介绍这个安科世界…"
        defaultValue={pendingEditDescription?.description || ''}
        multiline
        rows={4}
        maxLength={500}
        confirmText="保存"
        cancelText="取消"
        onCancel={() => setPendingEditDescription(null)}
        onConfirm={(value) => {
          if (pendingEditDescription) {
            updateStoryDescription(pendingEditDescription.id, value);
            showToast('简介已更新', 'success');
          }
          setPendingEditDescription(null);
        }}
      />

      {/* 确认对话框 */}
      {confirmState?.type === 'soft-delete' && confirmState.work && (
        <ConfirmDialog
          open={true}
          title="移至回收站"
          message={`确定将「${confirmState.work.title}」移至回收站？稍后仍可在回收站还原。`}
          onConfirm={() => {
            softDeleteStory(confirmState.work!.id);
            showToast(`已移至回收站：${confirmState.work!.title}`, 'info', {
              undo: () => restoreStory(confirmState.work!.id),
            });
            setConfirmState(null);
          }}
          onCancel={() => setConfirmState(null)}
        />
      )}
      {confirmState?.type === 'permanent-delete' && confirmState.work && (
        <ConfirmDialog
          open={true}
          title="永久删除"
          danger
          message={`将永久删除「${confirmState.work.title}」及其所有内容，无法恢复！确定继续？`}
          onConfirm={() => {
            permanentlyDeleteStory(confirmState.work!.id);
            showToast(`已永久删除：${confirmState.work!.title}`, 'success');
            setConfirmState(null);
          }}
          onCancel={() => setConfirmState(null)}
        />
      )}
      {confirmState?.type === 'clear-trash' && (
        <ConfirmDialog
          open={true}
          title="清空回收站"
          danger
          message={`确定清空回收站？共 ${trashedStories.length} 个作品将被永久删除，无法恢复！`}
          onConfirm={() => {
            const ids = [...trashedStories];
            ids.forEach((w) => permanentlyDeleteStory(w.id));
            showToast(`已清空回收站（${ids.length} 个作品）`, 'success');
            setConfirmState(null);
          }}
          onCancel={() => setConfirmState(null)}
        />
      )}
      {importState && !importProgress && (
        <InputDialog
          open={true}
          title="导入作品"
          placeholder="请输入导入后的作品标题"
          defaultValue={importState.originalTitle}
          confirmText="导入"
          onConfirm={(value) => performImportStory(value)}
          onCancel={() => setImportState(null)}
        />
      )}
      {importProgress && <ImportProgressDialog progress={importProgress} />}
      {/* EPUB 导出选项弹窗 */}
      <EpubExportOptionsDialog
        open={epubOptionsOpen}
        storyTitle={
          pendingEpubExport
            ? stories.find((s) => s.id === pendingEpubExport.id)?.title
            : undefined
        }
        onCancel={handleEpubOptionsCancel}
        onConfirm={handleEpubOptionsConfirm}
      />
      {/* EPUB 导出进度弹窗 */}
      <EpubExportProgressDialog
        open={epubExportOpen}
        onClose={() => {
          setEpubExportOpen(false)
          setPendingEpubExport(null)
          setConfirmedEpubOptions(null)
        }}
        onRetry={handleEpubRetry}
      />

      {/* 收藏夹：新建 / 重命名 / 删除（仅空） */}
      <InputDialog
        open={showNewFavorite}
        title="新建收藏夹"
        placeholder="收藏夹名称（如：推理向、灵感库）"
        defaultValue=""
        confirmText="创建"
        onConfirm={(name) => {
          setShowNewFavorite(false);
          if (name.trim()) handleCreateFavorite(name.trim());
        }}
        onCancel={() => setShowNewFavorite(false)}
      />
      <InputDialog
        open={renameFavoriteTarget !== null}
        title="重命名收藏夹"
        placeholder="收藏夹名称"
        defaultValue={renameFavoriteTarget?.name || ''}
        confirmText="保存"
        onConfirm={(name) => {
          if (renameFavoriteTarget) handleRenameFavorite(renameFavoriteTarget.id, name.trim());
          setRenameFavoriteTarget(null);
        }}
        onCancel={() => setRenameFavoriteTarget(null)}
      />
      <ConfirmDialog
        open={deleteFavoriteTarget !== null}
        title="删除收藏夹"
        message={
          deleteFavoriteTarget
            ? `确认删除收藏夹「${deleteFavoriteTarget.name}」？仅当收藏夹为空时才可删除。`
            : ''
        }
        confirmText="删除"
        cancelText="取消"
        onConfirm={() => {
          if (deleteFavoriteTarget) handleDeleteFavorite(deleteFavoriteTarget.id);
          setDeleteFavoriteTarget(null);
        }}
        onCancel={() => setDeleteFavoriteTarget(null)}
      />

      {/* 加入收藏夹子弹窗（multi 模式） */}
      {addToFavoriteStoryId && (
        <AddToFavoriteDialog
          open={true}
          mode="multi"
          storyId={addToFavoriteStoryId}
          favorites={favorites}
          initialCheckedIds={addToFavoriteInitial}
          onClose={() => {
            setAddToFavoriteStoryId(null);
            setAddToFavoriteInitial([]);
          }}
          onCreateNew={() => setShowNewFavorite(true)}
          onToggle={async (favoriteId, inFav) => {
            await handleToggleStoryInFavorite(addToFavoriteStoryId, favoriteId, inFav);
          }}
        />
      )}

      {/* 移动到收藏夹弹窗（single 模式） */}
      {moveToFavoriteStoryId && (
        <AddToFavoriteDialog
          open={true}
          mode="single"
          storyId={moveToFavoriteStoryId}
          favorites={favorites}
          initialCheckedIds={addToFavoriteInitial}
          onClose={() => {
            setMoveToFavoriteStoryId(null);
            setAddToFavoriteInitial([]);
          }}
          onCreateNew={() => setShowNewFavorite(true)}
          onToggle={() => { /* single 模式不使用 */ }}
          onSelectSingle={async (favoriteId) => {
            await handleSelectMoveTarget(moveToFavoriteStoryId, favoriteId);
          }}
        />
      )}
    </div>
  );
}

/** 基于 HTML 字符串统计字数（用于 contenteditable 编辑器） */
export function countWordsFromHtml(html: string): { words: number; dice: number } {
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
          if (el.dataset?.type === 'dice-card') {
            // 只 dice-card 算骰子；image-block 不算
            dice++;
            return NodeFilter.FILTER_REJECT;
          }
          if (el.dataset?.type === 'image-block') {
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
export function countContent(content: string): { words: number; dice: number } {
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
export function countWordsAndDice(json: any): { words: number; dice: number } {
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
