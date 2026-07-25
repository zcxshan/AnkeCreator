import React, { useRef, useEffect, useState } from 'react';
import { EditorToolbar, type ShortcutHandlers } from './EditorToolbar';

import { ContextMenu, type ContextMenuItemConfig } from '../common/ContextMenu';
import {
  insertImageBlock,
  attachImageBlockHandlers,
  reattachImageErrorHandlers,
  insertDiceCard,
  attachDiceCardHandlers,
  scrollToDiceCard,
  updateDiceBlock,
  getSelectedImageBlock,
  setImageBlockSize,
  updateSelectedImage,
  dispatchInput,
  attachCollapseBlockHandlers,
  ensureDragHandle,
  getCurrentStyles,
  applyActiveStylesToInsertion,
  applyActiveStylesToRange,
  setLastEditorRange,
  getInlineStylesFromAncestors,
  insertStyledParagraphAfter,
  splitBlockAtCursor,
  insertQuoteBlock,
} from './contenteditableUtils';
import { useEditorStore } from '../../store/editorStore';
import { useEditorHistoryStore } from '../../store/editorHistoryStore';
import { useToastStore } from '../../store/toastStore';
import { useThemeStore } from '../../store/themeStore';
import type { ThemeMode } from '../../store/themeStore';
import { countWordsFromHtml } from '../pages/HomePage';
import type { DiceBlockPayloadV2 } from '../../types';

interface RichTextEditorProps {
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
  /** 撤销回调（由父组件绑定到工具栏按钮，走自定义历史栈） */
  onUndo?: () => void;
  /** 重做回调（由父组件绑定到工具栏按钮，走自定义历史栈） */
  onRedo?: () => void;
  /** 是否可撤销（控制工具栏按钮禁用态） */
  canUndo?: boolean;
  /** 是否可重做（控制工具栏按钮禁用态） */
  canRedo?: boolean;
  /** 外部 ref（供搜索面板访问编辑器 DOM） */
  editorRef?: React.MutableRefObject<HTMLDivElement | null>;
  /** Ctrl+F / 右键搜索触发回调（切换到搜索面板） */
  onSearchOpen?: () => void;
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

function RichTextEditorInner({
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
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  editorRef,
  onSearchOpen,
}: RichTextEditorProps) {
  const internalDivRef = useRef<HTMLDivElement | null>(null);
  const divRef = (editorRef ?? internalDivRef) as React.MutableRefObject<HTMLElement | null>;
  const lastContentRef = useRef<string>('');
  const savedRangeRef = useRef<Range | null>(null);
  /** 标记：正在应用历史快照（undo/redo 触发的 innerHTML 设置），此时不要推历史 */
  const applyingHistoryRef = useRef<boolean>(false);
  /** 防抖：把短时间内的连续输入合并为一条历史 */
  const historyTimerRef = useRef<number | null>(null);
  /**
   * 滚动容器的 ref（外层 .anke-editor-scroll div）
   * 用于在 touch 手势判定为 pan 时手动更新 scrollTop
   */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** 需求4:用 ref 包装 onEditDiceBlock 避免 effect 频繁重绑定 */
  const onEditDiceBlockRef = useRef(onEditDiceBlock);
  onEditDiceBlockRef.current = onEditDiceBlock;
  /** 需求2: 工具栏快捷键处理函数（由 EditorToolbar 通过 onShortcutReady 注册）*/
  const shortcutHandlersRef = useRef<ShortcutHandlers | null>(null);
  /**
   * 触摸手势状态：
   * - 记录触摸起点 + 起始 scrollTop
   * - 累计位移 > TAP_MAX_MOVE 时认定为 pan，开始接管滚动
   * - tap（位移 < 阈值）保持默认行为，contenteditable 正常处理光标定位 + 唤起键盘
   */
  const gestureRef = useRef<{
    startX: number;
    startY: number;
    startScrollTop: number;
    isPanning: boolean;
  } | null>(null);
  /** 判定阈值：手指滑动超过这个距离才算 pan（px） */
  const TAP_MAX_MOVE = 8;

  // 自定义右键菜单
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    hasSelection: boolean;
  } | null>(null);

