// ============================================================
// 作品 ↔ NGA 帖子关联（存储在作品目录的 nga.json）
// ============================================================

export interface NgaThreadLink {
  /** 规范化后的主题帖 URL */
  url: string
  tid: string
  baseUrl: string
  title?: string
  fid?: string
  linkedAt: string
}

export interface NgaPostLink {
  pid?: string
  url?: string
  postedAt: string
}

export interface StoryNgaLink {
  thread: NgaThreadLink | null
  /** sectionId → 已发送楼层的回执 */
  posts: Record<string, NgaPostLink>
}

export const EMPTY_NGA_LINK: StoryNgaLink = { thread: null, posts: {} }

const NGA_HOST_ALLOWLIST = ['nga.cn', 'ngabbs.com', 'nga.178.com', 'nga.com']

/** 从用户输入的 NGA 帖子链接解析 tid / baseUrl；非 NGA 域名返回 null */
export function parseNgaThreadUrl(raw: string): { url: string; tid: string; baseUrl: string } | null {
  const input = raw.trim()
  if (!input) return null
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase()
  if (!NGA_HOST_ALLOWLIST.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    return null
  }
  const tid =
    url.searchParams.get('tid')?.trim() ||
    url.pathname.match(/\/thread-(\d+)/)?.[1] ||
    ''
  if (!tid || !/^[0-9]+$/.test(tid)) return null
  url.protocol = 'https:'
  return { url: url.toString(), tid, baseUrl: url.origin }
}
