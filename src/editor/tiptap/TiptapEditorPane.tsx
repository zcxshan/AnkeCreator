// ============================================================
// 安科编辑器 —— Tiptap 内核外壳（改造方案 S7）
//
// 目标：作为 RichTextEditor 的**等价替代**，外层 props / DOM 结构 /
// CSS 类名 / 交互（缩放、右键菜单、手势滚动、节滚动位置持久化）
// 与旧内核逐项对齐；编辑内核换成 Tiptap（ProseMirror）。
//
// 关键设计：
//  1. props 与 RichTextEditorProps 逐字段一致（含未使用项），
//     便于 S9 阶段把 VisualEditorPane 的渲染目标整体切换过来。
//  2. 撤销/重做以 ProseMirror history 为唯一事实来源，
//     忽略外层传入的 onUndo/onRedo/canUndo/canRedo（S9 起外层不再传）。
//  3. 序列化口径：onChangeContent 使用 view.dom.innerHTML（与旧内核逐字节对齐，
//     含 NodeView 生成的样式），并剥除 PM 渲染层临时 DOM（ProseMirror-separator
//     等，见 serialize.ts）；空文档归一化为 ''（与旧内核空内容口径一致）。
//  4. DOM 结构：EditorContent div（.anke-editor-content，承载 padding/zoom）
//     > div.ProseMirror.anke-editor-content（实际 contenteditable）。
//     类名同时挂两层，使 index.css 中既有的
//     `.anke-editor-content[contenteditable=...]`（作用于可编辑根）与
//     `.anke-editor-content .ProseMirror xxx`（作用于后代元素）两类选择器
//     无需任何改动即可命中。
// ============================================================

