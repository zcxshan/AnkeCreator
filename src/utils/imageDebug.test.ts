import { beforeEach, describe, expect, it } from 'vitest'
import { clearImageEvents, getRecentImageEvents, recordImageEvent } from './imageDebug'

beforeEach(() => {
  clearImageEvents()
})

describe('imageDebug', () => {
  it('只保留最近 50 条事件', () => {
    for (let index = 0; index < 60; index += 1) {
      recordImageEvent({
        src: `local:///img-${index}.png`,
        kind: 'local',
        ok: index % 2 === 0,
        reason: index % 2 === 0 ? undefined : '读取失败',
      })
    }
    const events = getRecentImageEvents()
    expect(events).toHaveLength(50)
    expect(events[0].src).toBe('local:///img-10.png')
    expect(events[49].src).toBe('local:///img-59.png')
  })

  it('clear 清空事件', () => {
    recordImageEvent({ src: 'a', kind: 'data', ok: true })
    clearImageEvents()
    expect(getRecentImageEvents()).toEqual([])
  })
})
