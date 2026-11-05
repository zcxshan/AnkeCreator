import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { WorksLoadingState, WorksErrorState } from '../WorksViews'

afterEach(() => cleanup())

describe('作品列表三态', () => {
  it('加载态带 role=status，不伪装成空库', () => {
    render(<WorksLoadingState />)
    const node = screen.getByRole('status')
    expect(node.textContent).toContain('正在加载作品列表')
  })

  it('错误态带 role=alert、展示原因并可重试', () => {
    const onRetry = vi.fn()
    render(<WorksErrorState message="读取 stories 目录失败" onRetry={onRetry} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('作品列表加载失败')
    expect(alert.textContent).toContain('读取 stories 目录失败')
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