import React, {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';

import { EditorToolbar, type ShortcutHandlers } from '../../components/editor/EditorToolbar';
import { ContextMenu, type ContextMenuItemConfig } from '../../components/common/ContextMenu';
import { useEditorStore } from '../../store/editorStore';
import { useToastStore } from '../../store/toastStore';
import { countWordsFromHtml } from '../../components/pages/HomePage';
import { getCurrentStyles } from './currentStyles';
import { setLastEditorRange, domShowsContent } from './domState';
import type { DiceBlockPayloadV2 } from '../../types';
import { uploadImagesWithProgress } from '../../utils/uploadImage';

import { createAnkeExtensions } from './schema';
import { ankeNodeViews, setAnkeNodeViewHandlers } from './nodeViews';
import { createAnkeCommands } from './commands';
import { normalizePastedHtml } from './pasteNormalize';
import { sanitizeAnkeHtml, hasProseMirrorArtifacts } from './serialize';
import {
  shouldApplyExternalContent,
  shouldRecreateHistory,
  shouldSkipExternalSync,
} from './contentSync';

/** 可编辑根 / 外层容器共用的类名（index.css 依赖） */
const ANKE_CONTENT_CLASS = 'anke-editor-content';

/** 原子块 / 折叠块样式（与旧内核注入的 style 标签逐条一致） */
const INJECTED_STYLE_ID_IMAGE = 'anke-editor-image-block-style';
const INJECTED_STYLE_ID_DICE = 'anke-editor-dice-card-style';

const INJECTED_CSS = `
  /* 图片块：保持 inline-block，让块可与文本同行；用 cursor:grab 提示可拖动 */
  .anke-editor-content div[data-type="image-block"] {
    position: relative;
    display: inline-block !important;
    vertical-align: middle;
    user-select: auto;
    cursor: grab;
    outline: none;
    max-width: 100%;
  }
  .anke-editor-content div[data-type="image-block"][data-selected="true"] {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-tight);
  }
  .anke-editor-content div[data-type="image-block"] img {
    display: inline-block;
    max-width: 100%;
    height: auto;
    pointer-events: none;
  }
  /* 图片块对齐：一旦带上 text-align（TextAlign 作用于图片块自身），
     改为整行块级盒子，让内部 inline-block 的 <img> 能左/中/右定位 */
  .anke-editor-content div[data-type="image-block"][style*="text-align"] {
    display: block !important;
    margin-left: 0;
    margin-right: 0;
  }

  /* 骰子卡片：同样 inline-block，可与文本同行拖动 */
  .anke-editor-content div[data-type="dice-card"] {
    position: relative;
    display: inline-block !important;
    vertical-align: middle;
    user-select: auto;
    cursor: grab;
    outline: none;
    max-width: 100%;
  }
  .anke-editor-content div[data-type="dice-card"][data-selected="true"] {
    outline: 2px solid var(--accent) !important;
    outline-offset: 2px;
  }
  .anke-editor-content div[data-type="dice-card"] * {
    pointer-events: auto;
  }
  .anke-editor-content div[data-type="dice-card"] button,
  .anke-editor-content div[data-type="dice-card"] input,
  .anke-editor-content div[data-type="dice-card"] select {
    pointer-events: auto;
  }
  .anke-editor-content div[data-type="dice-card"] button[data-role="roll"]:focus {
    outline: none;
  }

  /* 折叠块：保留 block 布局（块级容器），但加 cursor:grab 提示整体可拖动 */
  .anke-editor-content div[data-type="collapse-block"] {
    display: block;
    user-select: auto;
    cursor: grab;
    outline: none;
  }
  .anke-editor-content div[data-type="collapse-block"] .collapse-head {
    cursor: pointer;
  }
`;

/** 注入原子块样式（按 id 幂等，多次挂载不重复） */
function injectEditorStyles(): void {
  if (!document.getElementById(INJECTED_STYLE_ID_IMAGE)) {
    const styleEl = document.createElement('style');
    styleEl.id = INJECTED_STYLE_ID_IMAGE;
    styleEl.textContent = INJECTED_CSS;
    document.head.appendChild(styleEl);
  }
  // 保留旧 id 作为占位，避免与旧内核同时挂载时重复注入
  if (!document.getElementById(INJECTED_STYLE_ID_DICE)) {
    const marker = document.createElement('style');
    marker.id = INJECTED_STYLE_ID_DICE;
    marker.textContent = '';
    document.head.appendChild(marker);
  }
}

/**
 * 判断编辑器 DOM 是否"内容为空"（用于显示占位符）：
 * - 无可见文本
 * - 无结构内容（图片/表格/分割线/原子块）—— 有结构内容即使无文字也不算空
 */
function isEditorDomEmpty(el: HTMLElement): boolean {
  if ((el.textContent || '').trim() !== '') return false;
  if (el.querySelector('img, table, hr, [data-type]')) return false;
  return true;
}

/** 同步 data-empty 属性，驱动 CSS 占位符显隐 */
function syncEmptyState(el: HTMLElement): void {
  el.setAttribute('data-empty', isEditorDomEmpty(el) ? 'true' : 'false');
}

export interface RichTextEditorProps {
  content: string | null | undefined;
  onChangeContent: (htmlStr: string) => void;
  onInsertDiceRequest: () => void;
  onDiceRolled?: (payload: any) => void;
  /** 需求4:编辑已有骰子块(由 dice-card 编辑按钮触发) */
  onEditDiceBlock?: (blockId: string, payload: DiceBlockPayloadV2) => void;
  onImageSelected?: (info: { width: number; height: number; src?: string; dataSize?: string } | null) => void;
  editable?: boolean;
  className?: string;
  style?: React.CSSProperties;
  commandsRef?: React.MutableRefObject<RichTextEditorCommands | null>;
  onShowToast?: (msg: string) => void;
  /**
   * 撤销/重做回调（旧内核走应用级历史栈）。
   * Tiptap 版以 ProseMirror history 为唯一事实来源，此三项仅保留签名兼容，
   * S9 切换渲染目标后由外层移除。
   */
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  /** 外部 ref（供搜索面板访问编辑器 DOM） */
  editorRef?: React.MutableRefObject<HTMLDivElement | null>;
  /** Ctrl+F / 右键搜索触发回调（切换到搜索面板） */
  onSearchOpen?: () => void;
  /** 样式工具栏是否折叠（受控，由编辑器外层统一管理） */
  stylePanelCollapsed?: boolean;
  /** 切换样式工具栏折叠态 */
  onToggleStylePanel?: () => void;
}

export interface RichTextEditorCommands {
  insertImage: (src: string, size?: string) => void;
  insertDice: (payload: DiceBlockPayloadV2) => void;
  /** 需求4:更新已有骰子块的 payload(编辑保存后回填) */
  updateDiceBlock: (blockId: string, payload: DiceBlockPayloadV2) => void;
  focus: () => void;
  getJSON: () => Record<string, unknown>;
  scrollToDiceCard: (payloadSnapshot: string) => boolean;
  setSelectedImageSize: (size: string) => void;
  updateSelectedImageSrc: (src: string) => void;
  updateSelectedImageDataSize: (size: string) => void;
  /** 需求5: 快速跳转 — 滚动到顶部 */
  scrollToTop: () => void;
  /** 需求5: 快速跳转 — 滚动到底部 */
  scrollToBottom: () => void;
  /** 需求5: 快速跳转 — 获取当前滚动位置 */
  getScrollTop: () => number;
  /** 需求5: 快速跳转 — 设置滚动位置 */
  setScrollTop: (scrollTop: number) => void;
}

export function TiptapEditorPane({
  content,
  onChangeContent,
  onInsertDiceRequest,
  onDiceRolled,
  onEditDiceBlock,
  onImageSelected,
  editable = true,
  className,
  style,
  commandsRef,
  onShowToast,
  editorRef,
  onSearchOpen,
  stylePanelCollapsed,
  onToggleStylePanel,
}: RichTextEditorProps) {
  const internalDivRef = useRef<HTMLDivElement | null>(null);
  const divRef = (editorRef ?? internalDivRef) as React.MutableRefObject<HTMLElement | null>;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** 最近一次与外部同步过的 content 字符串（避免回声重写 + 误清撤销栈） */
  const lastContentRef = useRef<string>('');
  /** 输入法组合期间不打断候选框：此时跳过外部内容同步 */
  const composingRef = useRef(false);
  /** 保存编辑器内的选区（工具栏按钮点击后编辑器失焦时沿用） */
  const savedRangeRef = useRef<Range | null>(null);
  /** 标记 None：Ctrl+Shift+V 置位，handlePaste 消费 */
  const pasteAsPlainRef = useRef(false);
  /** 工具栏快捷键处理函数（由 EditorToolbar 通过 onShortcutReady 注册） */
  const shortcutHandlersRef = useRef<ShortcutHandlers | null>(null);
  /** 最新 props 引用，供编辑器事件回调读取（避免闭包过期） */
  const onChangeContentRef = useRef(onChangeContent);
  onChangeContentRef.current = onChangeContent;
  const onImageSelectedRef = useRef(onImageSelected);
  onImageSelectedRef.current = onImageSelected;
  const onDiceRolledRef = useRef(onDiceRolled);
  onDiceRolledRef.current = onDiceRolled;
  const onEditDiceBlockRef = useRef(onEditDiceBlock);
  onEditDiceBlockRef.current = onEditDiceBlock;
  const onSearchOpenRef = useRef(onSearchOpen);
  onSearchOpenRef.current = onSearchOpen;
  const onInsertDiceRequestRef = useRef(onInsertDiceRequest);
  onInsertDiceRequestRef.current = onInsertDiceRequest;
  const onShowToastRef = useRef(onShowToast);
  onShowToastRef.current = onShowToast;

  /** 编辑器实例引用（供命令层在实例被重建时始终取到最新值） */
  const editorRefInternal = useRef<Editor | null>(null);

  // 自定义右键菜单
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(
    null,
  );

  // Ctrl+滚轮缩放编辑区（50%~200%，不持久化）
  const [zoom, setZoom] = useState(1);
  const [showZoomHint, setShowZoomHint] = useState(false);
  const zoomHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showZoomHintFor = (ms: number) => {
    setShowZoomHint(true);
    if (zoomHintTimerRef.current) clearTimeout(zoomHintTimerRef.current);
    zoomHintTimerRef.current = setTimeout(() => setShowZoomHint(false), ms);
  };
  const handleResetZoom = () => {
    setZoom(1);
    showZoomHintFor(1500);
  };
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1; // 向上放大，向下缩小
    setZoom((prev) => {
      const next = Math.round((prev + delta) * 10) / 10;
      if (next < 0.5) return 0.5;
      if (next > 2) return 2;
      return next;
    });
    showZoomHintFor(1500);
  };
  useEffect(() => {
    return () => {
      if (zoomHintTimerRef.current) clearTimeout(zoomHintTimerRef.current);
    };
  }, []);

  // ------------------------------------------------------------
  // 扩展装配：把三个原子块的 NodeView 挂到对应节点上
  // ------------------------------------------------------------
  const extensions = useMemo(
    () =>
      createAnkeExtensions().map((ext) => {
        if (ext.name === 'imageBlock') {
          return ext.extend({ addNodeView: () => ankeNodeViews.imageBlock() });
        }
        if (ext.name === 'diceCard') {
          return ext.extend({ addNodeView: () => ankeNodeViews.diceCard() });
        }
        if (ext.name === 'collapseBlock') {
          return ext.extend({ addNodeView: () => ankeNodeViews.collapseBlock() });
        }
        return ext;
      }),
    [],
  );

  // ------------------------------------------------------------
  // 键盘：仅接管 Tiptap 默认行为不覆盖的快捷键
  //   Ctrl+0 缩放复位 / Ctrl+F 搜索 / Ctrl+Shift+V 纯文本粘贴 /
  //   Ctrl+B·I·U / Ctrl+Shift+S·Q·C·D（工具栏注册的处理函数）
  // 撤销/重做交给 ProseMirror history（AnkeUndoRedo 已注册 Mod-z / Shift-Mod-z / Mod-y）
  // ------------------------------------------------------------
  const handleEditorKeyDown = (event: KeyboardEvent): boolean => {
    const ctrlOrCmd = event.ctrlKey || event.metaKey;

    if (ctrlOrCmd && event.key === '0') {
      event.preventDefault();
      handleResetZoom();
      return true;
    }

    if (ctrlOrCmd && !event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      onSearchOpenRef.current?.();
      return true;
    }

    if (ctrlOrCmd && !event.shiftKey) {
      const key = event.key.toLowerCase();
      if (key === 'b') {
        event.preventDefault();
        shortcutHandlersRef.current?.bold();
        return true;
      }
      if (key === 'i') {
        event.preventDefault();
        shortcutHandlersRef.current?.italic();
        return true;
      }
      if (key === 'u') {
        event.preventDefault();
        shortcutHandlersRef.current?.underline();
        return true;
      }
    }

    if (ctrlOrCmd && event.shiftKey) {
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        shortcutHandlersRef.current?.strike();
        return true;
      }
      if (key === 'c') {
        event.preventDefault();
        shortcutHandlersRef.current?.collapse();
        return true;
      }
      if (key === 'd') {
        event.preventDefault();
        onInsertDiceRequestRef.current?.();
        return true;
      }
      if (key === 'v') {
        // Ctrl+Shift+V：纯文本粘贴。不 preventDefault，让浏览器继续触发 paste
        pasteAsPlainRef.current = true;
        return false;
      }
    }

    return false;
  };

  // ------------------------------------------------------------
  // 粘贴：仅在 Ctrl+Shift+V 时降级为纯文本，其余交给 ProseMirror
  // （schema 解析天然丢弃不受支持的标记，替代旧内核的手工清洗流程）
  // ------------------------------------------------------------
  const handleEditorPaste = (view: { pasteText: (text: string, event?: ClipboardEvent) => boolean }, event: ClipboardEvent): boolean => {
    if (!pasteAsPlainRef.current) return false;
    pasteAsPlainRef.current = false;
    const text = event.clipboardData?.getData('text/plain') ?? '';
    return view.pasteText(text, event);
  };

  const editor = useEditor({
    extensions,
    // 内容入口清洗：存量库数据可能含 PM 临时 DOM（ProseMirror-separator 等），
    // 不清洗会导致其作为文档内容反复增殖（工程文件膨胀到 23MB 的根因）
    content: content ? sanitizeAnkeHtml(content) : '',
    editable,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class: ANKE_CONTENT_CLASS,
        // 性能优化：>50k 字符时关闭 spellcheck，避免大文档输入时阻塞主线程
        spellcheck: String(editable && (content?.length ?? 0) <= 50000),
      },
      handleKeyDown: (_view, event) => handleEditorKeyDown(event),
      handlePaste: (view, event) => handleEditorPaste(view, event as ClipboardEvent),
      handleDOMEvents: {
        compositionstart: () => {
          composingRef.current = true;
          return false;
        },
        compositionend: () => {
          composingRef.current = false;
          return false;
        },
      },
    },
    onUpdate: ({ editor: current }) => {
      const el = current.view.dom;
      // 序列化出口清洗：剥除 PM 渲染层临时 DOM（separator 等）并补齐业务块属性，
      // 防止其随 innerHTML 存库后无限增殖（见 serialize.ts 模块注释）
      const html = current.isEmpty ? '' : sanitizeAnkeHtml(el.innerHTML);
      if (html === lastContentRef.current) return;
      lastContentRef.current = html;
      syncEmptyState(el);
      onChangeContentRef.current(html);
    },
    onCreate: ({ editor: current }) => {
      syncEmptyState(current.view.dom);
    },
  });

  editorRefInternal.current = editor;

  // ------------------------------------------------------------
  // 撤销/重做可用性：订阅 transaction，仅在布尔值变化时重渲染
  // （useEditor 默认 shouldRerenderOnTransaction=false，不能靠渲染期读取）
  // ------------------------------------------------------------
  const [historyFlags, setHistoryFlags] = useState({ canUndo: false, canRedo: false });
  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      const next = { canUndo: editor.can().undo(), canRedo: editor.can().redo() };
      setHistoryFlags((prev) =>
        prev.canUndo === next.canUndo && prev.canRedo === next.canRedo ? prev : next,
      );
    };
    sync();
    editor.on('transaction', sync);
    return () => {
      editor.off('transaction', sync);
    };
  }, [editor]);

  // 编辑器 DOM 引用（保持「编辑器 DOM」语义：指向实际 contenteditable 根）
  useEffect(() => {
    if (editor) divRef.current = editor.view.dom;
  });

  // editable 变化 -> 同步
  useEffect(() => {
    if (editor) editor.setEditable(editable);
  }, [editor, editable]);

  // ------------------------------------------------------------
  // content 变化 -> 写入编辑器（切节加载 / 导入 / 外部同步）
  //   1. lastContentRef 命中 = 我们刚回传出去的内容，直接返回（避免回声重写）
  //   2. domShowsContent 命中 = DOM 已显示等价内容（浏览器序列化非幂等），直接返回
  //   3. 真正的外部加载：setContent + 重建 EditorState 清空撤销栈
  //      （否则 Ctrl+Z 会撤销回上一节内容并把脏数据写进当前节）
  // ------------------------------------------------------------
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (shouldSkipExternalSync(composingRef.current)) return;
    const el = editor.view.dom;
    const safe: string = content == null || content === '' ? '' : content;
    // 存量污染治愈：剥离 PM 临时 DOM 后若内容有变，说明库里是脏数据，
    // 加载干净版本并主动回传，确保下次保存落库即为干净 HTML
    const cleaned = sanitizeAnkeHtml(safe);
    if (
      !shouldApplyExternalContent({
        isComposing: composingRef.current,
        next: cleaned,
        lastApplied: lastContentRef.current,
      })
    ) {
      return;
    }
    const healed = hasProseMirrorArtifacts(safe) && cleaned !== safe;
    if (lastContentRef.current === cleaned) return;
    if (domShowsContent(el, cleaned)) {
      lastContentRef.current = cleaned;
      syncEmptyState(el);
      if (healed) onChangeContentRef.current(cleaned);
      return;
    }
    if (shouldRecreateHistory(lastContentRef.current, cleaned)) {
      // 外部加载视为撤销边界：重建 EditorState 清空撤销栈
      editor.commands.setContent(cleaned, { emitUpdate: false });
      editor.view.updateState(
        EditorState.create({
          schema: editor.schema,
          doc: editor.state.doc,
          plugins: editor.state.plugins,
        }),
      );
    }
    lastContentRef.current = cleaned;
    syncEmptyState(editor.view.dom);
    if (healed) onChangeContentRef.current(cleaned);
  }, [content, editor]);

  // ------------------------------------------------------------
  // NodeView 回调桥接（NodeView 无法直接拿到 React props）
  // ------------------------------------------------------------
  useEffect(() => {
    setAnkeNodeViewHandlers({
      onImageSelected: (info) => onImageSelectedRef.current?.(info),
      onDiceRolled: (payload) => onDiceRolledRef.current?.(payload),
      onEditDiceBlock: (blockId, payload) => onEditDiceBlockRef.current?.(blockId, payload),
    });
    return () => setAnkeNodeViewHandlers({});
  }, []);

  // 原子块样式注入（幂等）
  useEffect(() => {
    injectEditorStyles();
  }, []);

  // ------------------------------------------------------------
  // 选区同步：cursorStyles（光标处样式）+ selectionStats（选区字数）
  // 与旧内核同一套取数口径（DOM 祖先样式 + 选区 HTML 字数），保证工具栏展示一致
  // ------------------------------------------------------------
  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    let rafId: number | null = null;
    let wordCountTimer: number | null = null;

    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const r = sel.getRangeAt(0);
      if (!el.contains(r.startContainer)) return;
      savedRangeRef.current = r.cloneRange();
      setLastEditorRange(r.cloneRange());

      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          const cur = getCurrentStyles(el);
          const store = useEditorStore.getState();
          const c = store.cursorStyles;
          const same =
            c.color === cur.color &&
            c.fontSize === cur.fontSize &&
            c.fontFamily === cur.fontFamily &&
            !!c.bold === !!cur.bold &&
            !!c.italic === !!cur.italic &&
            !!c.underline === !!cur.underline &&
            !!c.strike === !!cur.strike &&
            !!c.sup === !!cur.sup &&
            !!c.sub === !!cur.sub;
          if (!same) useEditorStore.setState({ cursorStyles: cur });
        });
      }

      if (wordCountTimer !== null) clearTimeout(wordCountTimer);
      if (!r.collapsed && el.contains(r.endContainer)) {
        const rangeCopy = r.cloneRange();
        wordCountTimer = window.setTimeout(() => {
          try {
            const fragment = rangeCopy.cloneContents();
            const tmp = document.createElement('div');
            tmp.appendChild(fragment);
            useEditorStore.setState({ selectionStats: countWordsFromHtml(tmp.innerHTML) });
          } catch {
            useEditorStore.setState({ selectionStats: null });
          }
        }, 100);
      } else {
        wordCountTimer = window.setTimeout(() => {
          useEditorStore.setState({ selectionStats: null });
        }, 100);
      }
    };

    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (wordCountTimer !== null) clearTimeout(wordCountTimer);
    };
  }, []);

  // ------------------------------------------------------------
  // 命令适配层（12 个方法）+ 工具栏插入图片复用同一实现
  // ------------------------------------------------------------
  const commands = useMemo(
    () =>
      createAnkeCommands({
        getEditor: () => editorRefInternal.current,
        getContentEl: () => editorRefInternal.current?.view.dom ?? null,
        getScrollEl: () => scrollRef.current,
      }),
    [],
  );

  useImperativeHandle(commandsRef, () => commands, [commands]);

  // ------------------------------------------------------------
  // 图片加载失败 → 「重新选择图片」：选图上传后替换对应图片块的 src
  // （图片块 NodeView 在兜底占位里派发 anke:image-reselect 事件）
  // ------------------------------------------------------------
  useEffect(() => {
    const host = editor?.view.dom;
    if (!host) return;

    const pickFile = async (): Promise<{ file: File; filePath?: string } | null> => {
      const electronAPI = (window as any).electronAPI;
      if (typeof electronAPI?.selectImage === 'function') {
        try {
          const sel: {
            buffer: string;
            filename: string;
            mimeType: string;
            filePath?: string;
          } | null = await electronAPI.selectImage();
          if (!sel) return null;
          const byteChars = atob(sel.buffer);
          const bytes = new Uint8Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
          return {
            file: new File([bytes], sel.filename, { type: sel.mimeType }),
            filePath: sel.filePath,
          };
        } catch {
          return null;
        }
      }
      return await new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = () => {
          const file = input.files?.[0];
          resolve(file ? { file } : null);
        };
        input.click();
      });
    };

    const handleReselect = async (event: Event) => {
      const oldSrc = (event as CustomEvent<{ src?: string }>).detail?.src;
      const current = editorRefInternal.current;
      if (!oldSrc || !current) return;
      const picked = await pickFile();
      if (!picked) return;
      const [uploaded] = await uploadImagesWithProgress([picked.file], () => {}, picked.filePath);
      if (!uploaded?.ok || !uploaded.url) {
        useToastStore
          .getState()
          .showToast(`图片替换失败：${uploaded?.error || '未知错误'}`, 'error');
        return;
      }
      const matches: Array<{ pos: number; attrs: Record<string, unknown> }> = [];
      current.state.doc.descendants((node, pos) => {
        if (matches.length > 0) return false;
        if (node.type.name === 'imageBlock' && node.attrs.src === oldSrc) {
          matches.push({ pos, attrs: node.attrs });
          return false;
        }
        return true;
      });
      if (matches.length === 0) {
        useToastStore.getState().showToast('未找到要替换的图片块', 'error');
        return;
      }
      const target = matches[0];
      current.view.dispatch(
        current.state.tr.setNodeMarkup(target.pos, undefined, {
          ...target.attrs,
          src: uploaded.url,
          dataOriginalSrc: uploaded.url,
        }),
      );
      useToastStore.getState().showToast('图片已替换', 'success');
    };

    host.addEventListener('anke:image-reselect', handleReselect as EventListener);
    return () => host.removeEventListener('anke:image-reselect', handleReselect as EventListener);
  }, [editor]);

  // ------------------------------------------------------------
  // 需求5: 节切换时保存/恢复滚动位置
  // ------------------------------------------------------------
  const currentSectionId = useEditorStore((s) => s.sectionId);
  const lastSectionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prevId = lastSectionIdRef.current;
    const newId = currentSectionId;
    if (prevId && prevId !== newId) {
      const scrollTop = scrollRef.current?.scrollTop ?? 0;
      useEditorStore.getState().setSectionScrollPosition(prevId, scrollTop);
    }
    lastSectionIdRef.current = newId;
    if (newId && prevId !== newId) {
      const savedPos = useEditorStore.getState().getSectionScrollPosition(newId);
      if (savedPos !== undefined && savedPos > 0) {
        const timer = window.setTimeout(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = savedPos;
        }, 300);
        return () => window.clearTimeout(timer);
      }
    }
  }, [currentSectionId]);

  // 组件卸载时保存当前节的滚动位置
  useEffect(() => {
    return () => {
      const sid = lastSectionIdRef.current;
      if (sid) {
        const scrollTop = scrollRef.current?.scrollTop ?? 0;
        useEditorStore.getState().setSectionScrollPosition(sid, scrollTop);
      }
    };
  }, []);

  // ------------------------------------------------------------
  // 触摸手势：tap（点一下）→ 光标 + 键盘；pan（滑动）→ 滚动外层 div
  // （Android WebView 下 contenteditable 自身滚动不可靠）
  // ------------------------------------------------------------
  const TAP_MAX_MOVE = 8;
  const gestureRef = useRef<{
    startX: number;
    startY: number;
    startScrollTop: number;
    isPanning: boolean;
  } | null>(null);

  const handleTouchStartScroll = (e: React.TouchEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || e.touches.length !== 1) {
      gestureRef.current = null;
      return;
    }
    const touch = e.touches[0];
    gestureRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startScrollTop: el.scrollTop,
      isPanning: false,
    };
  };

  const handleTouchMoveScroll = (e: React.TouchEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    const el = scrollRef.current;
    if (!g || !el || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - g.startX;
    const dy = touch.clientY - g.startY;

    if (!g.isPanning) {
      if (Math.abs(dy) > TAP_MAX_MOVE) {
        g.isPanning = true;
      } else if (Math.abs(dx) > TAP_MAX_MOVE) {
        gestureRef.current = null;
        return;
      } else {
        return;
      }
    }

    const maxScroll = el.scrollHeight - el.clientHeight;
    let newScrollTop = g.startScrollTop - dy;
    if (newScrollTop < 0) newScrollTop = 0;
    if (newScrollTop > maxScroll) newScrollTop = maxScroll;
    el.scrollTop = newScrollTop;
    e.preventDefault();
  };

  const handleTouchEndScroll = () => {
    gestureRef.current = null;
  };

  return (
    <div
      className={`${className} flex flex-col flex-[1] min-h-[0px] bg-[var(--bg-editor)] border border-[color:var(--border-color)] rounded-[var(--radius-control)] overflow-hidden`}
    >
      <EditorToolbar
        editor={editor}
        editorElRef={divRef}
        savedRangeRef={savedRangeRef}
        onInsertImage={(src, size) => commands.insertImage(src, size)}
        onInsertDice={onInsertDiceRequest}
        onShowToast={onShowToast}
        onUndo={() => editor?.commands.undo()}
        onRedo={() => editor?.commands.redo()}
        canUndo={historyFlags.canUndo}
        canRedo={historyFlags.canRedo}
        collapsed={stylePanelCollapsed}
        onToggleCollapsed={onToggleStylePanel}
        onShortcutReady={(handlers) => {
          shortcutHandlersRef.current = handlers;
        }}
      />
      {/* 滚动容器：普通 div，Android WebView 触摸滚动正常 */}
      <div
        ref={(el) => {
          scrollRef.current = el;
        }}
        onTouchStart={handleTouchStartScroll}
        onTouchMove={handleTouchMoveScroll}
        onTouchEnd={handleTouchEndScroll}
        onTouchCancel={handleTouchEndScroll}
        onWheel={handleWheel}
        className="flex-[1] min-h-[0px] overflow-y-auto overflow-x-hidden relative anke-editor-scroll"
      >
        {showZoomHint && (
          <div
            className="absolute top-3 right-3 z-10 px-3 py-1.5 rounded-lg text-sm font-medium pointer-events-none select-none"
            style={{
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              boxShadow: 'var(--shadow-md)',
            }}
            aria-live="polite"
          >
            {Math.round(zoom * 100)}%
          </div>
        )}
        {/* 内容外壳：承载 padding / zoom；真正的 contenteditable 是内部的 .ProseMirror */}
        <EditorContent
          editor={editor}
          className={ANKE_CONTENT_CLASS}
          style={{
            minHeight: '100%',
            padding: '24px 32px',
            outline: 'none',
            cursor: editable ? 'text' : 'default',
            zoom, // Ctrl+滚轮缩放（Chrome/Electron 原生支持）
            ...(style || {}),
          }}
          onContextMenu={(e: React.MouseEvent<HTMLDivElement>) => {
            e.preventDefault();
            const sel = window.getSelection();
            const hasSelection = !!(sel && !sel.isCollapsed && sel.toString().trim());
            setCtxMenu({ x: e.clientX, y: e.clientY, hasSelection });
          }}
        />
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          separatorsBefore={[3]}
          items={[
            {
              label: '复制',
              disabled: !ctxMenu.hasSelection,
              onClick: async () => {
                const sel = window.getSelection();
                const text = sel ? sel.toString() : '';
                if (!text) return;
                try {
                  await navigator.clipboard.writeText(text);
                  useToastStore.getState().showToast('已复制', 'success');
                } catch {
                  document.execCommand('copy');
                }
                setCtxMenu(null);
              },
            },
            {
              label: '粘贴',
              onClick: async () => {
                editor?.commands.focus();
                try {
                  if (navigator.clipboard?.read) {
                    try {
                      const items = await navigator.clipboard.read();
                      for (const item of items) {
                        if (item.types.includes('text/html')) {
                          const blob = await item.getType('text/html');
                          const html = await blob.text();
                          const normalized = normalizePastedHtml(html);
                          if (normalized) {
                            editor?.chain().focus().insertContent(normalized).run();
                            setCtxMenu(null);
                            return;
                          }
                        }
                      }
                    } catch {
                      // 用户拒绝授权 / 浏览器不支持 → fallback 到纯文本
                    }
                  }
                  const text = await navigator.clipboard.readText();
                  if (text) editor?.chain().focus().insertContent(text).run();
                } catch (err) {
                  useToastStore
                    .getState()
                    .showToast('粘贴失败：' + (err as Error).message, 'error');
                }
                setCtxMenu(null);
              },
            },
            {
              label: '剪切',
              disabled: !ctxMenu.hasSelection,
              onClick: async () => {
                const sel = window.getSelection();
                const text = sel ? sel.toString() : '';
                if (!text) return;
                try {
                  await navigator.clipboard.writeText(text);
                  editor?.commands.deleteSelection();
                  useToastStore.getState().showToast('已剪切', 'success');
                } catch {
                  document.execCommand('cut');
                }
                setCtxMenu(null);
              },
            },
            {
              label: '在当前节中搜索',
              onClick: () => {
                setCtxMenu(null);
                editor?.commands.focus();
                onSearchOpen?.();
              },
            },
          ] as ContextMenuItemConfig[]}
        />
      )}
    </div>
  );
}

export default TiptapEditorPane;
