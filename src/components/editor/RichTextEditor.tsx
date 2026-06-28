import React, { useRef, useEffect, useState } from 'react';
import { EditorToolbar } from './EditorToolbar';

import { ContextMenu, type ContextMenuItemConfig } from '../common/ContextMenu';
import {
  insertImageBlock,
  attachImageBlockHandlers,
  insertDiceCard,
  attachDiceCardHandlers,
  scrollToDiceCard,
  getSelectedImageBlock,
  setImageBlockSize,
  updateSelectedImage,
  dispatchInput,
  attachCollapseBlockHandlers,
  getCurrentStyles,
  applyActiveStylesToInsertion,
  setLastEditorRange,
} from './contenteditableUtils';
import { useEditorStore } from '../../store/editorStore';
import { useEditorHistoryStore } from '../../store/editorHistoryStore';
import { useToastStore } from '../../store/toastStore';
import type { DiceBlockPayloadV2 } from '../../types';

interface RichTextEditorProps {
  content: string | null | undefined;
  onChangeContent: (htmlStr: string) => void;
  onInsertDiceRequest: () => void;
  onDiceRolled?: (payload: any) => void;
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
  focus: () => void;
  getJSON: () => Record<string, unknown>;
  scrollToDiceCard: (payloadSnapshot: string) => boolean;
  setSelectedImageSize: (size: string) => void;
  updateSelectedImageSrc: (src: string) => void;
  updateSelectedImageDataSize: (size: string) => void;
}

