import React, { useRef, useEffect } from 'react';
import { EditorToolbar } from './EditorToolbar';
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
} from './contenteditableUtils';
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
}: RichTextEditorProps) {
  const divRef = useRef<HTMLElement | null>(null);
  const lastContentRef = useRef<string>('');
  const savedRangeRef = useRef<Range | null>(null);

  // 持续保存编辑器内的光标位置（工具栏按钮点击后编辑器失焦时恢复用）
  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const r = sel.getRangeAt(0);
      if (el.contains(r.startContainer)) {
        savedRangeRef.current = r.cloneRange();
      }
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  // content 变化 -> 同步写入 div.innerHTML（切节加载）
  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    const safeContent: string =
      content == null || content === '' ? '' : content;
    if (el.innerHTML !== safeContent) {
      el.innerHTML = safeContent;
      lastContentRef.current = safeContent;
    }
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
    
    // Ctrl+Z 撤销 - 确保编辑器聚焦后执行原生操作
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      el.focus();
      document.execCommand('undo', false);
      return;
    }
    
    // Ctrl+Y / Ctrl+Shift+Z 重做
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      el.focus();
      document.execCommand('redo', false);
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
      />
      <div
        ref={(el) => {
          divRef.current = el;
        }}
        contentEditable={editable}
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="anke-editor-content"
        style={{
          flex: 1,
          minHeight: 0,
          padding: '24px 32px',
          overflowY: 'auto',
          background: 'var(--bg-editor)',
          outline: 'none',
          cursor: 'text',
          ...(style || {}),
        }}
      />
    </div>
  );
}