  // Ctrl+滚轮缩放编辑区（50%~200%，不持久化）
  const [zoom, setZoom] = useState(1);
  const [showZoomHint, setShowZoomHint] = useState(false);
  const zoomHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    // 显示缩放提示，1.5s 后自动消失
    setShowZoomHint(true);
    if (zoomHintTimerRef.current) clearTimeout(zoomHintTimerRef.current);
    zoomHintTimerRef.current = setTimeout(() => setShowZoomHint(false), 1500);
  };
  const handleResetZoom = () => {
    setZoom(1);
    setShowZoomHint(true);
    if (zoomHintTimerRef.current) clearTimeout(zoomHintTimerRef.current);
    zoomHintTimerRef.current = setTimeout(() => setShowZoomHint(false), 1500);
  };
  // 卸载时清理 timer
  useEffect(() => {
    return () => {
      if (zoomHintTimerRef.current) clearTimeout(zoomHintTimerRef.current);
    };
  }, []);

  // 持续保存编辑器内的光标位置（工具栏按钮点击后编辑器失焦时恢复用）
  // 同时把光标处的样式同步到 useEditorStore.cursorStyles（供工具栏展示）
  // 注意：不同步到 activeStyles —— activeStyles 是用户主动激活的状态，保留用户意图
  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    // rAF 节流：每帧最多执行一次样式更新（避免拖选时频繁触发）
    let rafId: number | null = null;
    // 防抖 timer：选区字数统计延迟 100ms（拖选过程中不频繁计算 HTML 字数）
    let wordCountTimer: number | null = null;

    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        setLastEditorRange(null);
        return;
      }
      const r = sel.getRangeAt(0);
      if (el.contains(r.startContainer)) {
        const cloned = r.cloneRange();
        savedRangeRef.current = cloned;
        setLastEditorRange(cloned.cloneRange());

        // 样式更新：rAF 节流（每帧最多一次）
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
            if (!same) {
              useEditorStore.setState({ cursorStyles: cur });
              // v40: 移除 styleMismatch unlock 逻辑
              // activeStylesLocked 只由用户主动操作清除(清格式/Backspace 删空/切章节)
              // 锁定状态下光标移动不解锁,保持 Word 式"持久锁定"
            }
          });
        }

        // 选区字数统计：100ms 防抖（拖选过程中不频繁解析 HTML）
        if (wordCountTimer !== null) clearTimeout(wordCountTimer);
        if (!r.collapsed && el.contains(r.endContainer)) {
          const rangeCopy = r.cloneRange();
          wordCountTimer = window.setTimeout(() => {
            try {
              const fragment = rangeCopy.cloneContents();
              const tmp = document.createElement('div');
              tmp.appendChild(fragment);
              const stats = countWordsFromHtml(tmp.innerHTML);
              useEditorStore.setState({ selectionStats: stats });
            } catch {
              useEditorStore.setState({ selectionStats: null });
            }
          }, 100);
        } else {
          wordCountTimer = window.setTimeout(() => {
            useEditorStore.setState({ selectionStats: null });
          }, 100);
        }
      } else {
        // 光标在 editor 之外（弹窗 / 工具栏）→ 保留旧模块级 range（不更新到 null）
      }
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (wordCountTimer !== null) clearTimeout(wordCountTimer);
    };
  }, []);

  // content 变化 -> 写入 div.innerHTML（切节加载，用 requestIdleCallback 避免阻塞主线程）
  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const safeContent: string =
      content == null || content === '' ? '' : content;
    // 实际写入的 HTML：空内容时插入 <br> 占位，让 contenteditable 能显示光标
    // （contenteditable div 为空时浏览器不显示光标）
    const displayHTML = safeContent === '' ? '<br>' : safeContent;
    if (el.innerHTML === displayHTML) return;

    const apply = () => {
      el.innerHTML = displayHTML;
      // v48 Fix 4: innerHTML 重写后重新挂载 img error listener
      // 确保章节切换/视图切换后图片仍有 base64 兜底能力
      // (addEventListener 注册的 listener 不被 innerHTML 序列化,新 img 元素需要重新挂载)
      reattachImageErrorHandlers(el);
      lastContentRef.current = safeContent;
      // 内容从外部加载（切章节/导入等），重置历史栈
      useEditorHistoryStore.getState().reset(safeContent);
    };
    // requestIdleCallback 让浏览器在空闲时执行写入，避免大节内容阻塞 UI
    const ric = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout?: number }) => number)
      | undefined;
    if (ric) {
      const handle = ric(apply, { timeout: 200 });
      return () => (window as any).cancelIdleCallback?.(handle);
    }
    // 降级：非 Electron 环境用 setTimeout(0)
    const t = setTimeout(apply, 0);
    return () => clearTimeout(t);
  }, [content]);

  // editable 变化 -> 同步属性
  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    el.setAttribute('contenteditable', editable ? 'true' : 'false');
  }, [editable]);

  React.useImperativeHandle(
    commandsRef,
    () => ({
      focus: () => divRef.current?.focus(),
      getJSON: () => ({
        type: 'doc',
        html: divRef.current?.innerHTML ?? '',
      }),
      insertImage: (src, size) => {
        const el = divRef.current;
        if (!el || !src) return;
        insertImageBlock(el, src, { size });
      },
      insertDice: (payload: any) => {
        const el = divRef.current;
        if (!el) return;
        insertDiceCard(el, payload);
      },
      updateDiceBlock: (blockId: string, payload: DiceBlockPayloadV2) => {
        const el = divRef.current;
        if (!el) return;
        updateDiceBlock(el, blockId, payload);
      },
      scrollToDiceCard: (payloadSnapshot: string) => {
        const el = divRef.current;
        if (!el) return false;
        return scrollToDiceCard(el, payloadSnapshot);
      },
      setSelectedImageSize: (size: string) => {
        const el = divRef.current;
        if (!el) return;
        const selected = getSelectedImageBlock(el);
        if (selected) {
          setImageBlockSize(el, selected, size);
        }
      },
      updateSelectedImageSrc: (src: string) => {
        const el = divRef.current;
        if (!el) return;
        const selected = getSelectedImageBlock(el);
        if (selected) {
          updateSelectedImage(el, selected, { src });
        }
      },
      updateSelectedImageDataSize: (size: string) => {
        const el = divRef.current;
        if (!el) return;
        const selected = getSelectedImageBlock(el);
        if (selected) {
          updateSelectedImage(el, selected, { size });
        }
      },
      scrollToTop: () => {
        const scrollEl = scrollRef.current;
        if (scrollEl) scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
      },
      scrollToBottom: () => {
        const scrollEl = scrollRef.current;
        if (scrollEl) scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
      },
      getScrollTop: () => {
        return scrollRef.current?.scrollTop ?? 0;
      },
      setScrollTop: (scrollTop: number) => {
        const scrollEl = scrollRef.current;
        if (scrollEl) scrollEl.scrollTop = scrollTop;
      },
    }),
    [],
  );

  // 需求5: 节切换时保存/恢复滚动位置
  const currentSectionId = useEditorStore((s) => s.sectionId);
  const lastSectionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prevId = lastSectionIdRef.current;
    const newId = currentSectionId;
    // 保存旧节的滚动位置
    if (prevId && prevId !== newId) {
      const scrollTop = scrollRef.current?.scrollTop ?? 0;
      useEditorStore.getState().setSectionScrollPosition(prevId, scrollTop);
    }
    lastSectionIdRef.current = newId;
    // 恢复新节的滚动位置（延迟等 innerHTML 写入完成）
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

  // 需求5: 组件卸载时保存当前节的滚动位置
  useEffect(() => {
    return () => {
      const sid = lastSectionIdRef.current;
      if (sid) {
        const scrollTop = scrollRef.current?.scrollTop ?? 0;
        useEditorStore.getState().setSectionScrollPosition(sid, scrollTop);
      }
    };
  }, []);

  const handleInput = () => {
    const el = divRef.current;
    if (!el) return;
    const html = el.innerHTML;
    if (html === lastContentRef.current) return;
    lastContentRef.current = html;
    onChangeContent(html);
    // 推历史：debounce 200ms 合并连续输入（缩短 debounce 让 Ctrl+Z 跨度更细）
    if (applyingHistoryRef.current) return;
    if (historyTimerRef.current) {
      window.clearTimeout(historyTimerRef.current);
      // 清掉对应的全局 timer 标记（原子块 push 用同一窗口）
      (window as any).__editorHistoryTimer = null;
    }
    historyTimerRef.current = window.setTimeout(() => {
      useEditorHistoryStore.getState().push(html);
      historyTimerRef.current = null;
      (window as any).__editorHistoryTimer = null;
    }, 200);
    (window as any).__editorHistoryTimer = historyTimerRef.current;
  };

  // 用 ref 保存最新的 handleInput，供原生 beforeinput listener 使用
  // （handleInput 闭包捕获了 onChangeContent，避免 stale closure + 避免每次渲染重绑 listener）
  const handleInputRef = useRef(handleInput);
  handleInputRef.current = handleInput;

  // 主题切换时迁移编辑器内黑/白文字颜色
  // - 切到暗色：黑色 span (#000000/#000/black) → #ffffff
  // - 切到亮色：白色 span (#ffffff/#fff/white) → #000000
  // 其他颜色（红/蓝/绿等）保持不变；首次挂载只记录不迁移
  const themeMode = useThemeStore((s) => s.mode);
  const prevThemeModeRef = useRef<ThemeMode | null>(null);
  useEffect(() => {
    const prevMode = prevThemeModeRef.current;
    if (prevMode === null) {
      prevThemeModeRef.current = themeMode;
      return;
    }
    if (prevMode === themeMode) return;
    prevThemeModeRef.current = themeMode;

    const el = divRef.current;
    if (!el) return;

    const BLACK_SET = new Set(['black', '#000000', '#000', 'rgb(0, 0, 0)', 'rgba(0, 0, 0, 1)']);
    const WHITE_SET = new Set(['white', '#ffffff', '#fff', 'rgb(255, 255, 255)', 'rgba(255, 255, 255, 1)']);

    let changed = false;
    const spans = el.querySelectorAll<HTMLSpanElement>('span[style*="color"]');
    for (const span of Array.from(spans)) {
      const color = (span.style.color || '').trim().toLowerCase();
      if (!color) continue;
      if (themeMode === 'dark' && BLACK_SET.has(color)) {
        span.style.color = '#ffffff';
        changed = true;
      } else if (themeMode === 'light' && WHITE_SET.has(color)) {
        span.style.color = '#000000';
        changed = true;
      }
    }

    if (changed) {
      const html = el.innerHTML;
      // 更新 lastContentRef 避免 handleInput 误判重复
      lastContentRef.current = html;
      onChangeContent(html);
      // 不推历史栈：主题切换是 UI 偏好，不是内容编辑
    }

    // 修复：迁移 store 里的 activeStyles.color（用户光标处尚未输入，但选中的颜色已被锁）
    // 主题切换后，如果当前 activeStyles.color 是黑/白，必须同步迁移，
    // 否则用户输入的文字颜色会与新主题不匹配。
    const store = useEditorStore.getState();
    const cur = store.activeStyles.color;
    if (cur) {
      const c = cur.trim().toLowerCase();
      if (themeMode === 'dark' && BLACK_SET.has(c)) {
        useEditorStore.getState().setActiveStyles({ color: '#ffffff' });
      } else if (themeMode === 'light' && WHITE_SET.has(c)) {
        useEditorStore.getState().setActiveStyles({ color: '#000000' });
      }
    }
  }, [themeMode, onChangeContent]);

  // 原生 beforeinput 事件：把活动样式应用到即将插入的字符上
  // 用 addEventListener 监听原生 InputEvent（React 合成 onBeforeInput 的 inputType 永远 undefined）
  // 支持：insertText / insertReplacementText（英文/数字/符号输入）
  // 不处理：insertCompositionText（IME 输入由 handleCompositionEnd 补偿，避免双重处理）
  // 不处理：insertFromPaste（粘贴保持原内容，不被 activeStyles 覆盖）
  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const onBeforeInputNative = (e: InputEvent) => {
      const SUPPORTED_TYPES = new Set(['insertText', 'insertReplacementText']);
      if (!SUPPORTED_TYPES.has(e.inputType) || !e.data) return;
      const store = useEditorStore.getState();
      const active = store.activeStyles;
      // 仅在样式锁定状态下才接管输入（用户主动激活样式的意图）（#12）
      // 未锁定时让浏览器原生处理，避免残留 activeStyles 误触发
      if (!store.activeStylesLocked) return;
      const hasStyle =
        active.color ||
        active.fontSize ||
        active.fontFamily ||
        active.bold ||
        active.italic ||
        active.underline ||
        active.strike ||
        active.sup ||
        active.sub;
      // v6 修复：B/I/U/S 显式取消时（active.bold === false 等）也要接管输入，
      // 否则浏览器原生插入会继承父 span 的样式
      const hasExplicitCancel =
        active.bold === false ||
        active.italic === false ||
        active.underline === false ||
        active.strike === false;
      if (!hasStyle && !hasExplicitCancel) return;
      // 只在光标折叠且选区内无文本时接管
      const sel = window.getSelection();
      // v37 修复: 仅在 sel 明确非折叠时 return（用户选中了文本要替换）
      // sel 不可用或 rangeCount=0 时，让 applyActiveStylesToInsertion 内部使用 _lastEditorRange fallback
      // 避免 v36 场景下 unwrap 破坏 sel 后无法接管输入
      if (sel && !sel.isCollapsed) return;
      // v9 修复：preventDefault 必须在确认能接管后才能调用
      // 否则 activeStylesLocked=true + 显式取消 + 无父 span 时
      // applyActiveStylesToInsertion 返回 false → 浏览器默认插入被阻止 → "编辑都编辑不了"
      if (applyActiveStylesToInsertion(el, active, e.data, useEditorStore.getState().activeStylesLocked)) {
        // 成功接管：阻止默认 + 触发 input 事件保存
        e.preventDefault();
        // 不再 unlock：保持锁定，让后续输入继续延续预选样式（#8）
        // 锁定状态由 Backspace 删空 / 用户主动改样式 / 切章节 清除
        // 触发 input 事件让 onChangeContent 保存
        handleInputRef.current();
      }
    };
    el.addEventListener('beforeinput', onBeforeInputNative as EventListener);
    return () => el.removeEventListener('beforeinput', onBeforeInputNative as EventListener);
  }, []);

  // 应用历史快照到编辑器（undo/redo 共用）
  // 设置 innerHTML + 重置光标到末尾 + 通知内容变化
  const applyHistory = (restored: string) => {
    const el = divRef.current;
    if (!el) return;
    applyingHistoryRef.current = true;
    try {
      el.innerHTML = restored;
      lastContentRef.current = restored;
      // 重置光标到内容末尾，避免光标停留在无效位置
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      // 直接通知内容变化（不走 dispatchInput，否则 handleInput 会因 lastContentRef 相同而跳过）
      onChangeContent(restored);
    } finally {
      applyingHistoryRef.current = false;
    }
  };

  // 撤销：从历史栈弹出上一快照并应用
  const handleUndo = () => {
    const el = divRef.current;
    if (!el) return;
    el.focus();
    const restored = useEditorHistoryStore.getState().undo();
    if (restored != null) applyHistory(restored);
  };

  // 重做：从 future 栈弹出下一快照并应用
  const handleRedo = () => {
    const el = divRef.current;
    if (!el) return;
    el.focus();
    const restored = useEditorHistoryStore.getState().redo();
    if (restored != null) applyHistory(restored);
  };

  // IME 合成结束补偿：中文输入法提交后，浏览器已插入原始文本（无样式）
  // 如果 activeStylesLocked 且有激活样式，把刚插入的文本包裹进 <span style="..."> 应用预选样式
  const handleCompositionEnd = (e: React.CompositionEvent<HTMLDivElement>) => {
    const el = divRef.current;
    if (!el) return;
    const store = useEditorStore.getState();
    const active = store.activeStyles;
    if (!store.activeStylesLocked) return;
    const hasStyle =
      active.color ||
      active.fontSize ||
      active.fontFamily ||
      active.bold ||
      active.italic ||
      active.underline ||
      active.strike ||
      active.sup ||
      active.sub;
    // v6 修复：B/I/U/S 显式取消时也要接管 IME 输入
    const hasExplicitCancel =
      active.bold === false ||
      active.italic === false ||
      active.underline === false ||
      active.strike === false;
    if (!hasStyle && !hasExplicitCancel) return;

    const insertedText = (e.nativeEvent as CompositionEvent).data || '';
    if (!insertedText) return;

    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    // 光标所在节点应为文本节点（IME 刚插入）
    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) return;

    // v40 修复: 在 textNode 中搜索匹配 insertedText 的子串定位起止位置
    // (移除 startOffset - textLen 反推逻辑,该逻辑假设光标在 IME 文本末尾,
    //  对中间提交场景错误)
    const cursorOffset = range.startOffset;
    const nodeValue = (textNode as Text).nodeValue || '';
    let insertStart = -1;
    // 优先在 cursorOffset 之前查找(IME 提交后光标通常在文本末尾)
    const searchStart = Math.max(0, cursorOffset - insertedText.length);
    const beforeCursor = nodeValue.substring(searchStart, cursorOffset);
    const idx = beforeCursor.lastIndexOf(insertedText);
    if (idx >= 0) {
      insertStart = searchStart + idx;
    } else {
      // 在整个文本节点中搜索
      const globalIdx = nodeValue.indexOf(insertedText);
      if (globalIdx >= 0) {
        insertStart = globalIdx;
      }
    }
    if (insertStart < 0) return;
    const insertEnd = insertStart + insertedText.length;

    // 创建包裹范围：覆盖 IME 提交文本
    const wrapRange = document.createRange();
    wrapRange.setStart(textNode as Text, insertStart);
    wrapRange.setEnd(textNode as Text, insertEnd);

    if (applyActiveStylesToRange(wrapRange, active, el, useEditorStore.getState().activeStylesLocked)) {
      handleInput();
    }
  };

  const handleKeyUp = () => {
    const el = divRef.current;
    if (!el) return;
    // 只更新 cursorStyles（光标处实时样式，用于工具栏展示）（#9）
    // 永不覆盖 activeStyles：activeStyles 是用户主动设置的样式意图，
    // 只由工具栏 setActiveStyles/clearActiveStyles 改变，确保预选样式持续生效
    const cur = getCurrentStyles(el);
    useEditorStore.setState({ cursorStyles: cur });
  };
  const handleMouseUp = () => {
    const el = divRef.current;
    if (!el) return;
    // 同 handleKeyUp：只更新 cursorStyles，不覆盖 activeStyles（#9）
    const cur = getCurrentStyles(el);
    useEditorStore.setState({ cursorStyles: cur });
  };

  const handleInsertImage = (src: string, size?: string) => {
    const el = divRef.current;
    if (!el || !src) return;
    insertImageBlock(el, src, { size });
  };

  // Tab 键：在编辑区内插入 4 个 &nbsp;（避免焦点跑掉）
  // BUG-2 修复：确保撤销/全选/删除等快捷键正常工作
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = divRef.current;
    if (!el) return;

    // Ctrl/Cmd + 0：还原编辑区缩放到 100%
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault();
      handleResetZoom();
      return;
    }

    // Tab 键：插入空格
    if (e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      try {
        document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
      } catch {
        /* ignore */
      }
      return;
    }
    
    // Shift+Enter 引用/折叠块出块 + 代码块内换行
    if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        // commonAncestorContainer 可能是 TextNode（光标在文本中间），TextNode 没有 .closest()
        const containerEl = container.nodeType === Node.ELEMENT_NODE
          ? container as HTMLElement
          : container.parentElement;
        // 代码块内 Shift+Enter 换行
        const codeBlock = containerEl?.closest('.code-block');
        if (codeBlock) {
          e.preventDefault();
          document.execCommand('insertHTML', false, '\n');
          return;
        }
        // 引用块内 Shift+Enter：把光标移到 blockquote 之后（整个引用块向下移动一行）
        const quoteBlock = containerEl?.closest('.quote-block, .quote-line, blockquote');
        if (quoteBlock) {
          e.preventDefault();
          // 在 blockquote 之后插入新 <p><br></p>，光标放到 br 之后
          const newP = document.createElement('p');
          const newBr = document.createElement('br');
          newP.appendChild(newBr);
          quoteBlock.parentNode?.insertBefore(newP, quoteBlock.nextSibling);
          const newRange = document.createRange();
          newRange.setStartAfter(newBr);
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
          handleInput();
          return;
        }

        // v41 新增: 普通编辑区域 Shift+Enter 软换行(插入 <br>),延续当前 inline 样式
        // Word 标准: Shift+Enter 在当前段落内换行,不创建新段落
        e.preventDefault();
        const r = selection.getRangeAt(0);
        // 如果选区非折叠,先删除选区内容
        if (!r.collapsed) r.deleteContents();
        // 获取当前 inline 样式(与 Enter 逻辑一致: 优先光标处样式,回退 activeStyles)
        let shiftEnterStyles: ReturnType<typeof getInlineStylesFromActive> = null;
        if (r.collapsed && el.contains(r.commonAncestorContainer)) {
          const cursorNode = r.startContainer;
          shiftEnterStyles = collectInlineStyleFromAncestors(
            cursorNode.nodeType === Node.ELEMENT_NODE
              ? cursorNode
              : cursorNode.parentNode,
            el,
          );
        }
        if (!shiftEnterStyles) {
          const activeStyles = useEditorStore.getState().activeStyles;
          shiftEnterStyles = getInlineStylesFromActive(activeStyles);
        }
        const br = document.createElement('br');
        if (shiftEnterStyles) {
          // 用 span 包裹 <br> 以延续样式
          const span = document.createElement('span');
          if (shiftEnterStyles.fontWeight) span.style.fontWeight = shiftEnterStyles.fontWeight;
          if (shiftEnterStyles.fontStyle) span.style.fontStyle = shiftEnterStyles.fontStyle;
          if (shiftEnterStyles.textDecoration) span.style.textDecoration = shiftEnterStyles.textDecoration;
          span.appendChild(br);
          r.insertNode(span);
          // 光标移到 span 之后(新行开头)
          const newRange = document.createRange();
          newRange.setStartAfter(span);
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
        } else {
          r.insertNode(br);
          // 光标移到 <br> 之后
          const newRange = document.createRange();
          newRange.setStartAfter(br);
          newRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
        handleInput();
        return;
      }
    }

    // 代码块内 Enter（非 Shift）也换行，避免创建新段落
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        // commonAncestorContainer 可能是 TextNode（光标在文本中间），TextNode 没有 .closest()
        const containerEl = container.nodeType === Node.ELEMENT_NODE
          ? container as HTMLElement
          : container.parentElement;
        const codeBlock = containerEl?.closest('.code-block, pre');
        if (codeBlock) {
          e.preventDefault();
          document.execCommand('insertHTML', false, '<br>');
          return;
        }
        // 引用块内 Enter：手动插入 <br>，避免 execCommand 把 <br> 包装成 <div>/<p> 导致脱离引用块
        const quoteBlock = containerEl?.closest('.quote-block, .quote-line, blockquote');
        if (quoteBlock) {
          e.preventDefault();
          const sel2 = window.getSelection();
          if (sel2 && sel2.rangeCount > 0) {
            const range2 = sel2.getRangeAt(0);
            range2.deleteContents();
            const br = document.createElement('br');
            range2.insertNode(br);
            // 把光标移到 <br> 之后
            const newRange = document.createRange();
            newRange.setStartAfter(br);
            newRange.collapse(true);
            sel2.removeAllRanges();
            sel2.addRange(newRange);
            handleInput();
          }
          return;
        }
        // v31 修复:回车继承样式从"基于光标位置"改为"基于 activeStyles(用户意图)"
        // 设计哲学:工具栏 B/I/U/S 按钮高亮 = 用户意图 = 新行/新输入应延续
        // 这与 Word/Quill/Typora 的标准行为一致
        // - 旧 v25c 方案: <p style="..."><br></p> + 光标在 <br> 之前 → <br> 撑起空行 + <p> style 不被新输入字符继承
        // - 新 v31 方案: <p><span style="..."></span></p> + 光标在 <span> 内 → 无 <br> 占位 + 新输入字符进入 <span> 继承样式
        // v36 修正:Enter 创建新行时,优先用光标处 inline 样式(更具上下文)
        // 场景:光标在非粗体位置 + B 工具栏高亮 → 新行不应加粗(光标优先)
        const sel3 = window.getSelection();
        let inlineStyles: ReturnType<typeof getInlineStylesFromActive> = null;
        if (sel3 && sel3.rangeCount > 0) {
          const rCursor = sel3.getRangeAt(0);
          if (rCursor.collapsed && el.contains(rCursor.commonAncestorContainer)) {
            const cursorNode = rCursor.startContainer;
            const cursorStyles = collectInlineStyleFromAncestors(
              cursorNode.nodeType === Node.ELEMENT_NODE
                ? cursorNode
                : cursorNode.parentNode,
              el,
            );
            if (cursorStyles) inlineStyles = cursorStyles;
          }
        }
        if (!inlineStyles) {
          const activeStyles = useEditorStore.getState().activeStyles;
          inlineStyles = getInlineStylesFromActive(activeStyles);
        }

        if (sel3 && sel3.rangeCount > 0) {
          const r3 = sel3.getRangeAt(0);
          const commonAncestor = r3.commonAncestorContainer;
          const ancestorEl = commonAncestor.nodeType === Node.ELEMENT_NODE
            ? commonAncestor as HTMLElement
            : commonAncestor.parentElement;
          // v41 Fix 1C: 去掉 'div'，避免匹配编辑器根本身（裸文本由 else fallback 处理）
          const blockEl = ancestorEl?.closest('p, h1, h2, h3, h4, h5, h6, blockquote, li') as HTMLElement | null;

          // v40: 列表 <li> 内 Enter → 创建新 <li>(而非 <p>)
          // v41 Fix 1A/1B: 光标在开头→前方插空li；末尾→带样式新li；中间→splitBlock
          if (blockEl && blockEl.tagName === 'LI') {
            const liText = blockEl.textContent || '';
            // 空 <li> 末尾按 Enter → 退出列表(创建 <p>)
            if (liText.trim() === '') {
              const newP = document.createElement('p');
              newP.appendChild(document.createElement('br'));
              const listParent = blockEl.closest('ul, ol');
              if (listParent && listParent.parentNode) {
                // 在列表之后插入 <p>
                if (listParent.nextSibling) {
                  listParent.parentNode.insertBefore(newP, listParent.nextSibling);
                } else {
                  listParent.parentNode.appendChild(newP);
                }
                // 移除空 <li>
                blockEl.remove();
              } else {
                el.appendChild(newP);
              }
              const cursor = document.createRange();
              cursor.setStart(newP, 0);
              cursor.collapse(true);
              sel3.removeAllRanges();
              sel3.addRange(cursor);
              e.preventDefault();
              handleInput();
              return;
            }

            // v41 Fix 1B: 光标在 <li> 开头(offset===0) → 在前方插入空 li（Word 标准）
            // 场景: <li>|text</li> 按 Enter → <li><br></li><li>text</li>,光标留在原 li(现第二个)
            if (r3.collapsed && r3.startOffset === 0 && blockEl.textContent && blockEl.textContent.length > 0) {
              e.preventDefault();
              const emptyLi = document.createElement('li');
              if (inlineStyles) {
                // 延续当前 inline 样式: <li><span style="..."><br></span></li>
                const span = document.createElement('span');
                if (inlineStyles.fontWeight) span.style.fontWeight = inlineStyles.fontWeight;
                if (inlineStyles.fontStyle) span.style.fontStyle = inlineStyles.fontStyle;
                if (inlineStyles.textDecoration) span.style.textDecoration = inlineStyles.textDecoration;
                span.appendChild(document.createElement('br'));
                emptyLi.appendChild(span);
              } else {
                emptyLi.appendChild(document.createElement('br'));
              }
              blockEl.parentNode?.insertBefore(emptyLi, blockEl);
              // 光标留在原 li(现在变成第二个)的文本开头
              const cursor = document.createRange();
              cursor.setStart(blockEl, 0);
              cursor.collapse(true);
              sel3.removeAllRanges();
              sel3.addRange(cursor);
              handleInput();
              return;
            }

            // 非空 <li> 末尾或中间 → splitBlockAtCursor 创建新 <li>
            e.preventDefault();
            const cursor = splitBlockAtCursor(el, blockEl, r3);
            // 把新创建的 <p> 改为 <li>
            const newP = cursor.startContainer;
            if (newP.nodeType === Node.ELEMENT_NODE && (newP as HTMLElement).tagName === 'P') {
              const newLi = document.createElement('li');
              while (newP.firstChild) {
                newLi.appendChild(newP.firstChild);
              }
              // v41 Fix 1A: 如果 newLi 为空(只有 <br>),替换为带样式 span 以延续 inline 样式
              // 场景: <li><span style="font-weight:bold">bold|</span></li> 按 Enter
              //       → 新 li 应为 <li><span style="font-weight:bold"><br></span></li>
              if (newLi.childNodes.length === 1 && newLi.firstChild?.nodeName === 'BR' && inlineStyles) {
                newLi.removeChild(newLi.firstChild);
                const span = document.createElement('span');
                if (inlineStyles.fontWeight) span.style.fontWeight = inlineStyles.fontWeight;
                if (inlineStyles.fontStyle) span.style.fontStyle = inlineStyles.fontStyle;
                if (inlineStyles.textDecoration) span.style.textDecoration = inlineStyles.textDecoration;
                span.appendChild(document.createElement('br'));
                newLi.appendChild(span);
                // 光标放在 span 内 br 之前(与 insertStyledParagraphAfter 一致)
                cursor.setStart(span, 0);
              } else {
                cursor.setStart(newLi, 0);
              }
              cursor.collapse(true);
              newP.parentNode?.replaceChild(newLi, newP);
            }
            sel3.removeAllRanges();
            sel3.addRange(cursor);
            handleInput();
            return;
          }

          if (blockEl) {
            // v32 修复:光标在文本中间时,split block(加粗文本中间按 Enter → 左半加粗 + 右半加粗)
            const cursorNode = r3.startContainer;
            const isCursorInMiddleOfText =
              cursorNode.nodeType === Node.TEXT_NODE &&
              r3.startOffset > 0 &&
              r3.startOffset < (cursorNode as Text).length;

            if (isCursorInMiddleOfText) {
              e.preventDefault();
              const cursor = splitBlockAtCursor(el, blockEl, r3);
              sel3.removeAllRanges();
              sel3.addRange(cursor);
              handleInput();
              // v40: 空编辑器 Enter 后,若编辑器变空则添加 <br> 占位
              if (!el.textContent && el.querySelectorAll('br').length === 0) {
                el.appendChild(document.createElement('br'));
              }
              return;
            }

            // v31 原有逻辑:段落末尾按 Enter → insertStyledParagraphAfter
            if (inlineStyles) {
              e.preventDefault();
              const cursor = insertStyledParagraphAfter(el, blockEl, inlineStyles);
              sel3.removeAllRanges();
              sel3.addRange(cursor);
              handleInput();
              return;
            }

            // v34 修复:activeStyles 为空时也要确保能换行
            // (修复"样式文本末尾按 Enter 无反应"的 bug)
            // 新行样式只与菜单栏 activeStyles 有关,activeStyles 为空 → 新行是普通 <p><br></p>
            e.preventDefault();
            const cursor = insertStyledParagraphAfter(el, blockEl, null);
            sel3.removeAllRanges();
            sel3.addRange(cursor);
            handleInput();
            return;
          } else {
            // v41 Fix 1D: blockEl 为 null 时光标在编辑器根的直接子节点(裸文本等)
            // 创建 <p><br></p> 或 <p><span style><br></span></p> 追加到编辑器根
            e.preventDefault();
            const p = document.createElement('p');
            if (inlineStyles) {
              const span = document.createElement('span');
              if (inlineStyles.fontWeight) span.style.fontWeight = inlineStyles.fontWeight;
              if (inlineStyles.fontStyle) span.style.fontStyle = inlineStyles.fontStyle;
              if (inlineStyles.textDecoration) span.style.textDecoration = inlineStyles.textDecoration;
              span.appendChild(document.createElement('br'));
              p.appendChild(span);
            } else {
              p.appendChild(document.createElement('br'));
            }
            el.appendChild(p);
            const newRange = document.createRange();
            const firstChild = p.firstChild;
            if (firstChild && firstChild.nodeType === Node.ELEMENT_NODE && (firstChild as HTMLElement).tagName === 'SPAN') {
              newRange.setStart(firstChild, 0);
            } else {
              newRange.setStart(p, 0);
            }
            newRange.collapse(true);
            sel3.removeAllRanges();
            sel3.addRange(newRange);
            handleInput();
            return;
          }
        }
      }
    }
    
    // Ctrl+F 打开节内搜索
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      onSearchOpen?.();
      return;
    }

    // 需求2: 格式快捷键
    const ctrlOrCmd = e.ctrlKey || e.metaKey;
    if (ctrlOrCmd && !e.shiftKey) {
      const key = e.key.toLowerCase();
      if (key === 'b') { e.preventDefault(); shortcutHandlersRef.current?.bold(); return; }
      if (key === 'i') { e.preventDefault(); shortcutHandlersRef.current?.italic(); return; }
      if (key === 'u') { e.preventDefault(); shortcutHandlersRef.current?.underline(); return; }
    }
    if (ctrlOrCmd && e.shiftKey) {
      const key = e.key.toLowerCase();
      if (key === 's') { e.preventDefault(); shortcutHandlersRef.current?.strike(); return; }
      if (key === 'q') {
        e.preventDefault();
        const editorEl = divRef.current;
        if (editorEl) { insertQuoteBlock(editorEl); dispatchInput(editorEl); }
        return;
      }
      if (key === 'c') { e.preventDefault(); shortcutHandlersRef.current?.collapse(); return; }
      if (key === 'd') { e.preventDefault(); onInsertDiceRequest?.(); return; }
    }

    // Ctrl+Z 撤销 - 使用应用级历史栈（替代 execCommand）
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      handleUndo();
      return;
    }

    // Ctrl+Y / Ctrl+Shift+Z 重做 - 使用应用级历史栈
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      handleRedo();
      return;
    }
    
    // Ctrl+A 全选
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      el.focus();
      document.execCommand('selectAll', false);
      return;
    }

    // Delete / Backspace：处理选区包含 atomic block（image-block/dice-card/collapse-block）的情况
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        // 检查选区是否包含 editor 内的 atomic blocks
        const editorEl = divRef.current;
        if (editorEl && editorEl.contains(range.commonAncestorContainer)) {
          // 收集选区内的所有 atomic blocks
          const atomicBlocks = editorEl.querySelectorAll<HTMLElement>(
            '[data-type="image-block"], [data-type="dice-card"], [data-type="collapse-block"]'
          );
          let removed = false;
          atomicBlocks.forEach((block) => {
            if (range.intersectsNode(block)) {
              block.remove();
              removed = true;
            }
          });
          if (removed) {
            // v40: 防止浏览器重复删除(已手动删除 atomic blocks,若不 preventDefault,
            //   浏览器会再次尝试删除光标处内容,可能删多)
            e.preventDefault();
            dispatchInput(editorEl);
          }
        }
      }
      // 选区折叠时：若光标在空 quote-block 内，一次 Backspace 整块删除
      if (selection && selection.rangeCount > 0 && selection.isCollapsed) {
        const editorEl = divRef.current;
        if (editorEl) {
          const range = selection.getRangeAt(0);
          const container = range.startContainer;
          const containerEl = container.nodeType === Node.ELEMENT_NODE
            ? container as HTMLElement
            : container.parentElement;
          if (containerEl) {
            const quoteBlock = containerEl.closest('blockquote[data-type="quote-block"]') as HTMLElement | null;
            if (quoteBlock) {
              // 判断块是否"空"：只有 <br>，或文本为空
              const inner = quoteBlock.innerHTML.trim();
              const text = (quoteBlock.textContent || '').trim();
              const isEmpty = text === '' && (inner === '' || inner === '<br>');
              if (isEmpty) {
                e.preventDefault();
                // 记录位置 → 删除 blockquote → 在原位置放一个 br 占位
                const parent = quoteBlock.parentNode;
                const next = quoteBlock.nextSibling;
                if (parent) {
                  const placeholder = document.createElement('br');
                  parent.insertBefore(placeholder, quoteBlock);
                  quoteBlock.remove();
                  // 光标放到 br 之后
                  const newRange = document.createRange();
                  newRange.setStartAfter(placeholder);
                  newRange.collapse(true);
                  selection.removeAllRanges();
                  selection.addRange(newRange);
                  dispatchInput(editorEl);
                }
              }
            }
          }
        }
      }
      // Backspace 删空时清除样式锁定（#8）：选区折叠且编辑器内容为空/仅剩 <br>
      if (e.key === 'Backspace' && selection && selection.isCollapsed) {
        const text = el.textContent?.trim() ?? '';
        const onlyBr = el.querySelectorAll('br').length <= 1 && text === '';
        if (onlyBr || el.innerHTML === '' || el.innerHTML === '<br>') {
          useEditorStore.getState().unlockActiveStyles();
        }
      }
    }
  };
  // ─── 安卓全屏编辑模式：tap vs pan 手势判定 ───
  // 行为规范（用户原话）：
  //   - 手指点击（tap）→ contenteditable 显示光标 + 弹出手机键盘 → 可编辑
  //   - 手指滑动（pan）→ 外层 div 滚动编辑区域的内容
  // 实现思路：
  //   - touchstart 仅记录起点，**不** preventDefault，让 tap 走默认流程（contenteditable 正常处理）
  //   - touchmove 累计位移 > TAP_MAX_MOVE 视为 pan，开始手动更新外层 div 的 scrollTop
  //   - 一旦认定 pan，立即 preventDefault 阻止 contenteditable 同时处理（避免光标跳动）
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
    // 不 preventDefault → 让 tap 后续触发 click → contenteditable 正常处理光标定位
  };

  const handleTouchMoveScroll = (e: React.TouchEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    const el = scrollRef.current;
    if (!g || !el || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - g.startX;
    const dy = touch.clientY - g.startY;

    if (!g.isPanning) {
      // 还没认定为 pan：先判断方向
      if (Math.abs(dy) > TAP_MAX_MOVE) {
        // 垂直位移超阈值 → 认定为 pan
        g.isPanning = true;
      } else if (Math.abs(dx) > TAP_MAX_MOVE) {
        // 水平滑动：不是我们要管的滚动（编辑器是垂直滚动），放弃接管
        gestureRef.current = null;
        return;
      } else {
        // 还在 tap 范围内：不动，让浏览器继续把 touch 给 contenteditable
        return;
      }
    }

    // 已经在 pan 状态：手动更新外层 div 的 scrollTop
    const maxScroll = el.scrollHeight - el.clientHeight;
    let newScrollTop = g.startScrollTop - dy;
    // 边界处理：超出范围时仍尝试滚动（由 CSS overscroll-behavior 控制弹性），但保留 preventDefault
    if (newScrollTop < 0) newScrollTop = 0;
    if (newScrollTop > maxScroll) newScrollTop = maxScroll;
    el.scrollTop = newScrollTop;
    e.preventDefault();  // 阻止 contenteditable 同时处理 pan，避免光标跳动
  };

  const handleTouchEndScroll = () => {
    gestureRef.current = null;
  };

  // BUG-1 修复：点击编辑器区域自动 focus，防止失焦后无法编辑
  // #10 修复：光标在引用/代码块内时，点击块外区域要能逃出
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = divRef.current;
    if (!el) return;
    // 确保编辑器获得焦点（保底）
    try {
      el.focus();
    } catch {
      /* ignore */
    }

    // 检查当前光标是否在引用/代码块内，且点击位置在块外 → 手动逃出（#10）
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const curRange = sel.getRangeAt(0);
    // v40: 明确判断 nodeType,用 parentElement?.closest() 替代 as HTMLElement
    //   (TextNode 没有 closest 方法,原代码靠 ?. 侥幸返回 undefined)
    const startEl = curRange.startContainer.nodeType === Node.ELEMENT_NODE
      ? (curRange.startContainer as HTMLElement)
      : curRange.startContainer.parentElement;
    // v41 Fix B: 新增 collapse-head, image-block, dice-card 原子块逃逸
    const curInQuote = startEl?.closest?.(
      '.quote-block, .quote-line, blockquote, .code-block, pre, .collapse-head, .image-block, .dice-card'
    );
    if (!curInQuote) return;

    // 用点击坐标计算目标插入点
    const x = e.clientX;
    const y = e.clientY;
    let targetRange: Range | null = null;
    // Chromium
    const caretFn = (document as any).caretRangeFromPoint;
    if (typeof caretFn === 'function') {
      const r = caretFn.call(document, x, y);
      if (r && el.contains(r.startContainer)) targetRange = r;
    }
    // 标准（Firefox）
    const posFn = (document as any).caretPositionFromPoint;
    if (!targetRange && typeof posFn === 'function') {
      const pos = posFn.call(document, x, y);
      if (pos && el.contains(pos.offsetNode)) {
        const r = document.createRange();
        r.setStart(pos.offsetNode, pos.offset);
        r.collapse(true);
        targetRange = r;
      }
    }
    if (targetRange) {
      // 确认目标点不在引用/代码块内
      // v41 Fix B: 新增 collapse-head, image-block, dice-card 原子块逃逸
      // 修复：startContainer 可能是 TextNode，强转 HTMLElement 后 closest 失效，
      //   导致块内拖选松手即被清空。统一用 parentElement 取祖先后再 closest。
      const targetEl = targetRange.startContainer.nodeType === Node.ELEMENT_NODE
        ? (targetRange.startContainer as HTMLElement)
        : targetRange.startContainer.parentElement;
      const targetInQuote = targetEl?.closest?.(
        '.quote-block, .quote-line, blockquote, .code-block, pre, .collapse-head, .image-block, .dice-card'
      );
      if (!targetInQuote) {
        sel.removeAllRanges();
        sel.addRange(targetRange);
      }
    }
  };

  // 选中内容(含图片/骰子)都可以被拖动。原子块自身就是 draggable 的，
  // 原生 HTML5 拖拽可以把它们整体移动。
  // 我们只需确保：
  // - 原子块的数据类型被选中后可以作为整体被拖动
  // - 普通文本选中后也可以被拖动
  // 不再对拖拽做任何 preventDefault，完全委托给浏览器原生行为
  // 折叠块：仅识别从 .collapse-drag-handle 触发的拖动，避免整块 draggable 干扰 body 文本选中
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // 如果拖动起点在 .dice-card 内的 .dice-roll 按钮或链接，跳过
    if (target.closest && target.closest('[data-role="roll"]')) {
      return;
    }

    // 折叠块：仅识别从 .collapse-drag-handle 触发的拖动
    const dragHandle = target.closest?.('.collapse-drag-handle');
    if (dragHandle) {
      const collapseBlock = dragHandle.closest('[data-type="collapse-block"]') as HTMLElement | null;
      if (collapseBlock) {
        e.dataTransfer.effectAllowed = 'move';
        const outerHtml = collapseBlock.outerHTML;
        e.dataTransfer.setData('application/x-anke-block', 'collapse-block');
        e.dataTransfer.setData('text/html', outerHtml);
        e.dataTransfer.setData('text/plain', outerHtml);
        try {
          e.dataTransfer.setDragImage(collapseBlock, 20, 20);
        } catch {
          /* noop */
        }
        collapseBlock.setAttribute('data-dragging', 'true');
      }
      return;
    }

    // image-block / dice-card：保持原有整块拖动逻辑
    const atomicBlock = target.closest('[data-type="image-block"],[data-type="dice-card"]') as HTMLElement | null;
    if (atomicBlock) {
      e.dataTransfer.effectAllowed = 'move';
      const outerHtml = atomicBlock.outerHTML;
      const blockType = atomicBlock.getAttribute('data-type') || '';
      // 使用自定义 MIME 类型确保我们的块在所有浏览器中都能被正确识别
      e.dataTransfer.setData('application/x-anke-block', blockType);
      e.dataTransfer.setData('text/html', outerHtml);
      e.dataTransfer.setData('text/plain', outerHtml);
      try {
        e.dataTransfer.setDragImage(atomicBlock, 20, 20);
      } catch {
        /* noop */
      }
      atomicBlock.setAttribute('data-dragging', 'true');
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    // 必须调用 preventDefault 才能允许 drop
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const editor = divRef.current;
    if (!editor) return;

    // 外部文件拖入：交给原有的文件处理器
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      // 让默认文件处理器继续处理
      setTimeout(() => dispatchInput(editor), 0);
      return;
    }

    // 块级移动（内部拖拽）
    const htmlData = e.dataTransfer?.getData('text/html');
    const ankeBlockData = e.dataTransfer?.getData('application/x-anke-block');
    const hasAnkeBlock = !!ankeBlockData || (htmlData && /data-type="(image-block|dice-card|collapse-block)"/.test(htmlData));
    if (htmlData && hasAnkeBlock) {
      e.preventDefault();

      // 用 drop 坐标定位插入点
      const dropRange = getDropRange(editor, e.clientX, e.clientY);
      if (!dropRange) {
        editor.querySelectorAll('[data-dragging="true"]').forEach((el) => el.removeAttribute('data-dragging'));
        return;
      }

      // 解析被拖动的 HTML 字符串为 DOM 节点
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlData, 'text/html');
      const movedNode = doc.body.firstElementChild as HTMLElement | null;
      if (!movedNode) {
        editor.querySelectorAll('[data-dragging="true"]').forEach((el) => el.removeAttribute('data-dragging'));
        return;
      }

      // 重要：使用真实 DOM 节点进行 move，而不是用 execCommand 重新序列化
      // 1. 抓取并从原位置删除（保留事件 listener、collapse-title contenteditable 等结构）
      const dragging = editor.querySelector('[data-dragging="true"]') as HTMLElement | null;
      let realNode: HTMLElement | null = null;
      if (dragging && dragging.isSameNode(movedNode)) {
        realNode = dragging;
      } else {
        // 兼容性 fallback：直接从编辑器中按 outerHTML 匹配
        const liveCandidates = Array.from(
          editor.querySelectorAll('[data-type="image-block"],[data-type="dice-card"],[data-type="collapse-block"]'),
        ) as HTMLElement[];
        for (const cand of liveCandidates) {
          if (cand.outerHTML === htmlData) {
            realNode = cand;
            break;
          }
        }
        if (!realNode) realNode = dragging; // 最终兜底
      }
      if (realNode && realNode.parentNode) {
        realNode.parentNode.removeChild(realNode);
      }

      // 2. 插入到 drop 位置
      try {
        // 确保 movedNode（从 HTML 解析得到）保留 data-type / data-payload / data-title 等关键属性
        const ensureBlockAttr = (node: HTMLElement): void => {
          if (!node) return;
          // 1. 恢复 data-type
          if (!node.getAttribute('data-type')) {
            const blockType = ankeBlockData || (htmlData && (htmlData.match(/data-type="([^"]+)"/) || [])[1]) || '';
            if (blockType) node.setAttribute('data-type', blockType);
          }
          const dt = node.getAttribute('data-type') || '';
          // 2. 恢复 data-payload（骰子的配置和结果）
          if (dt === 'dice-card' && !node.getAttribute('data-payload')) {
            const payloadMatch = htmlData && htmlData.match(/data-payload="([^"]*)"/);
            if (payloadMatch && payloadMatch[1]) {
              node.setAttribute('data-payload', payloadMatch[1]);
            }
          }
          // 3. 恢复 data-title（折叠块的标题）
          if (dt === 'collapse-block' && !node.getAttribute('data-title')) {
            const titleMatch = htmlData && htmlData.match(/data-title="([^"]*)"/);
            if (titleMatch && titleMatch[1]) {
              node.setAttribute('data-title', titleMatch[1]);
            }
            ensureDragHandle(node);
          }
        };
        if (movedNode) ensureBlockAttr(movedNode);
        if (realNode) ensureBlockAttr(realNode);
        // 把 dropRange 设为不 collapsed
        if (dropRange.collapsed) {
          // collapse 状态下正常插入即可
        }
        // 不能把块级元素塞到 <p> 中。检查包含块是否是 <p> / <pre>，
        // 如果是，在外层 split，把 <p> 拆成两段，中间插入块级元素。
        let container: Node | null = dropRange.startContainer;
        while (container && container !== editor) {
          if (container.nodeType === 1) {
            const tag = (container as HTMLElement).tagName.toLowerCase();
            if (tag === 'p' || tag === 'pre') {
              // 把 <p> 在 dropRange 处拆成两段，块级元素插入中间
              const pEl = container as HTMLElement;
              const pParent = pEl.parentNode;
              if (pParent) {
                const afterRange = document.createRange();
                afterRange.setStart(dropRange.startContainer, dropRange.startOffset);
                afterRange.setEndAfter(pEl.lastChild || pEl);
                const afterFrag = afterRange.extractContents();
                
                // 如果 <p> 前半段为空，移除它
                if (!pEl.textContent?.trim() && pEl.children.length === 0) {
                  pParent.removeChild(pEl);
                }
                
                // 插入块级元素
                if (pEl.parentNode) {
                  pEl.parentNode.insertBefore(realNode || movedNode, pEl.nextSibling);
                } else {
                  pParent.insertBefore(realNode || movedNode, pParent.firstChild);
                }
                
                // 如果后半段有内容，创建新的 <p> 包裹
                if (afterFrag.childNodes.length > 0) {
                  const newP = document.createElement('p');
                  newP.appendChild(afterFrag);
                  const blockNode = realNode || movedNode;
                  blockNode.parentNode?.insertBefore(newP, blockNode.nextSibling);
                }
                
                // 插入后追加一个换行占位
                const tailBr = document.createElement('br');
                const blockNode = realNode || movedNode;
                blockNode.parentNode?.insertBefore(tailBr, blockNode.nextSibling);
                
                const sel = window.getSelection();
                if (sel) {
                  const newRange = document.createRange();
                  newRange.setStartAfter(tailBr);
                  newRange.collapse(true);
                  sel.removeAllRanges();
                  sel.addRange(newRange);
                }
                
                editor.querySelectorAll('[data-dragging="true"]').forEach((el) => el.removeAttribute('data-dragging'));
                setTimeout(() => dispatchInput(editor), 0);
                return;
              }
              break;
            }
          }
          container = container.parentNode;
        }
        dropRange.deleteContents();
        dropRange.insertNode(realNode || movedNode);
        // 插入后追加一个换行占位，避免与后续文本粘连
        const tailBr = document.createElement('br');
        const afterRange = document.createRange();
        afterRange.setStartAfter(realNode || movedNode);
        afterRange.collapse(true);
        afterRange.insertNode(tailBr);
        // 光标定位到 br 之后
        const sel = window.getSelection();
        if (sel) {
          const newRange = document.createRange();
          newRange.setStartAfter(tailBr);
          newRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(newRange);
        }
      } catch (err) {
        // 兜底：使用原始 htmlData 直接插入（data-type 可能丢失，但内容保留）
        try {
          const tmp = document.createElement('div');
          tmp.innerHTML = htmlData;
          const node = tmp.firstElementChild as HTMLElement | null;
          if (node) {
            const blockType = ankeBlockData || (htmlData && (htmlData.match(/data-type="([^"]+)"/) || [])[1]) || '';
            if (blockType) {
              node.setAttribute('data-type', blockType);
              // 恢复 data-payload（骰子）
              if (blockType === 'dice-card' && !node.getAttribute('data-payload')) {
                const payloadMatch = htmlData && htmlData.match(/data-payload="([^"]*)"/);
                if (payloadMatch && payloadMatch[1]) {
                  node.setAttribute('data-payload', payloadMatch[1]);
                }
              }
              // 恢复 data-title（折叠块）
              if (blockType === 'collapse-block' && !node.getAttribute('data-title')) {
                const titleMatch = htmlData && htmlData.match(/data-title="([^"]*)"/);
                if (titleMatch && titleMatch[1]) {
                  node.setAttribute('data-title', titleMatch[1]);
                }
                ensureDragHandle(node);
              }
            }
            editor.appendChild(node);
          } else {
            document.execCommand('insertHTML', false, htmlData);
          }
        } catch {
          /* ignore */
        }
      }

      editor.querySelectorAll('[data-dragging="true"]').forEach((el) => el.removeAttribute('data-dragging'));
      setTimeout(() => dispatchInput(editor), 0);
      return;
    }

    // 其他默认行为
    editor.querySelectorAll('[data-dragging="true"]').forEach((el) => el.removeAttribute('data-dragging'));
    setTimeout(() => dispatchInput(editor), 0);
  };

  // 根据 drop 坐标获取编辑器内的 Range
  const getDropRange = (editor: HTMLElement, x: number, y: number): Range | null => {
    // 优先使用 caretRangeFromPoint（Chrome/Edge）
    const doc = editor.ownerDocument;
    if (typeof doc.caretRangeFromPoint === 'function') {
      const range = doc.caretRangeFromPoint(x, y);
      if (range && editor.contains(range.startContainer)) return range;
    }
    // 回退到 caretPositionFromPoint（Firefox）
    if (typeof doc.caretPositionFromPoint === 'function') {
      const pos = doc.caretPositionFromPoint(x, y);
      if (pos) {
        const range = doc.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
        if (editor.contains(range.startContainer)) return range;
      }
    }
    // 最终回退：在编辑器末尾创建 range
    const range = doc.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    return range;
  };

  // 挂载图片块交互（点击选中 + 拖拽手柄 + Delete/Backspace 删除）
  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const detach = attachImageBlockHandlers(el);

    // 注入 image-block / dice-card / collapse-block 的样式（不强制 display:block，保留 inline-block 让块可与文本同行拖动）
    const styleId = 'anke-editor-image-block-style';
    if (!document.getElementById(styleId)) {
      const styleEl = document.createElement('style');
      styleEl.id = styleId;
      styleEl.textContent = `
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
          border-radius: 2px;
        }
        .anke-editor-content div[data-type="image-block"] img {
          display: inline-block;
          max-width: 100%;
          height: auto;
          pointer-events: none;
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
        .anke-editor-content div[data-type="dice-card"] * {
          pointer-events: auto;
        }
        .anke-editor-content div[data-type="dice-card"] button,
        .anke-editor-content div[data-type="dice-card"] input,
        .anke-editor-content div[data-type="dice-card"] select {
          pointer-events: auto;
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
      document.head.appendChild(styleEl);
    }

    // 监听图片选中/取消选中/尺寸变化事件，通知外层
    const onSelected = (e: Event) => {
      const custom = e as CustomEvent;
      if (onImageSelected) {
        onImageSelected({
          width: custom?.detail?.width ?? 400,
          height: custom?.detail?.height ?? 0,
          src: custom?.detail?.src ?? '',
          dataSize: custom?.detail?.dataSize ?? 'original',
        });
      }
    };
    const onDeselected = () => {
      if (onImageSelected) onImageSelected(null);
    };
    const onSizeChanged = (e: Event) => {
      const custom = e as CustomEvent;
      if (onImageSelected && custom?.detail) {
        onImageSelected({
          width: custom.detail.width ?? 400,
          height: custom.detail.height ?? 0,
          src: custom?.detail?.src ?? '',
          dataSize: custom?.detail?.dataSize ?? 'original',
        });
      }
    };

    el.addEventListener('anke-image-selected', onSelected as EventListener);
    el.addEventListener('anke-image-deselected', onDeselected as EventListener);
    el.addEventListener('anke-image-size-changed', onSizeChanged as EventListener);

    return () => {
      el.removeEventListener('anke-image-selected', onSelected as EventListener);
      el.removeEventListener('anke-image-deselected', onDeselected as EventListener);
      el.removeEventListener('anke-image-size-changed', onSizeChanged as EventListener);
      detach();
    };
  }, [onImageSelected]);

  // 挂载骰子卡片交互
  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const detach = attachDiceCardHandlers(el);

    // 注入 dice-card 的选中态样式
    const styleId = 'anke-editor-dice-card-style';
    if (!document.getElementById(styleId)) {
      const styleEl = document.createElement('style');
      styleEl.id = styleId;
      styleEl.textContent = `
        .anke-editor-content div[data-type="dice-card"][data-selected="true"] {
          outline: 2px solid var(--accent) !important;
          outline-offset: 2px;
        }
        .anke-editor-content div[data-type="dice-card"] button[data-role="roll"]:focus {
          outline: none;
        }
      `;
      document.head.appendChild(styleEl);
    }

    // 监听骰子掷出事件，通知外层
    const handler = (e: Event) => {
      if (!onDiceRolled) return;
      const custom = e as CustomEvent;
      const payload = custom?.detail?.payload;
      if (payload) onDiceRolled(payload);
    };
    el.addEventListener('anke-dice-rolled', handler as EventListener);

    // 需求4:监听 dice-card 编辑按钮触发的 CustomEvent
    const editHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { blockId: string; payload: DiceBlockPayloadV2 };
      if (detail && onEditDiceBlockRef.current) {
        onEditDiceBlockRef.current(detail.blockId, detail.payload);
      }
    };
    el.addEventListener('dice-edit-request', editHandler as EventListener);

    return () => {
      el.removeEventListener('anke-dice-rolled', handler as EventListener);
      el.removeEventListener('dice-edit-request', editHandler as EventListener);
      detach();
    };
  }, [onDiceRolled]);

  // 挂载折叠块交互（点击选中 + Delete/Backspace 删除）
  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const detach = attachCollapseBlockHandlers(el);
    return () => { detach(); };
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        background: 'var(--bg-editor)',
        border: '1px solid var(--border-color)',
        borderRadius: 6,
        overflow: 'hidden',
      }}
      className={className}
    >
      <EditorToolbar
        editorElRef={divRef}
        savedRangeRef={savedRangeRef}
        onInsertImage={handleInsertImage}
        onInsertDice={onInsertDiceRequest}
        onShowToast={onShowToast}
        onUndo={onUndo ?? handleUndo}
        onRedo={onRedo ?? handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        onShortcutReady={(handlers) => { shortcutHandlersRef.current = handlers; }}
      />
      {/* 滚动容器：普通 div，Android WebView 触摸滚动正常 */}
      <div
        ref={(el) => { scrollRef.current = el; }}
        onTouchStart={handleTouchStartScroll}
        onTouchMove={handleTouchMoveScroll}
        onTouchEnd={handleTouchEndScroll}
        onTouchCancel={handleTouchEndScroll}
        onWheel={handleWheel}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          // v43: background 移至 .anke-editor-scroll CSS 类(用 --bg-editor-margin 作为 padding 留白区域颜色)
          position: 'relative',
        }}
        className="anke-editor-scroll"
      >
        {/* Ctrl+滚轮缩放提示：右上角悬浮，1.5s 后自动消失 */}
        {showZoomHint && (
          <div
            className="absolute top-3 right-3 z-10 px-3 py-1.5 rounded-lg text-sm font-medium pointer-events-none select-none"
            style={{
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            }}
            aria-live="polite"
          >
            {Math.round(zoom * 100)}%
          </div>
        )}
        {/* contenteditable：仅承担编辑职责，不承担滚动 */}
        <div
          ref={(el) => {
            divRef.current = el;
          }}
          contentEditable={editable}
          suppressContentEditableWarning
          onInput={handleInput}
          onCompositionEnd={handleCompositionEnd}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onMouseUp={handleMouseUp}
          onClick={handleClick}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onContextMenu={(e) => {
            e.preventDefault();
            const sel = window.getSelection();
            const hasSelection = !!(sel && !sel.isCollapsed && sel.toString().trim());
            setCtxMenu({ x: e.clientX, y: e.clientY, hasSelection });
          }}
          className="anke-editor-content"
          style={{
            minHeight: '100%',
            padding: '24px 32px',
            outline: 'none',
            cursor: editable ? 'text' : 'default',
            zoom: zoom, // Ctrl+滚轮缩放（Chrome/Electron 原生支持）
            ...(style || {}),
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
                  // fallback：execCommand
                  document.execCommand('copy');
                }
                setCtxMenu(null);
              },
            },
            {
              label: '粘贴',
              onClick: async () => {
                const el = divRef.current;
                if (el) el.focus();
                try {
                  // 优先尝试带 HTML 格式粘贴（粗体、颜色、链接等）
                  if (navigator.clipboard?.read) {
                    try {
                      const items = await navigator.clipboard.read();
                      for (const item of items) {
                        if (item.types.includes('text/html')) {
                          const blob = await item.getType('text/html');
                          const html = await blob.text();
                          if (html) {
                            document.execCommand('insertHTML', false, html);
                            setCtxMenu(null);
                            return;
                          }
                        }
                      }
                    } catch {
                      // 用户拒绝授权 / 浏览器不支持 → fallback 到纯文本
                    }
                  }
                  // fallback：纯文本
                  const text = await navigator.clipboard.readText();
                  if (text) {
                    const ok = document.execCommand('insertText', false, text);
                    if (!ok && el) {
                      // 兜底：直接插入到光标
                      const sel = window.getSelection();
                      if (sel && sel.rangeCount) {
                        sel.getRangeAt(0).insertNode(document.createTextNode(text));
                        sel.collapseToEnd();
                        handleInput();
                      }
                    }
                  }
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
                  document.execCommand('delete');
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
                const el = divRef.current;
                if (el) el.focus();
                onSearchOpen?.();
              },
            },
          ] as ContextMenuItemConfig[]}
        />
      )}
    </div>
  );
}

// React.memo 包裹：避免父组件重渲染时（如 sectionStats 更新）触发编辑器不必要重渲染
// 注意：父组件传入的回调 props 应保持引用稳定（useCallback），否则 memo 会失效
export const RichTextEditor = React.memo(RichTextEditorInner);
