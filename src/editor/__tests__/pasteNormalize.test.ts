// ============================================================
// 粘贴规范化回归测试
// 覆盖：危险标签剥离、标签归一化、样式/属性白名单、链接与图片 URL 校验、
//       内部原子块降级、空段落压缩
// ============================================================

import { describe, it, expect } from 'vitest'
import { normalizePastedHtml } from '../tiptap/pasteNormalize'

describe('normalizePastedHtml 安全性', () => {
  it('删除 script / style / iframe 等危险标签', () => {
    const out = normalizePastedHtml(
      '<p>前</p><script>alert(1)</script><style>p{color:red}</style><iframe></iframe><p>后</p>',
    )
    expect(out).not.toContain('script')
    expect(out).not.toContain('alert')
    expect(out).not.toContain('iframe')
    expect(out).toContain('前')
    expect(out).toContain('后')
  })

  it('剥离事件处理器与未知属性', () => {
    const out = normalizePastedHtml('<p onclick="alert(1)" data-x="1" class="foo">正文</p>')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('data-x')
    expect(out).not.toContain('class=')
    expect(out).toContain('正文')
  })

  it('javascript: / vbscript: 链接解包为纯文本', () => {
    const out = normalizePastedHtml('<p><a href="javascript:alert(1)">点我</a></p>')
    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('<a')
    expect(out).toContain('点我')
  })

  it('保留 http/https/mailto 链接并只留 href', () => {
    const out = normalizePastedHtml(
      '<p><a href="https://nga.178.com" target="_blank" rel="opener">NGA</a></p>',
    )
    expect(out).toContain('href="https://nga.178.com"')
    expect(out).not.toContain('target=')
    expect(out).not.toContain('rel=')
  })

  it('危险图片地址整节点删除，data:image 不会被判为不安全', () => {
    expect(normalizePastedHtml('<p><img src="javascript:alert(1)"></p>')).toBe('')
    // 正文图片统一走 image-block 原子块，清洗层只做安全判定与尺寸透传，不复制原 src
    const ok = normalizePastedHtml('<p><img src="data:image/png;base64,iVBORw0KGgo=" width="120"></p>')
    expect(ok).toContain('<img')
    expect(ok).toContain('width="120"')
  })

  it('内部原子块（图片/骰子/折叠）降级为纯文本，不产生不可用的交互节点', () => {
    const out = normalizePastedHtml(
      '<div data-type="dice-card" data-dice=\'{"expr":"1d6"}\'>1d6</div><div data-type="image-block"><img src="https://a/b.png"></div>',
    )
    expect(out).not.toContain('data-type')
    expect(out).not.toContain('data-dice')
    expect(out).not.toContain('<img')
    expect(out).toContain('1d6')
  })
})

describe('normalizePastedHtml 归一化', () => {
  it('strong/em/strike → b/i/s，div → p', () => {
    const out = normalizePastedHtml(
      '<div><strong>粗</strong><em>斜</em><strike>删</strike></div>',
    )
    expect(out).toContain('<b>粗</b>')
    expect(out).toContain('<i>斜</i>')
    expect(out).toContain('<s>删</s>')
    expect(out).not.toContain('strong')
    expect(out).not.toContain('div')
  })

  it('span 只保留白名单样式，丢弃布局类样式', () => {
    const out = normalizePastedHtml(
      '<p><span style="color: rgb(255, 0, 0); font-size: 18px; position: absolute; width: 999px">文字</span></p>',
    )
    expect(out).toContain('color')
    expect(out).toContain('font-size')
    expect(out).not.toContain('position')
    expect(out).not.toContain('width')
  })

  it('font 标签转 span 并保留颜色/字号/字体族', () => {
    const out = normalizePastedHtml(
      '<p><font color="#ff0000" size="5" face="SimSun">红字</font></p>',
    )
    expect(out).not.toContain('<font')
    expect(out).toContain('<span')
    expect(out).toContain('红字')
  })

  it('无安全 href 的 A 标签解包但保留文字', () => {
    const out = normalizePastedHtml('<p><a>无链接</a></p>')
    expect(out).not.toContain('<a')
    expect(out).toContain('无链接')
  })
})

describe('normalizePastedHtml 空内容', () => {
  it('纯空白 / 纯 script 返回空串（调用方回退纯文本粘贴）', () => {
    expect(normalizePastedHtml('')).toBe('')
    expect(normalizePastedHtml('   \n  ')).toBe('')
    expect(normalizePastedHtml('<script>alert(1)</script>')).toBe('')
  })

  it('删除完全空段落，但保留浏览器标准空行 <p><br></p>', () => {
    const out = normalizePastedHtml('<p></p><p><br></p><p>正文</p>')
    expect(out).not.toContain('<p></p>')
    expect(out).toContain('<br>')
    expect(out).toContain('正文')
  })

  it('表格 / 分割线算作真实内容，不会被当成空粘贴', () => {
    expect(normalizePastedHtml('<table><tbody><tr><td>x</td></tr></tbody></table>')).toContain('<table')
    expect(normalizePastedHtml('<hr>')).toContain('<hr')
  })
})
