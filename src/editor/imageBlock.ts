// contenteditable 富文本工具集 — 图片块 image-block
// 原内容来自 src/components/editor/contenteditableUtils.ts（机械拆分，无逻辑改动）

import { NGA_IMAGE_SIZES, NGA_DEFAULT_IMAGE_SIZE } from '../types';
import {
  getInsertionPoint,
  setLastEditorRange,
  focusEditor,
  dispatchInput,
} from './selection';
import { pushAtomicHistory, IMAGE_BLOCK_SELECTOR } from './utils';

export function isImageBlock(el: HTMLElement | null | undefined): boolean {
  return !!(el && el.dataset && el.dataset.type === 'image-block');
}

/** 从节点向上查找最近的 image-block 容器（含自身） */
export function findImageBlockAncestor(
  node: Node | null | undefined,
  editor: HTMLElement,
): HTMLElement | null {
  if (!node) return null;
  let cur: Node | null = node;
  while (cur && cur !== editor) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      if (isImageBlock(el)) return el;
    }
    cur = cur.parentNode;
  }
  return null;
}

/** 取消所有图片块的选中态 */
export function clearImageSelection(editor: HTMLElement): void {
  const list = editor.querySelectorAll<HTMLElement>(IMAGE_BLOCK_SELECTOR);
  list.forEach((el) => el.removeAttribute('data-selected'));
}

/** 选中指定图片块（高亮蓝色 outline），返回该元素 */
export function selectImageBlock(
  editor: HTMLElement,
  block: HTMLElement,
): void {
  clearImageSelection(editor);
  block.setAttribute('data-selected', 'true');
}

/** 返回当前选中的图片块（如果有） */
export function getSelectedImageBlock(editor: HTMLElement): HTMLElement | null {
  const list = editor.querySelectorAll<HTMLElement>(IMAGE_BLOCK_SELECTOR);
  for (let i = 0; i < list.length; i++) {
    if (list[i].getAttribute('data-selected') === 'true') return list[i];
  }
  return null;
}

/**
 * v48 Fix 3: 为 img 元素挂载 base64 兜底 error listener
 *
 * 当 img.src 是 local:// 协议且加载失败时，通过 readAsDataUrl IPC
 * 读取文件内容并转为 base64 dataUrl 作为兜底。
 *
 * 提取此函数是为了在 content useEffect 重写 innerHTML 后
 * 重新挂载 error listener（reattachImageErrorHandlers）。
 */
export function attachImageErrorHandler(img: HTMLImageElement, src: string): void {
  let fallbackTried = false;
  img.addEventListener('error', async () => {
    if (src.startsWith('local://') && !fallbackTried) {
      fallbackTried = true;
      try {
        const res = await window.electronAPI?.readAsDataUrl?.(src);
        if (res?.ok && res.dataUrl) {
          img.src = res.dataUrl;
          return; // 重新设置 src 会触发 load/error，无需走下面的错误显示
        }
      } catch {
        // 忽略异常，继续走错误显示
      }
    }
    img.style.minHeight = '60px';
    img.style.background = 'var(--bg-hover, #f0f0f0)';
    img.alt = `图片加载失败: ${src.slice(0, 80)}`;
    if (!img.nextSibling || !(img.nextSibling as HTMLElement).classList?.contains('img-error-hint')) {
      const hint = document.createElement('span');
      hint.className = 'img-error-hint';
      hint.textContent = '[图片无法加载]';
      hint.style.cssText = 'display:block;color:#999;font-size:12px;padding:4px;';
      img.parentNode?.insertBefore(hint, img.nextSibling);
    }
  });
  img.addEventListener('load', () => {
    const hint = img.nextElementSibling;
    if (hint && (hint as HTMLElement).classList?.contains('img-error-hint')) {
      hint.remove();
    }
  });
}

