import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useStoryStore } from '../../store/storyStore';
import { useEditorStore } from '../../store/editorStore';
import { useEditorHistoryStore } from '../../store/editorHistoryStore';
import { useDiceStore } from '../../store/diceStore';
import {
  useDiceHistoryStore,
  buildDiceHistoryRecord,
  type DiceHistoryRecord,
} from '../../store/diceHistoryStore';
import type { Section, WorldSetting, DiceBlockPayloadV2 } from '../../types';
import { NGA_IMAGE_SIZES, NGA_DEFAULT_IMAGE_SIZE } from '../../types';
import * as db from '../../db/index';
import { useMetaStore } from '../../store/metaStore';
import { useSectionEditor } from '../../hooks/useSectionEditor';
import { DirectoryTree } from '../common/DirectoryTree';
import { DiceConfigDialog } from '../dice/DiceConfigDialog';
import { WorldSettingPanel } from '../common/WorldSettingPanel';
import { CharacterPanel } from '../character/CharacterEditor';
import { RichTextEditor, type RichTextEditorCommands } from '../editor/RichTextEditor';
import { isDiceCardInEditor } from '../editor/contenteditableUtils';
import { createDiceId, rollExpression } from '../../utils/diceEngine';
import { playDiceRollSound } from '../../utils/diceSound';
import { RelationshipPanel } from '../editor/RelationshipPanel';
import { OutlineTree } from '../outline/OutlineTree';
import { OutlineEditor } from '../outline/OutlineEditor';
import { SyncDialog } from '../common/SyncDialog';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { InputDialog } from '../common/InputDialog';
import { useToastStore } from '../../store/toastStore';
import { useSettingStore } from '../../store/settingStore';
import { uploadImagesWithProgress, ensureLocalWarning, type UploadProgressEvent } from '../../utils/uploadImage';
import { UploadProgressDialog } from '../common/UploadProgressDialog';
import { LocalModeBanner } from '../common/LocalModeBanner';
import {
  computeDiff,
  buildOutlineStructure,
  buildDirectoryStructure,
} from '../../utils/structureSync';
import type { DiffItem } from '../../utils/structureSync';
import { htmlToNGABBCode } from '../../utils/ngaHtmlToBBCode';
import { bbcodeToHtml } from '../../utils/ngaBBCodeToHtml';
import { validateBBCode } from '../../utils/bbcodeValidator';
import { parseOutlineContent } from '../../types';
import { isCapacitor, isElectron } from '../../utils/platform';
import { ContextMenu } from '../common/ContextMenu';
import { SearchPanel } from '../editor/SearchPanel';
import { GlobalSearchPanel } from '../editor/GlobalSearchPanel';
import { CompactImageLibraryPanel } from '../editor/CompactImageLibraryPanel';
import { toPng } from 'html-to-image';

interface EditorPageProps {
  onBack: () => void;
  onOpenReader?: () => void;
}

type EditorView = 'info' | 'directory' | 'outline' | 'character';

/** 基于 HTML 字符串统计字数（用于 contenteditable 编辑器）。
 * 规则：
 *  - 文本节点按非空白字符计数
 *  - 原子块（image-block / dice-card）各算 1 个"骰子/图片"项（不计入 words）
 *  - 返回 { words, dice }，dice 实际上是 "原子块总数"
 */
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

/** VS Code 风格的可拖动分隔条 */
function ResizeHandle({ onResize, side }: { onResize: (delta: number) => void; side: 'left' | 'right' }) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = ev.clientX - lastX.current;
      lastX.current = ev.clientX;
      onResize(side === 'left' ? delta : -delta);
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div
      className="shrink-0 hover:opacity-100 transition-opacity opacity-40"
      style={{
        width: 4,
        cursor: 'col-resize',
        background: 'var(--border-color)',
      }}
      onMouseDown={onMouseDown}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.opacity = '1'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--border-color)'; e.currentTarget.style.opacity = ''; }}
    />
  );
}

