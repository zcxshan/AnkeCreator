import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageHeader, PageContainer } from './PageScaffold'

describe('PageScaffold', () => {
  it('渲染标题与返回按钮', () => {
    const back = vi.fn()
    render(<PageHeader title="测试" onBack={back} />)
    expect(screen.getByRole('heading', { name: '测试' })).toBeTruthy()
    expect(screen.getByLabelText('返回')).toBeTruthy()
  })
  it('PageContainer 渲染子内容', () => {
    const { container } = render(<PageContainer><div>hello</div></PageContainer>)
    expect(container.textContent).toContain('hello')
  })
})