/**
 * v48 Fix 4: 重新挂载所有 img 元素的 error listener
 *
 * 在 content useEffect 重写 innerHTML 后调用，确保章节切换/视图切换后
 * 新创建的 img 元素仍有 base64 兜底能力。
 *
 * 仅对 data-original-src 或 src 以 local:// 开头的 img 挂载，
 * 避免对已成功 base64 兜底的 img（src 是 data:）重复挂载。
 */
export function reattachImageErrorHandlers(editor: HTMLElement): void {
  const imgs = editor.querySelectorAll<HTMLImageElement>('img');
  imgs.forEach((img) => {
    // 优先读 data-original-src（保留原始 local:// URL），降级读 src
    const originalSrc = img.getAttribute('data-original-src') || img.src || '';
    // 只对 local:// 图片挂载（data: base64 图片不需要兜底）
    if (originalSrc.startsWith('local://')) {
      // 用 data-original-src 作为兜底 IPC 参数（而非可能已被污染的 src）
      attachImageErrorHandler(img, originalSrc);
    }
  });
}

/** 在光标位置插入 image-block（NGA 5 档尺寸预设），光标落块后 */
export function insertImageBlock(
  editor: HTMLElement,
  src: string,
  opts?: { size?: string; alt?: string; name?: string },
): HTMLElement | null {
  // 关键：不要先 focusEditor！focus 会把 contenteditable 的 selection 重置到 (0,0)
  // getInsertionPoint 内部会优先用 _lastEditorRange（用户最后在 editor 内的光标）
  const sel = window.getSelection();
  if (!sel) return null;

  const sizeValue = opts?.size ?? NGA_DEFAULT_IMAGE_SIZE;
  const sizeInfo = NGA_IMAGE_SIZES.find((s) => s.value === sizeValue) ?? NGA_IMAGE_SIZES[0];

  const range = getInsertionPoint(editor);

  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-type', 'image-block');
  wrapper.setAttribute('data-size', sizeInfo.value);
  wrapper.setAttribute('contenteditable', 'false');
  wrapper.setAttribute('contentEditable', 'false');
  wrapper.setAttribute('draggable', 'true');
  wrapper.setAttribute('tabindex', '-1');
  wrapper.style.display = 'block';
  wrapper.style.margin = '2px 4px';
  wrapper.style.verticalAlign = 'middle';
  wrapper.style.outline = 'none';
  wrapper.style.userSelect = 'auto';
  wrapper.style.cursor = 'grab';

  const img = document.createElement('img');
  img.src = src;
  // v35: 保存原始 src，防止 base64 兜底污染后丢失原始 local:// URL
  img.setAttribute('data-original-src', src);
  // alt 用可读名字，不要用 src（src 可能是 base64 data URL 巨长）
  img.alt = opts?.alt || opts?.name || '本地图片';
  if (opts?.name) img.setAttribute('data-name', opts.name);
  img.style.maxWidth = '100%';
  img.style.height = 'auto';
  img.style.display = 'inline-block';
  img.style.cursor = 'pointer';
  img.style.userSelect = 'auto';
  img.style.pointerEvents = 'none';
  if (sizeInfo.width) img.style.width = `${sizeInfo.width}px`;
  if (sizeInfo.height) img.style.height = `${sizeInfo.height}px`;

  // v24: IPC 兜底 — 与 v23 CompactImageLibraryPanel / ImageLibraryPage 保持一致
  // v48 Fix 3: 提取 error listener 到 attachImageErrorHandler 函数,便于 reattachImageErrorHandlers 复用
  attachImageErrorHandler(img, src);

  wrapper.setAttribute('data-width', sizeInfo.width ? String(sizeInfo.width) : '');
  wrapper.setAttribute('data-height', sizeInfo.height ? String(sizeInfo.height) : '');

  wrapper.appendChild(img);

  range.insertNode(wrapper);

  // 紧跟 wrapper 之后插入 <br> 占位，让用户可以点击空行放下光标
  const placeholder = document.createElement('br');
  wrapper.parentNode?.insertBefore(placeholder, wrapper.nextSibling);

  // 移动光标到 <br> 占位之后；这样连续插入会接在 <br> 之后，
  // 形成 wrapper → <br> → 新块 的结构
  focusEditor(editor);
  const newRange = document.createRange();
  newRange.setStartAfter(placeholder);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
  // 把新的"块后位置"也同步到模块，让下一次插入仍接在后面
  setLastEditorRange(newRange.cloneRange());

  dispatchInput(editor);
  // 原子块插入立即 push 历史（跳过 200ms 防抖，让每次插入可独立撤销）
  pushAtomicHistory(editor.innerHTML);
  return wrapper;
}

