// ============================================================
// ImageWorkbenchPanel：资源库「图片处理」独立面板
//
// 不再把处理入口塞在图片卡片上，而是集中一个工作台：
// - 左侧选择图片（单选处理 / 多选拼接）
// - 右侧实时预览 + 分组操作：格式与压缩、尺寸画布、旋转翻转、裁剪、拼接
// - 保存可覆盖原图或另存为副本
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImageLibraryItem } from '../../types';
import {
  addImageLibraryItem,
  listAllImageLibraryItems,
  updateImageLibraryItem,
} from '../../db/imageLibrary';
import { resolveImageSrc } from '../../utils/imageSrc';
import { stripImageFilenameExtension } from '../../utils/imageFilename';
import {
  blobToBase64,
  drawTransformedImage,
  extForFormat,
  formatForMime,
  guessMimeFromName,
  loadImageElement,
  mimeForFormat,
  renderImageWithTransform,
  renderStitchedImage,
  type CanvasFit,
  type CropRect,
  type ImageOutputFormat,
  type RotateDeg,
} from '../../utils/imageProcess';
import { useToastStore } from '../../store/toastStore';
import { Icon } from '../common/Icon';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isElectronSaveAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.saveImageLocal;
}

export function ImageWorkbenchPanel() {
  const showToast = useToastStore((s) => s.showToast);

  const [items, setItems] = useState<ImageLibraryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stitchIds, setStitchIds] = useState<string[]>([]);
  const [resolvedSrc, setResolvedSrc] = useState('');
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);

  // 变换参数
  const [format, setFormat] = useState<ImageOutputFormat>('png');
  const [quality, setQuality] = useState(90);
  const [rotate, setRotate] = useState<RotateDeg>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [autoTarget, setAutoTarget] = useState(true);
  const [targetW, setTargetW] = useState('');
  const [targetH, setTargetH] = useState('');
  const [fit, setFit] = useState<CanvasFit>('stretch');
  const [background, setBackground] = useState('#ffffff');

  // 拼接参数
  const [stitchDir, setStitchDir] = useState<'horizontal' | 'vertical'>('horizontal');
  const [stitchGap, setStitchGap] = useState(8);
  const [stitchBg, setStitchBg] = useState('#ffffff');

  const [saveMode, setSaveMode] = useState<'copy' | 'overwrite'>('copy');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const cropWrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    crop: CropRect;
  } | null>(null);

  const selected = useMemo(
    () => items.find((it) => it.id === selectedId) ?? null,
    [items, selectedId],
  );

  const refresh = useCallback(async () => {
    try {
      const all = await listAllImageLibraryItems();
      setItems(all);
      setSelectedId((prev) => (prev && all.some((it) => it.id === prev) ? prev : all[0]?.id ?? null));
    } catch (e) {
      setError((e as Error).message || '加载图片库失败');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 选中图片后加载原图
  useEffect(() => {
    if (!selected) {
      setResolvedSrc('');
      setSourceImage(null);
      setNatural(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const resolved = await resolveImageSrc(selected.url, {
          readAsDataUrl: (p) => window.electronAPI?.readAsDataUrl?.(p) ?? Promise.resolve(undefined),
        });
        const img = await loadImageElement(resolved.src);
        if (cancelled) return;
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        setResolvedSrc(resolved.src);
        setSourceImage(img);
        setNatural({ width, height });
        setCrop({ x: 0, y: 0, width, height });
        setRotate(0);
        setFlipH(false);
        setFlipV(false);
        setFit('stretch');
        setAutoTarget(true);
        setTargetW(String(width));
        setTargetH(String(height));
        setFormat(formatForMime(guessMimeFromName(selected.filename || selected.url)));
      } catch (e) {
        if (!cancelled) setError((e as Error).message || '图片加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.id]);

  // 裁剪 / 旋转变化时，未手动改尺寸则自动跟随
  const stageSize = useMemo(() => {
    if (!crop) return { width: 0, height: 0 };
    return rotate === 90 || rotate === 270
      ? { width: crop.height, height: crop.width }
      : { width: crop.width, height: crop.height };
  }, [crop, rotate]);

  useEffect(() => {
    if (!autoTarget) return;
    if (stageSize.width > 0) {
      setTargetW(String(stageSize.width));
      setTargetH(String(stageSize.height));
    }
  }, [autoTarget, stageSize.width, stageSize.height]);

  // 结果预览：用与导出完全相同的绘制逻辑
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !sourceImage || !crop) return;
    try {
      const full = drawTransformedImage(sourceImage, {
        rotate,
        flipH,
        flipV,
        crop,
        targetWidth: Number(targetW) || undefined,
        targetHeight: Number(targetH) || undefined,
        fit,
        background,
        format,
      });
      const maxDim = 720;
      const scale = Math.min(1, maxDim / Math.max(full.width, full.height));
      const width = Math.max(1, Math.round(full.width * scale));
      const height = Math.max(1, Math.round(full.height * scale));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(full, 0, 0, width, height);
    } catch {
      // 预览失败不阻塞，保存时会给出明确错误
    }
  }, [sourceImage, crop, rotate, flipH, flipV, targetW, targetH, fit, background, format]);

  const cropPercent = useMemo(() => {
    if (!natural || !crop) return null;
    return {
      left: `${(crop.x / natural.width) * 100}%`,
      top: `${(crop.y / natural.height) * 100}%`,
      width: `${(crop.width / natural.width) * 100}%`,
      height: `${(crop.height / natural.height) * 100}%`,
    };
  }, [natural, crop]);

  const startCropDrag = (
    e: React.PointerEvent,
    mode: 'move' | 'resize',
  ) => {
    if (!crop) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, crop: { ...crop } };
  };

  const handleCropPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const wrap = cropWrapRef.current;
    if (!drag || !wrap || !natural) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dx = ((e.clientX - drag.startX) / rect.width) * natural.width;
    const dy = ((e.clientY - drag.startY) / rect.height) * natural.height;
    const base = drag.crop;
    if (drag.mode === 'move') {
      setCrop({
        ...base,
        x: Math.round(clamp(base.x + dx, 0, natural.width - base.width)),
        y: Math.round(clamp(base.y + dy, 0, natural.height - base.height)),
      });
    } else {
      const width = Math.round(clamp(base.width + dx, 24, natural.width - base.x));
      const height = Math.round(clamp(base.height + dy, 24, natural.height - base.y));
      setCrop({ ...base, width, height });
    }
  };

  const endCropDrag = () => {
    dragRef.current = null;
  };

  const applyCropPreset = (ratio: number) => {
    if (!natural) return;
    const maxW = natural.width;
    const maxH = natural.height;
    let width = maxW;
    let height = Math.round(maxW / ratio);
    if (height > maxH) {
      height = maxH;
      width = Math.round(maxH * ratio);
    }
    setCrop({
      x: Math.round((maxW - width) / 2),
      y: Math.round((maxH - height) / 2),
      width,
      height,
    });
  };

  const resetCrop = () => {
    if (!natural) return;
    setCrop({ x: 0, y: 0, width: natural.width, height: natural.height });
  };

  const handleSaveSingle = async () => {
    if (!selected || !resolvedSrc || !crop) return;
    if (!isElectronSaveAvailable()) {
      setError('保存处理后的图片仅支持桌面端');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const blob = await renderImageWithTransform(resolvedSrc, {
        rotate,
        flipH,
        flipV,
        crop,
        targetWidth: Number(targetW) || undefined,
        targetHeight: Number(targetH) || undefined,
        fit,
        background,
        format,
        quality: quality / 100,
      });
      const base64 = await blobToBase64(blob);
      const baseName = stripImageFilenameExtension(selected.filename) || 'image';
      const filename =
        saveMode === 'overwrite'
          ? `${baseName}.${extForFormat(format)}`
          : `${baseName}-处理.${extForFormat(format)}`;
      const res = await window.electronAPI!.saveImageLocal({
        buffer: base64,
        filename,
        mimeType: mimeForFormat(format),
        folderId: selected.folderId,
      });
      if (!res?.ok || !res.url) throw new Error(res?.error || '保存失败');
      const urlBasename = String(res.url)
        .replace(/^local:\/\/[^/]*\//, '')
        .replace(/^local:\/\//, '');
      const displayName = stripImageFilenameExtension(urlBasename || filename);
      if (saveMode === 'overwrite') {
        await updateImageLibraryItem(selected.id, { url: res.url, filename: displayName });
        if (selected.url.startsWith('local://') && selected.url !== res.url) {
          await window.electronAPI?.deleteImageLocal?.({ url: selected.url });
        }
      } else {
        await addImageLibraryItem({
          folderId: selected.folderId,
          url: res.url,
          filename: displayName,
          source: 'local',
        });
      }
      await refresh();
      showToast(saveMode === 'overwrite' ? '已覆盖原图' : '已另存为新图片', 'success');
    } catch (e) {
      setError((e as Error).message || '处理失败（远程图片可能受跨域限制）');
    } finally {
      setBusy(false);
    }
  };

  const stitchItems = useMemo(
    () => items.filter((it) => stitchIds.includes(it.id)),
    [items, stitchIds],
  );

  const toggleStitch = (id: string) => {
    setStitchIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleSaveStitch = async () => {
    if (stitchItems.length < 2) {
      setError('请至少勾选两张图片用于拼接');
      return;
    }
    if (!isElectronSaveAvailable()) {
      setError('保存拼接结果仅支持桌面端');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const sources: string[] = [];
      for (const item of stitchItems) {
        const resolved = await resolveImageSrc(item.url, {
          readAsDataUrl: (p) => window.electronAPI?.readAsDataUrl?.(p) ?? Promise.resolve(undefined),
        });
        sources.push(resolved.src);
      }
      const blob = await renderStitchedImage({
        sources,
        direction: stitchDir,
        gap: stitchGap,
        background: stitchBg,
        format,
        quality: quality / 100,
      });
      const base64 = await blobToBase64(blob);
      const filename = `拼接-${Date.now()}.${extForFormat(format)}`;
      const res = await window.electronAPI!.saveImageLocal({
        buffer: base64,
        filename,
        mimeType: mimeForFormat(format),
        folderId: stitchItems[0]?.folderId ?? null,
      });
      if (!res?.ok || !res.url) throw new Error(res?.error || '保存失败');
      const urlBasename = String(res.url)
        .replace(/^local:\/\/[^/]*\//, '')
        .replace(/^local:\/\//, '');
      await addImageLibraryItem({
        folderId: stitchItems[0]?.folderId ?? null,
        url: res.url,
        filename: stripImageFilenameExtension(urlBasename || filename),
        source: 'local',
      });
      await refresh();
      showToast(`已拼接 ${stitchItems.length} 张图片`, 'success');
    } catch (e) {
      setError((e as Error).message || '拼接失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto p-4 text-[var(--an-ink)]">
      {error && (
        <div
          role="alert"
          className="mb-3 px-3 py-2 text-[12px] text-[var(--an-pink)] bg-[var(--an-pink-soft)]"
          style={{ border: '2px solid var(--an-ink)', borderRadius: 'var(--an-radius-sm)' }}
        >
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* 左：选择图片 */}
        <div
          className="max-h-[560px] overflow-y-auto p-3 space-y-2"
          style={{ background: 'var(--an-card)', border: '2px solid var(--an-ink)', borderRadius: 'var(--an-radius-sm)' }}
        >
          <div className="text-[13px] font-bold" style={{ fontFamily: 'var(--an-font-display)' }}>
            图片（{items.length}）
          </div>
          <div className="text-[11px] text-[var(--an-ink-faint)] leading-snug">
            点击选中后处理；勾选多张可横向/纵向拼接。
          </div>
          {items.length === 0 && (
            <div className="text-[12px] text-[var(--an-ink-faint)] py-4 text-center">
              图片库是空的，先到「图片」页上传素材。
            </div>
          )}
          {items.map((item) => {
            const active = item.id === selectedId;
            return (
              <div
                key={item.id}
                className="flex items-center gap-2 p-1.5 cursor-pointer"
                style={{
                  background: active ? 'var(--an-pink-soft)' : 'transparent',
                  border: `2px solid ${active ? 'var(--an-ink)' : 'transparent'}`,
                  borderRadius: 'var(--an-radius-sm)',
                }}
                onClick={() => setSelectedId(item.id)}
              >
                <input
                  type="checkbox"
                  aria-label={`选择 ${item.filename} 用于拼接`}
                  checked={stitchIds.includes(item.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleStitch(item.id)}
                  className="accent-[var(--an-pink)] shrink-0"
                />
                <img
                  src={item.url}
                  alt={item.filename}
                  loading="lazy"
                  className="w-9 h-9 object-cover shrink-0"
                  style={{ border: '1px solid var(--an-ink-faint)', borderRadius: 6 }}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] truncate font-semibold" title={item.filename}>
                    {item.filename}
                  </div>
                  <div className="text-[10px] text-[var(--an-ink-faint)]">
                    {item.source === 'local' ? '本地' : 'URL'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 右：预览 + 操作 */}
        <div className="space-y-3 min-w-0">
          {/* 结果预览 */}
          <div
            className="p-3"
            style={{ background: 'var(--an-card)', border: '2px solid var(--an-ink)', borderRadius: 'var(--an-radius-sm)' }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-[13px] font-bold" style={{ fontFamily: 'var(--an-font-display)' }}>
                结果预览
              </div>
              <div className="text-[11px] text-[var(--an-ink-faint)]">
                {natural ? `${natural.width} × ${natural.height} → ${targetW || stageSize.width} × ${targetH || stageSize.height}` : ''}
              </div>
            </div>
            <div
              className="min-h-[140px] flex items-center justify-center overflow-hidden"
              style={{ background: 'var(--an-paper-2)', borderRadius: 'var(--an-radius-sm)' }}
            >
              {loading ? (
                <span className="text-[12px] text-[var(--an-ink-faint)]">加载中…</span>
              ) : sourceImage ? (
                <canvas ref={previewRef} className="max-w-full max-h-[320px] object-contain" />
              ) : (
                <span className="text-[12px] text-[var(--an-ink-faint)]">从左侧选择一张图片</span>
              )}
            </div>
          </div>

          {/* 格式与压缩 */}
          <section className="p-3 space-y-2" style={sectionStyle}>
            <SectionTitle icon="save" title="格式转换与压缩" />
            <div className="flex items-center gap-2 flex-wrap">
              {([
                ['png', 'PNG'],
                ['jpeg', 'JPEG'],
                ['webp', 'WebP'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFormat(key)}
                  className={format === key ? 'an-btn an-btn--sm an-btn--pink' : 'an-btn an-btn--sm an-btn--ghost'}
                >
                  {label}
                </button>
              ))}
              <span className="text-[11px] text-[var(--an-ink-faint)]">PNG 支持透明，JPEG/WebP 可调质量</span>
            </div>
            {format !== 'png' && (
              <label className="block text-[12px] text-[var(--an-ink-soft)]">
                压缩质量：{quality}
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                  className="w-full mt-1 accent-[var(--an-pink)]"
                />
              </label>
            )}
          </section>

          {/* 尺寸与画布 */}
          <section className="p-3 space-y-2" style={sectionStyle}>
            <SectionTitle icon="box" title="尺寸 / 画布" />
            <div className="flex items-center gap-2 flex-wrap text-[12px] text-[var(--an-ink-soft)]">
              <label className="flex items-center gap-1">
                宽
                <input
                  type="number"
                  min={1}
                  value={targetW}
                  onChange={(e) => {
                    setAutoTarget(false);
                    setTargetW(e.target.value);
                  }}
                  className="w-20 px-2 py-1 text-[12px]"
                  style={inputStyle}
                />
              </label>
              <label className="flex items-center gap-1">
                高
                <input
                  type="number"
                  min={1}
                  value={targetH}
                  onChange={(e) => {
                    setAutoTarget(false);
                    setTargetH(e.target.value);
                  }}
                  className="w-20 px-2 py-1 text-[12px]"
                  style={inputStyle}
                />
              </label>
              <button
                className="an-btn an-btn--sm an-btn--ghost"
                onClick={() => {
                  setAutoTarget(true);
                  setFit('stretch');
                  if (stageSize.width) {
                    setTargetW(String(stageSize.width));
                    setTargetH(String(stageSize.height));
                  }
                }}
              >
                按原比例
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-[12px] text-[var(--an-ink-soft)]">
              <span>画布适配</span>
              {([
                ['stretch', '拉伸铺满'],
                ['contain', '完整留白'],
                ['cover', '裁切铺满'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFit(key)}
                  className={fit === key ? 'an-btn an-btn--sm an-btn--pink' : 'an-btn an-btn--sm an-btn--ghost'}
                >
                  {label}
                </button>
              ))}
              {fit !== 'stretch' && (
                <label className="flex items-center gap-1">
                  背景
                  <input
                    type="color"
                    value={background}
                    onChange={(e) => setBackground(e.target.value)}
                    className="w-8 h-7 p-0 bg-transparent cursor-pointer"
                  />
                </label>
              )}
            </div>
          </section>

          {/* 旋转 / 翻转 */}
          <section className="p-3 space-y-2" style={sectionStyle}>
            <SectionTitle icon="refresh" title="旋转 / 翻转" />
            <div className="flex items-center gap-2 flex-wrap">
              {([90, 180, 270] as const).map((deg) => (
                <button
                  key={deg}
                  onClick={() => setRotate((prev) => ((prev + deg) % 360) as RotateDeg)}
                  className="an-btn an-btn--sm an-btn--ghost"
                >
                  <Icon name="refresh" size={12} /> {deg === 90 ? '右转 90°' : deg === 180 ? '转 180°' : '左转 90°'}
                </button>
              ))}
              <button
                onClick={() => setFlipH((v) => !v)}
                className={flipH ? 'an-btn an-btn--sm an-btn--pink' : 'an-btn an-btn--sm an-btn--ghost'}
              >
                <Icon name="arrowLeftRight" size={12} /> 水平翻转
              </button>
              <button
                onClick={() => setFlipV((v) => !v)}
                className={flipV ? 'an-btn an-btn--sm an-btn--pink' : 'an-btn an-btn--sm an-btn--ghost'}
              >
                <Icon name="arrowUp" size={12} /> 垂直翻转
              </button>
              <button
                onClick={() => {
                  setRotate(0);
                  setFlipH(false);
                  setFlipV(false);
                }}
                className="an-btn an-btn--sm an-btn--ghost"
              >
                重置方向
              </button>
            </div>
          </section>

          {/* 裁剪 */}
          <section className="p-3 space-y-2" style={sectionStyle}>
            <SectionTitle icon="image" title="裁剪" />
            <div className="flex items-center gap-2 flex-wrap">
              <button className="an-btn an-btn--sm an-btn--ghost" onClick={resetCrop}>全图</button>
              <button className="an-btn an-btn--sm an-btn--ghost" onClick={() => applyCropPreset(1)}>1:1</button>
              <button className="an-btn an-btn--sm an-btn--ghost" onClick={() => applyCropPreset(4 / 3)}>4:3</button>
              <button className="an-btn an-btn--sm an-btn--ghost" onClick={() => applyCropPreset(16 / 9)}>16:9</button>
              {natural && crop && (
                <span className="text-[11px] text-[var(--an-ink-faint)]">
                  选区 {Math.round(crop.width)} × {Math.round(crop.height)} @ ({Math.round(crop.x)}, {Math.round(crop.y)})
                </span>
              )}
            </div>
            {natural && crop && (
              <div
                ref={cropWrapRef}
                className="relative select-none touch-none inline-block max-w-full"
                style={{ border: '2px solid var(--an-ink)', borderRadius: 'var(--an-radius-sm)', overflow: 'hidden' }}
                onPointerMove={handleCropPointerMove}
                onPointerUp={endCropDrag}
                onPointerCancel={endCropDrag}
              >
                <img src={resolvedSrc} alt="裁剪原图" className="block w-full h-auto pointer-events-none" draggable={false} />
                {cropPercent && (
                  <div
                    className="absolute cursor-move"
                    style={{
                      ...cropPercent,
                      border: '2px solid var(--an-pink)',
                      background: 'rgba(255,255,255,0.12)',
                      boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
                    }}
                    onPointerDown={(e) => startCropDrag(e, 'move')}
                  >
                    <span
                      className="absolute w-3 h-3 cursor-se-resize"
                      style={{
                        right: -7,
                        bottom: -7,
                        background: 'var(--an-pink)',
                        border: '2px solid var(--an-ink)',
                        borderRadius: 3,
                      }}
                      onPointerDown={(e) => startCropDrag(e, 'resize')}
                    />
                  </div>
                )}
              </div>
            )}
            <div className="text-[11px] text-[var(--an-ink-faint)]">拖动选区移动位置，拖右下角调整大小。</div>
          </section>

          {/* 拼接 */}
          <section className="p-3 space-y-2" style={sectionStyle}>
            <SectionTitle icon="layoutGrid" title={`拼接（已选 ${stitchItems.length} 张）`} />
            <div className="flex items-center gap-2 flex-wrap text-[12px] text-[var(--an-ink-soft)]">
              <button
                onClick={() => setStitchDir('horizontal')}
                className={stitchDir === 'horizontal' ? 'an-btn an-btn--sm an-btn--pink' : 'an-btn an-btn--sm an-btn--ghost'}
              >
                横向
              </button>
              <button
                onClick={() => setStitchDir('vertical')}
                className={stitchDir === 'vertical' ? 'an-btn an-btn--sm an-btn--pink' : 'an-btn an-btn--sm an-btn--ghost'}
              >
                纵向
              </button>
              <label className="flex items-center gap-1">
                间距
                <input
                  type="number"
                  min={0}
                  value={stitchGap}
                  onChange={(e) => setStitchGap(Math.max(0, Number(e.target.value) || 0))}
                  className="w-16 px-2 py-1 text-[12px]"
                  style={inputStyle}
                />
              </label>
              <label className="flex items-center gap-1">
                背景
                <input
                  type="color"
                  value={stitchBg}
                  onChange={(e) => setStitchBg(e.target.value)}
                  className="w-8 h-7 p-0 bg-transparent cursor-pointer"
                />
              </label>
              <button
                className="an-btn an-btn--sm an-btn--pink ml-auto"
                disabled={busy || stitchItems.length < 2}
                onClick={handleSaveStitch}
              >
                生成拼接图
              </button>
            </div>
            <div className="text-[11px] text-[var(--an-ink-faint)]">
              在左侧勾选多张图片（顺序即勾选顺序之外的列表顺序），生成的新图会加入同一文件夹。
            </div>
          </section>

          {/* 保存 */}
          <div
            className="flex items-center gap-2 flex-wrap p-3"
            style={sectionStyle}
          >
            <button
              onClick={() => setSaveMode('copy')}
              className={saveMode === 'copy' ? 'an-btn an-btn--sm an-btn--pink' : 'an-btn an-btn--sm an-btn--ghost'}
            >
              另存为新图
            </button>
            <button
              onClick={() => setSaveMode('overwrite')}
              className={saveMode === 'overwrite' ? 'an-btn an-btn--sm an-btn--pink' : 'an-btn an-btn--sm an-btn--ghost'}
            >
              覆盖原图
            </button>
            <button
              onClick={handleSaveSingle}
              disabled={busy || !selected || !sourceImage}
              className="an-btn an-btn--sm an-btn--pink ml-auto"
            >
              {busy ? '处理中…' : '保存处理结果'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  background: 'var(--an-card)',
  border: '2px solid var(--an-ink)',
  borderRadius: 'var(--an-radius-sm)',
};

const inputStyle: React.CSSProperties = {
  background: 'var(--an-paper)',
  border: '2px solid var(--an-ink)',
  borderRadius: 'var(--an-radius-sm)',
  color: 'var(--an-ink)',
};

function SectionTitle({ icon, title }: { icon: React.ComponentProps<typeof Icon>['name']; title: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[13px] font-bold" style={{ fontFamily: 'var(--an-font-display)' }}>
      <Icon name={icon} size={14} />
      {title}
    </div>
  );
}
