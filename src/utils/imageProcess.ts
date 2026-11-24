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

// ============================================================
// 独立图片处理面板用的变换管线：裁剪 / 旋转翻转 / 尺寸画布
// ============================================================

export type RotateDeg = 0 | 90 | 180 | 270;
export type CanvasFit = 'stretch' | 'contain' | 'cover';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageTransformOptions {
  rotate: RotateDeg;
  flipH: boolean;
  flipV: boolean;
  /** 源图像素坐标；null 表示不裁剪 */
  crop?: CropRect | null;
  /** 目标画布尺寸；不填则沿用裁剪旋转后的尺寸 */
  targetWidth?: number;
  targetHeight?: number;
  /** 目标画布里的适配方式 */
  fit?: CanvasFit;
  /** 画布背景色（contain/cover 留白处填充），'transparent' 表示透明 */
  background?: string;
  format: ImageOutputFormat;
  /** 0–1，仅 jpeg/webp 生效 */
  quality?: number;
}

function normalizeCrop(crop: CropRect | null | undefined, sw: number, sh: number): CropRect {
  if (!crop) return { x: 0, y: 0, width: sw, height: sh };
  const x = Math.min(Math.max(0, Math.round(crop.x)), Math.max(0, sw - 1));
  const y = Math.min(Math.max(0, Math.round(crop.y)), Math.max(0, sh - 1));
  const width = Math.min(Math.max(1, Math.round(crop.width)), sw - x);
  const height = Math.min(Math.max(1, Math.round(crop.height)), sh - y);
  return { x, y, width, height };
}

function rotatedSize(width: number, height: number, rotate: RotateDeg): TargetSize {
  return rotate === 90 || rotate === 270 ? { width: height, height: width } : { width, height };
}

/**
 * 同步绘制变换后的图片到离屏 canvas（预览与导出共用，保证所见即所得）。
 */
export function drawTransformedImage(
  img: HTMLImageElement,
  options: ImageTransformOptions,
): HTMLCanvasElement {
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const crop = normalizeCrop(options.crop, sw, sh);
  const rotated = rotatedSize(crop.width, crop.height, options.rotate);

  const stage = document.createElement('canvas');
  stage.width = Math.max(1, rotated.width);
  stage.height = Math.max(1, rotated.height);
  const sctx = stage.getContext('2d');
  if (!sctx) throw new Error('当前环境不支持 canvas');
  sctx.save();
  sctx.translate(stage.width / 2, stage.height / 2);
  sctx.rotate((options.rotate * Math.PI) / 180);
  sctx.scale(options.flipH ? -1 : 1, options.flipV ? -1 : 1);
  sctx.drawImage(
    img,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    -crop.width / 2,
    -crop.height / 2,
    crop.width,
    crop.height,
  );
  sctx.restore();

  const tw = options.targetWidth && options.targetWidth > 0 ? Math.round(options.targetWidth) : stage.width;
  const th = options.targetHeight && options.targetHeight > 0 ? Math.round(options.targetHeight) : stage.height;
  const out = document.createElement('canvas');
  out.width = Math.max(1, tw);
  out.height = Math.max(1, th);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('当前环境不支持 canvas');

  const bg = options.background ?? 'transparent';
  if (bg && bg !== 'transparent') {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const fit = options.fit ?? 'stretch';
  if (fit === 'stretch') {
    ctx.drawImage(stage, 0, 0, out.width, out.height);
  } else {
    const scale =
      fit === 'cover'
        ? Math.max(out.width / stage.width, out.height / stage.height)
        : Math.min(out.width / stage.width, out.height / stage.height);
    const dw = stage.width * scale;
    const dh = stage.height * scale;
    ctx.drawImage(stage, (out.width - dw) / 2, (out.height - dh) / 2, dw, dh);
  }
  return out;
}

/** 按变换选项输出 Blob（导出用） */
export async function renderImageWithTransform(
  src: string,
  options: ImageTransformOptions,
): Promise<Blob> {
  const img = await loadImageElement(src);
  const canvas = drawTransformedImage(img, options);
  return canvasToBlob(canvas, mimeForFormat(options.format), options.quality);
}

export interface StitchOptions {
  sources: string[];
  direction: 'horizontal' | 'vertical';
  gap: number;
  background: string;
  format: ImageOutputFormat;
  quality?: number;
}

/** 多图拼接：横向 / 纵向，可设置间距与背景 */
export async function renderStitchedImage(options: StitchOptions): Promise<Blob> {
  if (options.sources.length === 0) throw new Error('请至少选择一张图片');
  const imgs = await Promise.all(options.sources.map((src) => loadImageElement(src)));
  const sizes = imgs.map((img) => ({
    w: img.naturalWidth || img.width,
    h: img.naturalHeight || img.height,
  }));
  const horizontal = options.direction === 'horizontal';
  const gap = Math.max(0, Math.round(options.gap));
  const totalW = horizontal
    ? sizes.reduce((sum, s) => sum + s.w, 0) + gap * (imgs.length - 1)
    : Math.max(...sizes.map((s) => s.w));
  const totalH = horizontal
    ? Math.max(...sizes.map((s) => s.h))
    : sizes.reduce((sum, s) => sum + s.h, 0) + gap * (imgs.length - 1);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, totalW);
  canvas.height = Math.max(1, totalH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前环境不支持 canvas');
  const bg = options.background || 'transparent';
  if (bg !== 'transparent') {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  let cursor = 0;
  imgs.forEach((img, idx) => {
    const { w, h } = sizes[idx];
    if (horizontal) {
      const y = Math.round((totalH - h) / 2);
      ctx.drawImage(img, cursor, y, w, h);
      cursor += w + gap;
    } else {
      const x = Math.round((totalW - w) / 2);
      ctx.drawImage(img, x, cursor, w, h);
      cursor += h + gap;
    }
  });
  return canvasToBlob(canvas, mimeForFormat(options.format), options.quality);
}