/** 获取图片块的当前尺寸 */
export function getImageBlockSize(block: HTMLElement): { width: number; height: number } {
  const img = block.querySelector('img');
  if (!img) return { width: 400, height: 0 };
  const w = parseInt(block.getAttribute('data-width') || '', 10);
  const h = parseInt(block.getAttribute('data-height') || '', 10);
  return {
    width: isNaN(w) ? img.clientWidth || 400 : w,
    height: isNaN(h) ? img.clientHeight || 0 : h,
  };
}

/** 设置图片块的尺寸（按 NGA 预设 size value） */
export function setImageBlockSize(
  editor: HTMLElement,
  block: HTMLElement,
  size: string,
): void {
  const img = block.querySelector('img');
  if (!img) return;
  const sizeInfo = NGA_IMAGE_SIZES.find((s) => s.value === size) ?? NGA_IMAGE_SIZES[0];
  if (sizeInfo.width) img.style.width = `${sizeInfo.width}px`;
  else img.style.width = 'auto';
  if (sizeInfo.height) img.style.height = `${sizeInfo.height}px`;
  else img.style.height = 'auto';
  img.style.maxWidth = '100%';
  block.setAttribute('data-size', sizeInfo.value);
  block.setAttribute('data-width', sizeInfo.width ? String(sizeInfo.width) : '');
  block.setAttribute('data-height', sizeInfo.height ? String(sizeInfo.height) : '');
  dispatchInput(editor);
}

/** 更新选中图片块的 src、data-size 并应用尺寸 */
export function updateSelectedImage(
  editor: HTMLElement,
  block: HTMLElement,
  opts: { src?: string; size?: string },
): void {
  const img = block.querySelector('img');
  if (!img) return;
  if (opts.src !== undefined) {
    img.setAttribute('src', opts.src);
    // v38 修复: 同步更新 data-original-src,保证下次选中读到最新值
    img.setAttribute('data-original-src', opts.src);
  }
  if (opts.size !== undefined) {
    block.setAttribute('data-size', opts.size);
    const sizeInfo = NGA_IMAGE_SIZES.find((s) => s.value === opts.size);
    if (sizeInfo) {
      if (sizeInfo.width) img.style.width = `${sizeInfo.width}px`;
      else img.style.width = 'auto';
      if (sizeInfo.height) img.style.height = `${sizeInfo.height}px`;
      else img.style.height = 'auto';
      img.style.maxWidth = '100%';
      block.setAttribute('data-width', String(sizeInfo.width || ''));
      block.setAttribute('data-height', String(sizeInfo.height || ''));
    }
  }
  dispatchInput(editor);
}

/** 删除指定 image-block，并把光标放在它原来的位置（前面的段落末尾） */
export function removeImageBlock(editor: HTMLElement, block: HTMLElement): void {
  if (!block.parentNode) return;
  const parent = block.parentNode;
  const prev = block.previousSibling;
  parent.removeChild(block);

  // 尽量把光标放到前一个兄弟节点末尾，否则放到 parent 末尾
  const newRange = document.createRange();
  if (prev) {
    try {
      newRange.selectNodeContents(prev);
      newRange.collapse(false);
    } catch {
      newRange.selectNodeContents(editor);
      newRange.collapse(false);
    }
  } else {
    newRange.selectNodeContents(editor);
    newRange.collapse(false);
  }
  const sel = window.getSelection();
  sel?.removeAllRanges();
  focusEditor(editor);
  sel?.addRange(newRange);

  dispatchInput(editor);
  // 原子块删除立即 push 历史（跳过 200ms 防抖，让每次删除可独立撤销）
  pushAtomicHistory(editor.innerHTML);
}

