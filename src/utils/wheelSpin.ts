// ============================================================
// 玩转盘 - 旋转计算纯函数
//
// 与 WheelCanvas 共享扇区几何：
//   - 扇区从 12 点方向（-90°）开始顺时针排列
//   - 指针固定在 12 点方向（-90°）
//   - 旋转角度为正表示顺时针
//
// 抽离成纯函数便于单元测试落点归属、权重边界与单扇区 360°。
// ============================================================

export interface SectorGeometry {
  index: number
  startAngle: number
  endAngle: number
  midAngle: number
}

function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360
}

/**
 * 按权重计算每个扇区的起止角度（不含颜色）。
 */
export function computeSectorGeometry(
  options: ReadonlyArray<{ weight: number }>,
): SectorGeometry[] {
  const totalWeight = options.reduce((sum, o) => sum + Math.max(o.weight, 0), 0)
  if (totalWeight <= 0 || options.length === 0) return []

  let currentAngle = -90
  return options.map((opt, index) => {
    const weight = Math.max(opt.weight, 0)
    const angle = (weight / totalWeight) * 360
    const startAngle = currentAngle
    const endAngle = currentAngle + angle
    const midAngle = (startAngle + endAngle) / 2
    currentAngle = endAngle
    return { index, startAngle, endAngle, midAngle }
  })
}

/**
 * 按权重随机抽取一个索引。
 * random 可注入以便测试；返回 -1 表示没有可抽取项。
 */
export function pickWeightedIndex(
  options: ReadonlyArray<{ weight: number }>,
  random: () => number = Math.random,
): number {
  if (options.length === 0) return -1
  const totalWeight = options.reduce((sum, o) => sum + Math.max(o.weight, 0), 0)
  if (totalWeight <= 0) return 0

  const value = Math.min(Math.max(random(), 0), 0.999999) * totalWeight
  let accumulated = 0
  for (let i = 0; i < options.length; i++) {
    accumulated += Math.max(options[i].weight, 0)
    if (value < accumulated) return i
  }
  return options.length - 1
}

/** 判断某个角度是否落在指定扇区内（支持跨 0° 与整圆） */
export function isAngleInSector(angle: number, startAngle: number, endAngle: number): boolean {
  const span = endAngle - startAngle
  if (span >= 360) return true
  const offset = normalizeAngle(angle - startAngle)
  return offset <= span
}

export interface ComputeTargetRotationOptions {
  /** 额外整圈数，默认 5 */
  extraTurns?: number
  /**
   * 落点在扇区内的偏移比例，范围 -1~1（0 = 正中线）。
   * 用于让每次停下的位置有些许随机感，同时保证仍落在目标扇区。
   */
  offsetRatio?: number
}

/**
 * 计算让指定扇区落在顶部指针处所需的目标旋转角度。
 *
 * 返回角度始终大于 currentRotation，且至少额外旋转 extraTurns 圈。
 */
export function computeTargetRotation(
  options: ReadonlyArray<{ weight: number }>,
  targetIndex: number,
  currentRotation: number,
  { extraTurns = 5, offsetRatio = 0 }: ComputeTargetRotationOptions = {},
): number {
  const sectors = computeSectorGeometry(options)
  if (sectors.length === 0) {
    return currentRotation + 360 * Math.max(extraTurns, 1)
  }

  const safeIndex = Math.min(Math.max(targetIndex, 0), sectors.length - 1)
  const target = sectors[safeIndex]
  const halfAngle = (target.endAngle - target.startAngle) / 2
  const clampedOffset = Math.min(Math.max(offsetRatio, -0.95), 0.95)
  const landedMidAngle = target.midAngle + clampedOffset * halfAngle

  // 指针在 -90°：landedMidAngle + rotation ≡ -90 (mod 360)
  const delta = normalizeAngle(-90 - landedMidAngle)
  // 取不小于 currentRotation 的等价角度，再加整圈
  const base = Math.ceil((currentRotation - delta) / 360) * 360
  return base + delta + 360 * Math.max(extraTurns, 0)
}

/**
 * 根据旋转角度判断顶部指针当前指向哪个扇区。
 * 未命中任何扇区时返回 -1。
 */
export function getSectorIndexAtPointer(
  options: ReadonlyArray<{ weight: number }>,
  rotation: number,
  pointerAngle = -90,
): number {
  const sectors = computeSectorGeometry(options)
  if (sectors.length === 0) return -1
  const wheelAngle = normalizeAngle(pointerAngle - rotation)
  for (const sector of sectors) {
    if (isAngleInSector(wheelAngle, sector.startAngle, sector.endAngle)) {
      return sector.index
    }
  }
  return -1
}
