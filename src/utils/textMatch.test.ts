/**
 * textMatch 工具函数单元测试
 *
 * 覆盖 exact / fuzzy / regex 三种匹配模式 + 边界用例
 * 验证点：全角半角兼容、大小写不敏感、空白压缩、多关键词 and/or 逻辑、非法正则兜底
 */
import { describe, it, expect } from 'vitest'
import { matchText, normalizeText } from './textMatch'

describe('matchText - exact 模式', () => {
  it('基本子串包含：text 含 pattern 子串 → true', () => {
    expect(matchText('hello world', 'world', { mode: 'exact' })).toBe(true)
  })

  it('全角半角兼容：全角 ＡＢＣ 匹配半角 ABC', () => {
    expect(matchText('ＡＢＣ', 'ABC', { mode: 'exact' })).toBe(true)
  })

  it('大小写不敏感（默认）：Hello 匹配 hello', () => {
    expect(matchText('Hello', 'hello', { mode: 'exact' })).toBe(true)
  })

  it('空白压缩：连续多空格压缩为单空格后匹配', () => {
    expect(matchText('hello   world', 'hello world', { mode: 'exact' })).toBe(true)
  })

  it('caseSensitive=true 时大小写敏感：Hello 不匹配 hello', () => {
    expect(matchText('Hello', 'hello', { mode: 'exact', caseSensitive: true })).toBe(false)
  })
})

describe('matchText - fuzzy 模式', () => {
  it('单关键词：text 含关键词 → true', () => {
    expect(matchText('hello world', 'hello', { mode: 'fuzzy' })).toBe(true)
  })

  it('多关键词 and 逻辑（默认）：text 同时含 hello 和 foo → true', () => {
    expect(matchText('hello world foo', 'hello foo', { mode: 'fuzzy' })).toBe(true)
  })

  it('多关键词 and 不匹配：text 不含 bar → false', () => {
    expect(matchText('hello world', 'hello bar', { mode: 'fuzzy' })).toBe(false)
  })

  it('多关键词 or 逻辑：text 含 hello 即可 → true', () => {
    expect(matchText('hello world', 'hello bar', { mode: 'fuzzy', multiLogic: 'or' })).toBe(true)
  })

  it('多关键词 or 全不匹配 → false', () => {
    expect(matchText('hello world', 'foo bar', { mode: 'fuzzy', multiLogic: 'or' })).toBe(false)
  })
})

describe('matchText - regex 模式', () => {
  it('基本正则：\\d+ 匹配数字', () => {
    expect(matchText('hello 123 world', '\\d+', { mode: 'regex' })).toBe(true)
  })

  it('大小写不敏感（默认）：/hello/i 匹配 Hello', () => {
    expect(matchText('Hello', 'hello', { mode: 'regex' })).toBe(true)
  })

  it('大小写敏感：caseSensitive=true 时 /hello/ 不匹配 Hello', () => {
    expect(matchText('Hello', 'hello', { mode: 'regex', caseSensitive: true })).toBe(false)
  })

  it('非法正则返回 false（不崩溃）：[invalid 是未闭合字符类', () => {
    expect(matchText('hello', '[invalid', { mode: 'regex' })).toBe(false)
  })

  it('合法正则但不匹配 → false', () => {
    expect(matchText('hello', '^\\d+$', { mode: 'regex' })).toBe(false)
  })
})

describe('matchText - 边界用例', () => {
  it('空 pattern 始终返回 true（与 includes("") 行为一致）', () => {
    expect(matchText('hello', '', { mode: 'exact' })).toBe(true)
    expect(matchText('hello', '', { mode: 'fuzzy' })).toBe(true)
    expect(matchText('hello', '', { mode: 'regex' })).toBe(true)
  })

  it('空 text 且非空 pattern 返回 false', () => {
    expect(matchText('', 'hello', { mode: 'exact' })).toBe(false)
    expect(matchText('', 'hello', { mode: 'fuzzy' })).toBe(false)
    expect(matchText('', 'hello', { mode: 'regex' })).toBe(false)
  })

  it('fuzzy 模式 pattern 仅空白 → 关键词为空 → true', () => {
    expect(matchText('hello', '   ', { mode: 'fuzzy' })).toBe(true)
  })
})

describe('normalizeText', () => {
  it('全角转半角：ＡＢＣ123 → abc123', () => {
    expect(normalizeText('ＡＢＣ123')).toBe('abc123')
  })

  it('全角空格转半角空格', () => {
    expect(normalizeText('hello　world')).toBe('hello world')
  })

  it('压缩连续空白为单个空格', () => {
    expect(normalizeText('hello   world')).toBe('hello world')
  })

  it('去首尾空白', () => {
    expect(normalizeText('  hello  ')).toBe('hello')
  })

  it('caseSensitive=true 时不转小写', () => {
    expect(normalizeText('Hello', true)).toBe('Hello')
  })

  it('空字符串返回空字符串', () => {
    expect(normalizeText('')).toBe('')
  })
})
