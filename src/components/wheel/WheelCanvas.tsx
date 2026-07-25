// ============================================================
// 玩转盘 - SVG 转盘渲染组件
//
// 功能：
//   - 按权重分配扇区角度（weight 越大扇区越大）
//   - 用 SVG 绘制圆形转盘
//   - 支持旋转动画（父组件控制 rotation 角度）
//   - 高亮中奖扇区
//
// 设计：
//   - 用 SVG 而非 Canvas，便于交互和样式
//   - 扇区颜色用预设调色板循环
//   - 文本沿扇区中线绘制，超长自动截断
// ============================================================

import { useMemo } from 'react'
import type { WheelOption } from '../../types/wheel'

export interface WheelCanvasProps {
  /** 选项列表（带权重） */
  options: WheelOption[]
  /** SVG 尺寸（px），默认 320 */
  size?: number
  /** 当前旋转角度（度），0 = 不旋转，正值顺时针 */
  rotation?: number
  /** 中奖扇区索引（高亮显示），undefined = 无高亮 */
  highlightIndex?: number
  /** 是否正在旋转（影响过渡动画） */
  spinning?: boolean
}

// 预设扇区颜色（暖色 + 冷色交替，避免相邻同色）
const SECTOR_COLORS = [
  '#f59e0b', // amber-500
  '#10b981', // emerald-500
  '#3b82f6', // blue-500
  '#ec4899', // pink-500
  '#8b5cf6', // violet-500
  '#ef4444', // red-500
  '#14b8a6', // teal-500
  '#f97316', // orange-500
  '#06b6d4', // cyan-500
  '#84cc16', // lime-500
  '#a855f7', // purple-500
  '#eab308', // yellow-500
]

/**
 * 计算每个扇区的起止角度和颜色
 */
function computeSectors(options: WheelOption[]) {
  const totalWeight = options.reduce((sum, o) => sum + Math.max(o.weight, 0), 0)
  if (totalWeight <= 0 || options.length === 0) return []

  let currentAngle = -90 // 从顶部开始（-90 度 = 12 点方向）
  return options.map((opt, idx) => {
    const weight = Math.max(opt.weight, 0)
    const angle = (weight / totalWeight) * 360
    const startAngle = currentAngle
    const endAngle = currentAngle + angle
    const midAngle = (startAngle + endAngle) / 2
    currentAngle = endAngle
    return {
      option: opt,
      index: idx,
      startAngle,
      endAngle,
      midAngle,
      color: SECTOR_COLORS[idx % SECTOR_COLORS.length],
    }
  })
}

/**
 * 极坐标转笛卡尔坐标
 * @param angleDeg 角度（度，0 = 右侧，90 = 下方）
 * @param radius 半径
 * @param cx 圆心 x
 * @param cy 圆心 y
 */
function polarToCartesian(angleDeg: number, radius: number, cx: number, cy: number) {
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  }
}

/**
 * 生成扇区路径（圆环扇形）
 */
function describeSector(
  startAngle: number,
  endAngle: number,
  radius: number,
  cx: number,
  cy: number,
): string {
  if (endAngle - startAngle >= 360) {
    // 完整圆
    return `M ${cx - radius} ${cy} A ${radius} ${radius} 0 1 1 ${cx + radius} ${cy} A ${radius} ${radius} 0 1 1 ${cx - radius} ${cy} Z`
  }
  const start = polarToCartesian(startAngle, radius, cx, cy)
  const end = polarToCartesian(endAngle, radius, cx, cy)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`
}

/**
 * 截断过长的选项文本（避免扇区文字溢出）
 */
function truncateText(text: string, maxLen: number): string {
  if (!text) return ''
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + '…'
}

export function WheelCanvas({
  options,
  size = 320,
  rotation = 0,
  highlightIndex,
  spinning = false,
}: WheelCanvasProps) {
  const cx = size / 2
  const cy = size / 2
  const radius = size / 2 - 8

  const sectors = useMemo(() => computeSectors(options), [options])

  // 根据扇区数量决定文本最大长度
  const maxTextLen = useMemo(() => {
    if (sectors.length <= 4) return 8
    if (sectors.length <= 8) return 6
    if (sectors.length <= 12) return 4
    return 3
  }, [sectors.length])

  if (options.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-full"
        style={{
          width: size,
          height: size,
          background: 'var(--bg-card)',
          border: '2px dashed var(--border-color)',
          color: 'var(--text-secondary)',
          fontSize: '14px',
        }}
      >
        暂无选项
      </div>
    )
  }

  return (
    <div style={{ width: size, height: size, position: 'relative' }}>
      {/* 顶部指针 */}
      <div
        style={{
          position: 'absolute',
          top: -4,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '10px solid transparent',
          borderRight: '10px solid transparent',
          borderTop: '18px solid var(--accent, #ef4444)',
          zIndex: 10,
          filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.2))',
        }}
      />
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: spinning
            ? 'transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99)'
            : 'none',
          display: 'block',
        }}
      >
        {/* 外圈边框 */}
        <circle
          cx={cx}
          cy={cy}
          r={radius + 4}
          fill="none"
          stroke="var(--border-color, #d1d5db)"
          strokeWidth={2}
        />
        {/* 扇区 */}
        {sectors.map((s) => {
          const isHighlighted = highlightIndex === s.index
          const path = describeSector(s.startAngle, s.endAngle, radius, cx, cy)
          // 文本位置（扇区中线，半径的 65% 处）
          const textPos = polarToCartesian(s.midAngle, radius * 0.65, cx, cy)
          // 文本旋转角度（让文字沿径向）
          const textRotation = s.midAngle
          // 文本是否需要翻转（避免倒着读）
          const flipText = s.midAngle > 90 && s.midAngle < 270
          return (
            <g key={s.option.id}>
              <path
                d={path}
                fill={s.color}
                fillOpacity={isHighlighted ? 1 : 0.85}
                stroke="#fff"
                strokeWidth={isHighlighted ? 3 : 1}
              />
              <text
                x={textPos.x}
                y={textPos.y}
                fill="#fff"
                fontSize={Math.max(10, Math.min(16, 80 / maxTextLen))}
                fontWeight={isHighlighted ? 'bold' : 'normal'}
                textAnchor="middle"
                dominantBaseline="middle"
                transform={`rotate(${flipText ? textRotation + 180 : textRotation} ${textPos.x} ${textPos.y})`}
                style={{ pointerEvents: 'none', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
              >
                {truncateText(s.option.text, maxTextLen)}
              </text>
            </g>
          )
        })}
        {/* 中心圆 */}
        <circle
          cx={cx}
          cy={cy}
          r={Math.max(12, radius * 0.08)}
          fill="#fff"
          stroke="var(--border-color, #d1d5db)"
          strokeWidth={2}
        />
        <circle
          cx={cx}
          cy={cy}
          r={Math.max(6, radius * 0.04)}
          fill="var(--accent, #ef4444)"
        />
      </svg>
    </div>
  )
}
