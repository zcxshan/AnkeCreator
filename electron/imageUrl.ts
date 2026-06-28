// ============================================================
// 图片 URL 规范化
//
// 解决 NGA 图床 URL 带签名 token 导致「同一张图被识别为多张」的问题
// 例：
//   https://img.nga.178.com/attachments/mon_202401/01/abc.jpg?md5hash=xyz&expires=1700000000
//   https://img.nga.178.com/attachments/mon_202401/01/abc.jpg?md5hash=abc&expires=1800000000
//   → 规范化后都是 https://img.nga.178.com/attachments/mon_/01/abc.jpg
//
// 规则：
//   1. data: / local: / file: 原样返回（不去重）
//   2. http(s) 剥离 query + hash
//   3. NGA 主机名额外剥离 _300x200 尺寸后缀 + mon_202401 → mon_ 简化
//   4. host 统一小写
//   5. 非 http(s) 协议（相对路径、sm.ms CDN 等）原样返回
// ============================================================

const NGA_HOSTS = new Set([
  'img.nga.178.com',
  'img4.nga.178.com',
  'img.nga.cn',
  'ngabbs.com',
  'nga.178.com',
])

/**
 * 规范化图片 URL，去除签名 token / 查询参数 / 尺寸后缀
 * 失败（解析失败 / 非标准 URL）原样返回
 */
export function normalizeImageUrl(src: string): string {
  if (!src) return src
  // data: / local: / file: 协议不去重
  if (/^(data|local|file):/i.test(src)) return src
  // 非 http(s) 协议（相对路径、sm.ms CDN 等）原样返回
  if (!/^https?:\/\//i.test(src)) return src

  try {
    const u = new URL(src)
    // 1. 剥离 query
    u.search = ''
    // 2. 剥离 hash
    u.hash = ''

    // 3. NGA 特殊处理
    if (NGA_HOSTS.has(u.hostname.toLowerCase())) {
      // /attachments/mon_202401/01/abc_300x200.jpg → /attachments/mon_/01/abc.jpg
      u.pathname = u.pathname.replace(/_(\d+)x(\d+)(\.[a-z]+)$/i, '$3')
      // 简化 mon_202401 → mon_
      u.pathname = u.pathname.replace(/\/mon_\d+\//g, '/mon_/')
    }

    // 4. host 小写
    u.hostname = u.hostname.toLowerCase()
    return u.toString()
  } catch {
    return src
  }
}

/** 图片 src 类别 */
export type ImageSrcKind = 'remote' | 'local' | 'data'

/** 判断 src 是远端 http(s) / 本地 file|local|绝对路径 / base64 dataURL */
export function classifyImageSrc(src: string): ImageSrcKind {
  if (!src) return 'remote'
  if (/^data:/i.test(src)) return 'data'
  if (
    /^(local|file):/i.test(src) ||
    /^[A-Za-z]:[\\/]/.test(src) || // Windows 绝对路径
    /^file:\/\//i.test(src)
  ) {
    return 'local'
  }
  return 'remote'
}
