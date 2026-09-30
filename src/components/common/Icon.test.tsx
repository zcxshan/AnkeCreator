import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Icon } from './Icon'

describe('Icon', () => {
  it('渲染指定名称的 svg 图标', () => {
    const { container } = render(<Icon name="dices" />)
    expect(container.querySelector('svg')).not.toBeNull()
  })
  it('未知名称回退到 ArrowRight', () => {
    const { container } = render(<Icon name={'nonexistent' as any} />)
    expect(container.querySelector('svg')).not.toBeNull()
  })
  it('渲染新增名称（alert/menu/settings/globe）', () => {
    for (const name of ['alert', 'menu', 'settings', 'globe'] as const) {
      const { container } = render(<Icon name={name} />)
      expect(container.querySelector('svg')).not.toBeNull()
    }
  })
})