export function RichTextEditor({
  content,
  onChangeContent,
  onInsertDiceRequest,
  onDiceRolled,
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

  // 持续保存编辑器内的光标位置（工具栏按钮点击后编辑器失焦时恢复用）
  // 同时把光标处的样式同步到 useEditorStore.cursorStyles（供工具栏展示）
  // 注意：不同步到 activeStyles —— activeStyles 是用户主动激活的状态，保留用户意图
  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        // 光标完全没选区（点了别处）→ 清空模块级 range，下次插入会走 fallback
        setLastEditorRange(null);
        return;
      }
      const r = sel.getRangeAt(0);
      if (el.contains(r.startContainer)) {
        const cloned = r.cloneRange();
        savedRangeRef.current = cloned;
        // 同步到模块，供 insertDiceCard/insertImageBlock 等不 focus 的插入函数使用
        setLastEditorRange(cloned.cloneRange());
        // 同步光标处样式到 cursorStyles（仅展示用，不影响新输入）
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
        }
      } else {
        // 光标在 editor 之外（弹窗 / 工具栏）→ 保留旧模块级 range（不更新到 null）
        // 因为接下来可能要在弹窗里编辑然后插入到 editor 的原光标位置
      }
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
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
    }),
    [],
  );

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

  // 拦截 input 事件：把活动样式应用到即将插入的字符上
  // 支持：
  //   - insertText：普通字符输入 + IME 合成结束后的最终文本
  //   - insertReplacementText：替换选中文本（如自动更正）
  // 不处理：
  //   - insertCompositionText：IME 合成中（让浏览器原生处理，避免干扰中文输入法）
  //   - insertFromPaste：粘贴保持原内容，不被 activeStyles 覆盖
  const handleBeforeInput = (e: React.FormEvent<HTMLDivElement>) => {
    const ev = e.nativeEvent as InputEvent;
    const SUPPORTED_TYPES = new Set(['insertText', 'insertReplacementText']);
    if (!SUPPORTED_TYPES.has(ev.inputType) || !ev.data) return;
    const el = divRef.current;
    if (!el) return;
    const active = useEditorStore.getState().activeStyles;
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
    if (!hasStyle) return;
    // 只在光标折叠且选区内无文本时接管
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed) return;
    e.preventDefault();
    if (applyActiveStylesToInsertion(el, active, ev.data)) {
      // 触发 input 事件让 onChangeContent 保存
      handleInput();
    }
  };

  const handleKeyUp = () => {
    const el = divRef.current;
    if (!el) return;
    const cur = getCurrentStyles(el);
    useEditorStore.setState({ activeStyles: cur });
  };
  const handleMouseUp = () => {
    const el = divRef.current;
    if (!el) return;
    const cur = getCurrentStyles(el);
    useEditorStore.setState({ activeStyles: cur });
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
    
    // 代码块内 Shift+Enter 换行
    if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        const codeBlock = (container as HTMLElement).closest('.code-block');
        if (codeBlock) {
          e.preventDefault();
          document.execCommand('insertHTML', false, '\n');
          return;
        }
      }
    }

    // 代码块内 Enter（非 Shift）也换行，避免创建新段落
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        const codeBlock = (container as HTMLElement).closest('.code-block, pre');
        if (codeBlock) {
          e.preventDefault();
          document.execCommand('insertHTML', false, '<br>');
          return;
        }
      }
    }
    
    // Ctrl+F 打开节内搜索
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      onSearchOpen?.();
      return;
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
            // 让浏览器继续处理剩余文本的删除
            // 不 preventDefault，让原生删除执行
            dispatchInput(editorEl);
          }
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
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = divRef.current;
    if (!el) return;
    const target = e.target as HTMLElement;
    
    // 如果点击的是 contentEditable="false" 的子元素（图片块、骰子卡片等），
    // 不阻止冒泡，让外层编辑器区域处理焦点保持
    // 注意：不要调用 e.stopPropagation() 以免父级 focus 逻辑被打断
    
    // 确保编辑器获得焦点（保底）
    try {
      el.focus();
    } catch {
      /* ignore */
    }
  };

  // 选中内容(含图片/骰子)都可以被拖动。原子块自身就是 draggable 的，
  // 原生 HTML5 拖拽可以把它们整体移动。
  // 我们只需确保：
  // - 原子块的数据类型被选中后可以作为整体被拖动
  // - 普通文本选中后也可以被拖动
  // 不再对拖拽做任何 preventDefault，完全委托给浏览器原生行为
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // 如果拖动起点在 .dice-card 内的 .dice-roll 按钮或链接，跳过
    if (target.closest && target.closest('[data-role="roll"]')) {
      return;
    }
    const atomicBlock = target.closest('[data-type="image-block"],[data-type="dice-card"],[data-type="collapse-block"]') as HTMLElement | null;
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
            node.setAttribute('draggable', 'true');
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
                node.setAttribute('draggable', 'true');
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

    return () => {
      el.removeEventListener('anke-dice-rolled', handler as EventListener);
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
      />
      {/* 滚动容器：普通 div，Android WebView 触摸滚动正常 */}
      <div
        ref={(el) => { scrollRef.current = el; }}
        onTouchStart={handleTouchStartScroll}
        onTouchMove={handleTouchMoveScroll}
        onTouchEnd={handleTouchEndScroll}
        onTouchCancel={handleTouchEndScroll}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          background: 'var(--bg-editor)',
        }}
        className="anke-editor-scroll"
      >
        {/* contenteditable：仅承担编辑职责，不承担滚动 */}
        <div
          ref={(el) => {
            divRef.current = el;
          }}
          contentEditable={editable}
          suppressContentEditableWarning
          onInput={handleInput}
          onBeforeInput={handleBeforeInput}
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
            cursor: 'text',
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
                try {
                  const text = await navigator.clipboard.readText();
                  if (!text) {
                    setCtxMenu(null);
                    return;
                  }
                  const el = divRef.current;
                  if (!el) return;
                  el.focus();
                  const ok = document.execCommand('insertText', false, text);
                  if (!ok) {
                    // fallback：直接插入到光标
                    const sel = window.getSelection();
                    if (sel && sel.rangeCount) {
                      sel.getRangeAt(0).insertNode(document.createTextNode(text));
                      sel.collapseToEnd();
                      handleInput();
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
