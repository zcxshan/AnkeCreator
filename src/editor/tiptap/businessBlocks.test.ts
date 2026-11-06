import { describe, expect, it } from 'vitest'
import { DOMParser as PMDOMParser, DOMSerializer } from '@tiptap/pm/model'
import { createAnkeSchema } from './schema'
import { sanitizeAnkeHtml, sanitizeBusinessBlocks } from './serialize'

function roundTrip(html: string): string {
  const host = document.createElement('div')
  host.innerHTML = html
  const schema = createAnkeSchema()
  const doc = PMDOMParser.fromSchema(schema).parse(host)
  const fragment = DOMSerializer.fromSchema(schema).serializeFragment(doc.content)
  const out = document.createElement('div')
  out.appendChild(fragment)
  return out.innerHTML
}

describe('business blocks', () => {
  it('折叠块 data-type / data-title / data-collapsed 往返保留', () => {
    const html =
      '<div data-type="collapse-block" data-title="点我展开" data-collapsed="false"><div class="collapse-body"><p>折叠正文</p></div></div>'
    const out = roundTrip(html)
    expect(out).toContain('data-type="collapse-block"')
    expect(out).toContain('data-title="点我展开"')
    expect(out).toContain('data-collapsed="false"')
    expect(out).toContain('折叠正文')
  })

  it('缺少 data-title / data-collapsed 时补默认值，不剥离块', () => {
    const out = sanitizeBusinessBlocks(
      '<div data-type="collapse-block"><div class="collapse-body"><p>正文</p></div></div>',
    )
    expect(out).toContain('data-type="collapse-block"')
    expect(out).toContain('data-title="折叠"')
    expect(out).toContain('data-collapsed="false"')
    expect(out).toContain('正文')
  })

  it('普通 blockquote 补成引用块并保留内容', () => {
    const out = sanitizeBusinessBlocks('<blockquote><p>引用内容</p></blockquote>')
    expect(out).toContain('data-type="quote-block"')
    expect(out).toContain('引用内容')
    expect(roundTrip(out)).toContain('引用内容')
  })

  it('sanitizeAnkeHtml 同时清理 ProseMirror 痕迹并保留业务块属性', () => {
    const out = sanitizeAnkeHtml(
      '<div data-type="collapse-block" data-title="标题" data-collapsed="true" class="ProseMirror-selectednode" contenteditable="false"><div class="collapse-body"><p>正文</p></div></div>',
    )
    expect(out).not.toContain('ProseMirror-selectednode')
    expect(out).not.toContain('contenteditable')
    expect(out).toContain('data-title="标题"')
    expect(out).toContain('data-collapsed="true"')
  })
})
