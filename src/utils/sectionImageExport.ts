// ============================================================
// 节内容导出为图片（从 EditorPage 抽出）
// 策略：
//  1) 单图高度 ≤ MAX_IMAGE_HEIGHT：直接清晰导出（skipAutoScale）
//  2) 超过：按顶级子节点拆分为多张图
//  3) 字数 > MAX_IMAGE_CHARS * 3：拒绝导出并给出中文提示
// 只负责 DOM → PNG → 下载，提示文案以结果对象返回，由页面统一 toast。
// ============================================================

import { toPng } from 'html-to-image';

const MAX_IMAGE_HEIGHT = 8000;
const MAX_IMAGE_CHARS = 10000;
const CHUNK_DOWNLOAD_INTERVAL = 200;

export interface SectionImageExportResult {
  type: 'success' | 'info' | 'error';
  message: string;
  duration?: number;
}

/** 为空内容快速失败（页面可先自行判断，也可交给导出函数） */
function isEmptyHtml(el: HTMLElement): boolean {
  const html = el.innerHTML;
  return !html.trim() || html === '<br>';
}

function classifyError(
  err: unknown,
  ctx?: { totalChars?: number },
): string {
  const msg = (err as any)?.message || String(err) || '';
  const lower = msg.toLowerCase();
  // 0. 内容过长（用户主动提示的场景）
  if (msg.includes('内容过长') || msg.includes('字数超限')) {
    return `导出失败：内容过长\n\n当前字数：${ctx?.totalChars ?? '?'} 字\n最大支持：${MAX_IMAGE_CHARS} 字\n\n建议：\n1) 把这一节拆分成多个小节\n2) 删除冗余内容\n3) 简化复杂样式（如移除 backdrop-filter）`;
  }
  // 1. Canvas 尺寸超限
  if (
    (lower.includes('canvas') &&
      (lower.includes('size') || lower.includes('limit') || lower.includes('exceed'))) ||
    lower.includes('maximum') ||
    lower.includes('too large')
  ) {
    return '导出失败：画布尺寸超限\n\n当前内容过长导致画布超过浏览器上限（通常 16384 像素）。\n\n建议：\n1) 把这一节拆分成多个小节\n2) 减少大尺寸图片（>2000px 宽）\n3) 移除复杂样式（如 backdrop-filter）';
  }
  // 2. 跨域 / CORS 图片加载失败
  if (lower.includes('tainted') || lower.includes('cross-origin') || lower.includes('cors')) {
    return '导出失败：图片跨域加载失败\n\n编辑器中包含跨域图片，被浏览器安全策略阻止。\n\n请：\n1) 把图片下载到本地后重新插入\n2) 或使用同源图片';
  }
  // 3. 不支持的颜色函数（oklch/lab）
  if (lower.includes('oklch') || lower.includes('oklab') || lower.includes('color(')) {
    return '导出失败：样式不兼容\n\n检测到不兼容的颜色函数（如 oklch / lab）。\n\n建议：把颜色改为传统 #hex 或 rgb() 格式';
  }
  // 4. 节点过多 / 内存不足
  if (lower.includes('node') || lower.includes('too many') || lower.includes('memory')) {
    return '导出失败：内容过大\n\nDOM 节点过多或内存不足。\n\n建议：\n1) 把这一节拆分成多个小节\n2) 减少嵌入的骰子卡 / 图片块\n3) 删除过时的隐藏内容';
  }
  // 5. 字体加载失败
  if (lower.includes('font') || lower.includes('typeface')) {
    return '导出失败：字体加载失败\n\n自定义字体未加载完。\n\n建议：等待字体加载完成后再试';
  }
  // 6. CSP / 安全策略
  if (lower.includes('unsafe') || lower.includes('security') || lower.includes('unsafe-eval')) {
    return '导出失败：样式触发安全策略\n\n包含 unsafe-eval 或其他被 CSP 拦截的样式。';
  }
  // 7. SVG / XML 转换失败
  if (lower.includes('svg') || lower.includes('xml')) {
    return '导出失败：SVG 转换失败\n\n包含复杂的 SVG 内容无法转为 PNG。';
  }
  // 8. 通用失败：把原始消息带出来
  if (msg) {
    return `导出失败：${msg}\n\n可能原因：\n1) 内容过长（>${MAX_IMAGE_CHARS} 字）\n2) 复杂样式（filter / backdrop-filter）\n3) 跨域图片\n\n建议：拆分节、简化样式、移除跨域图片`;
  }
  return '导出失败：未知错误\n\n可能是内容过长、样式不兼容或浏览器内存不足。\n\n建议：\n1) 把这一节拆分成多个小节\n2) 简化样式（去掉 filter、backdrop-filter）\n3) 移除跨域图片';
}