export function EditorPage({ onBack, onOpenReader }: EditorPageProps) {
  const {
    stories,
    activeStoryId,
    volumes,
    chapters,
    sections,
    activeChapterId,
    activeSectionId,
    expandedVolumeIds,
    expandedChapterIds,
    outlines,
    createVolume,
    createVolumeAt,
    createChapter,
    createChapterAt,
    createSection,
    createSectionAt,
    renameVolume,
    renameChapter,
    renameSection,
    deleteVolume,
    deleteChapter,
    deleteSection,
    renameStory,
    toggleVolume,
    toggleChapter,
    setActiveChapter,
    setActiveSection,
    reorderVolumes,
    reorderChapters,
    reorderSections,
    moveChapters,
    moveSections,
    createOutlineVolume,
    createOutlineChapter,
    renameOutline,
    deleteOutline,
    updateOutline,
  } = useStoryStore();

  const {
    sectionContent,
    sectionLoading,
    setSectionContent,
    flushSectionContent,
  } = useEditorStore();

  // 订阅撤销/重做可用状态（用 selector 避免不必要重渲染）
  const canUndo = useEditorHistoryStore((s) => s.canUndo());
  const canRedo = useEditorHistoryStore((s) => s.canRedo());

  const diceStore = useDiceStore();
  const [view, setView] = useState<EditorView>('directory');
  const [rightPanelTab, setRightPanelTab] = useState<
    'properties' | 'world' | 'character' | 'dice' | 'gallery'
  >('properties');
  // 编辑器视图模式：'visual' = 富文本 contenteditable；'bbcode' = 纯文本 BBCode
  const [editorMode, setEditorMode] = useState<'visual' | 'bbcode'>('visual');
  // BBCode 视图的本地草稿（受控 textarea 用）

  // 搜索面板需要访问的编辑器 DOM ref
  const bbcodeTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const visualEditorRef = useRef<HTMLDivElement | null>(null);

  // Phase E — 子卡点 3.2：BBCode 视图 Ctrl+Z/Y 拦截
  // BBCode 视图用原生 textarea，浏览器内置 undo 每次切节重置，无法跨节撤销。
  // 这里拦截 Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z，调用自定义栈，
  // 撤销结果按 mode 写回：visual → sectionContent，bbcode → bbcodeDraft。
  const handleUndoRedoForBBCode = useCallback(
    (kind: 'undo' | 'redo') => {
      const restored =
        kind === 'undo'
          ? useEditorHistoryStore.getState().undo()
          : useEditorHistoryStore.getState().redo();
      if (restored == null) return;
      if (editorMode === 'visual') {
        setSectionContent(restored);
      } else {
        setBbcodeDraft(restored);
      }
    },
    [editorMode],
  );
  const [bbcodeDraft, setBbcodeDraft] = useState('');
  // BBCode 语法校验错误（实时显示在编辑器下方，非阻塞）
  const [bbcodeErrors, setBbcodeErrors] = useState<string[]>([]);
  // BBCode → HTML 防抖定时器
  const bbcodeDebounceRef = useRef<number | null>(null);

  // 切换到 BBCode 视图时：从 section.bbcode 读取（不再 htmlToNGABBCode 回转）
  // 取消自动对照 —— BBCode 视图与可视化视图是两个独立的内容源
  //
  // 关键设计：
  // - bbcodeDraftSectionIdRef 跟踪当前 bbcodeDraft 来自哪个 section
  // - mode 切换（visual ↔ bbcode）不动 bbcodeDraft，避免覆盖用户编辑
  // - section 切换（点侧栏另一个节）才重置 bbcodeDraft
  // - 首次挂载时按 editorMode 决定是否同步加载
  const isFirstMount = useRef(true);
  const bbcodeDraftSectionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      if (editorMode === 'bbcode') {
        const sid = (section as any)?.id ?? null;
        const raw = (section as any)?.bbcode;
        setBbcodeDraft(raw ? String(raw) : '');
        bbcodeDraftSectionIdRef.current = sid;
      }
      return;
    }
    // section 切换由 useEffect on [section.id] 负责
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorMode]);

  // 卸载时清理防抖定时器
  useEffect(() => {
    return () => {
      if (bbcodeDebounceRef.current !== null) {
        window.clearTimeout(bbcodeDebounceRef.current);
      }
    };
  }, []);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const richTextEditorCommandsRef = useRef<RichTextEditorCommands | null>(null);
  const [selectedImage, setSelectedImage] = useState<{ width: number; height: number; src?: string; dataSize?: string } | null>(null);
  const [exportingImage, setExportingImage] = useState(false);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(256);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(384);
  // 用户手动拖动记忆值（窗口放大后恢复到此值）
  const userLeftWidthRef = useRef(256);
  const userRightWidthRef = useRef(384);
  // 桌面端右栏折叠（窄窗口自动折叠，可手动展开）
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  // 移动端 + 窄窗口响应式侧栏宽度：窗口缩小时自动收缩，窗口放大时恢复用户设定值
  useEffect(() => {
    const updateForViewport = () => {
      const w = window.innerWidth;
      if (w < 768) {
        // 移动端：左栏 200（仅缩小，不记为用户值）
        setLeftSidebarWidth((prev) => (prev > 200 ? 200 : prev));
      } else if (w < 1024) {
        // 窄窗口：左 200、右 240，自动折叠右栏释放编辑区空间
        setLeftSidebarWidth((prev) => (prev > 200 ? 200 : prev));
        setRightSidebarWidth((prev) => (prev > 240 ? 240 : prev));
        setRightSidebarCollapsed(true);
      } else if (w < 1280) {
        // 中等窗口：左 220、右 300
        setLeftSidebarWidth((prev) => (prev > 220 ? 220 : prev));
        setRightSidebarWidth((prev) => (prev > 300 ? 300 : prev));
        setRightSidebarCollapsed(false);
      } else {
        // 宽窗口（>=1280）：恢复用户设定值，展开右栏
        setLeftSidebarWidth(userLeftWidthRef.current);
        setRightSidebarWidth(userRightWidthRef.current);
        setRightSidebarCollapsed(false);
      }
    };
    updateForViewport();
    window.addEventListener('resize', updateForViewport);
    return () => window.removeEventListener('resize', updateForViewport);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 移动端判断：Capacitor 原生 App 或窗口宽度 < 768px
  const [isMobile, setIsMobile] = useState<boolean>(
    () => isCapacitor || (typeof window !== 'undefined' && window.innerWidth < 768),
  );
  // 移动端：左抽屉开关
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  // 移动端：右面板折叠开关（默认折叠，点击 tab 展开）
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  // 移动端：全屏专注编辑模式（键盘弹出时编辑区占据全部可视空间）
  const [focusMode, setFocusMode] = useState(false);
  // 移动端：键盘弹出检测（智能折叠面包屑/底状态条/右面板）
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  // 全屏专注编辑模式下的可视区域高度（跟随 visualViewport.height，避免被键盘遮挡）
  const [focusModeViewportHeight, setFocusModeViewportHeight] = useState<number>(
    typeof window !== 'undefined' && window.visualViewport
      ? window.visualViewport.height
      : typeof window !== 'undefined' ? window.innerHeight : 800
  );
  useEffect(() => {
    const onResize = () => setIsMobile(isCapacitor || window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    if (!isMobile) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const isOpen = window.innerHeight - vv.height > 100;
      setKeyboardOpen(isOpen);
      setFocusModeViewportHeight(vv.height);
      // 键盘弹出时自动收起右面板，避免挤占编辑区
      if (isOpen && mobilePanelOpen) setMobilePanelOpen(false);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [isMobile, mobilePanelOpen]);

  // 同步对话框状态（支持双向：目录→大纲、大纲→目录）
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncDialogSource, setSyncDialogSource] = useState<'directory' | 'outline'>('directory');
  const [volumeDiffs, setVolumeDiffs] = useState<DiffItem[]>([]);
  const [chapterDiffs, setChapterDiffs] = useState<DiffItem[]>([]);

  // 同步按钮二次确认（防止误覆盖辛苦写的内容）—— 安卓 + Windows 都生效
  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false);
  const [syncConfirmKind, setSyncConfirmKind] = useState<'visual-to-bbcode' | 'bbcode-to-visual'>('visual-to-bbcode');

  const handleOpenSyncDialog = (source: 'directory' | 'outline' = 'directory') => {
    if (!activeStoryId) return;
    const outlineStruct = buildOutlineStructure(outlines);
    const dirStruct = buildDirectoryStructure(volumes, chapters, outlines);
    const { volumes: volDiffs, chapters: chDiffs } = computeDiff(
      source,
      outlineStruct,
      dirStruct,
    );
    setSyncDialogSource(source);
    setVolumeDiffs(volDiffs);
    setChapterDiffs(chDiffs);
    setSyncDialogOpen(true);
  };

  const handleApplySync = async (confirmedVolDiffs: DiffItem[], confirmedChDiffs: DiffItem[]) => {
    if (!activeStoryId) return;

    if (syncDialogSource === 'directory') {
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
            const containerId = await createOutlineVolume(`未归卷容器`);
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

    setSyncDialogOpen(false);
  };

  // 节切换自动保存 / 加载逻辑（使用 useSectionEditor hook）
  useSectionEditor(activeSectionId);

  const story = stories.find((s) => s.id === activeStoryId);
  const section = sections.find((s) => s.id === activeSectionId);

  // section 切换时重置 bbcodeDraft（mode 切换不动；只在 section.id 实际变化时刷新）
  useEffect(() => {
    if (editorMode !== 'bbcode') return;
    const sid = (section as any)?.id ?? null;
    if (bbcodeDraftSectionIdRef.current === sid) return;
    const raw = (section as any)?.bbcode;
    setBbcodeDraft(raw ? String(raw) : '');
    bbcodeDraftSectionIdRef.current = sid;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(section as any)?.id, editorMode]);

  // ===== 同步按钮实际执行逻辑（用户点"确认覆盖"后调用）=====
  // 把当前可视化内容转成 BBCode，覆盖 bbcodeDraft + 持久化
  const doSyncVisualToBbcode = () => {
    const el = visualEditorRef.current;
    const html = (el && el.innerHTML && el.innerHTML !== '<br>')
      ? el.innerHTML
      : (sectionContent ?? '');
    try {
      const bb = htmlToNGABBCode(html);
      setBbcodeDraft(bb);
      // 标记当前 section 的 bbcodeDraft 已初始化，避免切到 BBCode 视图时被 useEffect 覆盖
      bbcodeDraftSectionIdRef.current = section?.id ?? null;
      if (activeSectionId) {
        void db.setSectionBBCode(activeSectionId, bb);
      }
      useToastStore.getState().showToast('已将可视化内容同步到 BBCode', 'success');
    } catch (e) {
      useToastStore.getState().showToast(`同步失败：${(e as Error).message}`, 'error');
    }
  };

  // 把当前 BBCode 转成 HTML，覆盖可视化编辑区
  const doSyncBbcodeToVisual = () => {
    const bb = bbcodeDraft ?? '';
    try {
      const html = bbcodeToHtml(bb);
      setSectionContent(html);
      // 强制同步 RichTextEditor 的 div.innerHTML（避免 useEffect 异步覆盖）
      requestAnimationFrame(() => {
        const ve = visualEditorRef.current;
        if (ve) {
          ve.innerHTML = html === '' ? '<br>' : html;
        }
      });
      useToastStore.getState().showToast('已将 BBCode 同步到可视化视图', 'success');
    } catch (e) {
      useToastStore.getState().showToast(`同步失败：${(e as Error).message}`, 'error');
    }
  };

  // 当前节导出为图片（使用 html-to-image 的 toPng，2 倍像素比保证清晰度）
  // 2x 失败时降级到 1x，应对内容过长 / canvas 尺寸超限
  const handleExportSectionAsImage = async () => {
    const el = visualEditorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    if (!html.trim() || html === '<br>') {
      useToastStore.getState().showToast('当前节没有内容可导出', 'info');
      return;
    }
    const tryExport = async (pixelRatio: number): Promise<string> => {
      return await toPng(el, {
        backgroundColor: getComputedStyle(el).backgroundColor || '#ffffff',
        pixelRatio,
      });
    };
    setExportingImage(true);
    try {
      let dataUrl: string;
      try {
        dataUrl = await tryExport(2);
      } catch (firstErr) {
        // 2x 像素比可能因内容过长 / canvas 尺寸超限失败，降级到 1x
        console.error('[exportImage] 2x pixelRatio 失败，尝试 1x:', firstErr);
        dataUrl = await tryExport(1);
      }
      const link = document.createElement('a');
      link.download = `${section?.title || '当前节'}.png`;
      link.href = dataUrl;
      link.click();
      useToastStore.getState().showToast('已导出为图片', 'success');
    } catch (e) {
      console.error('[exportImage] 完整错误对象:', e);
      // 兼容各种错误形态：DOMException、纯对象、字符串等
      const msg = (e as Error)?.message || String(e) || '未知错误（可能是内容过长或样式不兼容）';
      useToastStore.getState().showToast('导出失败：' + msg, 'error');
    } finally {
      setExportingImage(false);
    }
  };

  // 稳定 onDiceRolled 引用，避免 RichTextEditor 的 useEffect 频繁卸载/重建骰子卡片交互
  const handleDiceRolled = useCallback(
    (payload: DiceBlockPayloadV2) => {
      const rec = buildDiceHistoryRecord({
        payload,
        storyId: activeStoryId ?? '',
        sectionId: section?.id ?? '',
        sectionTitle: section?.title ?? '',
      });
      if (rec) useDiceHistoryStore.getState().addRecord(rec);
    },
    [activeStoryId, section?.id, section?.title],
  );

  // 面包屑路径：section → chapter → volume
  const activeChapter = chapters.find((c) => c.id === section?.chapter_id);
  const activeVolume = volumes.find((v) => v.id === activeChapter?.volume_id);
  const volIdx = volumes.findIndex((v) => v.id === activeVolume?.id);
  const chapterListInVolume = activeVolume
    ? chapters.filter((c) => c.volume_id === activeVolume.id)
    : [];
  const chIdx = activeChapter
    ? chapterListInVolume.findIndex((c) => c.id === activeChapter.id)
    : -1;

  const [sectionStats, setSectionStats] = useState<Record<string, { words: number; dice: number }>>({});

  const sectionWordCount = useMemo(() => {
    if (!sectionContent) return 0;
    try {
      const json = JSON.parse(sectionContent);
      if (json && typeof json === 'object') {
        return countWordsAndDice(json).words;
      }
    } catch {
      // fallthrough
    }
    return countWordsFromHtml(sectionContent).words;
  }, [sectionContent]);

  // 初始统计：直接从 SectionMeta.word_count 获取字数，无需加载 content
  useEffect(() => {
    const stats: Record<string, { words: number; dice: number }> = {};
    for (const sec of sections) {
      stats[sec.id] = { words: sec.word_count || 0, dice: 0 };
    }
    setSectionStats(stats);
  }, [sections]);

  // 当前编辑节：实时更新字数（基于 sectionContent）
  useEffect(() => {
    if (!section) return;
    const words = sectionWordCount;
    setSectionStats((prev) => {
      const prevStat = prev[section.id] || { words: 0, dice: 0 };
      if (prevStat.words === words) return prev;
      return { ...prev, [section.id]: { ...prevStat, words } };
    });
  }, [sectionWordCount, section?.id]);

  const handleTitleEditCommit = () => {
    const trimmed = titleInput.trim();
    if (trimmed && story && trimmed !== story.title) {
      renameStory(story.id, trimmed);
    }
    setIsEditingTitle(false);
  };

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <div
      className="flex flex-col"
      style={{
        // 桌面端严格视口高：避免编辑内容撑大整个界面
        // 移动端保留 min-h-full 由 body 统一滚动（前两轮设计）
        ...(isMobile
          ? { minHeight: '100%' }
          : { height: isElectron ? 'calc(100vh - 32px)' : '100vh' }),
        background: 'var(--bg-page)',
        color: 'var(--text-primary)',
      }}
    >
      {/* 顶部导航栏 */}
      {isMobile ? (
        <>
          {/* 移动端第一行：极简顶栏（非 sticky，随 body 滚动） */}
          <header
            className="shrink-0 flex items-center gap-2 px-3 py-1.5"
            style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)' }}
          >
            <button
              onClick={() => setLeftDrawerOpen(true)}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg"
              style={{ color: 'var(--text-secondary)' }}
              title="打开目录"
            >
              ☰
            </button>
            <button
              onClick={onBack}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg"
              style={{ color: 'var(--text-secondary)' }}
              title="返回"
            >
              ←
            </button>
            <div className="flex-1 min-w-0">
              {isEditingTitle ? (
                <input
                  autoFocus
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  onBlur={handleTitleEditCommit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTitleEditCommit();
                    if (e.key === 'Escape') setIsEditingTitle(false);
                  }}
                  className="text-sm font-semibold px-2 py-1 rounded outline-none w-full"
                  style={{ border: '1px solid var(--accent)', color: 'var(--text-primary)', background: 'var(--bg-card)' }}
                />
              ) : (
                <button
                  onClick={() => {
                    if (story) {
                      setTitleInput(story.title);
                      setIsEditingTitle(true);
                    }
                  }}
                  className="text-left text-sm font-semibold px-2 py-1 rounded truncate block w-full"
                  style={{ color: 'var(--text-primary)' }}
                  title="点击重命名作品"
                >
                  {story?.title || '未命名作品'}
                </button>
              )}
            </div>
            <span
              className="shrink-0 text-[11px] px-2 py-0.5 rounded-md flex items-center gap-1"
              style={{ color: 'var(--text-secondary)', background: 'var(--bg-hover)' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: 'var(--accent)' }}
              />
              {sectionWordCount > 999 ? `${(sectionWordCount/1000).toFixed(1)}k` : sectionWordCount}
            </span>
            {section && view === 'directory' && (
              <button
                onClick={() => setFocusMode(true)}
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg"
                style={{ color: 'var(--text-secondary)' }}
                title="全屏编辑"
              >
                ⤢
              </button>
            )}
            {onOpenReader && (
              <button
                onClick={onOpenReader}
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg"
                style={{ color: 'var(--text-secondary)' }}
                title="阅读模式"
              >
                📖
              </button>
            )}
          </header>
          {/* 移动端第二行：全宽 tab bar（4 个视图等分，确保全部可见） */}
          <nav
            className="shrink-0 grid grid-cols-4 border-b"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
          >
            {(['世界观', '目录', '大纲', '人物'] as const).map((label, idx) => {
              const key: EditorView = ['info', 'directory', 'outline', 'character'][idx] as EditorView;
              const icons = ['🌍', '📑', '📝', '🎭'];
              const active = view === key;
              return (
                <button
                  key={label}
                  onClick={() => setView(key)}
                  className="flex flex-col items-center justify-center py-1.5 text-[11px]"
                  style={{
                    color: active ? 'var(--accent)' : 'var(--text-secondary)',
                    background: active ? 'var(--accent-soft)' : 'transparent',
                  }}
                >
                  <span className="text-base leading-none mb-0.5">{icons[idx]}</span>
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>
        </>
      ) : (
      <header
        className="shrink-0 flex items-center gap-2 md:gap-4 px-3 md:px-4 py-2 md:py-2.5"
        style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)' }}
      >
        <button
          onClick={onBack}
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
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

        {onOpenReader && (
          <button
            onClick={onOpenReader}
            className="shrink-0 h-9 px-3 flex items-center gap-1.5 rounded-lg transition-colors"
            style={{
              color: 'var(--text-secondary)',
              fontSize: 13,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
            title="阅读模式"
          >
            <span>📖</span>
            <span className="hidden md:inline">阅读</span>
          </button>
        )}

        <div className="shrink-0 min-w-0 max-w-[160px] md:max-w-[280px]">
          {isEditingTitle ? (
            <input
              autoFocus
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onBlur={handleTitleEditCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTitleEditCommit();
                if (e.key === 'Escape') setIsEditingTitle(false);
              }}
              className="text-sm font-semibold px-2 py-1 rounded outline-none w-full"
              style={{ border: '1px solid var(--accent)', color: 'var(--text-primary)', background: 'var(--bg-card)' }}
            />
          ) : (
            <button
              onClick={() => {
                if (story) {
                  setTitleInput(story.title);
                  setIsEditingTitle(true);
                }
              }}
              className="text-left text-sm font-semibold px-2 py-1 rounded transition-colors truncate block w-full"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '')}
              title="点击重命名作品"
            >
              {story?.title || '未命名作品'}
            </button>
          )}
        </div>

        <nav className="flex-1 flex items-center justify-center gap-0.5 md:gap-1">
          {(['世界观', '目录编辑', '大纲', '人物角色'] as const).map((label, idx) => {
            const key: EditorView = ['info', 'directory', 'outline', 'character'][idx] as EditorView;
            const icons = ['🌍', '📑', '📝', '🎭'];
            const active = view === key;
            return (
              <button
                key={label}
                onClick={() => {
                  setView(key);
                }}
                className="relative px-2 md:px-3 py-1.5 text-xs font-medium rounded-lg transition-all shrink-0 whitespace-nowrap"
                style={{
                  color: active ? 'var(--accent)' : 'var(--text-secondary)',
                  background: active ? 'var(--accent-soft)' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.color = 'var(--text-primary)';
                    e.currentTarget.style.background = 'var(--bg-hover)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.color = 'var(--text-secondary)';
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <span className="mr-1">{icons[idx]}</span>
                <span>{label}</span>
                {active && (
                  <span
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full"
                    style={{ background: 'var(--accent)' }}
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="shrink-0 flex items-center gap-1 md:gap-1.5">
          <span
            className="text-xs px-2 py-1 rounded-md flex items-center gap-1"
            style={{ color: 'var(--text-secondary)', background: 'var(--bg-hover)' }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: 'var(--accent)' }}
            />
            <span className="hidden sm:inline">{sectionWordCount.toLocaleString()} 字</span>
            <span className="sm:hidden">{sectionWordCount > 999 ? `${(sectionWordCount/1000).toFixed(1)}k` : sectionWordCount}</span>
          </span>
        </div>
      </header>
      )}

      {/* 本地保存模式常驻警告横幅（仅在 imageStoreMode === 'local' 时显示） */}
      <LocalModeBanner />

      {/* 主体：根据 view 切换不同内容 */}
      {view === 'info' && <WorldSettingPanel />}
      {view === 'character' && <CharacterPanel richTextEditorCommandsRef={richTextEditorCommandsRef} />}

      {view === 'directory' && !focusMode && (
        <div className="flex-1 flex overflow-hidden min-h-0 relative md:min-h-[500px]">
          {/* ===== 桌面端：3 列布局（目录 + 编辑区 + 右侧栏） ===== */}
          {!isMobile && (
            <>
              <div className="shrink-0 flex flex-col overflow-hidden overflow-y-auto" style={{ width: leftSidebarWidth }}>
                <DirectoryTree
                  volumes={volumes}
                  chapters={chapters}
                  sections={sections}
                  activeChapterId={activeChapterId}
                  activeSectionId={activeSectionId}
                  sectionStats={sectionStats}
                  expandedVolumeIds={expandedVolumeIds}
                  expandedChapterIds={expandedChapterIds}
                  onSelectChapter={setActiveChapter}
                  onSelectSection={setActiveSection}
                  onCreateVolume={() => {
                    if (activeStoryId) {
                      const volCount = volumes.length + 1;
                      createVolume(activeStoryId, `第${volCount}卷`);
                    }
                  }}
                  onCreateChapter={(volumeId) => {
                    if (activeStoryId) {
                      // 按 volumeId 过滤后的章序号（per-volume 计数）
                      const chapCount = chapters.filter((c) => c.volume_id === volumeId).length + 1;
                      createChapter(activeStoryId, `第${chapCount}章`, volumeId);
                    }
                  }}
                  onCreateSection={(chapterId) => {
                    const chapterSections = sections.filter((s) => s.chapter_id === chapterId);
                    createSection(chapterId, `第${chapterSections.length + 1}节`);
                  }}
                  onCreateVolumeAt={(anchorId, position) => {
                    if (activeStoryId) {
                      const volCount = volumes.length + 1;
                      createVolumeAt(activeStoryId, `第${volCount}卷`, anchorId, position);
                    }
                  }}
                  onCreateChapterAt={(volumeId, anchorId, position) => {
                    if (activeStoryId) {
                      const chapCount = chapters.filter((c) => c.volume_id === volumeId).length + 1;
                      createChapterAt(activeStoryId, `第${chapCount}章`, volumeId, anchorId, position);
                    }
                  }}
                  onCreateSectionAt={(chapterId, anchorId, position) => {
                    const chapterSections = sections.filter((s) => s.chapter_id === chapterId);
                    createSectionAt(chapterId, `第${chapterSections.length + 1}节`, anchorId, position);
                  }}
                  onRenameVolume={renameVolume}
                  onRenameChapter={renameChapter}
                  onRenameSection={renameSection}
                  onDeleteVolume={deleteVolume}
                  onDeleteChapter={deleteChapter}
                  onDeleteSection={deleteSection}
                  onToggleVolume={toggleVolume}
                  onToggleChapter={toggleChapter}
                  onReorderVolumes={(orderedIds) =>
                    activeStoryId && reorderVolumes(orderedIds)
                  }
                  onReorderChapters={(orderedIds) =>
                    activeStoryId && reorderChapters(orderedIds)
                  }
                  onMoveChapters={(targetVolumeId, orderedIds) =>
                    activeStoryId && moveChapters(activeStoryId, targetVolumeId, orderedIds)
                  }
                  onMoveSections={(targetChapterId, orderedIds) =>
                    moveSections(targetChapterId, orderedIds)
                  }
                  onReorderSections={reorderSections}
                  onSyncToOutline={handleOpenSyncDialog}
                />
              </div>

              <ResizeHandle
                side="left"
                onResize={(delta) => setLeftSidebarWidth((w) => {
                  const next = Math.min(400, Math.max(160, w + delta));
                  userLeftWidthRef.current = next;
                  return next;
                })}
              />
            </>
          )}

          <div className="flex-1 min-w-0 flex flex-col overflow-hidden min-h-0">
          <main
            className="flex-1 min-w-0 flex flex-col overflow-hidden"
            style={{ borderLeft: !isMobile ? '1px solid var(--border-color)' : 'none', borderRight: !isMobile ? '1px solid var(--border-color)' : 'none', minHeight: 0 }}
          >
            {section && activeChapter ? (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {!(isMobile && keyboardOpen) && (
                  <EditorBreadcrumb
                    volumeIdx={volIdx >= 0 ? volIdx : 0}
                    volumeTitle={activeVolume?.title || '未归卷'}
                    chapterIdx={chIdx >= 0 ? chIdx : 0}
                    chapterTitle={activeChapter.title}
                    sectionTitle={section.title}
                  />
                )}
                {editorMode === 'visual' ? (
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
                    {!(isMobile && keyboardOpen) && (
                      <div
                        className="shrink-0 flex items-center gap-2 px-3 py-1.5 text-xs"
                        style={{
                          background: 'var(--bg-card)',
                          borderBottom: '1px solid var(--border-color)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            // 优先用真实 DOM（避免 store 滞后于最后一次 onInput）
                            const el = visualEditorRef.current;
                            const html = (el && el.innerHTML && el.innerHTML !== '<br>')
                              ? el.innerHTML
                              : (sectionContent ?? '');
                            if (!html.trim() || html === '<br>') {
                              useToastStore.getState().showToast('当前节没有可视化内容可同步', 'info');
                              return;
                            }
                            // 弹二次确认，防止误覆盖辛苦写的内容
                            setSyncConfirmKind('visual-to-bbcode');
                            setSyncConfirmOpen(true);
                          }}
                          className="px-2 py-1 rounded text-xs"
                          style={{
                            background: 'var(--bg-hover)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border-color)',
                            cursor: 'pointer',
                          }}
                          title="把当前可视化内容同步到 BBCode 字段（覆盖当前 BBCode）"
                        >
                          🔄 同步到BBCode
                        </button>
                        <button
                          type="button"
                          onClick={handleExportSectionAsImage}
                          className="px-2 py-1 rounded text-xs"
                          style={{
                            background: 'var(--bg-hover)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border-color)',
                            cursor: 'pointer',
                          }}
                          title="把当前节导出为图片"
                          disabled={exportingImage}
                        >
                          {exportingImage ? '⏳ 导出中...' : '📷 导出图片'}
                        </button>
                      </div>
                    )}
                    <RichTextEditor
                      content={sectionContent ?? ''}
                      onChangeContent={setSectionContent}
                      onInsertDiceRequest={() => diceStore.openDialog()}
                      onDiceRolled={handleDiceRolled}
                      onImageSelected={(info) => setSelectedImage(info)}
                      commandsRef={richTextEditorCommandsRef}
                      editable={true}
                      onShowToast={(msg) => setToast(msg)}
                      canUndo={canUndo}
                      canRedo={canRedo}
                      editorRef={visualEditorRef}
                      onSearchOpen={() => {
                        // 搜索面板在属性 tab 内常驻显示：保证切到属性 tab
                        setRightPanelTab('properties');
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
                    {!(isMobile && keyboardOpen) && (
                      <div
                        className="shrink-0 flex items-center gap-2 px-3 py-1.5 text-xs"
                        style={{
                          background: 'var(--bg-card)',
                          borderBottom: '1px solid var(--border-color)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            const bb = bbcodeDraft ?? '';
                            if (!bb.trim()) {
                              useToastStore.getState().showToast('当前节没有 BBCode 内容可同步', 'info');
                              return;
                            }
                            // 弹二次确认，防止误覆盖辛苦写的内容
                            setSyncConfirmKind('bbcode-to-visual');
                            setSyncConfirmOpen(true);
                          }}
                          className="px-2 py-1 rounded text-xs"
                          style={{
                            background: 'var(--bg-hover)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border-color)',
                            cursor: 'pointer',
                          }}
                          title="把当前 BBCode 同步到可视化视图（覆盖当前 visual 编辑）"
                        >
                          🔄 同步到可视化
                        </button>
                      </div>
                    )}
                    <BBCodeEditor
                      value={bbcodeDraft}
                      onChange={setBbcodeDraft}
                      onDebouncedChange={(bb) => {
                        // 取消自动对照：BBCode 编辑只持久化 section.bbcode，不自动写回 section.content
                        // 可视化视图需用户主动点"同步到可视化"按钮才会同步
                        if (activeSectionId) {
                          void db.setSectionBBCode(activeSectionId, bb);
                        }
                        // 实时语法校验（非阻塞：仅显示错误，不阻止编辑/保存）
                        const result = validateBBCode(bb);
                        setBbcodeErrors((prev) => {
                          if (
                            prev.length === result.errors.length &&
                            prev.every((e, i) => e === result.errors[i])
                          ) {
                            return prev;
                          }
                          return result.errors;
                        });
                      }}
                      onUndo={() => handleUndoRedoForBBCode('undo')}
                      onRedo={() => handleUndoRedoForBBCode('redo')}
                      textareaRef={bbcodeTextareaRef}
                      onSearchOpen={() => {
                        // 搜索面板在属性 tab 内常驻显示：保证切到属性 tab
                        setRightPanelTab('properties');
                      }}
                    />
                    {bbcodeErrors.length > 0 && (
                      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-color)' }}>
                        {bbcodeErrors.map((err, i) => (
                          <div key={i} style={{ color: '#dc2626', fontSize: 12, marginTop: 2 }}>{err}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {sectionLoading && (
                  <div className="absolute inset-0 flex items-center justify-center z-10" style={{ background: 'rgba(0,0,0,0.08)' }}>
                    <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                      加载中...
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div
                className="flex-1 flex items-center justify-center text-xs"
                style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}
              >
                请在左侧选择一个节开始编辑
              </div>
            )}
          </main>

          {/* 底部状态栏：移出 main，放外层 flex 容器中 shrink-0 贴底 */}
          {section && !(isMobile && keyboardOpen) && (
            <BottomStatusBar
              editorMode={editorMode}
              onSwitchMode={setEditorMode}
            />
          )}
          </div>

          {/* ===== 安卓版：右侧面板默认折叠（只露 tab 头，点击展开，不盖编辑区） ===== */}
          {isMobile && (
            <aside
              className="shrink-0 flex flex-col border-t"
              style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)' }}
            >
              {/* 移动端面板头：4 图标 tab（切换内容并自动展开）+ 独立▼/▲折叠按钮 */}
              <div className="shrink-0 flex items-center border-b" style={{ borderColor: 'var(--border-color)' }}>
                <div className="flex-1 grid grid-cols-5">
                  {([
                    { key: 'properties', label: '⚙️' },
                    { key: 'world', label: '🌏' },
                    { key: 'character', label: '👤' },
                    { key: 'dice', label: '🎲' },
                    { key: 'gallery', label: '🖼️' },
                  ] as const).map((t) => {
                    const active = rightPanelTab === t.key;
                    return (
                      <button
                        key={t.key}
                        onClick={() => {
                          setRightPanelTab(t.key);
                          if (!mobilePanelOpen) setMobilePanelOpen(true);
                        }}
                        className="flex items-center justify-center py-2 text-base"
                        style={{
                          color: active ? 'var(--accent)' : 'var(--text-secondary)',
                          background: active ? 'var(--accent-soft)' : 'transparent',
                        }}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
                {/* 独立展开/折叠按钮 */}
                <button
                  onClick={() => setMobilePanelOpen(!mobilePanelOpen)}
                  className="shrink-0 w-10 flex items-center justify-center py-2"
                  style={{
                    color: 'var(--text-secondary)',
                    borderLeft: '1px solid var(--border-color)',
                  }}
                  title={mobilePanelOpen ? '收起面板' : '展开面板'}
                >
                  {mobilePanelOpen ? '▼' : '▲'}
                </button>
              </div>
              {/* 内容区：仅展开时渲染，max-h 限制 + 可滚动 */}
              {mobilePanelOpen && (
                <div className="max-h-[35vh] overflow-y-auto">
                  <RightPanel
                    activeTab={rightPanelTab}
                    setActiveTab={setRightPanelTab}
                    section={section}
                    onRenameSection={(t) => section && renameSection(section.id, t)}
                    onJumpToDice={(sectionId, payloadSnapshot) => {
                      if (sectionId !== activeSectionId) {
                        useStoryStore.getState().setActiveSection(sectionId);
                      }
                      window.setTimeout(() => {
                        richTextEditorCommandsRef.current?.scrollToDiceCard(payloadSnapshot);
                      }, 80);
                    }}
                    onRestoreDice={(sectionId, payloadSnapshot) => {
                      if (sectionId !== activeSectionId) {
                        useStoryStore.getState().setActiveSection(sectionId);
                      }
                      window.setTimeout(() => {
                        try {
                          const payload = JSON.parse(payloadSnapshot);
                          // 给恢复的骰子换新 id（顶层 + config.id），与原骰子完全独立
                          payload.config = { ...payload.config, id: createDiceId() };
                          payload.id = `dice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
                          payload.restored = true;
                          richTextEditorCommandsRef.current?.insertDice(payload);
                          setToast('已恢复骰子到编辑区');
                        } catch (e) {
                          setToast('恢复失败：骰子数据格式错误');
                        }
                      }, 80);
                    }}
                    onInsertUnrolledDice={(_, payloadSnapshot) => {
                      try {
                        const payload = JSON.parse(payloadSnapshot);
                        // 生成全新 config.id，让插入的骰子与原骰子完全独立
                        payload.config = { ...payload.config, id: createDiceId() };
                        payload.id = `dice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
                        payload.history = [];
                        payload.lastResult = null;
                        payload.restored = false;
                        richTextEditorCommandsRef.current?.insertDice(payload);
                        setToast('已插入未掷骰的骰子');
                      } catch (e) {
                        setToast('插入失败：骰子数据格式错误');
                      }
                    }}
                    onCheckDiceExists={(sectionId, payloadSnapshot) => {
                      if (sectionId !== activeSectionId) return false;
                      const el = visualEditorRef.current;
                      if (!el) return false;
                      return isDiceCardInEditor(el, payloadSnapshot);
                    }}
                    selectedImage={selectedImage}
                    onSetImageSize={(size) => richTextEditorCommandsRef.current?.setSelectedImageSize(size)}
                    richTextEditorCommandsRef={richTextEditorCommandsRef}
                    onShowToast={(msg) => setToast(msg)}
                    width={undefined}
                    editorMode={editorMode}
                    bbcodeTextareaRef={bbcodeTextareaRef}
                    visualEditorRef={visualEditorRef}
                    bbcodeValue={bbcodeDraft}
                    visualValue={sectionContent ?? ''}
                    onBBCodeChange={setBbcodeDraft}
                    onVisualChange={setSectionContent}
                    hideHeader
                  />
                </div>
              )}
            </aside>
          )}

          {!isMobile && !rightSidebarCollapsed && (
            <>
              <ResizeHandle
                side="right"
                onResize={(delta) => setRightSidebarWidth((w) => {
                  const next = Math.min(600, Math.max(200, w + delta));
                  userRightWidthRef.current = next;
                  return next;
                })}
              />

              <RightPanel
                activeTab={rightPanelTab}
                setActiveTab={setRightPanelTab}
                section={section}
                onCollapse={() => setRightSidebarCollapsed(true)}
                onRenameSection={(t) => section && renameSection(section.id, t)}
                onJumpToDice={(sectionId, payloadSnapshot) => {
                  if (sectionId !== activeSectionId) {
                    const setActive = useStoryStore.getState().setActiveSection;
                    setActive(sectionId);
                  }
                  // 等下一个 tick，编辑器内容被重新渲染后再滚动
                  window.setTimeout(() => {
                    richTextEditorCommandsRef.current?.scrollToDiceCard(payloadSnapshot);
                  }, 80);
                }}
                onRestoreDice={(sectionId, payloadSnapshot) => {
                  // 跳到目标节
                  if (sectionId !== activeSectionId) {
                    const setActive = useStoryStore.getState().setActiveSection;
                    setActive(sectionId);
                  }
                  window.setTimeout(() => {
                    try {
                      const payload = JSON.parse(payloadSnapshot);
                      // 给恢复的骰子换新 id（顶层 + config.id），与原骰子完全独立
                      // 注意：isDiceCardInEditor 比对的是 config.id，必须更新此字段
                      payload.config = { ...payload.config, id: createDiceId() };
                      payload.id = `dice-${Date.now().toString(36)}-${Math.random()
                        .toString(36)
                        .slice(2, 8)}`;
                      // 标记为"已恢复"结果
                      payload.restored = true;
                      richTextEditorCommandsRef.current?.insertDice(payload);
                      setToast('已恢复骰子到编辑区');
                    } catch (e) {
                      setToast('恢复失败：骰子数据格式错误');
                    }
                  }, 80);
                }}
                onInsertUnrolledDice={(_, payloadSnapshot) => {
                  try {
                    const payload = JSON.parse(payloadSnapshot);
                    // 生成全新 config.id，让插入的骰子与原骰子完全独立
                    payload.config = { ...payload.config, id: createDiceId() };
                    payload.id = `dice-${Date.now().toString(36)}-${Math.random()
                      .toString(36)
                      .slice(2, 8)}`;
                    payload.history = [];
                    payload.lastResult = null;
                    payload.restored = false;
                    richTextEditorCommandsRef.current?.insertDice(payload);
                    setToast('已插入未掷骰的骰子');
                  } catch (e) {
                    setToast('插入失败：骰子数据格式错误');
                  }
                }}
                onCheckDiceExists={(sectionId, payloadSnapshot) => {
                  if (sectionId !== activeSectionId) return false;
                  const el = visualEditorRef.current;
                  if (!el) return false;
                  return isDiceCardInEditor(el, payloadSnapshot);
                }}
                selectedImage={selectedImage}
                onSetImageSize={(size) => {
                  richTextEditorCommandsRef.current?.setSelectedImageSize(size);
                }}
                richTextEditorCommandsRef={richTextEditorCommandsRef}
                onShowToast={(msg) => setToast(msg)}
                width={rightSidebarWidth}
                editorMode={editorMode}
                bbcodeTextareaRef={bbcodeTextareaRef}
                visualEditorRef={visualEditorRef}
                bbcodeValue={bbcodeDraft}
                visualValue={sectionContent ?? ''}
                onBBCodeChange={setBbcodeDraft}
                onVisualChange={setSectionContent}
              />
            </>
          )}

          {/* 桌面端右栏折叠状态：显示展开按钮 */}
          {!isMobile && rightSidebarCollapsed && (
            <button
              onClick={() => setRightSidebarCollapsed(false)}
              title="展开右侧面板"
              className="shrink-0 flex items-center justify-center w-6 border-l"
              style={{
                background: 'var(--bg-card)',
                borderColor: 'var(--border-color)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)';
                e.currentTarget.style.color = 'var(--accent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-card)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              ◀
            </button>
          )}

          {/* ===== 移动端：左抽屉（目录） ===== */}
          {isMobile && leftDrawerOpen && (
            <div
              className="mobile-drawer-backdrop absolute inset-0 z-30 bg-black/50"
              onClick={() => setLeftDrawerOpen(false)}
            >
              <div
                className="mobile-drawer-panel-left absolute left-0 top-0 bottom-0 w-[85%] max-w-[320px] shadow-2xl flex flex-col"
                style={{ background: 'var(--bg-card)' }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* 抽屉头部：关闭按钮 + 标题 */}
                <div
                  className="shrink-0 flex items-center justify-between px-3 py-2 border-b"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>目录</div>
                  <button
                    onClick={() => setLeftDrawerOpen(false)}
                    className="w-11 h-11 flex items-center justify-center rounded-lg"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    ✕
                  </button>
                </div>
                <div className="flex-1 overflow-hidden">
                  <DirectoryTree
                    volumes={volumes}
                    chapters={chapters}
                    sections={sections}
                    activeChapterId={activeChapterId}
                    activeSectionId={activeSectionId}
                    sectionStats={sectionStats}
                    expandedVolumeIds={expandedVolumeIds}
                    expandedChapterIds={expandedChapterIds}
                    onSelectChapter={(id) => { setActiveChapter(id); }}
                    onSelectSection={(id) => { setActiveSection(id); setLeftDrawerOpen(false); }}
                    onCreateVolume={() => {
                      if (activeStoryId) {
                        const volCount = volumes.length + 1;
                        createVolume(activeStoryId, `第${volCount}卷`);
                      }
                    }}
                    onCreateChapter={(volumeId) => {
                      if (activeStoryId) {
                        const chapCount = chapters.filter((c) => c.volume_id === volumeId).length + 1;
                        createChapter(activeStoryId, `第${chapCount}章`, volumeId);
                      }
                    }}
                    onCreateSection={(chapterId) => {
                      const chapterSections = sections.filter((s) => s.chapter_id === chapterId);
                      createSection(chapterId, `第${chapterSections.length + 1}节`);
                    }}
                    onCreateVolumeAt={(anchorId, position) => {
                      if (activeStoryId) {
                        const volCount = volumes.length + 1;
                        createVolumeAt(activeStoryId, `第${volCount}卷`, anchorId, position);
                      }
                    }}
                    onCreateChapterAt={(volumeId, anchorId, position) => {
                      if (activeStoryId) {
                        const chapCount = chapters.filter((c) => c.volume_id === volumeId).length + 1;
                        createChapterAt(activeStoryId, `第${chapCount}章`, volumeId, anchorId, position);
                      }
                    }}
                    onCreateSectionAt={(chapterId, anchorId, position) => {
                      const chapterSections = sections.filter((s) => s.chapter_id === chapterId);
                      createSectionAt(chapterId, `第${chapterSections.length + 1}节`, anchorId, position);
                    }}
                    onRenameVolume={renameVolume}
                    onRenameChapter={renameChapter}
                    onRenameSection={renameSection}
                    onDeleteVolume={deleteVolume}
                    onDeleteChapter={deleteChapter}
                    onDeleteSection={deleteSection}
                    onToggleVolume={toggleVolume}
                    onToggleChapter={toggleChapter}
                    onReorderVolumes={(orderedIds) =>
                      activeStoryId && reorderVolumes(orderedIds)
                    }
                    onReorderChapters={(orderedIds) =>
                      activeStoryId && reorderChapters(orderedIds)
                    }
                    onMoveChapters={(targetVolumeId, orderedIds) =>
                      activeStoryId && moveChapters(activeStoryId, targetVolumeId, orderedIds)
                    }
                    onMoveSections={(targetChapterId, orderedIds) =>
                      moveSections(targetChapterId, orderedIds)
                    }
                    onReorderSections={reorderSections}
                    onSyncToOutline={handleOpenSyncDialog}
                  />
                </div>
              </div>
            </div>
          )}

        </div>
      )}

      {view === 'outline' && (
        <div className="flex-1 flex overflow-hidden min-h-0">
          <OutlineTree
            onJumpToChapter={(chapterId) => {
              setActiveChapter(chapterId);
              setView('directory');
            }}
          />
          <main
            className="flex-1 flex flex-col overflow-hidden"
            style={{ borderLeft: '1px solid var(--border-color)', background: 'var(--bg-page)', minHeight: 0 }}
          >
            <div
              className="shrink-0 flex items-center justify-end gap-2 px-4 py-2 border-b"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
            >
              <button
                onClick={() => handleOpenSyncDialog('outline')}
                className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
                style={{ background: 'var(--bg-card)', color: 'var(--accent)', border: '1px solid var(--accent-soft)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-soft)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
              >
                📋 同步大纲到目录
              </button>
              <button
                onClick={() => handleOpenSyncDialog('directory')}
                className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
                style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
              >
                📋 同步目录到大纲
              </button>
            </div>
            <OutlineEditor />
          </main>
        </div>
      )}

      {/* Toast 提示 */}
      {toast && (
        <div
          className="absolute left-1/2 top-6 z-50 -translate-x-1/2 px-4 py-2 rounded-lg shadow-lg text-xs font-medium"
          style={{ background: 'var(--text-primary)', color: 'var(--bg-card)' }}
        >
          {toast}
        </div>
      )}

      {/* 骰子配置弹窗 */}
      <DiceConfigDialog
        onSaveNew={(payload) => {
          richTextEditorCommandsRef.current?.insertDice(payload as DiceBlockPayloadV2);
        }}
      />

      {/* 同步对话框（支持大纲→目录 和 目录→大纲 两个方向） */}
      <SyncDialog
        open={syncDialogOpen}
        onClose={() => setSyncDialogOpen(false)}
        source={syncDialogSource}
        volumeDiffs={volumeDiffs}
        chapterDiffs={chapterDiffs}
        onConfirm={handleApplySync}
      />

      {/* 同步按钮二次确认：防止误点覆盖辛苦写的内容（安卓 + Windows 都生效） */}
      <ConfirmDialog
        open={syncConfirmOpen}
        title="同步确认"
        danger
        message={
          syncConfirmKind === 'visual-to-bbcode'
            ? '将用当前可视化内容覆盖 BBCode 字段，原有的 BBCode 内容会被替换。确定继续？'
            : '将用当前 BBCode 内容覆盖可视化编辑区，原有的可视化内容会被替换。确定继续？'
        }
        confirmText="确认覆盖"
        cancelText="取消"
        onConfirm={() => {
          setSyncConfirmOpen(false);
          if (syncConfirmKind === 'visual-to-bbcode') {
            doSyncVisualToBbcode();
          } else {
            doSyncBbcodeToVisual();
          }
        }}
        onCancel={() => setSyncConfirmOpen(false)}
      />

      {/* ===== 移动端全屏专注编辑模式 =====
          用户点 ⤢ 按钮进入，编辑器占据全部可视空间（键盘弹出时编辑区不被挤窄） */}
      {focusMode && section && activeChapter && view === 'directory' && (
        <div
          className="fixed top-0 left-0 right-0 z-50 flex flex-col"
          style={{ height: focusModeViewportHeight, background: 'var(--bg-page)' }}
        >
          <header
            className="shrink-0 flex items-center gap-2 px-3 py-2"
            style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-color)' }}
          >
            <button
              onClick={() => setFocusMode(false)}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg"
              style={{ color: 'var(--text-secondary)' }}
              title="退出全屏"
            >
              ←
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                {activeVolume?.title || '未命名卷'} - {activeChapter.title} - {section.title}
              </div>
            </div>
            <button
              onClick={() => setFocusMode(false)}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg"
              style={{ color: 'var(--text-secondary)' }}
              title="退出全屏"
            >
              ✕
            </button>
          </header>
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            {editorMode === 'visual' ? (
              <RichTextEditor
                content={sectionContent ?? ''}
                onChangeContent={setSectionContent}
                onInsertDiceRequest={() => diceStore.openDialog()}
                onDiceRolled={handleDiceRolled}
                onImageSelected={(info) => setSelectedImage(info)}
                commandsRef={richTextEditorCommandsRef}
                editable={true}
                onShowToast={(msg) => setToast(msg)}
                canUndo={canUndo}
                canRedo={canRedo}
                editorRef={visualEditorRef}
                onSearchOpen={() => {
                  setRightPanelTab('properties');
                }}
              />
            ) : (
              <BBCodeEditor
                value={bbcodeDraft}
                onChange={setBbcodeDraft}
                onDebouncedChange={(bb) => {
                  if (activeSectionId) {
                    void db.setSectionBBCode(activeSectionId, bb);
                  }
                  const result = validateBBCode(bb);
                  setBbcodeErrors((prev) => {
                    if (
                      prev.length === result.errors.length &&
                      prev.every((e, i) => e === result.errors[i])
                    ) {
                      return prev;
                    }
                    return result.errors;
                  });
                }}
                onUndo={() => handleUndoRedoForBBCode('undo')}
                onRedo={() => handleUndoRedoForBBCode('redo')}
                textareaRef={bbcodeTextareaRef}
                onSearchOpen={() => {
                  setRightPanelTab('properties');
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ========== 右侧栏：属性 / 世界观 / 人物 / 骰点记录 四 Tab 切换 ==========

function RightPanel({
  activeTab,
  setActiveTab,
  section,
  onRenameSection,
  onJumpToDice,
  onRestoreDice,
  onInsertUnrolledDice,
  onCheckDiceExists,
  selectedImage,
  onSetImageSize,
  richTextEditorCommandsRef,
  onShowToast,
  width,
  editorMode,
  bbcodeTextareaRef,
  visualEditorRef,
  bbcodeValue,
  visualValue,
  onBBCodeChange,
  onVisualChange,
  hideHeader,
  onCollapse,
}: {
  activeTab: 'properties' | 'world' | 'character' | 'dice' | 'gallery';
  setActiveTab: (tab: 'properties' | 'world' | 'character' | 'dice' | 'gallery') => void;
  section: Section | undefined;
  onRenameSection: (newTitle: string) => void;
  onJumpToDice: (sectionId: string, payloadSnapshot: string) => void;
  onRestoreDice: (sectionId: string, payloadSnapshot: string) => void;
  onInsertUnrolledDice: (sectionId: string, payloadSnapshot: string) => void;
  onCheckDiceExists: (sectionId: string, payloadSnapshot: string) => boolean;
  selectedImage: { width: number; height: number; src?: string; dataSize?: string } | null;
  onSetImageSize: (size: string) => void;
  richTextEditorCommandsRef: React.MutableRefObject<RichTextEditorCommands | null>;
  onShowToast?: (msg: string) => void;
  width?: number;
  editorMode: 'visual' | 'bbcode';
  bbcodeTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  visualEditorRef: React.RefObject<HTMLDivElement | null>;
  bbcodeValue: string;
  visualValue: string;
  onBBCodeChange: (v: string) => void;
  onVisualChange: (v: string) => void;
  hideHeader?: boolean;
  onCollapse?: () => void;
}) {
  const [imageSizeNga, setImageSizeNga] = useState<string>('original');
  const [imageUrl, setImageUrl] = useState<string>('');
  const activeStoryId = useStoryStore((s) => s.activeStoryId);
  // 搜索模式：'current' = 当前节内搜索（SearchPanel）；'global' = 全作品搜索（GlobalSearchPanel）
  const [searchMode, setSearchMode] = useState<'current' | 'global'>('current');
  // 跨节搜索（GlobalSearchPanel）跳转时携带的 query；SearchPanel 消费后清空
  const [pendingSearchQuery, setPendingSearchQuery] = useState('');
  // 全作品搜索跳转：切换到对应作品 + 节，并切回当前节搜索便于继续编辑
  const setActiveStory = useStoryStore((s) => s.setActiveStory);
  const setActiveSection = useStoryStore((s) => s.setActiveSection);
  const handleGlobalSearchNavigate = useCallback(
    (storyId: string, sectionId: string, searchQuery?: string) => {
      void setActiveStory(storyId);
      setActiveSection(sectionId);
      setActiveTab('properties');
      setSearchMode('current');
      // 把跨节搜索的 query 传给 SearchPanel，自动填入并 doFind 到第一个匹配
      setPendingSearchQuery(searchQuery || '');
    },
    [setActiveStory, setActiveSection, setActiveTab],
  );

  // 当选中图片变化时，同步输入框的值
  useEffect(() => {
    if (selectedImage) {
      setImageSizeNga(selectedImage.dataSize || 'original');
      setImageUrl(selectedImage.src || '');
    }
  }, [selectedImage?.dataSize, selectedImage?.src]);
  const tabs: {
    key: 'properties' | 'world' | 'character' | 'dice' | 'gallery';
    label: string;
  }[] = [
    { key: 'properties', label: '⚙️属性' },
    { key: 'world', label: '🌏世界观' },
    { key: 'character', label: '👤人物' },
    { key: 'dice', label: '🎲骰点' },
    { key: 'gallery', label: '🖼️图库' },
  ];

  return (
    <aside
      className="shrink-0 flex flex-col overflow-hidden overflow-y-auto"
      style={{
        width: width ?? '100%',
        background: 'var(--bg-card)',
        borderLeft: width !== undefined ? '1px solid var(--border-color)' : 'none',
      }}
    >
      {/* Tab 头部（hideHeader 时隐藏，由外部提供 tab 头） */}
      {!hideHeader && (
      <div className="shrink-0 flex items-stretch border-b" style={{ borderColor: 'var(--border-color)' }}>
        {tabs.map((t) => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className="flex-1 flex items-center justify-center px-2 py-2 text-xs font-medium transition-colors shrink-0 whitespace-nowrap"
              style={{
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                background: active ? 'var(--accent-soft)' : 'var(--bg-card)',
                borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              <span>{t.label}</span>
            </button>
          );
        })}
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="折叠右侧面板"
            className="shrink-0 flex items-center justify-center w-7 text-xs transition-colors"
            style={{
              color: 'var(--text-secondary)',
              background: 'var(--bg-card)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
              e.currentTarget.style.color = 'var(--accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-card)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            ▶
          </button>
        )}
      </div>
      )}

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'properties' && (
          <div className="p-4 space-y-4">
            {/* 快速骰子面板：表达式投掷 + 复制骰点文本，无历史记录 */}
            <QuickDicePanel />
            {section ? (
              <>
                <div>
                  <div className="text-[10px] font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>节标题</div>
                  <input
                    defaultValue={section.title}
                    onBlur={(e) => onRenameSection(e.target.value.trim() || section.title)}
                    className="w-full px-2 py-1.5 text-xs rounded-md border outline-none"
                    style={{ borderColor: 'var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                  创建: {section.created_at?.slice(0, 10) || '-'}
                  <br />
                  更新: {section.updated_at?.slice(0, 10) || '-'}
                </div>
              </>
            ) : (
              <div className="text-xs text-center py-8" style={{ color: 'var(--text-secondary)' }}>
                选择一节开始编辑
              </div>
            )}

            {/* 选中图片时显示尺寸编辑区 */}
            {selectedImage && (
              <div className="pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
                <div className="text-[11px] font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                  🖼️ 图片属性
                </div>
                {/* NGA 尺寸选择 */}
                <div className="mb-3">
                  <div className="text-[10px] mb-1" style={{ color: 'var(--text-secondary)' }}>
                    尺寸预设（点击切换）
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {NGA_IMAGE_SIZES.map((s) => {
                      const active = imageSizeNga === s.value;
                      return (
                        <button
                          key={s.value}
                          onClick={() => {
                            setImageSizeNga(s.value);
                            onSetImageSize(s.value);
                          }}
                          className="text-[10px] px-2 py-1.5 rounded-md transition-colors"
                          style={{
                            background: active ? 'var(--accent-bg)' : 'var(--bg-hover)',
                            color: active ? 'var(--accent)' : 'var(--text-primary)',
                            border: `1px solid ${active ? 'var(--accent)' : 'var(--border-color)'}`,
                            fontWeight: active ? 600 : 400,
                          }}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* URL */}
                <div className="mb-2">
                  <div className="text-[10px] mb-1" style={{ color: 'var(--text-secondary)' }}>
                    图片 URL
                  </div>
                  <input
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    onBlur={() => {
                      if (imageUrl.trim()) {
                        richTextEditorCommandsRef.current?.updateSelectedImageSrc(imageUrl.trim());
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && imageUrl.trim()) {
                        richTextEditorCommandsRef.current?.updateSelectedImageSrc(imageUrl.trim());
                      }
                    }}
                    className="w-full px-2 py-1.5 text-xs rounded-md border outline-none transition-colors"
                    style={{
                      borderColor: 'var(--border-color)',
                      background: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                    }}
                    placeholder="图片链接地址"
                  />
                </div>
                <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                  提示：点击上方尺寸预设调整大小，导出时会拼接到图片 URL 后缀。
                </div>
              </div>
            )}

            {/* 搜索面板：常驻显示在属性面板内 */}
            <div
              className="pt-4 border-t"
              style={{ borderColor: 'var(--border-color)' }}
            >
              {/* 搜索模式切换 Tab */}
              <div
                className="flex gap-1 mb-2"
                style={{ borderBottom: '1px solid var(--border-color)' }}
              >
                {(['current', 'global'] as const).map((mode) => {
                  const active = searchMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setSearchMode(mode)}
                      style={{
                        padding: '4px 10px',
                        fontSize: 12,
                        fontWeight: active ? 600 : 400,
                        background: active ? 'var(--bg-hover)' : 'transparent',
                        color: active ? 'var(--accent)' : 'var(--text-secondary)',
                        border: 'none',
                        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                        cursor: 'pointer',
                      }}
                    >
                      {mode === 'current' ? '当前节' : '🌐 全作品'}
                    </button>
                  );
                })}
              </div>
              {searchMode === 'current' ? (
                <SearchPanel
                  editorMode={editorMode}
                  bbcodeTextareaRef={bbcodeTextareaRef}
                  visualEditorRef={visualEditorRef}
                  bbcodeValue={bbcodeValue}
                  visualValue={visualValue}
                  onBBCodeChange={onBBCodeChange}
                  onVisualChange={onVisualChange}
                  initialQuery={pendingSearchQuery}
                  onInitialQueryConsumed={() => setPendingSearchQuery('')}
                />
              ) : (
                <GlobalSearchPanel
                  onNavigate={handleGlobalSearchNavigate}
                  currentStoryId={activeStoryId}
                />
              )}
            </div>
          </div>
        )}
        {activeTab === 'world' && <CompactWorldSettingPanel onShowToast={onShowToast} />}
        {activeTab === 'character' && (
          <CompactCharacterPanel
            richTextEditorCommandsRef={richTextEditorCommandsRef}
            onShowToast={onShowToast}
          />
        )}
        {activeTab === 'dice' && (
            <DiceHistoryPanel
              storyId={activeStoryId}
              onJumpToDice={onJumpToDice}
              onRestoreDice={onRestoreDice}
              onInsertUnrolledDice={onInsertUnrolledDice}
              onCheckDiceExists={onCheckDiceExists}
            />
          )}
        {activeTab === 'gallery' && (
          <CompactImageLibraryPanel
            onInsertImage={(url) => {
              if (richTextEditorCommandsRef.current) {
                richTextEditorCommandsRef.current.insertImage(url, NGA_DEFAULT_IMAGE_SIZE);
                onShowToast?.('已插入图片');
              } else {
                onShowToast?.('没有可用的编辑器');
              }
            }}
          />
        )}
      </div>
    </aside>
  );
}

// ========== 快速骰子面板（properties tab 顶部） ==========

type QuickResult = { total: number; detail: string; allRolls: number[] };

const QUICK_DICE_PRESETS = ['1d100', '1d20', '2d6', '1d6+3'];

function QuickDicePanel() {
  const [expr, setExpr] = useState('1d100');
  const [result, setResult] = useState<QuickResult | null>(null);
  const [isRolling, setIsRolling] = useState(false);
  const [displayTotal, setDisplayTotal] = useState<number | null>(null);
  const [lastExpr, setLastExpr] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const doRoll = (expression: string) => {
    const trimmed = expression.trim();
    if (!trimmed) {
      useToastStore.getState().showToast('请输入骰子表达式', 'warning');
      return;
    }
    if (isRolling) return;

    let r: QuickResult;
    try {
      const res = rollExpression(trimmed);
      r = { total: res.total, detail: res.detail, allRolls: res.allRolls };
    } catch (err) {
      useToastStore.getState().showToast(
        `表达式错误：${(err as Error).message || '无法解析'}`,
        'error',
      );
      return;
    }

    // 音效（仅在设置开启时）
    if (useSettingStore.getState().soundEnabled) {
      void playDiceRollSound();
    }

    setLastExpr(trimmed);
    setIsRolling(true);

    // 渐进减速数字滚动（800ms）
    const tickDelays = [50, 50, 50, 50, 50, 50, 75, 75, 75, 75, 100, 100];
    const maxValue = 100;
    let tickIdx = 0;
    const tickFn = () => {
      const v = Math.floor(Math.random() * maxValue) + 1;
      setDisplayTotal(v);
      if (tickIdx < tickDelays.length) {
        window.setTimeout(tickFn, tickDelays[tickIdx]);
        tickIdx++;
      } else {
        setDisplayTotal(r.total);
        setResult(r);
        setIsRolling(false);
      }
    };
    tickFn();
  };

  const handleCopy = () => {
    if (!result) return;
    const text = `[${lastExpr || expr.trim()}=${result.total}]`;
    const ok = () => useToastStore.getState().showToast('已复制：' + text, 'success');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(ok, () => fallbackCopy(text, ok));
    } else {
      fallbackCopy(text, ok);
    }
  };

  const fallbackCopy = (text: string, ok: () => void) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      ok();
    } catch {
      useToastStore.getState().showToast('复制失败', 'error');
    }
  };

  return (
    <div
      className="rounded-lg border p-3"
      style={{ borderColor: 'var(--border-color)', background: 'var(--bg-base)' }}
    >
      <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        🎲 快速骰子
      </div>
      <div className="flex gap-2 mb-2">
        <input
          ref={inputRef}
          type="text"
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              doRoll(expr);
            }
          }}
          disabled={isRolling}
          placeholder="1d100、2d6+3..."
          className="flex-1 min-w-0 px-2 py-1 text-xs rounded-md outline-none disabled:opacity-50"
          style={{
            border: '1px solid var(--border-color)',
            background: 'var(--bg-input)',
            color: 'var(--text-primary)',
          }}
        />
        <button
          onClick={() => doRoll(expr)}
          disabled={isRolling}
          className={`px-3 py-1 text-xs rounded-md font-medium disabled:opacity-60 disabled:cursor-not-allowed ${isRolling ? 'anke-dice-playground-press' : ''}`}
          style={{
            background: 'var(--accent)',
            color: 'var(--text-on-accent)',
            border: '1px solid var(--accent)',
          }}
        >
          投
        </button>
      </div>
      <div className="flex flex-wrap gap-1 mb-2">
        {QUICK_DICE_PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => {
              setExpr(p);
              doRoll(p);
            }}
            disabled={isRolling}
            className="text-[10px] px-1.5 py-0.5 rounded disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: 'var(--bg-hover)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
            }}
          >
            {p}
          </button>
        ))}
      </div>
      {(result || isRolling) && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-1 min-w-0">
            <span
              className={isRolling ? 'anke-dice-playground-spin' : ''}
              style={{ fontSize: 14, display: 'inline-block' }}
            >
              🎲
            </span>
            <span
              className="text-[10px] font-mono truncate"
              style={{ color: 'var(--text-secondary)' }}
            >
              {isRolling ? expr.trim() : lastExpr}
            </span>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              =
            </span>
            <span
              className="text-lg font-bold tabular-nums"
              style={{ color: 'var(--accent)' }}
            >
              {isRolling ? displayTotal : result?.total}
            </span>
          </div>
          {!isRolling && result && (
            <button
              onClick={handleCopy}
              className="text-[10px] px-2 py-1 rounded border shrink-0"
              style={{
                borderColor: 'var(--accent)',
                color: 'var(--accent)',
                background: 'transparent',
                cursor: 'pointer',
              }}
              title="复制骰点文本"
            >
              📋 复制
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ========== 骰点历史记录面板 ==========

type DiceGroupMode = 'flat' | 'time' | 'story';

interface DiceGroup {
  key: string;
  title: string;
  records: DiceHistoryRecord[];
}

function DiceHistoryPanel({
  storyId,
  onJumpToDice,
  onRestoreDice,
  onInsertUnrolledDice,
  onCheckDiceExists,
}: {
  storyId?: string | null;
  onJumpToDice: (sectionId: string, payloadSnapshot: string) => void;
  onRestoreDice: (sectionId: string, payloadSnapshot: string) => void;
  onInsertUnrolledDice: (sectionId: string, payloadSnapshot: string) => void;
  onCheckDiceExists: (sectionId: string, payloadSnapshot: string) => boolean;
}) {
  const allRecords = useDiceHistoryStore((s) => s.records);
  const clearAll = useDiceHistoryStore((s) => s.clearAll);
  const removeRecord = useDiceHistoryStore((s) => s.removeRecord);
  const stories = useStoryStore((s) => s.stories);
  const [pendingClearDice, setPendingClearDice] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupMode, setGroupMode] = useState<DiceGroupMode>('time');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // storyId → title 映射（用于「作品」分组标题）
  const storyNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stories) m.set(s.id, s.title);
    return m;
  }, [stories]);

  // 范围 + 搜索过滤 + 分组
  const groups = useMemo<DiceGroup[]>(() => {
    // 1. 范围过滤：「作品」模式取全部；其他模式仅当前作品
    let list = allRecords;
    if (groupMode !== 'story') {
      list = storyId ? list.filter((r) => r.storyId === storyId) : [];
    }
    // 2. 搜索过滤（大小写不敏感）
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((r) =>
        [r.diceName, r.diceType, r.result, r.resultDetail, r.sectionTitle]
          .join(' ')
          .toLowerCase()
          .includes(q),
      );
    }
    // 3. 分组
    if (groupMode === 'flat') {
      return [{ key: 'all', title: '全部记录', records: list }];
    }
    if (groupMode === 'time') {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const yesterdayStart = todayStart - 86400000;
      const weekStart = todayStart - 6 * 86400000;
      const buckets: Record<string, { title: string; records: DiceHistoryRecord[] }> = {
        today: { title: '今天', records: [] },
        yesterday: { title: '昨天', records: [] },
        week: { title: '本周', records: [] },
        earlier: { title: '更早', records: [] },
      };
      for (const r of list) {
        if (r.timestamp >= todayStart) buckets.today.records.push(r);
        else if (r.timestamp >= yesterdayStart) buckets.yesterday.records.push(r);
        else if (r.timestamp >= weekStart) buckets.week.records.push(r);
        else buckets.earlier.records.push(r);
      }
      return (['today', 'yesterday', 'week', 'earlier'] as const)
        .filter((k) => buckets[k].records.length > 0)
        .map((k) => ({ key: k, title: buckets[k].title, records: buckets[k].records }));
    }
    // story 分组
    const byStory = new Map<string, DiceHistoryRecord[]>();
    for (const r of list) {
      const key = r.storyId || '__unknown__';
      const arr = byStory.get(key) || [];
      arr.push(r);
      byStory.set(key, arr);
    }
    return Array.from(byStory.entries()).map(([sid, recs]) => ({
      key: sid,
      title: sid === '__unknown__' ? '未知作品' : (storyNameMap.get(sid) || '未知作品'),
      records: recs,
    }));
  }, [allRecords, storyId, groupMode, searchQuery, storyNameMap]);

  const toggleCollapse = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalCount = groups.reduce((sum, g) => sum + g.records.length, 0);

  const formatTime = (ts: number): string => {
    try {
      const d = new Date(ts);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return String(ts);
    }
  };

  const renderRecord = (r: DiceHistoryRecord) => (
    <div
      key={r.id}
      className="relative p-3 rounded-lg border transition-colors"
      style={{ borderColor: 'var(--border-color)', background: 'var(--bg-base)' }}
    >
      {/* 单条删除 */}
      <button
        onClick={() => {
          removeRecord(r.id);
          useToastStore.getState().showToast('已删除该条记录', 'success');
        }}
        className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded text-[12px] leading-none"
        style={{ color: 'var(--text-muted)', background: 'transparent' }}
        title="删除该条记录"
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger, #d33)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
      >
        ×
      </button>
      <div className="text-[10px] mb-1" style={{ color: 'var(--text-secondary)' }}>
        {formatTime(r.timestamp)}
      </div>
      <div className="flex items-center gap-2 mb-1">
        <div className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
          {r.diceName}
        </div>
        <div
          className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          {r.diceType}
        </div>
      </div>
      <div className="text-xs font-mono mb-1" style={{ color: 'var(--accent)' }}>
        结果: {r.result}
      </div>
      {r.resultDetail && r.resultDetail !== r.result && (
        <div className="text-[11px] mb-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {r.resultDetail}
        </div>
      )}
      <div className="flex items-center justify-between pt-2 mt-1" style={{ borderTop: '1px solid var(--border-color)' }}>
        <div className="text-[10px] truncate flex-1 pr-2" style={{ color: 'var(--text-secondary)' }}>
          → {r.sectionTitle || '(未命名节)'}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onInsertUnrolledDice(r.sectionId, r.payloadSnapshot)}
            className="text-[10px] px-2 py-1 rounded-md font-medium border"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: 'transparent' }}
            title="在当前光标插入一个相同格式未掷骰的骰子"
          >
            插入
          </button>
          <button
            onClick={() => onRestoreDice(r.sectionId, r.payloadSnapshot)}
            disabled={onCheckDiceExists(r.sectionId, r.payloadSnapshot)}
            className="text-[10px] px-2 py-1 rounded-md font-medium border disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: 'transparent' }}
            title={onCheckDiceExists(r.sectionId, r.payloadSnapshot) ? '该骰子仍在编辑区，无需恢复' : '在编辑区重新插入一个相同的骰子'}
          >
            恢复
          </button>
          <button
            onClick={() => onJumpToDice(r.sectionId, r.payloadSnapshot)}
            className="text-[10px] px-2 py-1 rounded-md font-medium"
            style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
          >
            跳转
          </button>
        </div>
      </div>
    </div>
  );

  const groupBtn = (mode: DiceGroupMode, label: string) => {
    const active = groupMode === mode;
    return (
      <button
        onClick={() => setGroupMode(mode)}
        className="px-2 py-1 text-[10px] font-medium"
        style={{
          background: active ? 'var(--accent)' : 'var(--bg-card)',
          color: active ? 'var(--text-on-accent, #fff)' : 'var(--text-secondary)',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="p-3 flex flex-col h-full">
      {/* 顶部工具栏：搜索框 + 分组切换 */}
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索骰子名/类型/结果/节..."
          className="flex-1 min-w-0 px-2 py-1 text-xs rounded-md outline-none"
          style={{
            border: '1px solid var(--border-color)',
            background: 'var(--bg-input)',
            color: 'var(--text-primary)',
          }}
        />
        <div
          className="flex shrink-0 rounded-md overflow-hidden"
          style={{ border: '1px solid var(--border-color)' }}
        >
          {groupBtn('story', '作品')}
          {groupBtn('time', '时间')}
          {groupBtn('flat', '平铺')}
        </div>
      </div>
      <div className="flex items-center justify-between mb-2 shrink-0">
        <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          骰点历史 <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>共 {totalCount} 条</span>
        </div>
        {totalCount > 0 && (
          <button
            onClick={() => setPendingClearDice(true)}
            className="text-[10px] px-2 py-1 rounded-md border transition-colors"
            style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.borderColor = 'var(--danger)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
          >
            清空
          </button>
        )}
      </div>

      {totalCount === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs py-16" style={{ color: 'var(--text-secondary)' }}>
          {searchQuery ? '没有匹配的记录' : '还没有骰点记录，去正文编辑器掷一次骰子试试。'}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {groups.map((g) => {
            const collapsed = collapsedGroups.has(g.key);
            const showHeader = groupMode !== 'flat';
            return (
              <div key={g.key}>
                {showHeader && (
                  <div
                    onClick={() => toggleCollapse(g.key)}
                    className="flex items-center gap-1 px-1 py-1 cursor-pointer text-[11px] font-semibold select-none"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    <span style={{ display: 'inline-block', width: 12 }}>{collapsed ? '▶' : '▼'}</span>
                    <span>{g.title}</span>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>({g.records.length})</span>
                  </div>
                )}
                {!collapsed && (
                  <div className="space-y-2 mt-1">
                    {g.records.map(renderRecord)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pendingClearDice && (
        <ConfirmDialog
          open={true}
          title="清空确认"
          message="确定清空全部骰点记录？此操作不可撤销。"
          danger
          onConfirm={() => {
            clearAll();
            useToastStore.getState().showToast('已清空', 'success');
            setPendingClearDice(false);
          }}
          onCancel={() => setPendingClearDice(false)}
        />
      )}
    </div>
  );
}

// ========== 紧凑型世界观设定面板 ==========

function CompactWorldSettingPanel({
  onShowToast,
}: {
  onShowToast?: (msg: string) => void;
}) {
  const activeStoryId = useStoryStore((s) => s.activeStoryId);
  const worldSettings = useMetaStore((s) => s.worldSettings);
  const editingWorldId = useMetaStore((s) => s.editingWorldId);
  const createWorldSetting = useMetaStore((s) => s.createWorldSetting);
  const deleteWorldSetting = useMetaStore((s) => s.deleteWorldSetting);
  const setEditingWorldId = useMetaStore((s) => s.setEditingWorldId);

  const editing = worldSettings.find((w) => w.id === editingWorldId) ?? null;

  // 多选状态（紧凑面板不显示拖动）
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingBatchDelete, setPendingBatchDelete] = useState<{ ids: string[]; names: string[] } | null>(null);

  const filtered = activeStoryId
    ? worldSettings
        .filter((w) => w.story_id === activeStoryId)
        .slice()
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    : [];

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const clearSelection = () => setSelectedIds([]);
  const handleBatchDelete = async () => {
    if (!pendingBatchDelete) return;
    const target = pendingBatchDelete;
    setPendingBatchDelete(null);
    let deleted = 0;
    for (const id of target.ids) {
      await deleteWorldSetting(id);
      deleted++;
    }
    useToastStore.getState().showToast(`已批量删除 ${deleted} 条世界观`, 'success');
    clearSelection();
  };

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-card)' }}>
      {/* 顶部工具条 */}
      <div
        className="shrink-0 flex items-center justify-between px-3 py-2 border-b"
        style={{ background: 'var(--bg-toolbar)', borderColor: 'var(--border-color)' }}
      >
        <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>世界观设定</div>
        {selectedIds.length > 0 ? (
          <div className="flex items-center gap-1">
            <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>已选 {selectedIds.length}</span>
            <button
              onClick={() => {
                const names = filtered.filter((w) => selectedIds.includes(w.id)).map((w) => w.title || '未命名');
                setPendingBatchDelete({ ids: [...selectedIds], names });
              }}
              className="text-[10px] px-2 py-1 rounded transition-colors"
              style={{ background: 'var(--danger)', color: '#fff' }}
              title="删除所选"
            >
              🗑 批量删除
            </button>
            <button
              onClick={clearSelection}
              className="text-[10px] px-2 py-1 rounded transition-colors"
              style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => activeStoryId && createWorldSetting(activeStoryId)}
            disabled={!activeStoryId}
            className="text-[10px] px-2 py-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
          >
            + 新建
          </button>
        )}
      </div>

      {/* 条目列表 */}
      <div className="shrink-0 p-2 border-b max-h-40 overflow-y-auto space-y-1" style={{ borderColor: 'var(--border-color)' }}>
        {!activeStoryId && (
          <div className="text-[10px] italic px-2 py-3 text-center" style={{ color: 'var(--text-secondary)' }}>请先选择一个故事</div>
        )}
        {activeStoryId && filtered.length === 0 && (
          <div className="text-[10px] italic px-2 py-3 text-center" style={{ color: 'var(--text-secondary)' }}>
            暂无条目，点击上方"新建"
          </div>
        )}
        {activeStoryId && filtered.length > 0 && (
          <div className="space-y-1">
            {filtered.map((ws) => {
              const isActive = ws.id === editingWorldId;
              const isSel = selectedIds.includes(ws.id);
              return (
                <div
                  key={ws.id}
                  className="w-full text-left px-2 py-1.5 text-xs rounded transition-colors border flex items-start gap-1"
                  style={{
                    background: isSel
                      ? 'var(--accent-bg)'
                      : isActive
                      ? 'var(--accent-soft)'
                      : 'transparent',
                    color: isSel || isActive ? 'var(--accent)' : 'var(--text-primary)',
                    borderColor: isSel || isActive ? 'var(--accent)' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSel && !isActive) e.currentTarget.style.background = 'var(--bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSel && !isActive) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggleSelect(ws.id)}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onDragStart={(e) => e.preventDefault()}
                    style={{ marginTop: 2, cursor: 'pointer' }}
                    title="勾选以加入批量删除"
                  />
                  <button
                    onClick={() => setEditingWorldId(isActive ? null : ws.id)}
                    className="flex-1 text-left"
                  >
                    <div className="font-medium truncate">{ws.title || '未命名'}</div>
                    <div className="text-[10px] truncate" style={{ color: 'var(--text-secondary)' }}>
                      {(ws.content || '').slice(0, 50)}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 编辑区 */}
      <div className="flex-1 overflow-y-auto">
        {editing ? (
          <WorldSettingEditorInline setting={editing} onShowToast={onShowToast} />
        ) : (
          <div className="p-6 text-center">
            <div className="text-3xl mb-3 opacity-40">📜</div>
            <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>选择或新建一个世界观条目</div>
            <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>点击上方列表中的条目进行编辑</div>
          </div>
        )}
      </div>

      {pendingBatchDelete && (
        <ConfirmDialog
          open={true}
          title="批量删除世界观"
          message={`确定删除以下 ${pendingBatchDelete.ids.length} 条世界观？${pendingBatchDelete.names.length <= 5 ? `\n• ${pendingBatchDelete.names.join('\n• ')}` : ''}\n此操作不可撤销。`}
          danger
          onConfirm={handleBatchDelete}
          onCancel={() => setPendingBatchDelete(null)}
        />
      )}
    </div>
  );
}

// 简易内嵌版世界观编辑器（文本标题 + 富文本内容）
function WorldSettingEditorInline({ setting, onShowToast }: { setting: WorldSetting; onShowToast?: (msg: string) => void }) {
  const updateWorldSetting = useMetaStore((s) => s.updateWorldSetting);
  const deleteWorldSetting = useMetaStore((s) => s.deleteWorldSetting);
  const setEditingWorldId = useMetaStore((s) => s.setEditingWorldId);

  const [title, setTitle] = useState(setting.title || '');
  const [content, setContent] = useState(setting.content || '');
  const [pendingDelete, setPendingDelete] = useState(false);

  useEffect(() => {
    setTitle(setting.title || '');
    setContent(setting.content || '');
  }, [setting.id]);

  const handleSave = () => {
    updateWorldSetting(setting.id, { title, content });
  };

  const handleDelete = () => {
    setPendingDelete(true);
  };

  return (
    <div className="p-3 space-y-3" style={{ background: 'var(--bg-card)' }}>
      <div>
        <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>标题</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleSave}
          className="w-full px-2 py-1.5 text-xs rounded-md border outline-none"
          style={{ borderColor: 'var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
          placeholder="例如：主要角色设定"
        />
      </div>
      <div>
        <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>内容</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={handleSave}
          rows={12}
          className="w-full px-2 py-2 text-xs rounded-md border outline-none resize-y leading-relaxed"
          style={{ borderColor: 'var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
          placeholder="在此编辑世界观设定..."
        />
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={() => {
            const tplName = (title || '未命名世界观模板').trim();
            handleSave();
            useMetaStore.getState().createWorldSettingTemplate({
              title: tplName,
              content,
            });
          }}
          className="px-2 py-1 text-[10px] rounded-md transition-colors"
          style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-card)'}
          title="把当前世界观设定保存为模板"
        >
          存为模板
        </button>
        <button
          onClick={handleDelete}
          className="px-2 py-1 text-[10px] rounded-md transition-colors"
          style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
        >
          删除条目
        </button>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          open={true}
          title="删除确认"
          message={`确定删除"${title || '未命名'}"？此操作不可撤销。`}
          danger
          onConfirm={() => {
            deleteWorldSetting(setting.id);
            setEditingWorldId(null);
            useToastStore.getState().showToast('已删除', 'success');
            setPendingDelete(false);
          }}
          onCancel={() => setPendingDelete(false)}
        />
      )}
    </div>
  );
}

// ========== 紧凑型人物角色面板 ==========

function CompactCharacterPanel({
  richTextEditorCommandsRef,
  onShowToast,
}: {
  richTextEditorCommandsRef: React.MutableRefObject<RichTextEditorCommands | null>;
  onShowToast?: (msg: string) => void;
}) {
  const activeStoryId = useStoryStore((s) => s.activeStoryId);
  const [panelTab, setPanelTab] = useState<'by-character' | 'by-variant' | 'relation'>('by-character');

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-card)' }}>
      {/* === 主导航 Tab：按人物 / 按差分 / 关系 === */}
      <div
        className="shrink-0 flex border-b"
        style={{ borderColor: 'var(--border-color)', background: 'var(--bg-toolbar)' }}
      >
        {[
          { key: 'by-character', label: '👤 按人物' },
          { key: 'by-variant', label: '🎴 按差分' },
          { key: 'relation', label: '🔗 关系' },
        ].map((t) => {
          const active = panelTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setPanelTab(t.key as 'by-character' | 'by-variant' | 'relation')}
              className="flex-1 py-2 text-xs font-medium transition-colors"
              style={{
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                background: active ? 'var(--bg-card)' : 'transparent',
                borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {panelTab === 'by-character' && (
        <ByCharacterContent
          richTextEditorCommandsRef={richTextEditorCommandsRef}
          onShowToast={onShowToast}
        />
      )}

      {panelTab === 'by-variant' && (
        <ByVariantContent
          richTextEditorCommandsRef={richTextEditorCommandsRef}
          onShowToast={onShowToast}
        />
      )}

      {panelTab === 'relation' && activeStoryId && (
        <RelationshipPanel storyId={activeStoryId} />
      )}
    </div>
  );
}

/**
 * 「按人物」面板：原角色卡片列表 + 编辑区
 */
function ByCharacterContent({
  richTextEditorCommandsRef,
  onShowToast,
}: {
  richTextEditorCommandsRef: React.MutableRefObject<RichTextEditorCommands | null>;
  onShowToast?: (msg: string) => void;
}) {
  const activeStoryId = useStoryStore((s) => s.activeStoryId);
  const characters = useMetaStore((s) => s.characters);
  const editingCharacterId = useMetaStore((s) => s.editingCharacterId);
  const createCharacter = useMetaStore((s) => s.createCharacter);
  const setEditingCharacter = useMetaStore((s) => s.setEditingCharacter);
  const deleteCharacter = useMetaStore((s) => s.deleteCharacter);

  const editing = characters.find((c) => c.id === editingCharacterId) ?? null;

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pendingBatchDelete, setPendingBatchDelete] = useState<{ ids: string[]; names: string[] } | null>(null);

  const filtered = activeStoryId
    ? characters
        .filter((c) => c.story_id === activeStoryId)
        .slice()
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    : [];

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const clearSelection = () => setSelectedIds([]);
  const handleBatchDelete = async () => {
    if (!pendingBatchDelete) return;
    const target = pendingBatchDelete;
    setPendingBatchDelete(null);
    let deleted = 0;
    for (const id of target.ids) {
      await deleteCharacter(id);
      deleted++;
    }
    useToastStore.getState().showToast(`已批量删除 ${deleted} 个角色`, 'success');
    clearSelection();
  };

  const handleInsertVariant = (variantName: string, url: string) => {
    if (!richTextEditorCommandsRef.current) {
      onShowToast?.('没有可用的编辑器');
      return;
    }
    richTextEditorCommandsRef.current.insertImage(url, NGA_DEFAULT_IMAGE_SIZE);
    onShowToast?.(`已插入差分：${variantName}`);
  };

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-card)' }}>
      {/* 顶部工具条 */}
      <div
        className="shrink-0 flex items-center justify-between px-3 py-2 border-b"
        style={{ background: 'var(--bg-toolbar)', borderColor: 'var(--border-color)' }}
      >
        <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>人物角色</div>
        {selectedIds.length > 0 ? (
          <div className="flex items-center gap-1">
            <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>已选 {selectedIds.length}</span>
            <button
              onClick={() => {
                const names = filtered.filter((c) => selectedIds.includes(c.id)).map((c) => c.name || '未命名');
                setPendingBatchDelete({ ids: [...selectedIds], names });
              }}
              className="text-[10px] px-2 py-1 rounded transition-colors"
              style={{ background: 'var(--danger)', color: '#fff' }}
              title="删除所选"
            >
              🗑 批量删除
            </button>
            <button
              onClick={clearSelection}
              className="text-[10px] px-2 py-1 rounded transition-colors"
              style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => activeStoryId && createCharacter(activeStoryId)}
            disabled={!activeStoryId}
            className="text-[10px] px-2 py-1 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
          >
            + 新建角色
          </button>
        )}
      </div>

      {/* 角色卡片列表 */}
      <div
        className="shrink-0 p-2 border-b max-h-48 overflow-y-auto"
        style={{ borderColor: 'var(--border-color)' }}
      >
        {!activeStoryId && (
          <div className="text-[10px] italic px-2 py-3 text-center" style={{ color: 'var(--text-secondary)' }}>请先选择一个故事</div>
        )}
        {activeStoryId && filtered.length === 0 && (
          <div className="text-[10px] italic px-2 py-3 text-center" style={{ color: 'var(--text-secondary)' }}>
            暂无角色，点击上方"新建"
          </div>
        )}
        {activeStoryId && filtered.length > 0 && (
          <div className="space-y-1.5">
            {filtered.map((ch) => {
              const isActive = ch.id === editingCharacterId;
              const isSel = selectedIds.includes(ch.id);
              const variants = ch.variants || [];
              return (
                <div
                  key={ch.id}
                  className="rounded-lg transition-colors border relative overflow-hidden"
                  style={{
                    background: isSel ? 'var(--accent-bg)' : isActive ? 'var(--accent-bg)' : 'var(--bg-page)',
                    color: isSel || isActive ? 'var(--accent)' : 'var(--text-primary)',
                    borderColor: isSel || isActive ? 'var(--accent)' : 'var(--border-color)',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSel && !isActive) e.currentTarget.style.background = 'var(--bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSel && !isActive) e.currentTarget.style.background = 'var(--bg-page)';
                  }}
                >
                  {/* 选中态左侧色条 */}
                  {(isActive || isSel) && (
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: 3,
                        background: 'var(--accent)',
                      }}
                    />
                  )}
                  <div className="flex items-center gap-2 px-2.5 py-2">
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggleSelect(ch.id)}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onDragStart={(e) => e.preventDefault()}
                      style={{ cursor: 'pointer' }}
                      title="勾选以加入批量删除"
                    />
                    <button
                      onClick={() => setEditingCharacter(isActive ? null : ch.id)}
                      className="flex-1 flex items-center gap-2.5 text-left"
                    >
                      {ch.avatar ? (
                        <img
                          src={ch.avatar}
                          alt={ch.name}
                          className="w-9 h-9 rounded-full shrink-0 object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div
                          className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-sm"
                          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                        >
                          🧑
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate">{ch.name || '未命名'}</div>
                        <div className="text-[10px] truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                          {(ch.personality || '暂无角色描述').slice(0, 30)}
                        </div>
                      </div>
                      {variants.length > 0 && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                          style={{
                            background: 'var(--bg-tag, var(--bg-hover))',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          差分 {variants.length}
                        </span>
                      )}
                    </button>
                  </div>
                  {/* 差分缩略图条 */}
                  {variants.length > 0 && (
                    <div className="flex flex-wrap gap-1 px-2.5 pb-2">
                      {variants.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => handleInsertVariant(v.name, v.url)}
                          className="w-7 h-7 rounded border overflow-hidden shrink-0 transition relative"
                          style={{ borderColor: 'var(--border-color)' }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.outline = '2px solid var(--accent)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.outline = '';
                          }}
                          title={`点击插入差分：${v.name}`}
                        >
                          <img
                            src={v.url}
                            alt={v.name}
                            className="absolute inset-0 w-full h-full object-cover"
                            onError={(e) => {
                              const img = e.currentTarget as HTMLImageElement;
                              img.style.display = 'none';
                              const fallback = img.parentElement?.querySelector('.img-fallback') as HTMLElement | null;
                              if (fallback) fallback.style.display = 'flex';
                              console.warn('[VariantImage] 加载失败:', v.url);
                            }}
                          />
                          <div
                            className="img-fallback absolute inset-0 hidden items-center justify-center text-[10px] font-semibold"
                            style={{ color: 'var(--text-muted, #999)' }}
                          >
                            {(v.name || '?').charAt(0)}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 编辑区 */}
      <div className="flex-1 overflow-y-auto">
        {editing ? (
          <CharacterEditorInline character={editing} onShowToast={onShowToast} richTextEditorCommandsRef={richTextEditorCommandsRef} />
        ) : (
          <div className="p-6 text-center">
            <div className="text-3xl mb-3 opacity-40">🧑‍🎨</div>
            <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>选择或新建一个角色</div>
            <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>点击上方列表中的角色进行编辑</div>
          </div>
        )}
      </div>

      {pendingBatchDelete && (
        <ConfirmDialog
          open={true}
          title="批量删除角色"
          message={`确定删除以下 ${pendingBatchDelete.ids.length} 个角色？${pendingBatchDelete.names.length <= 5 ? `\n• ${pendingBatchDelete.names.join('\n• ')}` : ''}\n此操作不可撤销。`}
          danger
          onConfirm={handleBatchDelete}
          onCancel={() => setPendingBatchDelete(null)}
        />
      )}
    </div>
  );
}

/**
 * 「按差分」面板：作品所有人物的所有差分平铺/分组展示，点击插入到光标位置
 * - 顶部子导航：全部 / 按人物
 * - 「全部」：所有差分混合在 4 列网格
 * - 「按人物」：按人物分组，每个分区内是 4 列网格
 */
function ByVariantContent({
  richTextEditorCommandsRef,
  onShowToast,
}: {
  richTextEditorCommandsRef: React.MutableRefObject<RichTextEditorCommands | null>;
  onShowToast?: (msg: string) => void;
}) {
  const activeStoryId = useStoryStore((s) => s.activeStoryId);
  const characters = useMetaStore((s) => s.characters);
  const [subTab, setSubTab] = useState<'all' | 'grouped'>('all');

  const filteredChars = activeStoryId
    ? characters
        .filter((c) => c.story_id === activeStoryId)
        .slice()
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
    : [];

  // 拍平所有差分（带所属人物名）
  const allVariants = filteredChars.flatMap((ch) =>
    (ch.variants || []).map((v) => ({
      ...v,
      characterName: ch.name || '未命名',
      characterId: ch.id,
    })),
  );

  const handleInsert = (variantName: string, url: string, charName: string) => {
    if (!richTextEditorCommandsRef.current) {
      onShowToast?.('没有可用的编辑器');
      return;
    }
    richTextEditorCommandsRef.current.insertImage(url, NGA_DEFAULT_IMAGE_SIZE);
    onShowToast?.(`已插入差分：${charName} · ${variantName}`);
  };

  return (
    <div className="flex flex-col h-full">
      {/* 子导航：全部 / 按人物 */}
      <div
        className="shrink-0 flex items-center gap-1 px-3 py-2 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        {[
          { key: 'all', label: `全部（${allVariants.length}）` },
          { key: 'grouped', label: '按人物' },
        ].map((t) => {
          const active = subTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key as 'all' | 'grouped')}
              className="text-[10px] px-2.5 py-1 rounded-md transition-colors"
              style={{
                background: active ? 'var(--accent)' : 'var(--bg-toolbar)',
                color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                border: '1px solid',
                borderColor: active ? 'var(--accent)' : 'var(--border-color)',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 差分网格 */}
      <div className="flex-1 overflow-y-auto p-3">
        {!activeStoryId && (
          <div
            className="text-[10px] italic py-6 text-center"
            style={{ color: 'var(--text-secondary)' }}
          >
            请先选择一个故事
          </div>
        )}
        {activeStoryId && allVariants.length === 0 && (
          <div
            className="text-[10px] italic py-6 text-center"
            style={{ color: 'var(--text-secondary)' }}
          >
            暂无差分
          </div>
        )}

        {/* 全部子 tab：平铺网格 */}
        {activeStoryId && allVariants.length > 0 && subTab === 'all' && (
          <div className="grid grid-cols-4 gap-2">
            {allVariants.map((v) => (
              <VariantThumbnail
                key={v.id}
                variant={v}
                onClick={() => handleInsert(v.name, v.url, v.characterName)}
              />
            ))}
          </div>
        )}

        {/* 按人物子 tab：分组 */}
        {activeStoryId && allVariants.length > 0 && subTab === 'grouped' && (
          <div className="space-y-4">
            {filteredChars
              .filter((c) => (c.variants || []).length > 0)
              .map((ch) => (
                <div key={ch.id}>
                  <div
                    className="text-[11px] font-semibold mb-1.5 flex items-baseline gap-1.5"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    <span>{ch.name || '未命名'}</span>
                    <span
                      className="text-[10px] font-normal"
                      style={{ color: 'var(--text-muted, #999)' }}
                    >
                      {(ch.variants || []).length} 个差分
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {(ch.variants || []).map((v) => (
                      <VariantThumbnail
                        key={v.id}
                        variant={{ ...v, characterName: ch.name || '未命名' }}
                        onClick={() => handleInsert(v.name, v.url, ch.name || '未命名')}
                      />
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 差分缩略图：方形 + 下方差分名标签；hover 高亮 */
function VariantThumbnail({
  variant,
  onClick,
}: {
  variant: {
    id: string;
    name: string;
    url: string;
    characterName: string;
  };
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-md border overflow-hidden transition"
      style={{ borderColor: 'var(--border-color)', background: 'var(--bg-page)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent)';
        e.currentTarget.style.boxShadow = '0 0 0 2px var(--accent-soft, rgba(37,99,235,0.15))';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-color)';
        e.currentTarget.style.boxShadow = '';
      }}
      title={`点击插入：${variant.characterName} · ${variant.name}`}
    >
      <div className="aspect-square w-full relative overflow-hidden" style={{ background: 'var(--bg-toolbar)' }}>
        <img
          src={variant.url}
          alt={variant.name}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
          onError={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            img.style.display = 'none';
            const fallback = img.parentElement?.querySelector('.img-fallback') as HTMLElement | null;
            if (fallback) fallback.style.display = 'flex';
            console.warn('[VariantImage] 加载失败:', variant.url);
          }}
        />
        <div
          className="img-fallback absolute inset-0 hidden items-center justify-center text-base font-semibold"
          style={{ color: 'var(--text-muted, #999)' }}
        >
          {(variant.name || '?').charAt(0)}
        </div>
      </div>
      <div
        className="text-[9px] px-1 py-0.5 truncate"
        style={{ color: 'var(--text-secondary)' }}
      >
        {variant.name}
      </div>
    </button>
  );
}

// 简易内嵌版角色编辑器
function CharacterEditorInline({
  character,
  onShowToast,
  richTextEditorCommandsRef,
}: {
  character: {
    id: string;
    name: string;
    personality?: string;
    notes?: string;
    avatar?: string;
    variants?: { id: string; name: string; url: string; order_index: number }[];
    attributes?: Record<string, string | number>;
  };
  onShowToast?: (msg: string) => void;
  richTextEditorCommandsRef?: React.MutableRefObject<RichTextEditorCommands | null>;
}) {
  const updateCharacter = useMetaStore((s) => s.updateCharacter);
  const deleteCharacter = useMetaStore((s) => s.deleteCharacter);
  const setEditingCharacter = useMetaStore((s) => s.setEditingCharacter);
  const addVariant = useMetaStore((s) => s.addCharacterVariant);
  const updateVariant = useMetaStore((s) => s.updateCharacterVariant);
  const deleteVariant = useMetaStore((s) => s.deleteCharacterVariant);
  const reorderVariants = useMetaStore((s) => s.reorderCharacterVariants);

  // 属性相关状态
  const [attributes, setAttributes] = useState<Record<string, string | number>>(character.attributes || {});
  // 编辑中的属性值：key=属性名, value=正在输入的值；blur 后清空
  // 修复：原先在 .map() 回调里调 useState 违反 Rules of Hooks，会触发 React error #310
  const [editingAttrs, setEditingAttrs] = useState<Record<string, string>>({});

  const updateAttributes = (next: Record<string, string | number>) => {
    setAttributes(next);
    updateCharacter(character.id, { attributes: next });
  };

  const [name, setName] = useState(character.name || '');
  const [personality, setPersonality] = useState(character.personality || '');
  const [notes, setNotes] = useState(character.notes || '');
  const [avatar, setAvatar] = useState(character.avatar || '');
  const avatarFileRef = useRef<HTMLInputElement | null>(null);
  const variantFileRef = useRef<HTMLInputElement | null>(null);

  const [newVariantName, setNewVariantName] = useState('');
  const [newVariantUrl, setNewVariantUrl] = useState('');
  const [pendingDelete, setPendingDelete] = useState(false);
  const [pendingDeleteVariant, setPendingDeleteVariant] = useState<{ id: string; name: string } | null>(null);
  const [pendingNewAttr, setPendingNewAttr] = useState(false);
  const [newAttrName, setNewAttrName] = useState('');

  // 订阅本地上传总开关：关闭时把上传按钮置灰
  const imageStoreMode = useSettingStore((s) => s.imageStoreMode);
  const localUploadEnabled = useSettingStore((s) => s.localUploadEnabled);
  const localUploadDisabledReason = '本地上传未启用，请到设置 → 图片存储模式 → 启用本地上传';
  const isLocalUploadDisabled = !localUploadEnabled;

  // 上传进度弹窗状态
  const [uploadTasks, setUploadTasks] = useState<UploadProgressEvent[]>([]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

  useEffect(() => {
    setName(character.name || '');
    setPersonality(character.personality || '');
    setNotes(character.notes || '');
    setAvatar(character.avatar || '');
    setAttributes(character.attributes || {});
    setEditingAttrs({});  // 切换人物时清空编辑状态
  }, [character.id]);

  const handleSave = () => {
    updateCharacter(character.id, { name, personality, notes, avatar });
  };

  const handleDelete = () => {
    setPendingDelete(true);
  };

  const handleAvatarFile = async (file: File) => {
    // 检查本地上传总开关（默认关闭）
    if (!useSettingStore.getState().localUploadEnabled) {
      useToastStore
        .getState()
        .showToast('本地上传未启用，请到设置 → 图片存储模式 → 启用本地上传', 'error');
      return;
    }
    // 本地模式：先弹警告（统一由全局 store 管理）
    const confirmed = await ensureLocalWarning();
    if (!confirmed) return;
    setUploadTasks([
      {
        taskId: `${Date.now()}_0`,
        fileName: file.name || 'avatar',
        status: 'pending',
        progress: 0,
      },
    ]);
    setUploadDialogOpen(true);
    const [res] = await uploadImagesWithProgress([file], (e) => {
      setUploadTasks((prev) =>
        prev.map((t) => (t.taskId === e.taskId ? { ...t, ...e } : t)),
      );
    });
    if (res.ok && res.url) {
      setAvatar(res.url);
      updateCharacter(character.id, { avatar: res.url });
      useToastStore.getState().showToast('头像已更新', 'success');
    } else {
      useToastStore
        .getState()
        .showToast(`图片上传失败：${res.error || '未知错误'}，请检查网络后重新选择`, 'error');
    }
  };

  const handleVariantFile = async (file: File) => {
    // 检查本地上传总开关（默认关闭）
    if (!useSettingStore.getState().localUploadEnabled) {
      useToastStore
        .getState()
        .showToast('本地上传未启用，请到设置 → 图片存储模式 → 启用本地上传', 'error');
      return;
    }
    // 本地模式：先弹警告
    const confirmed = await ensureLocalWarning();
    if (!confirmed) return;
    setUploadTasks([
      {
        taskId: `${Date.now()}_0`,
        fileName: file.name || 'variant',
        status: 'pending',
        progress: 0,
      },
    ]);
    setUploadDialogOpen(true);
    const [res] = await uploadImagesWithProgress([file], (e) => {
      setUploadTasks((prev) =>
        prev.map((t) => (t.taskId === e.taskId ? { ...t, ...e } : t)),
      );
    });
    if (res.ok && res.url) {
      setNewVariantUrl(res.url);
      // 默认差分名 = 图片文件名（去后缀）
      const defaultName = file.name.replace(/\.[^.]+$/, '');
      if (defaultName) setNewVariantName(defaultName);
      useToastStore.getState().showToast('差分图片就绪', 'success');
    } else {
      useToastStore
        .getState()
        .showToast(`图片上传失败：${res.error || '未知错误'}，请检查网络后重新选择`, 'error');
    }
  };

  const handleAddVariant = () => {
    const url = newVariantUrl.trim();
    if (!url) return;
    const vname = newVariantName.trim() || `差分 ${(character.variants || []).length + 1}`;
    addVariant(character.id, { name: vname, url });
    setNewVariantName('');
    setNewVariantUrl('');
  };

  const moveVariant = (id: string, dir: -1 | 1) => {
    const list = [...(character.variants || [])];
    const i = list.findIndex((v) => v.id === id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    reorderVariants(character.id, list.map((v) => v.id));
  };

  const inputStyle = { 
    background: 'var(--bg-input)', 
    borderColor: 'var(--border-color)', 
    color: 'var(--text-primary)' 
  } as React.CSSProperties;
  const labelColor = 'var(--text-secondary)';

  return (
    <div className="p-3 space-y-3" style={{ background: 'var(--bg-card)' }}>
      {/* 头像 */}
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 w-16 h-16 rounded-lg flex items-center justify-center text-2xl cursor-pointer overflow-hidden border"
          style={{
            background: 'var(--bg-page)',
            borderColor: 'var(--border-color)',
            opacity: isLocalUploadDisabled ? 0.45 : 1,
            cursor: isLocalUploadDisabled ? 'not-allowed' : 'pointer',
          }}
          onClick={() => {
            if (isLocalUploadDisabled) {
              useToastStore.getState().showToast(localUploadDisabledReason, 'error');
              return;
            }
            avatarFileRef.current?.click();
          }}
          title={isLocalUploadDisabled ? localUploadDisabledReason : '点击更换头像'}
        >
          {avatar ? (
            <img 
              src={avatar} 
              alt={name} 
              className="w-full h-full object-cover" 
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <span style={{ color: 'var(--text-secondary)' }}>🧑</span>
          )}
        </div>
        <input
          ref={avatarFileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleAvatarFile(file);
            e.target.value = '';
          }}
        />
        <div className="flex-1 space-y-2">
          <div>
            <label className="block text-[10px] font-medium mb-1" style={{ color: labelColor }}>姓名</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleSave}
              className="w-full px-2 py-1.5 text-xs rounded-md border outline-none"
              style={{ ...inputStyle, outline: 'none' }}
              placeholder="角色姓名"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium mb-1" style={{ color: labelColor }}>性格/特征</label>
            <input
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              onBlur={handleSave}
              className="w-full px-2 py-1.5 text-xs rounded-md border outline-none"
              style={inputStyle}
              placeholder="例如：开朗、冷静、勇敢"
            />
          </div>
        </div>
      </div>

      {/* 描述 */}
      <div>
        <label className="block text-[10px] font-medium mb-1" style={{ color: labelColor }}>备注/详情</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={handleSave}
          rows={4}
          className="w-full px-2 py-2 text-xs rounded-md border outline-none resize-y leading-relaxed"
          style={inputStyle}
          placeholder="背景、外貌、技能等详细描述..."
        />
      </div>

      {/* 属性展示（可编辑） */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-[10px] font-medium" style={{ color: labelColor }}>角色属性</label>
          <div className="flex items-center gap-2">
            <span className="text-[10px]" style={{ color: labelColor }}>
              {Object.keys(attributes || {}).length} 项
            </span>
            <button
              onClick={() => setPendingNewAttr(true)}
              className="text-[10px] px-2 py-0.5 rounded transition-colors font-medium inline-flex items-center gap-0.5"
              style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
              title="添加新属性"
            >
              + 添加属性
            </button>
          </div>
        </div>
        {Object.keys(attributes || {}).length === 0 ? (
          <div className="text-[10px] italic text-center py-2" style={{ color: labelColor }}>暂无属性，点击上方添加</div>
        ) : (
          <div className="space-y-1">
            {Object.entries(attributes || {}).map(([key, value]) => {
              const editingVal = editingAttrs[key] ?? String(value);
              return (
                <div
                  key={key}
                  className="flex items-center gap-2 px-2 py-1 rounded border"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <span className="text-[10px] font-medium w-16 shrink-0 truncate" style={{ color: 'var(--text-primary)' }}>
                    {key}
                  </span>
                  <input
                    value={editingVal}
                    onChange={(e) => setEditingAttrs((prev) => ({ ...prev, [key]: e.target.value }))}
                    onBlur={() => {
                      updateAttributes({ ...attributes, [key]: editingVal });
                      setEditingAttrs((prev) => {
                        const next = { ...prev };
                        delete next[key];
                        return next;
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        updateAttributes({ ...attributes, [key]: editingVal });
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    className="flex-1 text-[10px] px-1.5 py-0.5 rounded border outline-none"
                    style={{
                      background: 'var(--bg-input)',
                      borderColor: 'var(--border-color)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  <button
                    onClick={() => {
                      const next = { ...attributes };
                      delete next[key];
                      updateAttributes(next);
                    }}
                    className="text-[10px] px-1 transition-colors"
                    style={{ color: 'var(--danger)' }}
                    title="删除此属性"
                  >x</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 差分管理 */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-[10px] font-medium" style={{ color: labelColor }}>
            人物差分（表情/姿势/服饰等图片变体）
          </label>
          <span className="text-[10px]" style={{ color: labelColor }}>
            {(character.variants || []).length} 个
          </span>
        </div>

        {(character.variants || []).length === 0 && (
          <div className="text-[10px] italic text-center py-1 mb-1" style={{ color: labelColor }}>
            暂无差分
          </div>
        )}

        <div className="space-y-1 mb-2">
          {(character.variants || []).map((v, idx) => (
            <div
              key={v.id}
              className="flex items-center gap-1.5 px-1.5 py-1 rounded border"
              style={{ borderColor: 'var(--border-color)' }}
            >
              <div
                className="w-8 h-8 rounded shrink-0 relative overflow-hidden"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)' }}
              >
                <img
                  src={v.url}
                  alt={v.name}
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={(e) => {
                    const img = e.currentTarget as HTMLImageElement;
                    img.style.display = 'none';
                    const fallback = img.parentElement?.querySelector('.img-fallback') as HTMLElement | null;
                    if (fallback) fallback.style.display = 'flex';
                    console.warn('[VariantImage] 加载失败:', v.url);
                  }}
                />
                <div
                  className="img-fallback absolute inset-0 hidden items-center justify-center text-[10px] font-semibold"
                  style={{ color: 'var(--text-muted, #999)' }}
                >
                  {(v.name || '?').charAt(0)}
                </div>
              </div>
              <input
                value={v.name}
                onChange={(e) => updateVariant(v.id, { name: e.target.value })}
                placeholder="差分名称"
                className="flex-1 min-w-0 px-1.5 py-1 text-[10px] rounded border outline-none"
                style={inputStyle}
              />
              <input
                value={v.url}
                onChange={(e) => updateVariant(v.id, { url: e.target.value })}
                placeholder="图片 URL"
                className="flex-1 min-w-0 px-1.5 py-1 text-[10px] rounded border outline-none"
                style={inputStyle}
              />
              <button
                onClick={() => moveVariant(v.id, -1)}
                disabled={idx === 0}
                className="text-[10px] px-1 py-0.5 rounded border disabled:opacity-30"
                style={{ 
                  background: 'var(--bg-base)', 
                  color: 'var(--text-secondary)', 
                  borderColor: 'var(--border-color)' 
                }}
                title="上移"
              >
                ↑
              </button>
              <button
                onClick={() => moveVariant(v.id, 1)}
                disabled={idx === (character.variants || []).length - 1}
                className="text-[10px] px-1 py-0.5 rounded border disabled:opacity-30"
                style={{ 
                  background: 'var(--bg-base)', 
                  color: 'var(--text-secondary)', 
                  borderColor: 'var(--border-color)' 
                }}
                title="下移"
              >
                ↓
              </button>
              <button
                onClick={() => {
                  if (richTextEditorCommandsRef?.current) {
                    richTextEditorCommandsRef.current.insertImage(v.url, NGA_DEFAULT_IMAGE_SIZE);
                    onShowToast?.(`已插入差分：${v.name}`);
                  }
                }}
                disabled={!richTextEditorCommandsRef?.current}
                className="text-[10px] px-1 py-0.5 rounded border transition-colors disabled:opacity-30"
                style={{ background: 'var(--accent-bg)', color: 'var(--accent)', borderColor: 'var(--accent)' }}
                title="插入到编辑器"
              >
                插入
              </button>
              <button
                onClick={() => {
                  setPendingDeleteVariant({ id: v.id, name: v.name });
                }}
                className="text-[10px] px-1 py-0.5 rounded"
                style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
                title="删除"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <input
            value={newVariantName}
            onChange={(e) => setNewVariantName(e.target.value)}
            placeholder="差分名称（可空）"
            className="w-28 px-1.5 py-1 text-[10px] rounded border outline-none"
            style={inputStyle}
          />
          <input
            value={newVariantUrl}
            onChange={(e) => setNewVariantUrl(e.target.value)}
            placeholder="图片 URL 或上传"
            className="flex-1 min-w-0 px-1.5 py-1 text-[10px] rounded border outline-none"
            style={inputStyle}
          />
          <button
            onClick={() => {
              if (isLocalUploadDisabled) {
                useToastStore.getState().showToast(localUploadDisabledReason, 'error');
                return;
              }
              variantFileRef.current?.click();
            }}
            disabled={isLocalUploadDisabled}
            className="text-[10px] px-1.5 py-1 rounded border"
            style={{
              background: 'var(--bg-sidebar)',
              color: 'var(--text-primary)',
              borderColor: 'var(--border-color)',
              opacity: isLocalUploadDisabled ? 0.45 : 1,
              cursor: isLocalUploadDisabled ? 'not-allowed' : 'pointer',
            }}
            title={isLocalUploadDisabled ? localUploadDisabledReason : '上传'}
          >
            📁
          </button>
          <input
            ref={variantFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleVariantFile(file);
              e.target.value = '';
            }}
          />
          <button
            onClick={handleAddVariant}
            disabled={!newVariantUrl.trim()}
            className="text-[10px] px-2 py-1 rounded disabled:opacity-40"
            style={{ background: 'var(--success)', color: 'var(--text-on-accent)' }}
          >
            + 添加
          </button>
        </div>
      </div>

      {/* 操作 */}
      <div className="flex items-center justify-between pt-1">
        <button
          onClick={handleDelete}
          className="px-2 py-1 text-[10px] rounded-md transition-colors"
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
          🗑 删除角色
        </button>
        <button
          onClick={handleSave}
          className="px-2 py-1 text-[10px] rounded-md transition-colors"
          style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--accent)';
            e.currentTarget.style.color = 'var(--text-on-accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--accent-bg)';
            e.currentTarget.style.color = 'var(--accent)';
          }}
        >
          ✓ 保存
        </button>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          open={true}
          title="删除确认"
          message={`确定删除角色"${name || '未命名'}"？此操作不可撤销。`}
          danger
          onConfirm={() => {
            deleteCharacter(character.id);
            setEditingCharacter(null);
            useToastStore.getState().showToast('已删除', 'success');
            setPendingDelete(false);
          }}
          onCancel={() => setPendingDelete(false)}
        />
      )}

      {pendingDeleteVariant && (
        <ConfirmDialog
          open={true}
          title="删除确认"
          message={`确定删除差分"${pendingDeleteVariant.name}"？`}
          danger
          onConfirm={() => {
            deleteVariant(pendingDeleteVariant.id);
            setPendingDeleteVariant(null);
          }}
          onCancel={() => setPendingDeleteVariant(null)}
        />
      )}

      {pendingNewAttr && (
        <InputDialog
          open={true}
          title="添加属性"
          placeholder="属性名（如：HP、力量、职业…）"
          defaultValue={newAttrName}
          confirmText="添加"
          onConfirm={(value: string) => {
            const k = value.trim();
            if (!k) {
              setPendingNewAttr(false);
              return;
            }
            if (attributes[k] !== undefined) {
              onShowToast?.(`属性"${k}"已存在`);
              return;
            }
            updateAttributes({ ...attributes, [k]: '' });
            setNewAttrName('');
            setPendingNewAttr(false);
          }}
          onCancel={() => {
            setNewAttrName('');
            setPendingNewAttr(false);
          }}
        />
      )}

      {/* 上传进度弹窗 */}
      <UploadProgressDialog
        open={uploadDialogOpen}
        tasks={uploadTasks}
        onClose={() => setUploadDialogOpen(false)}
      />
    </div>
  );
}

interface BottomStatusBarProps {
  editorMode: 'visual' | 'bbcode';
  onSwitchMode: (mode: 'visual' | 'bbcode') => void;
}

// ========== 节编辑区上方面包屑（卷·章·节路径） ==========
function EditorBreadcrumb({
  volumeIdx,
  volumeTitle,
  chapterIdx,
  chapterTitle,
  sectionTitle,
}: {
  volumeIdx: number;
  volumeTitle: string;
  chapterIdx: number;
  chapterTitle: string;
  sectionTitle: string;
}) {
  return (
    <div
      className="shrink-0 flex items-center gap-1.5 px-4 py-1.5 text-[11px] flex-wrap"
      style={{
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border-color)',
        color: 'var(--text-secondary)',
      }}
    >
      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
        {volumeTitle || '未命名卷'}
      </span>
      <span style={{ color: 'var(--border-color)' }}>›</span>
      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
        {chapterTitle || '未命名章'}
      </span>
      <span style={{ color: 'var(--border-color)' }}>›</span>
      <span className="font-semibold" style={{ color: 'var(--accent)' }}>
        {sectionTitle || '未命名节'}
      </span>
    </div>
  );
}

function BottomStatusBar({
  editorMode,
  onSwitchMode,
}: BottomStatusBarProps) {
  const selectionStats = useEditorStore((s) => s.selectionStats);
  const tabStyle = (active: boolean): CSSProperties => ({
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 500,
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'all 0.15s',
    background: active ? 'var(--accent)' : 'var(--bg-hover)',
    color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
  });

  return (
    <footer
      className="shrink-0 flex items-center justify-between px-4 py-2 text-xs"
      style={{ background: 'var(--bg-card)', borderTop: '1px solid var(--border-color)' }}
    >
      {/* 左侧：视图切换 */}
      <div
        className="flex items-center gap-1 p-0.5 rounded-lg"
        style={{ background: 'var(--bg-hover)' }}
      >
        <button
          onClick={() => onSwitchMode('visual')}
          style={tabStyle(editorMode === 'visual')}
          onMouseEnter={(e) => {
            if (editorMode !== 'visual') {
              e.currentTarget.style.color = 'var(--text-primary)';
            }
          }}
          onMouseLeave={(e) => {
            if (editorMode !== 'visual') {
              e.currentTarget.style.color = 'var(--text-secondary)';
            }
          }}
        >
          🎨 可视化编辑
        </button>
        <button
          onClick={() => onSwitchMode('bbcode')}
          style={tabStyle(editorMode === 'bbcode')}
          onMouseEnter={(e) => {
            if (editorMode !== 'bbcode') {
              e.currentTarget.style.color = 'var(--text-primary)';
            }
          }}
          onMouseLeave={(e) => {
            if (editorMode !== 'bbcode') {
              e.currentTarget.style.color = 'var(--text-secondary)';
            }
          }}
        >
          📝 BBcode编辑
        </button>
      </div>

      {/* 右侧：当前视图模式提示 + 快捷提示 */}
      <div className="flex items-center gap-3" style={{ color: 'var(--text-secondary)' }}>
        {selectionStats && (
          <span style={{ color: 'var(--accent)' }}>
            选中：{selectionStats.words} 字{selectionStats.dice > 0 ? ` · ${selectionStats.dice} 原子块` : ''}
          </span>
        )}
        <span className="hidden md:inline">
          {editorMode === 'visual'
            ? '💡 可直接使用工具栏富文本编辑'
            : '💡 可直接 Ctrl+V 粘贴 BBCode；编辑后切回可视化查看效果'}
        </span>
      </div>
    </footer>
  );
}

// ========== BBCode 视图编辑器：受控 textarea + 300ms 防抖回写 ==========
function BBCodeEditor({
  value,
  onChange,
  onDebouncedChange,
  onUndo,
  onRedo,
  textareaRef: externalTextareaRef,
  onSearchOpen,
}: {
  value: string;
  onChange: (v: string) => void;
  onDebouncedChange: (v: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  onSearchOpen?: () => void;
}) {
  const localRef = useRef<number | null>(null);
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalTextareaRef ?? internalTextareaRef;
  // 自定义右键菜单（与可视化视图一致：复制/粘贴/在当前节搜索）
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    hasSelection: boolean;
  } | null>(null);

  useEffect(() => {
    if (localRef.current !== null) {
      window.clearTimeout(localRef.current);
    }
    localRef.current = window.setTimeout(() => {
      onDebouncedChange(value);
    }, 300);
    return () => {
      if (localRef.current !== null) {
        window.clearTimeout(localRef.current);
      }
    };
  }, [value, onDebouncedChange]);

  // 拦截 Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z，走自定义历史栈
  // 不拦截 Ctrl+V / Ctrl+X / Ctrl+A（保留粘贴/剪切/全选等默认行为）
  // Ctrl+F 打开节内搜索
  // Tab 键：插入 4 个空格（NGA BBCode 不识别 \t）
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab 键：插入 4 个普通空格，避免焦点切换
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const insert = '    ';
      const newValue = value.slice(0, start) + insert + value.slice(end);
      onChange(newValue);
      // 恢复光标位置（在 React 更新后）
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + insert.length;
        }
      });
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;
    const key = e.key.toLowerCase();
    if (key === 'f') {
      e.preventDefault();
      onSearchOpen?.();
      return;
    }
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      onUndo();
      return;
    }
    if (key === 'y' || (key === 'z' && e.shiftKey)) {
      e.preventDefault();
      onRedo();
      return;
    }
  };

  return (
    <div
      className="flex-1 min-h-0 overflow-hidden p-3"
      style={{ background: 'var(--bg-input)' }}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onContextMenu={(e) => {
          e.preventDefault();
          const ta = textareaRef.current;
          const hasSelection = !!(ta && ta.selectionStart !== ta.selectionEnd);
          setCtxMenu({ x: e.clientX, y: e.clientY, hasSelection });
        }}
        spellCheck={false}
        placeholder="在此直接编辑 BBCode 文本（或 Ctrl+V 粘贴 NGA 帖子的 BBCode）…"
        className="w-full h-full p-3 rounded-lg outline-none resize-none font-mono text-sm leading-relaxed"
        style={{
          background: 'var(--bg-card)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-color)',
        }}
      />
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            {
              label: '复制',
              disabled: !ctxMenu.hasSelection,
              onClick: () => {
                const ta = textareaRef.current;
                if (!ta) return;
                const text = ta.value.substring(ta.selectionStart, ta.selectionEnd);
                if (!text) return;
                navigator.clipboard
                  .writeText(text)
                  .then(() => {
                    useToastStore.getState().showToast('已复制', 'success');
                  })
                  .catch(() => {
                    ta.focus();
                    document.execCommand('copy');
                  });
                setCtxMenu(null);
              },
            },
            {
              label: '粘贴',
              onClick: async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  if (!text) {
                    setCtxMenu(null);
                    return;
                  }
                  const ta = textareaRef.current;
                  if (!ta) return;
                  ta.focus();
                  const start = ta.selectionStart;
                  const end = ta.selectionEnd;
                  const newVal = ta.value.substring(0, start) + text + ta.value.substring(end);
                  onChange(newVal);
                  // 粘贴后光标移到插入内容末尾（下一帧执行，确保 value 已更新）
                  requestAnimationFrame(() => {
                    if (textareaRef.current) {
                      textareaRef.current.selectionStart = textareaRef.current.selectionEnd =
                        start + text.length;
                    }
                  });
                } catch (err) {
                  useToastStore
                    .getState()
                    .showToast('粘贴失败：' + (err as Error).message, 'error');
                }
                setCtxMenu(null);
              },
            },
            {
              label: '在当前节中搜索',
              onClick: () => {
                setCtxMenu(null);
                onSearchOpen?.();
              },
            },
          ]}
        />
      )}
    </div>
  );
}
