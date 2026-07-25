// ============================================================
// 相对时间格式化工具
//
// 用于把 unix 时间戳(秒)格式化为相对时间字符串
// 例如："3 分钟前"、"2 小时前"、"5 天前"、"3 周前"、"2 个月前"、"1 年前"
// 时间戳为 0 或无效时返回空字符串
// ============================================================

const MINUTE = 60
const HOUR = 3600
const DAY = 86400
const WEEK = DAY * 7
const MONTH = DAY * 30
const YEAR = DAY * 365

/**
 * 把 unix 时间戳(秒)格式化为相对时间字符串
 *
 * 规则：
 * - 时间戳为 0 或负数 → 返回空字符串
 * - diff < 60 秒       → "刚刚"
 * - diff < 60 分钟     → "X 分钟前"
 * - diff < 24 小时     → "X 小时前"
 * - diff < 7 天        → "X 天前"
 * - diff < 30 天       → "X 周前"
 * - diff < 365 天      → "X 个月前"
 * - diff >= 365 天     → "X 年前"
 *
 * 如果时间戳是未来时间（diff 为负），返回 "刚刚"（避免负数显示）
 */
export function formatRelativeTime(unixSeconds: number): string {
  if (!unixSeconds || unixSeconds <= 0) return ''
  const now = Math.floor(Date.now() / 1000)
  const diff = now - unixSeconds
  if (diff < 0) return '刚刚'
  if (diff < MINUTE) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`
  if (diff < WEEK) return `${Math.floor(diff / DAY)} 天前`
  if (diff < MONTH) return `${Math.floor(diff / WEEK)} 周前`
  if (diff < YEAR) return `${Math.floor(diff / MONTH)} 个月前`
  return `${Math.floor(diff / YEAR)} 年前`
}
