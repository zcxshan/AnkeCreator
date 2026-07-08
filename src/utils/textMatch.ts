// ============================================================
// 文本匹配工具：支持 精确 / 模糊 / 正则 三种模式
//
// 用于「寻找安科」页面的本地筛选层：
// - exact：规范化后 includes（大小写不敏感 + 全角→半角 + 去首尾空白）
// - fuzzy：按空白拆分多关键词，每个规范化后 includes，按 and/or 组合
// - regex：JS 正则，大小写不敏感（i 标志），异常时返回 false 不崩溃
//
// 设计原则：
// - 空 pattern 始终返回 true（与 String.prototype.includes('') 行为一致，不筛除任何结果）
// - 默认大小写不敏感（与搜索场景直觉相符）
// - 不引入第三方库（基础强度全部原生 JS）
// ============================================================

export type MatchMode = 'exact' | 'fuzzy' | 'regex'

export type MultiKeywordLogic = 'and' | 'or'

export interface MatchOptions {
  mode: MatchMode
  /** 多关键词逻辑，默认 'and'，仅 fuzzy 模式生效 */
  multiLogic?: MultiKeywordLogic
  /** 是否大小写敏感，默认 false，exact/fuzzy 生效；regex 始终受 flags 控制 */
  caseSensitive?: boolean
}

/**
 * 全角字符 → 半角字符
 * - 全角空格 U+3000 → 半角空格
 * - 全角 ASCII ！~ ～ (U+FF01 ~ U+FF5E) → 半角 (U+0021 ~ U+007E)
 */
function toHalfWidth(s: string): string {
  return s.replace(/[\u3000-\uFF5E]/g, (ch) => {
    const code = ch.charCodeAt(0)
    if (code === 0x3000) return ' '
    if (code >= 0xFF01 && code <= 0xFF5E) {
      return String.fromCharCode(code - 0xFEE0)
    }
    return ch
  })
}

/**
 * 规范化文本：
 * 1. 全角 → 半角
 * 2. 大小写统一（除非 caseSensitive=true）
 * 3. 压缩连续空白为单个空格 + 去首尾空白
 */
export function normalizeText(s: string, caseSensitive = false): string {
  if (!s) return ''
  let r = toHalfWidth(s)
  if (!caseSensitive) r = r.toLowerCase()
  // 压缩连续空白为单个空格 + trim
  r = r.replace(/\s+/g, ' ').trim()
  return r
}

/**
 * 主匹配函数
 *
 * @param text 待匹配文本
 * @param pattern 匹配模式字符串（exact/fuzzy 时是普通文本，regex 时是正则表达式源）
 * @param opts 匹配选项
 * @returns 是否匹配。空 pattern 始终返回 true
 */
export function matchText(text: string, pattern: string, opts: MatchOptions): boolean {
  // 空 pattern 永远匹配（与 includes('') 一致，不筛除任何结果）
  if (!pattern) return true
  if (!text) return false

  const { mode, multiLogic = 'and', caseSensitive = false } = opts

  if (mode === 'regex') {
    try {
      const flags = caseSensitive ? '' : 'i'
      const re = new RegExp(pattern, flags)
      return re.test(text)
    } catch {
      // 非法正则不崩溃，视为不匹配
      return false
    }
  }

  if (mode === 'fuzzy') {
    // 拆分多关键词：trim + 压缩连续空白 + 按空格拆分
    const keywords = normalizeText(pattern, caseSensitive).split(' ').filter(Boolean)
    if (keywords.length === 0) return true
    const normalizedText = normalizeText(text, caseSensitive)
    if (multiLogic === 'or') {
      return keywords.some((kw) => normalizedText.includes(kw))
    }
    // and
    return keywords.every((kw) => normalizedText.includes(kw))
  }

  // exact
  const normalizedText = normalizeText(text, caseSensitive)
  const normalizedPattern = normalizeText(pattern, caseSensitive)
  return normalizedText.includes(normalizedPattern)
}