/** 清除图片块上的 resize 手柄和删除按钮 */
function clearImageBlockHandles(block: HTMLElement): void {
  const handles = block.querySelectorAll<HTMLElement>('[data-role="image-handle"], [data-role="image-delete"]');
  handles.forEach((h) => h.remove());
}

/** 清除所有图片块上的手柄 */
function clearAllImageBlockHandles(editor: HTMLElement): void {
  const list = editor.querySelectorAll<HTMLElement>(IMAGE_BLOCK_SELECTOR);
  list.forEach((b) => clearImageBlockHandles(b));
}

/** 在选中的图片块上添加四角手柄和删除按钮 */
function renderImageBlockHandles(
  editor: HTMLElement,
  block: HTMLElement,
): void {
  clearImageBlockHandles(block);
  const img = block.querySelector('img');
  if (!img) return;

  // 图片容器是 block，但 img 本身是 inline-block 居中显示
  // 需要用一个 wrapper 来确定 img 的位置信息
  const wrapper = block;
  wrapper.style.position = 'relative';

  // 创建四角手柄
  const positions: Array<{
    key: string;
    style: Partial<CSSStyleDeclaration>;
    cursor: string;
  }> = [
    { key: 'nw', style: { top: '-6px', left: '-6px' }, cursor: 'nwse-resize' },
    { key: 'ne', style: { top: '-6px', right: '-6px' }, cursor: 'nesw-resize' },
    { key: 'sw', style: { bottom: '-6px', left: '-6px' }, cursor: 'nesw-resize' },
    { key: 'se', style: { bottom: '-6px', right: '-6px' }, cursor: 'nwse-resize' },
  ];

  positions.forEach(({ key, style, cursor }) => {
    const handle = document.createElement('span');
    handle.setAttribute('data-role', 'image-handle');
    handle.setAttribute('data-handle', key);
    handle.contentEditable = 'false';
    Object.assign(handle.style, {
      position: 'absolute',
      width: '12px',
      height: '12px',
      background: 'var(--accent)',
      border: '2px solid var(--text-on-accent)',
      borderRadius: '50%',
      boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
      zIndex: '5',
      cursor: cursor,
      ...style,
    } as CSSStyleDeclaration);

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startImageResize(editor, block, img, key, e.clientX, e.clientY);
    });

    wrapper.appendChild(handle);
  });

  // 删除按钮
  const deleteBtn = document.createElement('button');
  deleteBtn.setAttribute('data-role', 'image-delete');
  deleteBtn.contentEditable = 'false';
  deleteBtn.textContent = '×';
  Object.assign(deleteBtn.style, {
    position: 'absolute',
    top: '-10px',
    right: '-10px',
    width: '24px',
    height: '24px',
    background: 'var(--danger, #ef4444)',
    color: 'var(--text-on-accent, #fff)',
    border: '2px solid var(--text-on-accent, #fff)',
    borderRadius: '50%',
    fontSize: '14px',
    lineHeight: '1',
    fontWeight: '700',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
    zIndex: '6',
    padding: '0',
  } as CSSStyleDeclaration);

  deleteBtn.addEventListener('mousedown', (e) => e.preventDefault());
  deleteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    removeImageBlock(editor, block);
    // 通知外层选中状态取消
    const ev = new CustomEvent('anke-image-deselected', { bubbles: true });
    editor.dispatchEvent(ev);
  });

  wrapper.appendChild(deleteBtn);
}

