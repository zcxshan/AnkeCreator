// ============================================================
// 安科编辑器 —— 图片块 DOM 兜底（Tiptap 内核）
//
// 从旧 contenteditable 模块 imageBlock.ts 机械搬迁 attachImageErrorHandler，
// 函数体与语义逐字保留。
// ============================================================

/**
 * v48 Fix 3: 为 img 元素挂载 base64 兜底 error listener
 *
 * 当 img.src 是 local:// 协议且加载失败时，通过 readAsDataUrl IPC
 * 读取文件内容并转为 base64 dataUrl 作为兜底。
 *
 * 提取此函数是为了在 content 重写 innerHTML 后重新挂载 error listener。
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
    img.style.background = 'var(--bg-hover)';
    img.alt = `图片加载失败: ${src.slice(0, 80)}`;
    if (!img.nextSibling || !(img.nextSibling as HTMLElement).classList?.contains('img-error-hint')) {
      const hint = document.createElement('span');
      hint.className = 'img-error-hint';
      hint.textContent = '[图片无法加载]';
      hint.style.cssText = 'display:block;color:var(--text-muted);font-size:12px;padding:4px;';
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
