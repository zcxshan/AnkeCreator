import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachImageErrorHandler } from './imageBlockDom'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('attachImageErrorHandler', () => {
  it('本地图片读取失败时显示文件名、原因与重新选择入口', async () => {
    const img = document.createElement('img')
    document.body.appendChild(img)
    attachImageErrorHandler(img, 'local:///missing.png', {
      reason: '文件不存在',
      onReselect: () => {},
    })
    img.dispatchEvent(new Event('error'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const hint = img.nextElementSibling as HTMLElement
    expect(hint.classList.contains('img-error-hint')).toBe(true)
    expect(hint.textContent).toContain('[图片无法加载]')
    expect(hint.textContent).toContain('missing.png')
    expect(hint.textContent).toContain('文件不存在')
    expect(hint.querySelector('.img-error-reselect')?.textContent).toBe('重新选择图片')
  })

  it('点击重新选择图片触发回调', async () => {
    const img = document.createElement('img')
    document.body.appendChild(img)
    const onReselect = vi.fn()
    attachImageErrorHandler(img, 'https://example.com/a.png', { onReselect })
    img.dispatchEvent(new Event('error'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const button = img.nextElementSibling?.querySelector('.img-error-reselect') as HTMLButtonElement
    button.click()
    expect(onReselect).toHaveBeenCalledTimes(1)
  })
})
