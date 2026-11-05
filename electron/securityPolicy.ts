// ============================================================
// 安全策略（纯函数，无 electron 依赖）
//
// 被两处使用：
// - electron/security.ts（主进程窗口守卫）
// - vite.config.ts（构建时把 CSP 写进 index.html，因为 Electron 的 webRequest
//   不会拦截 file:// 请求，生产环境只能靠 <meta> 生效）
// ============================================================

import path from 'path'
import { fileURLToPath } from 'url'

export interface NavGuardContext {
  /** 开发模式的 Vite 服务器 origin（如 http://localhost:5173）；生产为空 */
  devServerOrigin?: string
  /** 生产模式的渲染层 dist 目录绝对路径 */
  rendererDist: string
}

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** 是否可以交给系统浏览器打开（http/https/mailto） */
export function isExternalUrl(target: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(target).protocol)
  } catch {
    return false
  }
}

/** 是否为本地图片资源（local:// 协议） */
export function isLocalAssetUrl(target: string): boolean {
  try {
    return new URL(target).protocol === 'local:'
  } catch {
    return false
  }
}

/** 是否为应用自身页面（生产：dist 内文件；开发：Vite 服务器同源） */
export function isInternalUrl(target: string, ctx: NavGuardContext): boolean {
  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return false
  }

  if (parsed.protocol === 'file:') {
    try {
      const targetPath = path.normalize(fileURLToPath(parsed))
      const dist = path.normalize(ctx.rendererDist)
      return targetPath === dist || targetPath.startsWith(dist + path.sep)
    } catch {
      return false
    }
  }

  if (ctx.devServerOrigin) {
    try {
      return parsed.origin === new URL(ctx.devServerOrigin).origin
    } catch {
      return false
    }
  }

  return false
}

/**
 * 生产环境 CSP。
 *
 * 说明：
 * - 生产页面用 file:// 加载，Chromium 对 file 文档的 origin 是 opaque，
 *   `'self'` 未必匹配，因此显式列出 `file:`，避免整包脚本被拦（白屏）
 * - `style-src 'unsafe-inline'`：React/tiptap 会写内联样式，Modal 还会注入 keyframes
 * - `img-src` 放开 http/https：正文里的图床图片（NGA、外链）必须能直接显示
 * - `connect-src` 不放开外网：渲染层不发起任何 fetch（NGA 抓取在主进程）
 */
export function buildCsp(): string {
  return [
    "default-src 'self' file:",
    "script-src 'self' file:",
    "style-src 'self' 'unsafe-inline' file:",
    "img-src 'self' data: blob: local: file: https: http:",
    "font-src 'self' data: file:",
    "media-src 'self' data: blob: local: file:",
    "connect-src 'self' data: blob: local:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}
