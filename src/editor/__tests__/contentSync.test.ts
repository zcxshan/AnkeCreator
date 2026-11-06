import { describe, expect, it } from 'vitest'
import {
  shouldApplyExternalContent,
  shouldRecreateHistory,
  shouldSkipExternalSync,
} from '../tiptap/contentSync'

describe('contentSync', () => {
  it('输入法组合期间跳过外部同步', () => {
    expect(shouldSkipExternalSync(true)).toBe(true)
    expect(
      shouldApplyExternalContent({ isComposing: true, next: '新内容', lastApplied: '旧内容' }),
    ).toBe(false)
  })

  it('内容未变化时不重复写回', () => {
    expect(
      shouldApplyExternalContent({ isComposing: false, next: '相同', lastApplied: '相同' }),
    ).toBe(false)
  })

  it('外部内容变化时允许同步并重建撤销历史', () => {
    expect(
      shouldApplyExternalContent({ isComposing: false, next: '新内容', lastApplied: '旧内容' }),
    ).toBe(true)
    expect(shouldRecreateHistory('旧内容', '新内容')).toBe(true)
    expect(shouldRecreateHistory('相同', '相同')).toBe(false)
  })
})
