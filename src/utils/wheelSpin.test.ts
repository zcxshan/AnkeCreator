import { describe, expect, it } from 'vitest'
import {
  computeSectorGeometry,
  computeTargetRotation,
  getSectorIndexAtPointer,
  isAngleInSector,
  pickWeightedIndex,
} from './wheelSpin'

describe('computeSectorGeometry', () => {
  it('按权重均分扇区，总和为 360 度', () => {
    const sectors = computeSectorGeometry([{ weight: 1 }, { weight: 1 }, { weight: 1 }, { weight: 1 }])
    expect(sectors).toHaveLength(4)
    expect(sectors.map((s) => s.startAngle)).toEqual([-90, 0, 90, 180])
    expect(sectors.map((s) => s.endAngle)).toEqual([0, 90, 180, 270])
    expect(sectors[3].endAngle - sectors[0].startAngle).toBe(360)
  })

  it('单个扇区占满 360 度', () => {
    const sectors = computeSectorGeometry([{ weight: 5 }])
    expect(sectors).toHaveLength(1)
    expect(sectors[0].endAngle - sectors[0].startAngle).toBe(360)
    expect(sectors[0].midAngle).toBe(90)
  })

  it('权重为 0 的选项不占角度；全部为 0 时返回空', () => {
    const sectors = computeSectorGeometry([{ weight: 1 }, { weight: 0 }])
    expect(sectors).toHaveLength(2)
    expect(sectors[1].endAngle - sectors[1].startAngle).toBe(0)
    expect(computeSectorGeometry([{ weight: 0 }, { weight: 0 }])).toEqual([])
  })
})

describe('pickWeightedIndex', () => {
  it('随机数边界命中第一个/最后一个有效项', () => {
    expect(pickWeightedIndex([{ weight: 1 }, { weight: 1 }], () => 0)).toBe(0)
    expect(pickWeightedIndex([{ weight: 1 }, { weight: 1 }], () => 0.999)).toBe(1)
  })

  it('按权重区间归属', () => {
    const options = [{ weight: 1 }, { weight: 3 }]
    expect(pickWeightedIndex(options, () => 0.2)).toBe(0)
    expect(pickWeightedIndex(options, () => 0.4)).toBe(1)
    expect(pickWeightedIndex(options, () => 0.9)).toBe(1)
  })

  it('空列表返回 -1，全零权重回退到第一项', () => {
    expect(pickWeightedIndex([])).toBe(-1)
    expect(pickWeightedIndex([{ weight: 0 }, { weight: 0 }], () => 0.5)).toBe(0)
  })
})

describe('computeTargetRotation', () => {
  const options = [{ weight: 1 }, { weight: 1 }, { weight: 1 }, { weight: 1 }]

  it('落点精确落在目标扇区（含随机偏移）', () => {
    for (const targetIndex of [0, 1, 2, 3]) {
      for (const offsetRatio of [-0.9, -0.4, 0, 0.4, 0.9]) {
        const rotation = computeTargetRotation(options, targetIndex, 0, {
          extraTurns: 5,
          offsetRatio,
        })
        expect(getSectorIndexAtPointer(options, rotation)).toBe(targetIndex)
      }
    }
  })

  it('始终正向旋转，且至少额外转 5 圈', () => {
    const current = 12345
    const rotation = computeTargetRotation(options, 2, current, { extraTurns: 5 })
    expect(rotation).toBeGreaterThan(current)
    expect(rotation - current).toBeGreaterThanOrEqual(5 * 360)
    expect(rotation - current).toBeLessThan(6 * 360)
  })

  it('偏移为 0 时扇区中线正对指针', () => {
    const rotation = computeTargetRotation(options, 1, 0, { extraTurns: 1 })
    const wheelAngle = (((-90 - rotation) % 360) + 360) % 360
    const mid = (((computedMid(options, 1) % 360) + 360) % 360)
    expect(Math.abs(wheelAngle - mid)).toBeLessThan(1e-6)
  })

  it('单扇区 360 度时任意落点都命中该扇区', () => {
    const single = [{ weight: 2 }]
    const rotation = computeTargetRotation(single, 0, 720)
    expect(getSectorIndexAtPointer(single, rotation)).toBe(0)
  })

  it('空选项时回退为额外若干整圈', () => {
    expect(computeTargetRotation([], 0, 100, { extraTurns: 2 })).toBe(100 + 720)
  })
})

describe('isAngleInSector', () => {
  it('支持跨 0 度与整圆', () => {
    expect(isAngleInSector(0, -90, 90)).toBe(true)
    expect(isAngleInSector(90, -90, 90)).toBe(true)
    expect(isAngleInSector(91, -90, 90)).toBe(false)
    expect(isAngleInSector(200, 0, 360)).toBe(true)
  })
})

function computedMid(options: Array<{ weight: number }>, index: number): number {
  return computeSectorGeometry(options)[index].midAngle
}
