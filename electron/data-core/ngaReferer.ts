// ============================================================
// NGA 图床 Referer 白名单
//
// NGA 图床检查 Referer，Electron 渲染层默认不携带 NGA 域名的 Referer，
// 导致编辑器内插入的 NGA 图片加载失败。此文件集中维护域名白名单与请求头，
// 供 electron/protocol.ts 的 webRequest 钩子复用。
// ============================================================

export const NGA_IMAGE_URL_PATTERNS = [
  'https://*.nga.cn/*',
  'https://*.ngabbs.com/*',
  'https://*.nga.178.com/*',
  'https://*.nga.com/*',
]

const DEFAULT_REFERER = 'https://bbs.nga.cn/'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export function buildNgaRefererHeaders(origin: string = DEFAULT_REFERER): Record<string, string> {
  return { Referer: origin, 'User-Agent': USER_AGENT }
}
