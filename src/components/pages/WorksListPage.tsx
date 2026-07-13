import { useEffect, useMemo, useRef, useState } from 'react';
import { useStoryStore } from '../../store/storyStore';
import { useToastStore } from '../../store/toastStore';
import * as db from '../../db/index';
import { WorkCard, type WorkSummary } from '../common/WorkCard';
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
import { isCapacitor } from '../../utils/platform';
import * as favoritesDb from '../../db/favorites';
import type { Favorite } from '../../types/story';

interface WorksListPageProps {
  onOpenStory: (storyId: string) => void;
  onBack: () => void;
  onShowAuthor?: () => void;
  onOpenReader?: (storyId: string) => void;
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

export function WorksListPage({ onOpenStory, onBack, onShowAuthor, onOpenReader }: WorksListPageProps) {
  const { stories, trashedStories, loadTrashedStories, softDeleteStory, restoreStory, permanentlyDeleteStory, renameStory, updateStoryDescription, setActiveStory, toggleStarred, togglePinned, setStoryOrder } = useStoryStore();
  const showToast = useToastStore((s) => s.showToast);

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [showNewModal, setShowNewModal] = useState(false);
  const [newStoryTitle, setNewStoryTitle] = useState('');
  const [newStoryDescription, setNewStoryDescription] = useState('');
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const gridRef = useRef<HTMLDivElement | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<null | { type: 'soft-delete' | 'permanent-delete' | 'clear-trash' | 'duplicate'; work?: WorkSummary }>(null);
  const [pendingRename, setPendingRename] = useState<WorkSummary | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    const loadWorks = async () => {
      setWorksLoading(true);
      // 一次性聚合查询：3 次文件读 vs 原来 N×M 次（消灭 N+1）
      const storiesWithStats = await db.listStoriesWithStats();
      const diceRecords = useDiceHistoryStore.getState().records;
      const result: WorkSummary[] = storiesWithStats.map((story: any) => ({
        ...story,
        wordCount: story.wordCount || 0,
        diceCount: diceRecords.filter((r: any) => r.storyId === story.id).length,
        sectionCount: story.sectionCount || 0,
        chapterCount: story.chapterCount || 0,
      }));
      if (!cancelled) {
        setWorks(result);
        setWorksLoading(false);
      }
    };
    loadWorks();
    return () => { cancelled = true; };
  }, [stories]);

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
      label: `📁 ${f.name}`,
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

  const handleCreateStory = async () => {
    const title = newStoryTitle.trim() || `未命名作品 ${new Date().toLocaleDateString()}`;
    const { createStory } = useStoryStore.getState();
    const storyId = await createStory(title, newStoryDescription.trim());
    setShowNewModal(false);
    setNewStoryTitle('');
    setNewStoryDescription('');
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
    const useBulkForStructure = !!(db.bulkCreateVolumes && db.bulkCreateChapters && db.bulkCreateSections)
      && Array.isArray(data.volumes) && data.volumes.length > 0
      && Array.isArray(data.chapters) && data.chapters.length > 0;
    const structureTicks = useBulkForStructure
      ? 4 // 上限：1 外层 + 1 批量卷 + 1 批量章 + 1 批量节
      : (1 + volumeCount + chapterCount + sectionCount);
    const totalSteps = 1 + structureTicks + wsCount + charCount + relCount + outlineCount + 1;
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
          id: '',
          storyId: newStory.id,
          sectionId: (r.sectionId && sectionIdMap[r.sectionId]) || '',
        }));
        useDiceHistoryStore.getState().addRecords(newRecords);
      }

      tick('完成，刷新列表...');
      await yieldUI();
      await useStoryStore.getState().loadStories();
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

  return (
    <div className="min-h-full w-full flex flex-col" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {/* 顶部栏（sticky 在 TitleBar 下方 32px 处，z-40） */}
      <header
        className="sticky top-8 z-40 backdrop-blur"
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

          {isCapacitor ? (
            // 移动端：折叠按钮菜单
            <div className="ml-auto relative">
              <button
                onClick={() => setActionMenuOpen((v) => !v)}
                className="px-3 py-2 text-xs rounded-lg font-medium transition-colors inline-flex items-center gap-1.5"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                title="操作"
              >
                <span>☰</span>
                <span>操作</span>
              </button>
              {actionMenuOpen && (
                <>
                  {/* 点击遮罩关闭菜单 */}
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setActionMenuOpen(false)}
                  />
                  <div
                    className="absolute right-0 top-full mt-1 z-40 min-w-[180px] rounded-lg shadow-lg overflow-hidden"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
                  >
                    {onShowAuthor && (
                      <button
                        onClick={() => { setActionMenuOpen(false); onShowAuthor(); }}
                        className="w-full px-4 py-2.5 text-left text-xs transition-colors inline-flex items-center gap-2"
                        style={{ color: 'var(--text-secondary)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = ''; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                      >
                        <span>👤</span>
                        <span>关于作者</span>
                      </button>
                    )}
                    <button
                      onClick={() => { setActionMenuOpen(false); setActiveFilter('trash'); }}
                      className="w-full px-4 py-2.5 text-left text-xs transition-colors inline-flex items-center gap-2"
                      style={{ color: 'var(--text-secondary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = ''; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    >
                      <span>🗑️</span>
                      <span>回收站{trashedStories.length > 0 ? `(${trashedStories.length})` : ''}</span>
                    </button>
                    <button
                      onClick={() => { setActionMenuOpen(false); setShowNewModal(true); }}
                      className="w-full px-4 py-2.5 text-left text-xs font-medium transition-colors inline-flex items-center gap-2"
                      style={{ color: 'var(--accent)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                    >
                      <span>+</span>
                      <span>新建安科</span>
                    </button>
                    <button
                      onClick={() => { setActionMenuOpen(false); handleImportStory(); }}
                      className="w-full px-4 py-2.5 text-left text-xs transition-colors inline-flex items-center gap-2"
                      style={{ color: 'var(--text-primary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                    >
                      <span>📥</span>
                      <span>导入作品</span>
                    </button>
                    <button
                      onClick={() => { setActionMenuOpen(false); setBatchMode(!batchMode); setSelectedIds(new Set()); }}
                      className="w-full px-4 py-2.5 text-left text-xs transition-colors inline-flex items-center gap-2"
                      style={{ color: 'var(--text-primary)', background: batchMode ? 'var(--accent-soft)' : 'transparent' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = batchMode ? 'var(--accent-soft)' : ''; }}
                    >
                      <span>📦</span>
                      <span>{batchMode ? '取消批量' : '批量导出'}</span>
                    </button>
                    {batchMode && (
                      <button
                        onClick={() => { setActionMenuOpen(false); handleBatchExport(); }}
                        disabled={selectedIds.size === 0}
                        className="w-full px-4 py-2.5 text-left text-xs font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ color: 'var(--text-on-accent)', background: 'var(--accent)' }}
                      >
                        <span>📤</span>
                        <span>导出选中 ({selectedIds.size})</span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
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

              <div className="ml-auto flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setActiveFilter('trash')}
                  className="px-3 py-2 text-xs rounded-lg transition-colors inline-flex items-center gap-1.5"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = ''}
                  title="回收站"
                >
                  <span>🗑️</span>
                  <span>回收站{trashedStories.length > 0 ? `(${trashedStories.length})` : ''}</span>
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
                <button
                  onClick={handleImportStory}
                  className="px-4 py-2 text-xs rounded-lg font-medium transition-colors inline-flex items-center gap-1.5"
                  style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.background = 'var(--bg-card)'; }}
                >
                  <span>📥</span>
                  <span>导入作品</span>
                </button>
                <button
                  onClick={() => { setBatchMode(!batchMode); setSelectedIds(new Set()); }}
                  className="px-4 py-2 text-xs rounded-lg font-medium transition-colors inline-flex items-center gap-1.5"
                  style={{ background: batchMode ? 'var(--accent-soft)' : 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.background = batchMode ? 'var(--accent-soft)' : 'var(--bg-card)'; }}
                >
                  <span>📦</span>
                  <span>{batchMode ? '取消批量' : '批量导出'}</span>
                </button>
                {batchMode && (
                  <button
                    onClick={handleBatchExport}
                    disabled={selectedIds.size === 0}
                    className="px-4 py-2 text-xs rounded-lg font-medium transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
                    onMouseEnter={(e) => { if (selectedIds.size > 0) e.currentTarget.style.opacity = '0.9'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                  >
                    <span>📤</span>
                    <span>导出选中 ({selectedIds.size})</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* 筛选栏 */}
        <div className="max-w-6xl mx-auto px-6 sm:px-8 pb-4 flex items-center gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto flex-1 min-w-0 scrollbar-hide">
            {categories.map((cat) => {
              const active = activeFilter === cat.key;
              const isFavorite = cat.key.startsWith('fav:');
              const favId = isFavorite ? cat.key.slice(4) : null;
              // 收藏夹的 count 显示为该收藏夹内的作品数
              const count = isFavorite
                ? works.filter((w) => favoriteStoryIds.has(w.id) || true).filter((w) => w.id).length // 永远重渲染
                : cat.count;
              return (
                <div key={cat.key} className="relative shrink-0">
                  <button
                    onClick={() => setActiveFilter(cat.key)}
                    onContextMenu={(e) => {
                      if (!isFavorite) return;
                      e.preventDefault();
                      setFavoriteMenuOpenId(favId);
                    }}
                    className="px-3.5 py-1.5 rounded-full text-xs font-medium inline-flex items-center gap-1.5 transition-all"
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
                      {isFavorite ? favoriteStoryIds.size : cat.count}
                    </span>
                  </button>
                  {/* 收藏夹右键菜单 */}
                  {isFavorite && favoriteMenuOpenId === favId && (
                    <div
                      className="absolute top-full left-0 mt-1 min-w-[120px] rounded-lg shadow-xl border py-1 z-30"
                      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--bg-hover)]"
                        style={{ color: 'var(--text-primary)' }}
                        onClick={() => {
                          const f = favorites.find((x) => x.id === favId);
                          if (f) setRenameFavoriteTarget(f);
                          setFavoriteMenuOpenId(null);
                        }}
                      >
                        ✏️ 重命名
                      </button>
                      <button
                        className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--bg-hover)]"
                        style={{ color: 'var(--danger)' }}
                        onClick={() => {
                          const f = favorites.find((x) => x.id === favId);
                          if (f) setDeleteFavoriteTarget(f);
                          setFavoriteMenuOpenId(null);
                        }}
                      >
                        🗑 删除（仅空）
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {/* 新建收藏夹按钮 */}
            <button
              onClick={() => setShowNewFavorite(true)}
              className="shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium inline-flex items-center gap-1 transition-all"
              style={{
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '1px dashed var(--border-color)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--accent)';
                e.currentTarget.style.borderColor = 'var(--accent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-secondary)';
                e.currentTarget.style.borderColor = 'var(--border-color)';
              }}
              title="新建收藏夹"
            >
              <span className="text-base leading-none">+</span>
              <span>新建收藏夹</span>
            </button>
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
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{trashedStories.length} 个作品</span>
              {trashedStories.length > 0 && (
                <button
                  onClick={() => setConfirmState({ type: 'clear-trash' })}
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
            {trashedStories.length === 0 ? (
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
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5"
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
                  position: 'relative',
                }}
              >
                {batchMode && (
                  <div
                    className="absolute top-2 left-2 z-30"
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = new Set(selectedIds);
                      if (next.has(work.id)) next.delete(work.id);
                      else next.add(work.id);
                      setSelectedIds(next);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(work.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        const next = new Set(selectedIds);
                        if (e.target.checked) next.add(work.id);
                        else next.delete(work.id);
                        setSelectedIds(next);
                      }}
                      style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: 'var(--accent)' }}
                    />
                  </div>
                )}
                <WorkCard
                  work={work}
                  onOpen={(id) => {
                    if (batchMode) {
                      const next = new Set(selectedIds);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      setSelectedIds(next);
                      return;
                    }
                    // Fix #2：必须 await setActiveStory 完成数据切换后再跳转
                    // 否则编辑器挂载时会渲染旧作品的数据（chapters/sections 未清空）
                    void (async () => {
                      await setActiveStory(id);
                      onOpenStory(id);
                    })();
                  }}
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
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border outline-none transition-all resize-y"
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
      {pendingRename && (
        <Modal title={`重命名「${pendingRename.title}」`} onClose={() => setPendingRename(null)}>
          <div className="space-y-4">
            <input
              autoFocus
              type="text"
              defaultValue={pendingRename.title}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="作品标题"
              className="w-full px-3.5 py-2.5 text-sm rounded-lg border outline-none transition-all"
              style={{
                background: 'var(--bg-input)',
                borderColor: 'var(--border-color)',
                color: 'var(--text-primary)'
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPendingRename(null)}
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
                    renameStory(pendingRename.id, v);
                    showToast(`已重命名为「${v}」`, 'success');
                  }
                  setPendingRename(null);
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
      {importProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div
            className="rounded-2xl p-6 w-96 max-w-[90vw]"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
          >
            <div className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
              正在导入作品...
            </div>
            <div className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
              {importProgress.message}
            </div>
            <div className="h-2 rounded-full overflow-hidden mb-2" style={{ background: 'var(--bg-hover)' }}>
              <div
                className="h-full transition-all"
                style={{
                  width: `${importProgress.total > 0 ? Math.round((importProgress.current / importProgress.total) * 100) : 0}%`,
                  background: 'var(--accent)',
                }}
              />
            </div>
            <div className="text-xs text-right" style={{ color: 'var(--text-secondary)' }}>
              {importProgress.current}/{importProgress.total}
            </div>
          </div>
        </div>
      )}
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

function TrashCard({ work, onRestore, onPermanentDelete }: { work: WorkSummary; onRestore: () => void; onPermanentDelete: () => void }) {
  return (
    <div
      className="flex items-center gap-4 px-4 py-3 rounded-xl border"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
    >
      <span className="text-2xl">📖</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{work.title}</div>
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
