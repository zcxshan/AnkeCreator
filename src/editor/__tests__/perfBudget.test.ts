// ============================================================
// 大文档性能预算（烟测级，阈值刻意放宽）
//
// 目的不是精确测速，而是拦住把线性流程写成 O(n²) 的回归：
// 一份 15 万字符以上的正文，粘贴清洗 / BBCode 导出 / BBCode 回渲染
// 都应在秒级内完成。
// ============================================================

import { describe, it, expect } from 'vitest'
import { normalizePastedHtml } from '../tiptap/pasteNormalize'
import { htmlToNGABBCode } from '../../utils/ngaHtmlToBBCode'
import { bbcodeToHtml } from '../../utils/ngaBBCodeToHtml'

const BUDGET_MS = 5000

function buildLargeHtml(paragraphs: number): string {
  const chunk: string[] = []
  for (let i = 0; i < paragraphs; i += 1) {
    chunk.push(
      `<p><span style="color: rgb(200, 40, 40); font-size: 16px">第${i}段</span>正文内容正文内容正文内容` +
        `<b>加粗</b><i>斜体</i><s>删除线</s>——一段普通文字。</p>`,
    )
    if (i % 20 === 0) chunk.push('<table><tbody><tr><td>表</td><td>格</td></tr></tbody></table>')
    if (i % 50 === 0) chunk.push('<div data-type="dice-card" data-dice=\'{"expr":"1d6"}\'>1d6</div>')
  }
  return chunk.join('')
}

function timeSync(fn: () => void): number {
  const start = performance.now()
  fn()
  return performance.now() - start
}

describe('大文档性能预算', () => {
  const html = buildLargeHtml(1200)
  const bbcode = htmlToNGABBCode(html)

  it('样本体量达到大文档级别（HTML 15 万+ / BBCode 6 万+ 字符）', () => {
    expect(html.length).toBeGreaterThan(150_000)
    expect(bbcode.length).toBeGreaterThan(60_000)
  })

  it('粘贴清洗大段 HTML 在预算内', () => {
    const elapsed = timeSync(() => {
      normalizePastedHtml(html)
    })
    expect(elapsed).toBeLessThan(BUDGET_MS)
  })

  it('导出 NGA BBCode 在预算内', () => {
    const elapsed = timeSync(() => {
      htmlToNGABBCode(html)
    })
    expect(elapsed).toBeLessThan(BUDGET_MS)
  })

  it('BBCode 回渲染为 HTML 在预算内', () => {
    const elapsed = timeSync(() => {
      bbcodeToHtml(bbcode)
    })
    expect(elapsed).toBeLessThan(BUDGET_MS)
  })
})
