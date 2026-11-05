import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Modal } from '../Modal'

function wait(ms = 30) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/** happy-dom 不实现布局，getClientRects 恒为空；Modal 用它过滤不可见元素，这里打桩成"可见" */
function stubVisibleLayout() {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    { x: 0, y: 0, width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 },
  ] as unknown as DOMRectList)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})

describe('Modal（键盘与焦点契约）', () => {
  it('渲染 dialog 语义与 aria 关联', () => {
    render(
      <Modal open onClose={() => {}} labelledBy="modal-title">
        <h3 id="modal-title">标题</h3>
        <button>确定</button>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('modal-title')
    expect(screen.getByRole('heading', { name: '标题' })).toBeTruthy()
  })

  it('Esc 关闭；closeOnEscape=false 时忽略', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Modal open onClose={onClose}>
        <button>确定</button>
      </Modal>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    onClose.mockClear()
    rerender(
      <Modal open closeOnEscape={false} onClose={onClose}>
        <button>确定</button>
      </Modal>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Tab 焦点陷阱：末元素 Tab 回到首元素，首元素 Shift+Tab 回到末元素', async () => {
    stubVisibleLayout()
    render(
      <Modal open onClose={() => {}}>
        <button>第一个</button>
        <button>第二个</button>
      </Modal>,
    )
    await wait()
    const first = screen.getByText('第一个')
    const last = screen.getByText('第二个')

    last.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    first.focus()
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('关闭后恢复焦点并解除滚动锁', async () => {
    const outside = document.createElement('button')
    outside.textContent = '外部'
    document.body.appendChild(outside)
    outside.focus()

    const { unmount } = render(
      <Modal open onClose={() => {}}>
        <button>确定</button>
      </Modal>,
    )
    expect(document.body.style.overflow).toBe('hidden')

    unmount()
    outside.remove()
    await wait(0)
    expect(document.body.style.overflow).toBe('')
    // 焦点恢复到打开前的元素（元素已移除时不应抛错）
    expect(document.activeElement).not.toBeNull()
  })

  it('点击遮罩关闭、点击内容不关闭', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Modal open onClose={onClose}>
        <button>内容</button>
      </Modal>,
    )
    const overlay = container.ownerDocument.body.lastElementChild as HTMLElement
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('内容'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
