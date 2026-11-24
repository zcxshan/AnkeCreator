import { useEffect, useState } from 'react';
import type { ImageLibraryItem } from '../../types';
import { updateImageLibraryItem } from '../../db/imageLibrary';
import { stripImageFilenameExtension } from '../../utils/imageFilename';
import { resolveImageSrc } from '../../utils/imageSrc';
import {
  blobToBase64,
  computeTargetSize,
  extForFormat,
  formatForMime,
  guessMimeFromName,
  loadImageElement,
  mimeForFormat,
  renderProcessedImage,
  type ImageOutputFormat,
} from '../../utils/imageProcess';
import { Modal } from '../common/Modal';

export interface ImageProcessDialogProps {
  open: boolean;
  item: ImageLibraryItem | null;
  folderId: string | null;
  folderName?: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export function ImageProcessDialog({
  open,
  item,
  folderId,
  folderName,
  onClose,
  onSaved,
}: ImageProcessDialogProps) {
  const [previewSrc, setPreviewSrc] = useState('');
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [keepRatio, setKeepRatio] = useState(true);
  const [format, setFormat] = useState<ImageOutputFormat>('png');
  const [quality, setQuality] = useState(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 打开时读取图片原始尺寸
  useEffect(() => {
    if (!open || !item) return;
    let cancelled = false;
    setError('');
    setBusy(false);
    setKeepRatio(true);
    setQuality(90);
    setFormat(formatForMime(guessMimeFromName(item.filename || item.url)));

    void (async () => {
      try {
        const resolved = await resolveImageSrc(item.url, {
          readAsDataUrl: (p) => window.electronAPI?.readAsDataUrl?.(p) ?? Promise.resolve(undefined),
        });
        if (!resolved.src) throw new Error('图片地址为空');
        const img = await loadImageElement(resolved.src);
        if (cancelled) return;
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        setPreviewSrc(resolved.src);
        setNatural({ width: w, height: h });
        setWidth(String(w));
        setHeight(String(h));
      } catch (e) {
        if (!cancelled) setError((e as Error).message || '图片加载失败');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, item]);

  if (!open || !item) return null;

  const handleWidthChange = (value: string) => {
    setWidth(value);
    if (!keepRatio || !natural.width) return;
    const next = Number(value);
    if (next > 0) {
      setHeight(String(computeTargetSize(natural.width, natural.height, next).height));
    }
  };

  const handleHeightChange = (value: string) => {
    setHeight(value);
    if (!keepRatio || !natural.height) return;
    const next = Number(value);
    if (next > 0) {
      setWidth(String(computeTargetSize(natural.width, natural.height, undefined, next).width));
    }
  };

  const toggleRatio = (next: boolean) => {
    setKeepRatio(next);
    if (next && natural.width && natural.height) {
      const target = computeTargetSize(
        natural.width,
        natural.height,
        Number(width) || undefined,
        undefined,
        true,
      );
      setHeight(String(target.height));
    }
  };

  const handleSave = async () => {
    if (!window.electronAPI?.saveImageLocal) {
      setError('图片处理仅支持桌面端 Electron 环境');
      return;
    }
    const target = computeTargetSize(
      natural.width,
      natural.height,
      Number(width) || undefined,
      Number(height) || undefined,
      keepRatio,
    );
    if (!previewSrc) {
      setError('图片尚未加载完成');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const blob = await renderProcessedImage({
        src: previewSrc,
        width: target.width,
        height: target.height,
        format,
        quality: quality / 100,
      });
      const base64 = await blobToBase64(blob);
      const baseName = stripImageFilenameExtension(item.filename) || 'image';
      const filename = `${baseName}.${extForFormat(format)}`;
      const res = await window.electronAPI.saveImageLocal({
        buffer: base64,
        filename,
        mimeType: mimeForFormat(format),
        folderId,
        folderName,
      });
      if (!res?.ok || !res.url) {
        throw new Error(res?.error || '保存处理后的图片失败');
      }
      const urlBasename = String(res.url)
        .replace(/^local:\/\/[^/]*\//, '')
        .replace(/^local:\/\//, '');
      await updateImageLibraryItem(item.id, {
        url: res.url,
        filename: stripImageFilenameExtension(urlBasename || filename),
      });
      // 旧本地文件清理（URL 来源跳过）
      if (item.url.startsWith('local://') && item.url !== res.url) {
        await window.electronAPI?.deleteImageLocal?.({ url: item.url });
      }
      await onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message || '图片处理失败（远程图片可能受跨域限制）');
    } finally {
      setBusy(false);
    }
  };

  const ratio = natural.height ? natural.width / natural.height : 1;

  return (
    <Modal open onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-[var(--an-ink)]">处理图片</h3>
          <button onClick={onClose} className="an-btn an-btn--sm an-btn--ghost" aria-label="关闭">
            关闭
          </button>
        </div>
        {error && (
          <div className="text-[12px] text-[var(--an-pink)] bg-[var(--an-pink-soft)] border-2 border-[var(--an-ink)] rounded-[var(--an-radius-sm)] px-2 py-1.5">
            {error}
          </div>
        )}

        <div className="flex gap-3 items-start">
          <div
            className="w-28 h-28 shrink-0 flex items-center justify-center overflow-hidden bg-[var(--an-paper-2)]"
            style={{ border: '2px solid var(--an-ink)', borderRadius: 'var(--an-radius-sm)' }}
          >
            {previewSrc ? (
              <img src={previewSrc} alt="预览" className="max-w-full max-h-full object-contain" />
            ) : (
              <span className="text-[11px] text-[var(--an-ink-faint)]">加载中…</span>
            )}
          </div>
          <div className="text-xs text-[var(--an-ink-soft)] leading-relaxed">
            <div>原图：{natural.width} × {natural.height} px</div>
            <div>比例：{ratio.toFixed(3)}</div>
            <div className="mt-1">支持修改尺寸、转换 PNG / JPEG / WebP 并覆盖资源库记录。</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-[var(--an-ink-soft)]">
            宽度 (px)
            <input
              type="number"
              min={1}
              value={width}
              onChange={(e) => handleWidthChange(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 text-sm text-[var(--an-ink)]"
              style={{ background: 'var(--an-card)', border: '2px solid var(--an-ink)', borderRadius: 'var(--an-radius-sm)' }}
            />
          </label>
          <label className="text-xs text-[var(--an-ink-soft)]">
            高度 (px)
            <input
              type="number"
              min={1}
              value={height}
              onChange={(e) => handleHeightChange(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 text-sm text-[var(--an-ink)]"
              style={{ background: 'var(--an-card)', border: '2px solid var(--an-ink)', borderRadius: 'var(--an-radius-sm)' }}
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-xs text-[var(--an-ink-soft)] select-none">
          <input
            type="checkbox"
            checked={keepRatio}
            onChange={(e) => toggleRatio(e.target.checked)}
            className="accent-[var(--an-pink)]"
          />
          锁定宽高比
        </label>

        <div>
          <div className="text-xs text-[var(--an-ink-soft)] mb-1.5">输出格式</div>
          <div className="flex gap-2">
            {([
              ['png', 'PNG'],
              ['jpeg', 'JPEG'],
              ['webp', 'WebP'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFormat(key)}
                className={
                  format === key
                    ? 'an-btn an-btn--sm an-btn--pink'
                    : 'an-btn an-btn--sm an-btn--ghost'
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {(format === 'jpeg' || format === 'webp') && (
          <label className="block text-xs text-[var(--an-ink-soft)]">
            质量：{quality}
            <input
              type="range"
              min={1}
              max={100}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="w-full mt-1 accent-[var(--an-pink)]"
            />
          </label>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="an-btn an-btn--sm an-btn--ghost" disabled={busy}>
            取消
          </button>
          <button onClick={handleSave} className="an-btn an-btn--sm an-btn--pink" disabled={busy || !previewSrc}>
            {busy ? '处理中…' : '保存处理结果'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
