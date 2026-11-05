import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useStoryStore } from '../../store/storyStore';
import { useEditorStore } from '../../store/editorStore';
import { flushDebouncedSave } from '../../store/editorStore';
import { useEditorHistoryStore } from '../../store/editorHistoryStore';
import { useDiceStore } from '../../store/diceStore';
import {
  useDiceHistoryStore,
  buildDiceHistoryRecord,
} from '../../store/diceHistoryStore';
import type { Section, DiceBlockPayloadV2 } from '../../types';
import { NGA_DEFAULT_IMAGE_SIZE } from '../../types';
import * as db from '../../db/index';
import { useSectionEditor } from '../../hooks/useSectionEditor';
import { useStructureSync } from '../../hooks/useStructureSync';
import { DirectoryTree } from '../common/DirectoryTree';
import { Icon, type IconName } from '../common/Icon';
import { DiceConfigDialog } from '../dice/DiceConfigDialog';
import { WorldSettingPanel } from '../common/WorldSettingPanel';
import { CharacterPanel } from '../character/CharacterEditor';
import { type RichTextEditorCommands } from '../../editor/tiptap/TiptapEditorPane';
import { VisualEditorPane } from '../editor/VisualEditorPane';
import { WordCount, computeSectionWordCount } from '../editor/WordCount';
import { isDiceCardInEditor } from '../../editor/tiptap/diceLookup';
import { createDiceId } from '../../utils/diceEngine';
import { OutlineTree } from '../outline/OutlineTree';
import { OutlineEditor } from '../outline/OutlineEditor';
import { SyncDialog } from '../common/SyncDialog';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useToastStore } from '../../store/toastStore';
import { useSettingStore } from '../../store/settingStore';
import { UploadProgressDialog } from '../common/UploadProgressDialog';
import { LocalModeBanner } from '../common/LocalModeBanner';
import { validateBBCode, type BBCodeError } from '../../utils/bbcodeValidator';
import { bbcodeToHtml } from '../../utils/ngaBBCodeToHtml';
import { htmlToNGABBCode } from '../../utils/ngaHtmlToBBCode';
import { exportSectionAsImages } from '../../utils/sectionImageExport';
import { isCapacitor, isElectron } from '../../utils/platform';
import { BBCodeEditor } from '../editor/BBCodeEditor';
import { RightPanel } from '../editor/EditorRightPanel';
import { EditorBreadcrumb, BottomStatusBar } from '../editor/EditorStatusBar';

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
      className="w-[4px] cursor-col-resize bg-[var(--border-color)] shrink-0 hover:opacity-100 transition-opacity opacity-40"
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
  } = useStoryStore();

  // 用 selector 订阅，避免每次 store 更新都触发整个 EditorPage 重渲染。
  // sectionContent / canUndo / canRedo 已下沉到 VisualEditorPane（编辑器独立订阅）。
  const sectionLoading = useEditorStore((s) => s.sectionLoading);
  const setSectionContent = useEditorStore((s) => s.setSectionContent);
  // BBCode 视图初始化需要：当前节是否已加载完成 + 与 content 同步的 BBCode 缓存
  const storeSectionId = useEditorStore((s) => s.sectionId);
  const storeSectionBbcode = useEditorStore((s) => s.sectionBbcode);

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

  const [bbcodeDraft, setBbcodeDraft] = useState('');
  // BBCode 草稿的同步引用：切节/切视图时需要拿到最新值（state 更新可能滞后于事件）
  const bbcodeDraftRef = useRef('');
  // 只有用户真正改过草稿才回写正文，避免"仅打开 BBCode 视图"就发生有损回转
  const bbcodeDirtyRef = useRef(false);
  const setBbcodeDraftValue = useCallback((value: string) => {
    bbcodeDraftRef.current = value;
    setBbcodeDraft(value);
  }, []);
  const handleBbcodeChange = useCallback(
    (value: string) => {
      bbcodeDirtyRef.current = true;
      setBbcodeDraftValue(value);
    },
    [setBbcodeDraftValue],
  );
  // 把 BBCode 草稿写回正文（content 是唯一事实来源，BBCode 由 content 派生）
  // 返回是否真的写入（目标节已不是当前编辑节时拒绝写入，避免串节）
  const commitBbcodeDraftToContent = useCallback((sectionId: string, bb: string): boolean => {
    if (useEditorStore.getState().sectionId !== sectionId) return false;
    try {
      useEditorStore.getState().setSectionContent(bbcodeToHtml(bb ?? ''), bb);
      return true;
    } catch (e) {
      useToastStore
        .getState()
        .showToast(`BBCode 解析失败，正文未更新：${(e as Error).message}`, 'error');
      return false;
    }
  }, []);

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
        setSectionContent(restored.html);
      } else {
        setBbcodeDraftValue(restored.html);
        bbcodeDirtyRef.current = false;
        if (activeSectionId && bbcodeDraftSectionIdRef.current === activeSectionId) {
          commitBbcodeDraftToContent(activeSectionId, restored.html);
        }
      }
    },
    [editorMode, activeSectionId, setSectionContent, setBbcodeDraftValue, commitBbcodeDraftToContent],
  );
  // BBCode 语法校验错误（实时显示在编辑器下方，非阻塞）
  // v35: 改为 BBCodeError[] (含行号)，支持点击跳转
  const [bbcodeErrors, setBbcodeErrors] = useState<BBCodeError[]>([]);
  // v35: 错误面板展开/折叠状态
  const [bbcodeErrorsExpanded, setBbcodeErrorsExpanded] = useState(false);

  // v35: 点击错误行跳转到 BBCode textarea 对应行
  const jumpToBbcodeLine = useCallback((line: number) => {
    const ta = bbcodeTextareaRef.current;
    if (!ta) return;
    const text = ta.value;
    // 计算目标行的字符偏移
    let offset = 0;
    let curLine = 1;
    for (let i = 0; i < text.length && curLine < line; i++) {
      if (text[i] === '\n') curLine++;
      offset = i + 1;
    }
    // 选中目标行内容
    let endOffset = offset;
    while (endOffset < text.length && text[endOffset] !== '\n') endOffset++;
    ta.focus();
    ta.setSelectionRange(offset, endOffset);
    // 滚动到目标行（估算行高，与 textarea leading-relaxed 大致匹配）
    const lineHeight = 20;
    ta.scrollTop = Math.max(0, (line - 1) * lineHeight - ta.clientHeight / 3);
  }, []);
  // v35: 实时语法校验（非阻塞），内容相同时保持原数组引用，避免无意义重渲染
  const updateBbcodeErrors = useCallback((bb: string) => {
    const result = validateBBCode(bb);
    setBbcodeErrors((prev) => {
      if (
        prev.length === result.errors.length &&
        prev.every((e, i) => e.message === result.errors[i].message && e.line === result.errors[i].line)
      ) {
        return prev;
      }
      return result.errors;
    });
  }, []);
  // BBCode 防抖回调：仅当用户真实编辑过草稿才写回正文，避免"只查看"触发有损回转
  const handleBbcodeDebouncedChange = useCallback(
    (bb: string) => {
      updateBbcodeErrors(bb);
      if (!bbcodeDirtyRef.current) return;
      bbcodeDirtyRef.current = false;
      if (activeSectionId && bbcodeDraftSectionIdRef.current === activeSectionId) {
        commitBbcodeDraftToContent(activeSectionId, bb);
      }
    },
    [activeSectionId, commitBbcodeDraftToContent, updateBbcodeErrors],
  );
  // BBCode 草稿归属的节 id：切节时据此判断草稿是否属于上一节
  const bbcodeDraftSectionIdRef = useRef<string | null>(null);

  // 切节前把上一节的 BBCode 草稿写回 content。
  // 该 effect 必须注册在 useSectionEditor 之前，保证先于 loadSection 执行。
  const prevActiveSectionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevActiveSectionIdRef.current;
    prevActiveSectionIdRef.current = activeSectionId;
    if (!prev || prev === activeSectionId) return;
    if (editorMode !== 'bbcode') return;
    if (bbcodeDraftSectionIdRef.current !== prev) return;
    // 只回写真正编辑过的草稿；仅浏览过则直接放弃草稿，避免有损回转
    if (bbcodeDirtyRef.current && !commitBbcodeDraftToContent(prev, bbcodeDraftRef.current)) return;
    // 已落盘：先清空草稿，等新节正文加载完成后回填，避免显示上一节内容
    setBbcodeDraftValue('');
    bbcodeDirtyRef.current = false;
    bbcodeDraftSectionIdRef.current = null;
  }, [activeSectionId, editorMode, commitBbcodeDraftToContent, setBbcodeDraftValue]);

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
  // 目录 ↔ 大纲同步（状态与差异应用见 hooks/useStructureSync）
  const structureSync = useStructureSync();

  // 节切换自动保存 / 加载逻辑（使用 useSectionEditor hook）
  useSectionEditor(activeSectionId);

  const story = stories.find((s) => s.id === activeStoryId);
  const section = sections.find((s) => s.id === activeSectionId);

  // ===== 稳定回调（useCallback）=====
  // 传给 VisualEditorPane / RightPanel 的回调必须保持引用稳定，
  // 否则会破坏 React.memo 自定义比较器，导致打字时整页重渲染。
  const handleRenameSection = useCallback(
    (newTitle: string) => {
      if (section) renameSection(section.id, newTitle);
    },
    [section, renameSection],
  );

  const handleCollapseRightPanel = useCallback(() => {
    setRightSidebarCollapsed(true);
  }, []);

  const handleOpenSearchPanel = useCallback(() => {
    // 搜索面板在属性 tab 内常驻显示：保证切到属性 tab
    setRightPanelTab('properties');
  }, []);

  const handleJumpToDice = useCallback(
    (sectionId: string, payloadSnapshot: string) => {
      if (sectionId !== activeSectionId) {
        useStoryStore.getState().setActiveSection(sectionId);
      }
      // 等下一个 tick，编辑器内容被重新渲染后再滚动
      window.setTimeout(() => {
        richTextEditorCommandsRef.current?.scrollToDiceCard(payloadSnapshot);
      }, 80);
    },
    [activeSectionId],
  );

  const handleRestoreDice = useCallback(
    (sectionId: string, payloadSnapshot: string) => {
      // 跳到目标节
      if (sectionId !== activeSectionId) {
        useStoryStore.getState().setActiveSection(sectionId);
      }
      window.setTimeout(() => {
        try {
          const payload = JSON.parse(payloadSnapshot);
          // 给恢复的骰子换新 id（顶层 + config.id），与原骰子完全独立
          // 注意：isDiceCardInEditor 比对的是 config.id，必须更新此字段
          payload.config = { ...payload.config, id: createDiceId() };
          payload.id = `dice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          // 标记为"已恢复"结果
          payload.restored = true;
          richTextEditorCommandsRef.current?.insertDice(payload);
          setToast('已恢复骰子到编辑区');
        } catch (e) {
          setToast('恢复失败：骰子数据格式错误');
        }
      }, 80);
    },
    [activeSectionId],
  );

  const handleInsertUnrolledDice = useCallback((_: string, payloadSnapshot: string) => {
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
  }, []);

  const handleCheckDiceExists = useCallback(
    (sectionId: string, payloadSnapshot: string) => {
      if (sectionId !== activeSectionId) return false;
      const el = visualEditorRef.current;
      if (!el) return false;
      return isDiceCardInEditor(el, payloadSnapshot);
    },
    [activeSectionId],
  );

  const handleSetImageSize = useCallback((size: string) => {
    richTextEditorCommandsRef.current?.setSelectedImageSize(size);
  }, []);

  // BBCode 视图初始化：等当前节正文加载完成后，用同一份正文（或已同步的 BBCode 缓存）填充草稿
  useEffect(() => {
    if (editorMode !== 'bbcode') return;
    if (!activeSectionId || storeSectionId !== activeSectionId) return;
    if (bbcodeDraftSectionIdRef.current === activeSectionId) return;
    const bb =
      storeSectionBbcode ??
      htmlToNGABBCode(useEditorStore.getState().sectionContent ?? '');
    setBbcodeDraftValue(bb);
    bbcodeDirtyRef.current = false;
    bbcodeDraftSectionIdRef.current = activeSectionId;
  }, [editorMode, activeSectionId, storeSectionId, storeSectionBbcode, setBbcodeDraftValue]);

  // 视图切换：content 是唯一事实来源，切换时双向自动同步，不再需要手动"同步"按钮
  const handleSwitchEditorMode = useCallback(
    async (mode: 'visual' | 'bbcode') => {
      if (mode === editorMode) return;
      if (mode === 'bbcode') {
        // 可视化 → BBCode：先把防抖中的正文落盘（保存时同步派生 BBCode）
        await flushDebouncedSave();
        const st = useEditorStore.getState();
        const bb = st.sectionBbcode ?? htmlToNGABBCode(st.sectionContent ?? '');
        setBbcodeDraftValue(bb);
        bbcodeDirtyRef.current = false;
        bbcodeDraftSectionIdRef.current = st.sectionId;
        setEditorMode('bbcode');
        return;
      }
      // BBCode → 可视化：仅当草稿被用户改动过才写回 content，避免只浏览就发生有损回转
      if (
        activeSectionId &&
        bbcodeDraftSectionIdRef.current === activeSectionId &&
        bbcodeDirtyRef.current
      ) {
        commitBbcodeDraftToContent(activeSectionId, bbcodeDraftRef.current);
        await flushDebouncedSave();
      }
      bbcodeDirtyRef.current = false;
      setEditorMode('visual');
    },
    [editorMode, activeSectionId, commitBbcodeDraftToContent, setBbcodeDraftValue],
  );

  // 当前节导出为图片：单图 / 自动拆分 / 超限拒绝（实现见 utils/sectionImageExport）
  const handleExportSectionAsImage = async () => {
    const el = visualEditorRef.current;
    if (!el) return;
    setExportingImage(true);
    try {
      const result = await exportSectionAsImages(el, { title: section?.title || '当前节' });
      useToastStore
        .getState()
        .showToast(result.message, result.type, result.duration ? { duration: result.duration } : undefined);
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

  /** 需求4:编辑已有骰子块 — 打开配置弹窗,加载已有 config+style */
  const handleEditDiceBlock = useCallback((blockId: string, payload: DiceBlockPayloadV2) => {
    useDiceStore.getState().openDialog({
      draft: payload.config,
      targetBlockId: blockId,
      originalPayload: payload,
    });
  }, []);

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

  // 初始统计：直接从 SectionMeta.word_count 获取字数，无需加载 content
  useEffect(() => {
    const stats: Record<string, { words: number; dice: number }> = {};
    for (const sec of sections) {
      stats[sec.id] = { words: sec.word_count || 0, dice: 0 };
    }
    setSectionStats(stats);
  }, [sections]);

  // 当前编辑节字数：改用 800ms 轮询读取 store（不订阅），避免每次按键触发 EditorPage 重渲染。
  // 输入时 UI 立即响应，字数显示低频更新，长文档输入不卡顿。
  // 性能优化：内容未变化时跳过全量解析（大文档下 JSON.parse 失败回退 + TreeWalker
  // 每次都要花数毫秒，轮询期间空转纯属浪费）。
  const lastCountedContentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!section) return;
    lastCountedContentRef.current = null; // 切节后强制重算一次
    const timer = window.setInterval(() => {
      if (useEditorStore.getState().sectionLoading) return; // 切节加载中跳过，防旧内容写入新节 stats
      const content = useEditorStore.getState().sectionContent;
      if (!content) return;
      if (content === lastCountedContentRef.current) return;
      lastCountedContentRef.current = content;
      let words = 0;
      try {
        const json = JSON.parse(content);
        if (json && typeof json === 'object') {
          words = countWordsAndDice(json).words;
        } else {
          words = countWordsFromHtml(content).words;
        }
      } catch {
        words = countWordsFromHtml(content).words;
      }
      setSectionStats((prev) => {
        const prevStat = prev[section.id] || { words: 0, dice: 0 };
        if (prevStat.words === words) return prev;
        return { ...prev, [section.id]: { ...prevStat, words } };
      });
    }, 800);
    return () => window.clearInterval(timer);
  }, [section?.id]);

  // 显示用字数：从 sectionStats 读取，切换节/加载中自动保留旧值避免跳变为 0
  const displayWordCount = section?.id ? (sectionStats[section.id]?.words || 0) : 0;

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
            className="bg-[var(--bg-card)] border-b border-b-[color:var(--border-color)] shrink-0 flex items-center gap-2 px-3 py-1.5"
          >
            <button aria-label="打开目录"
              onClick={() => setLeftDrawerOpen(true)}
              className="text-[var(--text-secondary)] shrink-0 w-8 h-8 flex items-center justify-center rounded-lg"
              title="打开目录"
            >
              <Icon name="menu" size={16} />
            </button>
            <button
              onClick={onBack}
              className="text-[var(--text-secondary)] shrink-0 w-8 h-8 flex items-center justify-center rounded-lg"
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
                  className="border border-[color:var(--accent)] text-[var(--text-primary)] bg-[var(--bg-card)] text-sm font-semibold px-2 py-1 rounded outline-none w-full"
                />
              ) : (
                <button
                  onClick={() => {
                    if (story) {
                      setTitleInput(story.title);
                      setIsEditingTitle(true);
                    }
                  }}
                  className="text-[var(--text-primary)] text-left text-sm font-semibold px-2 py-1 rounded truncate block w-full"
                  title="点击重命名作品"
                >
                  {story?.title || '未命名作品'}
                </button>
              )}
            </div>
            <span
              className="text-[var(--text-secondary)] bg-[var(--bg-hover)] shrink-0 text-[11px] px-2 py-0.5 rounded-md flex items-center gap-1"
            >
              <span
                className="bg-[var(--accent)] w-1.5 h-1.5 rounded-full"
              />
              <WordCount variant="compact" />
            </span>
            {section && view === 'directory' && (
              <button
                onClick={() => setFocusMode(true)}
                className="text-[var(--text-secondary)] shrink-0 w-8 h-8 flex items-center justify-center rounded-lg"
                title="全屏编辑"
              >
                ⤢
              </button>
            )}
            {onOpenReader && (
              <button
                onClick={onOpenReader}
                className="text-[var(--text-secondary)] shrink-0 w-8 h-8 flex items-center justify-center rounded-lg"
                title="阅读模式"
                aria-label="阅读模式"
              >
                <Icon name="bookText" size={14} />
              </button>
            )}
          </header>
          {/* 移动端第二行：全宽 tab bar（4 个视图等分，确保全部可见） */}
          <nav
            className="bg-[var(--bg-card)] border-[color:var(--border-color)] shrink-0 grid grid-cols-4 border-b"
          >
            {(['世界观', '目录', '大纲', '人物'] as const).map((label, idx) => {
              const key: EditorView = ['info', 'directory', 'outline', 'character'][idx] as EditorView;
              const icons: IconName[] = ['globe', 'scroll', 'pen', 'theater'];
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
                  <span className="text-base leading-none mb-0.5 flex items-center justify-center">
                    <Icon name={icons[idx]} size={16} />
                  </span>
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>
        </>
      ) : (
      <header
        className="bg-[var(--bg-card)] border-b border-b-[color:var(--border-color)] shrink-0 flex items-center gap-2 md:gap-4 px-3 md:px-4 py-2 md:py-2.5"
      >
        <button aria-label="返回"
          onClick={onBack}
          className="text-[var(--text-secondary)] shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
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
          <Icon name="back" size={14} />
        </button>

        {onOpenReader && (
          <button
            onClick={onOpenReader}
            className="text-[var(--text-secondary)] text-[13px] shrink-0 h-9 px-3 flex items-center gap-1.5 rounded-lg transition-colors"
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
            <Icon name="bookText" size={14} />
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
              className="border border-[color:var(--accent)] text-[var(--text-primary)] bg-[var(--bg-card)] text-sm font-semibold px-2 py-1 rounded outline-none w-full"
            />
          ) : (
            <button
              onClick={() => {
                if (story) {
                  setTitleInput(story.title);
                  setIsEditingTitle(true);
                }
              }}
              className="text-[var(--text-primary)] text-left text-sm font-semibold px-2 py-1 rounded transition-colors truncate block w-full"
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
            const icons: IconName[] = ['globe', 'scroll', 'pen', 'theater'];
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
                <span className="inline-flex items-center gap-1">
                  <Icon name={icons[idx]} size={16} />
                  <span>{label}</span>
                </span>
                {active && (
                  <span
                    className="bg-[var(--accent)] absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="shrink-0 flex items-center gap-1 md:gap-1.5">
          <span
            className="text-[var(--text-secondary)] bg-[var(--bg-hover)] text-xs px-2 py-1 rounded-md flex items-center gap-1"
          >
            <span
              className="bg-[var(--accent)] w-1.5 h-1.5 rounded-full"
            />
            <WordCount />
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
                  onCreateSection={(chapterId) => createSection(chapterId, '新的节')}
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
                  onCreateSectionAt={(chapterId, anchorId, position) => createSectionAt(chapterId, '新的节', anchorId, position)}
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
                  onSyncToOutline={structureSync.openDialog}
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
                        className="bg-[var(--bg-card)] border-b border-b-[color:var(--border-color)] text-[var(--text-secondary)] shrink-0 flex items-center gap-2 px-3 py-1.5 text-xs"
                      >
                        <button
                          type="button"
                          onClick={handleExportSectionAsImage}
                          className="px-2 py-1 rounded text-xs ancke-btn"
                          title="把当前节导出为图片"
                          disabled={exportingImage}
                        >
                          <span className="inline-flex items-center gap-1">
                            <Icon name={exportingImage ? 'hourglass' : 'camera'} size={14} />
                            {exportingImage ? '导出中...' : '导出图片'}
                          </span>
                        </button>
                      </div>
                    )}
                    <VisualEditorPane
                      commandsRef={richTextEditorCommandsRef}
                      editorRef={visualEditorRef}
                      onDiceRolled={handleDiceRolled}
                      onEditDiceBlock={handleEditDiceBlock}
                      onImageSelected={setSelectedImage}
                      onShowToast={setToast}
                      onSearchOpen={handleOpenSearchPanel}
                    />
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
                    <BBCodeEditor
                      value={bbcodeDraft}
                      onChange={handleBbcodeChange}
                      onDebouncedChange={handleBbcodeDebouncedChange}
                      onUndo={() => handleUndoRedoForBBCode('undo')}
                      onRedo={() => handleUndoRedoForBBCode('redo')}
                      textareaRef={bbcodeTextareaRef}
                      onSearchOpen={() => {
                        // 搜索面板在属性 tab 内常驻显示：保证切到属性 tab
                        setRightPanelTab('properties');
                      }}
                    />
                    {bbcodeErrors.length > 0 && (
                      <div className="border-t border-t-[color:var(--border-color)] bg-[var(--bg-card)]">
                        {/* v35: 展开/折叠按钮 */}
                        <div
                          onClick={() => setBbcodeErrorsExpanded(prev => !prev)}
                          className="py-[6px] px-[12px] cursor-pointer flex items-center gap-[6px]"
                        >
                          <span className="text-[var(--tone-danger)] text-[12px] select-none inline-flex items-center gap-[6px]">
                            <Icon name={bbcodeErrorsExpanded ? 'chevronDown' : 'chevronRight'} size={12} /> BBCode 语法错误（{bbcodeErrors.length} 个）
                          </span>
                        </div>
                        {/* v35: 最大高度 + 滚动条 + 点击跳转 */}
                        {bbcodeErrorsExpanded && (
                          <div className="max-h-[200px] overflow-y-auto pt-[0px] px-[12px] pb-[6px]">
                            {bbcodeErrors.map((err, i) => (
                              <div
                                key={i}
                                onClick={() => jumpToBbcodeLine(err.line)}
                                className="text-[var(--tone-danger)] text-[12px] mt-[2px] cursor-pointer py-[2px] px-[4px] rounded-[var(--radius-chip)]"
                                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--tone-danger-soft)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                                title="点击跳转到对应行"
                              >
                                行 {err.line}：{err.message}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {sectionLoading && (
                  <div className="bg-[var(--scrim-soft)] absolute inset-0 flex items-center justify-center z-10">
                    <div className="text-[var(--text-secondary)] flex items-center gap-2 text-sm">
                      <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                      加载中...
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div
                className="bg-[var(--bg-card)] text-[var(--text-secondary)] flex-1 flex items-center justify-center text-xs"
              >
                请在左侧选择一个节开始编辑
              </div>
            )}
          </main>

          {/* 底部状态栏：移出 main，放外层 flex 容器中 shrink-0 贴底 */}
          {section && !(isMobile && keyboardOpen) && (
            <BottomStatusBar
              editorMode={editorMode}
              onSwitchMode={handleSwitchEditorMode}
            />
          )}
          </div>

          {/* ===== 安卓版：右侧面板默认折叠（只露 tab 头，点击展开，不盖编辑区） ===== */}
          {isMobile && (
            <aside
              className="border-[color:var(--border-color)] bg-[var(--bg-card)] shrink-0 flex flex-col border-t"
            >
              {/* 移动端面板头：4 图标 tab（切换内容并自动展开）+ 独立▼/▲折叠按钮 */}
              <div className="border-[color:var(--border-color)] shrink-0 flex items-center border-b">
                <div className="flex-1 grid grid-cols-5">
                  {([
                    { key: 'properties', icon: 'settings', label: '属性' },
                    { key: 'world', icon: 'globe', label: '世界观' },
                    { key: 'character', icon: 'user', label: '人物' },
                    { key: 'dice', icon: 'dices', label: '骰子' },
                    { key: 'gallery', icon: 'image', label: '图库' },
                  ] as const).map((t) => {
                    const active = rightPanelTab === t.key;
                    return (
                      <button
                        key={t.key}
                        aria-label={t.label}
                        title={t.label}
                        onClick={() => {
                          setRightPanelTab(t.key);
                          if (!mobilePanelOpen) setMobilePanelOpen(true);
                        }}
                        className="flex items-center justify-center py-2.5"
                        style={{
                          color: active ? 'var(--accent)' : 'var(--text-secondary)',
                          background: active ? 'var(--accent-soft)' : 'transparent',
                        }}
                      >
                        <Icon name={t.icon} size={16} />
                      </button>
                    );
                  })}
                </div>
                {/* 独立展开/折叠按钮 */}
                <button
                  onClick={() => setMobilePanelOpen(!mobilePanelOpen)}
                  className="text-[var(--text-secondary)] border-l border-l-[color:var(--border-color)] shrink-0 w-10 flex items-center justify-center py-2.5"
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
                    onRenameSection={handleRenameSection}
                    onJumpToDice={handleJumpToDice}
                    onRestoreDice={handleRestoreDice}
                    onInsertUnrolledDice={handleInsertUnrolledDice}
                    onCheckDiceExists={handleCheckDiceExists}
                    selectedImage={selectedImage}
                    onSetImageSize={handleSetImageSize}
                    richTextEditorCommandsRef={richTextEditorCommandsRef}
                    onShowToast={(msg) => setToast(msg)}
                    width={undefined}
                    editorMode={editorMode}
                    bbcodeTextareaRef={bbcodeTextareaRef}
                    visualEditorRef={visualEditorRef}
                    bbcodeValue={bbcodeDraft}
                    onBBCodeChange={setBbcodeDraft}
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
                  const next = Math.min(480, Math.max(280, w + delta));
                  userRightWidthRef.current = next;
                  return next;
                })}
              />

              <RightPanel
                activeTab={rightPanelTab}
                setActiveTab={setRightPanelTab}
                section={section}
                onCollapse={handleCollapseRightPanel}
                onRenameSection={handleRenameSection}
                onJumpToDice={handleJumpToDice}
                onRestoreDice={handleRestoreDice}
                onInsertUnrolledDice={handleInsertUnrolledDice}
                onCheckDiceExists={handleCheckDiceExists}
                selectedImage={selectedImage}
                onSetImageSize={handleSetImageSize}
                richTextEditorCommandsRef={richTextEditorCommandsRef}
                onShowToast={(msg) => setToast(msg)}
                width={rightSidebarWidth}
                editorMode={editorMode}
                bbcodeTextareaRef={bbcodeTextareaRef}
                visualEditorRef={visualEditorRef}
                bbcodeValue={bbcodeDraft}
                onBBCodeChange={setBbcodeDraft}
              />
            </>
          )}

          {/* 桌面端右栏折叠状态：显示展开按钮 */}
          {!isMobile && rightSidebarCollapsed && (
            <button
              onClick={() => setRightSidebarCollapsed(false)}
              title="展开右侧面板"
              className="bg-[var(--bg-card)] border-[color:var(--border-color)] text-[var(--text-secondary)] cursor-pointer shrink-0 flex items-center justify-center w-6 border-l"
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
                className="bg-[var(--bg-card)] mobile-drawer-panel-left absolute left-0 top-0 bottom-0 w-[85%] max-w-[320px] shadow-2xl flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                {/* 抽屉头部：关闭按钮 + 标题 */}
                <div
                  className="border-[color:var(--border-color)] shrink-0 flex items-center justify-between px-3 py-2 border-b"
                >
                  <div className="text-[var(--text-primary)] text-sm font-semibold">目录</div>
                  <button aria-label="关闭"
                    onClick={() => setLeftDrawerOpen(false)}
                    className="text-[var(--text-secondary)] w-11 h-11 flex items-center justify-center rounded-lg"
                  >
                    <Icon name="x" size={14} />                  </button>
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
                    onCreateSection={(chapterId) => createSection(chapterId, '新的节')}
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
                    onCreateSectionAt={(chapterId, anchorId, position) => createSectionAt(chapterId, '新的节', anchorId, position)}
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
                    onSyncToOutline={structureSync.openDialog}
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
            className="border-l border-l-[color:var(--border-color)] bg-[var(--bg-page)] min-h-[0px] flex-1 flex flex-col overflow-hidden"
          >
            <div
              className="bg-[var(--bg-card)] border-[color:var(--border-color)] shrink-0 flex items-center justify-end gap-2 px-4 py-2 border-b"
            >
              <button
                onClick={() => structureSync.openDialog('outline')}
                className="bg-[var(--bg-card)] text-[var(--accent)] border border-[color:var(--accent-soft)] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-soft)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
              >
                <span className="inline-flex items-center gap-1">
                  <Icon name="copy" size={14} />
                  同步大纲到目录
                </span>
              </button>
              <button
                onClick={() => structureSync.openDialog('directory')}
                className="bg-[var(--bg-card)] text-[var(--text-primary)] border border-[color:var(--border-color)] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
              >
                <span className="inline-flex items-center gap-1">
                  <Icon name="copy" size={14} />
                  同步目录到大纲
                </span>
              </button>
            </div>
            <OutlineEditor />
          </main>
        </div>
      )}

      {/* Toast 提示 */}
      {toast && (
        <div
          className="bg-[var(--text-primary)] text-[var(--bg-card)] absolute left-1/2 top-6 z-50 -translate-x-1/2 px-4 py-2 rounded-lg shadow-lg text-xs font-medium"
        >
          {toast}
        </div>
      )}

      {/* 骰子配置弹窗 */}
      <DiceConfigDialog
        onSaveNew={(payload) => {
          richTextEditorCommandsRef.current?.insertDice(payload as DiceBlockPayloadV2);
        }}
        onSaveEdit={(blockId, payload) => {
          richTextEditorCommandsRef.current?.updateDiceBlock(blockId, payload);
        }}
      />

      {/* 同步对话框（支持大纲→目录 和 目录→大纲 两个方向） */}
      <SyncDialog
        open={structureSync.open}
        onClose={structureSync.close}
        source={structureSync.source}
        volumeDiffs={structureSync.volumeDiffs}
        chapterDiffs={structureSync.chapterDiffs}
        onConfirm={structureSync.applySync}
      />

      {/* ===== 移动端全屏专注编辑模式 =====
          用户点 ⤢ 按钮进入，编辑器占据全部可视空间（键盘弹出时编辑区不被挤窄） */}
      {focusMode && section && activeChapter && view === 'directory' && (
        <div
          className="fixed top-0 left-0 right-0 z-50 flex flex-col"
          style={{ height: focusModeViewportHeight, background: 'var(--bg-page)' }}
        >
          <header
            className="bg-[var(--bg-card)] border-b border-b-[color:var(--border-color)] shrink-0 flex items-center gap-2 px-3 py-2"
          >
            <button
              onClick={() => setFocusMode(false)}
              className="text-[var(--text-secondary)] shrink-0 w-8 h-8 flex items-center justify-center rounded-lg"
              title="退出全屏"
            >
              ←
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-[var(--text-primary)] text-sm font-semibold truncate">
                {activeVolume?.title || '未命名卷'} - {activeChapter.title} - {section.title}
              </div>
            </div>
            <button aria-label="退出全屏"
              onClick={() => setFocusMode(false)}
              className="text-[var(--text-secondary)] shrink-0 w-8 h-8 flex items-center justify-center rounded-lg"
              title="退出全屏"
            >
              <Icon name="x" size={14} />
            </button>
          </header>
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            {editorMode === 'visual' ? (
              <VisualEditorPane
                commandsRef={richTextEditorCommandsRef}
                editorRef={visualEditorRef}
                onDiceRolled={handleDiceRolled}
                onEditDiceBlock={handleEditDiceBlock}
                onImageSelected={setSelectedImage}
                onShowToast={setToast}
                onSearchOpen={handleOpenSearchPanel}
              />
            ) : (
              <BBCodeEditor
                value={bbcodeDraft}
                onChange={handleBbcodeChange}
                onDebouncedChange={handleBbcodeDebouncedChange}
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

