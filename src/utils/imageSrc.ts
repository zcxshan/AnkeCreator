export type ImageKind = 'empty' | 'data' | 'local' | 'file' | 'relative' | 'remote'

export interface ReadAsDataUrlResult {
  ok: boolean
  dataUrl?: string
  error?: string
}

export interface ResolveImageOptions {
  readAsDataUrl?: (path: string) => Promise<ReadAsDataUrlResult | undefined>
}

export interface ResolvedImage {
  src: string
  kind: ImageKind
  reason?: string
}

export async function resolveImageSrc(
  raw: string,
  options: ResolveImageOptions = {},
): Promise<ResolvedImage> {
  const src = raw.trim()
  if (!src) return { src: '', kind: 'empty', reason: '图片地址为空' }
  if (src.startsWith('data:')) return { src, kind: 'data' }
  if (/^https?:\/\//i.test(src)) return { src, kind: 'remote' }
  if (src.startsWith('local://')) {
    const normalized = src.startsWith('local:///') ? src : `local:///${src.slice('local://'.length)}`
    const result = await options.readAsDataUrl?.(normalized)
    if (result?.ok && result.dataUrl) return { src: result.dataUrl, kind: 'local' }
    return { src: normalized, kind: 'local', reason: result?.error ?? '本地图片读取失败' }
  }
  const isFile = src.startsWith('file://') || /^[A-Za-z]:\\/.test(src) || src.startsWith('\\\\')
  if (isFile) {
    const result = await options.readAsDataUrl?.(src)
    if (result?.ok && result.dataUrl) return { src: result.dataUrl, kind: 'file' }
    return { src, kind: 'file', reason: result?.error ?? '本地文件读取失败' }
  }
  const result = await options.readAsDataUrl?.(src)
  if (result?.ok && result.dataUrl) return { src: result.dataUrl, kind: 'relative' }
  return { src, kind: 'relative', reason: result?.error ?? '相对图片读取失败' }
}
