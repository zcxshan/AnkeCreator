import { describe, expect, it, vi } from 'vitest'
import { resolveImageSrc } from './imageSrc'

describe('resolveImageSrc', () => {
  it('空地址返回 empty 与中文原因', async () => {
    expect(await resolveImageSrc('   ')).toEqual({ src: '', kind: 'empty', reason: '图片地址为空' })
  })

  it('https 与 data 原样通过', async () => {
    expect(await resolveImageSrc('https://example.com/a.png')).toEqual({
      src: 'https://example.com/a.png',
      kind: 'remote',
    })
    expect(await resolveImageSrc('data:image/png;base64,AA')).toEqual({
      src: 'data:image/png;base64,AA',
      kind: 'data',
    })
  })

  it('local:// 交给 IPC 读取并返回 dataUrl', async () => {
    const readAsDataUrl = vi.fn(async () => ({ ok: true, dataUrl: 'data:image/png;base64,BB' }))
    const result = await resolveImageSrc('local://abc.png', { readAsDataUrl })
    expect(readAsDataUrl).toHaveBeenCalledWith('local:///abc.png')
    expect(result).toEqual({ src: 'data:image/png;base64,BB', kind: 'local' })
  })

  it('local:// 读取失败保留规范化地址与原因', async () => {
    const readAsDataUrl = vi.fn(async () => ({ ok: false, error: '文件不存在' }))
    expect(await resolveImageSrc('local://abc.png', { readAsDataUrl })).toEqual({
      src: 'local:///abc.png',
      kind: 'local',
      reason: '文件不存在',
    })
  })

  it('Windows 绝对路径与相对路径交给 IPC', async () => {
    const readAsDataUrl = vi.fn(async () => ({ ok: true, dataUrl: 'data:image/png;base64,CC' }))
    expect(await resolveImageSrc('C:\\images\\a.png', { readAsDataUrl })).toEqual({
      src: 'data:image/png;base64,CC',
      kind: 'file',
    })
    expect(await resolveImageSrc('images/a.png', { readAsDataUrl })).toEqual({
      src: 'data:image/png;base64,CC',
      kind: 'relative',
    })
  })
})