/** 计算图片的宽高比（优先从图片本身读取） */
function getImageAspectRatio(img: HTMLImageElement): number {
  const datasetRatio = parseFloat(img.parentElement?.getAttribute('data-ratio') || '');
  if (!isNaN(datasetRatio) && datasetRatio > 0) return datasetRatio;
  if (img.naturalWidth && img.naturalHeight) {
    const r = img.naturalWidth / img.naturalHeight;
    if (img.parentElement) img.parentElement.setAttribute('data-ratio', String(r));
    return r;
  }
  if (img.width && img.height) {
    return img.width / img.height;
  }
  return 1.5; // 默认值
}

/** 开始拖拽调整图片大小 */
function startImageResize(
  editor: HTMLElement,
  block: HTMLElement,
  img: HTMLImageElement,
  handle: string,
  startX: number,
  startY: number,
): void {
  const startWidth = img.clientWidth || 400;
  const aspectRatio = getImageAspectRatio(img);

  // 如果图片还在加载中，等待一下并存储原始尺寸
  if (!img.naturalWidth || !img.naturalHeight) {
    img.onload = () => {
      block.setAttribute('data-ratio', String(img.naturalWidth / img.naturalHeight));
    };
  }

  let latestWidth = startWidth;

  const onMove = (ev: MouseEvent) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;

    // 根据手柄位置决定放大/缩小方向
    // nw: 左上 → 右/下拖动为缩小
    // ne: 右上 → 左/下拖动为缩小
    // sw: 左下 → 右/上拖动为缩小
    // se: 右下 → 右/下拖动为放大
    let deltaW = 0;
    if (handle === 'se' || handle === 'ne') deltaW = dx;
    else deltaW = -dx;

    // 结合 dy 计算（保持宽高比，取绝对值较大的维度）
    const absByH = Math.abs(dy) * aspectRatio;
    const absByW = Math.abs(dx);
    const effectiveDelta = absByH > absByW ? (dy > 0 ? absByH : -absByH) : deltaW;

    let newWidth = startWidth + effectiveDelta;
    newWidth = Math.max(80, Math.min(2000, newWidth));
    latestWidth = newWidth;

    img.style.width = `${Math.round(newWidth)}px`;
    img.style.height = 'auto';
    block.setAttribute('data-width', String(Math.round(newWidth)));
  };

  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);

    const newHeight = Math.round(latestWidth / aspectRatio);
    block.setAttribute('data-height', String(newHeight));
    img.style.height = `${newHeight}px`;

    // 通知外层尺寸变化
    const ev = new CustomEvent('anke-image-size-changed', {
      bubbles: true,
      detail: { width: Math.round(latestWidth), height: newHeight },
    });
    editor.dispatchEvent(ev);

    dispatchInput(editor);
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