/** 按顶级子节点拆分内容为多组（不修改原 DOM） */
function splitIntoChunks(el: HTMLElement, maxHeight: number): HTMLElement[] {
  const children = Array.from(el.children) as HTMLElement[];
  if (children.length === 0) return [el];

  const chunks: HTMLElement[] = [];
  let currentContainer: HTMLElement | null = null;
  let currentHeight = 0;

  for (const child of children) {
    const childHeight = child.getBoundingClientRect().height;
    if (currentHeight + childHeight > maxHeight && currentContainer) {
      chunks.push(currentContainer);
      currentContainer = null;
      currentHeight = 0;
    }
    if (!currentContainer) {
      currentContainer = createOffscreenContainer(el);
    }
    const clone = child.cloneNode(true) as HTMLElement;
    currentContainer.appendChild(clone);
    currentHeight += childHeight;
  }
  if (currentContainer) chunks.push(currentContainer);

  return chunks;
}

/** 创建 off-screen 容器（与原容器样式一致，避免编辑区样式影响） */
function createOffscreenContainer(template: HTMLElement): HTMLElement {
  const div = document.createElement('div');
  const cs = getComputedStyle(template);
  div.style.cssText = `
    position: fixed;
    top: -99999px;
    left: -99999px;
    width: ${template.clientWidth}px;
    background: ${cs.backgroundColor};
    color: ${cs.color};
    font-family: ${cs.fontFamily};
    font-size: ${cs.fontSize};
    line-height: ${cs.lineHeight};
    padding: ${cs.padding};
    box-sizing: border-box;
  `;
  document.body.appendChild(div);
  return div;
}

/** 触发浏览器下载图片 */
function downloadImage(dataUrl: string, filename: string) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

/**
 * 将编辑器节点导出为一张或多张 PNG。
 * 调用方负责设置/清除「导出中」UI 状态。
 */
export async function exportSectionAsImages(
  el: HTMLElement,
  opts: { title: string },
): Promise<SectionImageExportResult> {
  if (isEmptyHtml(el)) {
    return { type: 'info', message: '当前节没有内容可导出' };
  }

  const totalHeight = el.scrollHeight;
  const totalChars = (el.textContent || '').length;

  // 临时移除 zoom（避免用户缩放影响清晰度），finally 恢复
  const originalZoom = el.style.zoom;
  el.style.zoom = '1';

  try {
    if (totalHeight <= MAX_IMAGE_HEIGHT) {
      const dataUrl = await toPng(el, {
        backgroundColor: getComputedStyle(el).backgroundColor || '#ffffff',
        pixelRatio: 2,
        skipAutoScale: true,
      });
      downloadImage(dataUrl, `${opts.title}.png`);
      return { type: 'success', message: '已导出为图片' };
    }

    // 字数严重超限（即使拆分也太多），直接拒绝并给出最大长度
    if (totalChars > MAX_IMAGE_CHARS * 3) {
      return {
        type: 'error',
        duration: 10000,
        message: `内容过长（${totalChars} 字）。\n\n最大支持约 ${MAX_IMAGE_CHARS} 字，超出后图片可能不清晰。\n\n建议：\n1) 把这一节拆分成多个小节\n2) 删除冗余内容\n3) 简化复杂样式（如移除 backdrop-filter）`,
      };
    }

    const chunks = splitIntoChunks(el, MAX_IMAGE_HEIGHT);
    if (chunks.length === 0) {
      return { type: 'error', message: '无法拆分内容' };
    }

    // 过大的子节点（大图片 / 长无断行文本）无法保证清晰度
    const oversizedChildren = Array.from(el.children).filter(
      (c) => c.getBoundingClientRect().height > MAX_IMAGE_HEIGHT,
    );
    if (oversizedChildren.length > 0) {
      return {
        type: 'error',
        duration: 10000,
        message: `内容中存在过大的子节点（如大图片、长无断行文本），无法在保证清晰度前提下导出。\n\n最大单图高度：${MAX_IMAGE_HEIGHT}px。请考虑：\n1) 把大图缩小到合理尺寸\n2) 给长无断行文本加上空格或换行`,
      };
    }

    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < chunks.length; i++) {
      try {
        const dataUrl = await toPng(chunks[i], {
          backgroundColor: getComputedStyle(chunks[i]).backgroundColor || '#ffffff',
          pixelRatio: 2,
          skipAutoScale: true,
        });
        downloadImage(dataUrl, `${opts.title}-part${i + 1}.png`);
        successCount++;
      } catch (chunkErr) {
        console.error(`[exportImage] chunk ${i + 1} 失败:`, chunkErr);
        failCount++;
      } finally {
        try {
          chunks[i].remove();
        } catch {
          // 容器可能已被移除
        }
      }
      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, CHUNK_DOWNLOAD_INTERVAL));
      }
    }

    if (successCount > 0 && failCount === 0) {
      return {
        type: 'success',
        message:
          chunks.length === 1 ? '已导出为图片' : `已拆分为 ${chunks.length} 张图片导出完成`,
      };
    }
    if (successCount > 0) {
      return {
        type: 'info',
        duration: 8000,
        message: `部分导出成功：${successCount} 张成功，${failCount} 张失败`,
      };
    }
    return {
      type: 'error',
      duration: 8000,
      message: classifyError(new Error('所有分块都导出失败'), { totalChars }),
    };
  } catch (e) {
    console.error('[exportImage] 完整错误对象:', e);
    return {
      type: 'error',
      duration: 8000,
      message: classifyError(e, { totalChars }),
    };
  } finally {
    el.style.zoom = originalZoom;
  }
}
