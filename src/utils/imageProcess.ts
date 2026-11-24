export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';

export interface TargetSize {
  width: number;
  height: number;
}

/**
 * 计算目标尺寸。
 * - keepRatio=true：优先用宽度，宽度缺失时用高度，等比推导另一边
 * - keepRatio=false：宽高各自独立，缺失的一边沿用原尺寸
 */
export function computeTargetSize(
  srcWidth: number,
  srcHeight: number,
  targetWidth?: number,
  targetHeight?: number,
  keepRatio = true,
): TargetSize {
  const sw = Math.max(1, Math.round(srcWidth || 1));
  const sh = Math.max(1, Math.round(srcHeight || 1));
  const tw = targetWidth && targetWidth > 0 ? Math.round(targetWidth) : undefined;
  const th = targetHeight && targetHeight > 0 ? Math.round(targetHeight) : undefined;

  if (!keepRatio) {
    return {
      width: Math.max(1, tw ?? sw),
      height: Math.max(1, th ?? sh),
    };
  }
  if (tw) {
    return { width: tw, height: Math.max(1, Math.round((tw * sh) / sw)) };
  }
  if (th) {
    return { width: Math.max(1, Math.round((th * sw) / sh)), height: th };
  }
  return { width: sw, height: sh };
}

/** 输出格式 → MIME */
export function mimeForFormat(format: ImageOutputFormat): string {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  return 'image/png';
}

/** 输出格式 → 文件扩展名（jpeg 用 jpg，符合常见习惯） */
export function extForFormat(format: ImageOutputFormat): string {
  if (format === 'jpeg') return 'jpg';
  return format;
}

/** MIME → 输出格式（未知格式按 PNG 处理，保证支持透明通道） */
export function formatForMime(mime: string | null | undefined): ImageOutputFormat {
  const value = (mime ?? '').toLowerCase();
  if (value.includes('jpeg') || value.includes('jpg')) return 'jpeg';
  if (value.includes('webp')) return 'webp';
  return 'png';
}

/** 从文件名 / URL 猜测 MIME（用于「保持原格式」） */
export function guessMimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // 远程图片需要 CORS 才能导出 canvas；同源/本地无需设置
    if (/^https?:\/\//i.test(src)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('图片编码失败'))),
      mimeType,
      quality,
    );
  });
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('读取图片数据失败'));
    reader.readAsDataURL(blob);
  });
}

export interface RenderImageOptions {
  src: string;
  width: number;
  height: number;
  format: ImageOutputFormat;
  /** 0–1，仅 jpeg/webp 生效 */
  quality?: number;
}

/** 加载图片 → 绘制到 canvas → 输出指定格式的 Blob */
export async function renderProcessedImage(options: RenderImageOptions): Promise<Blob> {
  const img = await loadImageElement(options.src);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(options.width));
  canvas.height = Math.max(1, Math.round(options.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前环境不支持 canvas');
  // JPEG 不支持透明，先铺白底避免黑边
  if (options.format === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvasToBlob(canvas, mimeForFormat(options.format), options.quality);
}