/** 给编辑器挂载图片块的交互：点击选中 + 拖拽手柄 + Delete/Backspace 删除 */
export function attachImageBlockHandlers(
  editor: HTMLElement,
): () => void {
  const onMouseDown = (e: MouseEvent) => {
    const target = e.target as Node | null;
    if (!target || !editor.contains(target)) return;

    // 如果点在手柄或删除按钮上，不做选中处理（由它们自己的事件处理）
    const targetEl = target as HTMLElement;
    if (targetEl.dataset?.role === 'image-handle' || targetEl.dataset?.role === 'image-delete') {
      return;
    }

    const block = findImageBlockAncestor(target, editor);
    if (block) {
      // 不调用 e.preventDefault()！否则浏览器不会触发 dragstart。
      // 只设置自定义选中态和"忽略文本选区"（通过 selectstart 事件）
      selectImageBlock(editor, block);
      renderImageBlockHandles(editor, block);
      const size = getImageBlockSize(block);
      const img = block.querySelector('img');
      // v38 修复: 优先读取 data-original-src,防止 base64 兜底污染 src 后 URL 输入框显示空或 base64
      // 与 ngaHtmlToBBCode.ts 中的读取模式保持一致
      const src = img?.getAttribute('data-original-src') || img?.getAttribute('src') || '';
      const dataSize = block.getAttribute('data-size') || 'original';
      const ev = new CustomEvent('anke-image-selected', {
        bubbles: true,
        detail: { width: size.width, height: size.height, src, dataSize },
      });
      editor.dispatchEvent(ev);
      return;
    }

    // 点击其他地方：清除图片选中态
    clearImageSelection(editor);
    clearAllImageBlockHandles(editor);
    const ev = new CustomEvent('anke-image-deselected', { bubbles: true });
    editor.dispatchEvent(ev);
  };

  // 用 selectstart 阻止文本选区出现在图片块内（不阻止 dragstart）
  const onSelectStart = (e: Event) => {
    const target = e.target as Node | null;
    if (!target || !editor.contains(target)) return;
    if (findImageBlockAncestor(target, editor)) {
      e.preventDefault();
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const selected = getSelectedImageBlock(editor);
    if (selected) {
      e.preventDefault();
      removeImageBlock(editor, selected);
      const ev = new CustomEvent('anke-image-deselected', { bubbles: true });
      editor.dispatchEvent(ev);
      return;
    }
    // 若光标刚好贴在某个 image-block 旁边（前后），按 Backspace/Delete 也删
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return;
    const container = range.startContainer;
    const offset = range.startOffset;

    if (container.nodeType === Node.ELEMENT_NODE) {
      const el = container as HTMLElement;
      if (e.key === 'Backspace') {
        const target = el.childNodes[offset - 1] as HTMLElement | undefined;
        if (target && target.nodeType === Node.ELEMENT_NODE && isImageBlock(target)) {
          e.preventDefault();
          removeImageBlock(editor, target);
          return;
        }
      } else {
        const target = el.childNodes[offset] as HTMLElement | undefined;
        if (target && target.nodeType === Node.ELEMENT_NODE && isImageBlock(target)) {
          e.preventDefault();
          removeImageBlock(editor, target);
          return;
        }
      }
    }

    if (container.nodeType === Node.TEXT_NODE) {
      const parent = container.parentNode as HTMLElement | null;
      if (!parent) return;
      const idx = Array.prototype.indexOf.call(parent.childNodes, container);
      if (e.key === 'Backspace' && offset === 0) {
        const prev = parent.childNodes[idx - 1] as HTMLElement | undefined;
        if (prev && prev.nodeType === Node.ELEMENT_NODE && isImageBlock(prev)) {
          e.preventDefault();
          removeImageBlock(editor, prev);
          return;
        }
      } else if (
        e.key === 'Delete' &&
        offset === (container.textContent?.length ?? 0)
      ) {
        const next = parent.childNodes[idx + 1] as HTMLElement | undefined;
        if (next && next.nodeType === Node.ELEMENT_NODE && isImageBlock(next)) {
          e.preventDefault();
          removeImageBlock(editor, next);
          return;
        }
      }
    }
  };

  editor.addEventListener('mousedown', onMouseDown, true);
  editor.addEventListener('selectstart', onSelectStart, true);
  editor.addEventListener('keydown', onKeyDown, true);
  return () => {
    editor.removeEventListener('mousedown', onMouseDown, true);
    editor.removeEventListener('selectstart', onSelectStart, true);
    editor.removeEventListener('keydown', onKeyDown, true);
  };
}

// ------------------------------------------------------------
// 图片块（带尺寸下拉）：复用现有 insertImageBlock，再加 data-size
// ------------------------------------------------------------

/** 插入带尺寸的 image-block（NGA 5 档预设 size value） */
export function insertImageBlockWithSize(
  editor: HTMLElement,
  src: string,
  size: typeof NGA_IMAGE_SIZES[number]['value'],
): HTMLElement | null {
  return insertImageBlock(editor, src, { size });
}

/** 设置当前选中（或光标紧邻）的 image-block 的对齐方式
 *  align: 'left' | 'center' | 'right'
 */
export function setImageBlockAlign(editor: HTMLElement, align: 'left' | 'center' | 'right'): void {
  focusEditor(editor);
  const block = findSelectedImageBlock(editor);
  if (!block) return;
  // 找到或创建一个包含该 block 的块级父容器来控制对齐
  let blockParent = block.parentElement;
  // 若父容器是编辑器本身，则创建一个 <p> 将 block 包起来
  if (blockParent === editor) {
    const p = document.createElement('p');
    block.parentNode?.insertBefore(p, block);
    p.appendChild(block);
    blockParent = p;
  }
  if (blockParent && blockParent !== editor) {
    blockParent.style.textAlign = align;
  }
  dispatchInput(editor);
}

/** 在编辑器内查找当前选区或光标邻近的 image-block */
function findSelectedImageBlock(editor: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel) return null;

  const closestFrom = (node: Node | null): HTMLElement | null => {
    if (!node) return null;
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.getAttribute?.('data-type') === 'image-block') return el;
    }
    let cur: Node | null = node;
    while (cur && cur !== editor) {
      if (cur.nodeType === Node.ELEMENT_NODE) {
        const el = cur as HTMLElement;
        if (el.getAttribute?.('data-type') === 'image-block') return el;
      }
      cur = cur.parentNode;
    }
    return null;
  };

  // 1) 从选区锚点/焦点向上冒泡查找
  const anchorHit = closestFrom(sel.anchorNode);
  if (anchorHit) return anchorHit;
  if (sel.focusNode && sel.focusNode !== sel.anchorNode) {
    const focusHit = closestFrom(sel.focusNode);
    if (focusHit) return focusHit;
  }

  // 2) 选区非折叠时：扫描 range 共同祖先内的子节点，找 image-block
  if (sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    if (!range.collapsed) {
      const root = range.commonAncestorContainer;
      const container =
        root.nodeType === Node.ELEMENT_NODE ? (root as HTMLElement) : (root.parentElement ?? editor);
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, {
        acceptNode(n) {
          if ((n as HTMLElement).getAttribute?.('data-type') === 'image-block') {
            return NodeFilter.FILTER_ACCEPT;
          }
          // 忽略嵌套的 contenteditable 子编辑器
          if ((n as HTMLElement).getAttribute?.('contenteditable') === 'true' && n !== editor) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_SKIP;
        },
      });
      let node: Node | null = walker.nextNode();
      while (node) {
        if (range.intersectsNode(node)) return node as HTMLElement;
        node = walker.nextNode();
      }
    } else {
      // 3) 光标紧邻一个 image-block（前/后兄弟节点）
      const start = range.startContainer;
      const startOffset = range.startOffset;
      if (start.nodeType === Node.ELEMENT_NODE) {
        const el = start as HTMLElement;
        const children = el.children;
        // 检查光标位置的前后孩子是否是 image-block
        const prev = children[startOffset - 1] as HTMLElement | undefined;
        const next = children[startOffset] as HTMLElement | undefined;
        if (prev && prev.getAttribute?.('data-type') === 'image-block') return prev;
        if (next && next.getAttribute?.('data-type') === 'image-block') return next;
      } else if (start.nodeType === Node.TEXT_NODE) {
        // 文本节点紧贴其 parent 的前后兄弟也可
        const parent = start.parentElement;
        if (parent) {
          const pPrev = parent.previousElementSibling as HTMLElement | null;
          const pNext = parent.nextElementSibling as HTMLElement | null;
          if (pPrev && pPrev.getAttribute?.('data-type') === 'image-block') return pPrev;
          if (pNext && pNext.getAttribute?.('data-type') === 'image-block') return pNext;
        }
      }
    }
  }

  return null;
}
