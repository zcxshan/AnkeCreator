import { describe, expect, it } from 'vitest'
import { buildNgaRefererHeaders, NGA_IMAGE_URL_PATTERNS } from '../data-core/ngaReferer'

describe('nga referer', () => {
  it('覆盖 nga.cn / ngabbs.com / nga.178.com / nga.com', () => {
    expect(NGA_IMAGE_URL_PATTERNS).toEqual([
      'https://*.nga.cn/*',
      'https://*.ngabbs.com/*',
      'https://*.nga.178.com/*',
      'https://*.nga.com/*',
    ])
  })

  it('构造 Referer 与 UA 头', () => {
    expect(buildNgaRefererHeaders('https://bbs.nga.cn/')).toEqual({
      Referer: 'https://bbs.nga.cn/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })
  })

  it('未传 origin 时默认 bbs.nga.cn', () => {
    expect(buildNgaRefererHeaders()).toMatchObject({ Referer: 'https://bbs.nga.cn/' })
  })
})
