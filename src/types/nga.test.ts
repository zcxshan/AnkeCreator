import { describe, expect, it } from 'vitest'
import { parseNgaThreadUrl } from '../types/nga'

describe('parseNgaThreadUrl', () => {
  it('解析标准 read.php?tid= 链接', () => {
    expect(parseNgaThreadUrl('https://bbs.nga.cn/read.php?tid=123456')).toEqual({
      url: 'https://bbs.nga.cn/read.php?tid=123456',
      tid: '123456',
      baseUrl: 'https://bbs.nga.cn',
    })
  })

  it('支持 ngabbs / nga.178 域名与无协议输入', () => {
    expect(parseNgaThreadUrl('ngabbs.com/read.php?tid=99')?.tid).toBe('99')
    expect(parseNgaThreadUrl('https://nga.178.com/thread-88')?.tid).toBe('88')
  })

  it('拒绝非 NGA 域名与缺少 tid', () => {
    expect(parseNgaThreadUrl('https://example.com/read.php?tid=1')).toBeNull()
    expect(parseNgaThreadUrl('https://bbs.nga.cn/read.php')).toBeNull()
    expect(parseNgaThreadUrl('')).toBeNull()
  })
})
