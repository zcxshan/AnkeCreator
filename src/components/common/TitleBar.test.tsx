import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TitleBar } from './TitleBar'

vi.mock('./AuthorInfo', () => ({ AuthorInfo: () => null }))
vi.mock('./SettingsDialog', () => ({ SettingsDialog: () => null }))

const originalApi = window.electronAPI
const controls = {
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
  onMaximizeStateChange: vi.fn(() => () => {}),
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  cleanup()
  window.electronAPI = originalApi
})

describe('platform window controls', () => {
  it('leaves macOS window controls to the native frame and keeps app actions', () => {
    window.electronAPI = { ...controls, platform: 'darwin' } as typeof window.electronAPI
    render(<TitleBar storyTitle="Test story" />)
    expect(screen.queryByTitle('最小化')).toBeNull()
    expect(screen.queryByTitle('最大化')).toBeNull()
    expect(screen.queryByTitle('关闭')).toBeNull()
    expect(screen.getByTitle('设置')).toBeTruthy()
    expect(screen.getByTitle('关于作者')).toBeTruthy()
    expect(screen.getByText('Test story')).toBeTruthy()
  })

  it('keeps Windows window buttons connected to their existing actions', () => {
    window.electronAPI = { ...controls, platform: 'win32' } as typeof window.electronAPI
    render(<TitleBar />)
    fireEvent.click(screen.getByTitle('最小化'))
    fireEvent.click(screen.getByTitle('最大化'))
    fireEvent.click(screen.getByTitle('关闭'))
    expect(controls.minimize).toHaveBeenCalledTimes(1)
    expect(controls.toggleMaximize).toHaveBeenCalledTimes(1)
    expect(controls.close).toHaveBeenCalledTimes(1)
  })
})
