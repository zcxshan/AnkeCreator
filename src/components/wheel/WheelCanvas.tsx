// ============================================================
// 玩转盘 - SVG 转盘渲染组件（糖果贴纸风）
//
// 功能：
//   - 按权重分配扇区角度（weight 越大扇区越大）
//   - 用 SVG 绘制圆形转盘
//   - 支持旋转动画（父组件通过 rAF 更新 rotation）
//   - 高亮中奖扇区（加粗描边 + 提亮 + 外圈光晕）
//   - 顶部指针 + 中心轮毂
//
// 设计：
//   - 糖果色循环 + 3px 墨水描边，贴纸手账观感
//   - 文字沿径向排列，按扇区角度自动选择字号并截断
//   - 默认 420px，由父容器决定自适应尺寸
// ============================================================

import { useId, useMemo } from 'react'
import type { WheelOption } from '../../types/wheel'
import { computeSectorGeometry } from '../../utils/wheelSpin'

export interface WheelCanvasProps {
  /** 选项列表（带权重） */
  options: WheelOption[]
  /** SVG 尺寸（px），默认 420 */
  size?: number
  /** 当前旋转角度（度），0 = 不旋转，正值顺时针 */
  rotation?: number
  /** 中奖扇区索引（高亮显示），undefined = 无高亮 */
  highlightIndex?: number
  /** 是否正在旋转（影响动效滤镜） */
  spinning?: boolean
}

/** 糖果色循环（与 --an-* 令牌同源） */
export const WHEEL_SECTOR_COLORS = [
  '#ff86b8',
  '#5cc6ff',
  '#4fdcae',
  '#ffd45e',
  '#b39bff',
  '#ffb38a',
  '#9be36b',
  '#ff9ad5',
]

const INK = '#40325c'
const DISPLAY_FONT =
  "'ZCOOL KuaiLe','YouYuan','幼圆','Yuanti SC','PingFang SC','Microsoft YaHei',system-ui,sans-serif"

function polarToCartesian(angleDeg: number, radius: number, cx: number, cy: number) {
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  }
}

function describeSector(
  startAngle: number,
  endAngle: number,
  radius: number,
  cx: number,
  cy: number,
): string {
  if (endAngle - startAngle >= 359.99) {
    return `M ${cx - radius} ${cy} A ${radius} ${radius} 0 1 1 ${cx + radius} ${cy} A ${radius} ${radius} 0 1 1 ${cx - radius} ${cy} Z`
  }
  const start = polarToCartesian(startAngle, radius, cx, cy)
  const end = polarToCartesian(endAngle, radius, cx, cy)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`
}

/** 根据扇区可用弧长截断文本 */
function fitText(text: string, maxChars: number): string {
  if (!text) return ''
  if (text.length <= maxChars) return text
  return text.slice(0, Math.max(1, maxChars - 1)) + '…'
}

export function WheelCanvas({
  options,
  size = 420,
  rotation = 0,
  highlightIndex,
  spinning = false,
}: WheelCanvasProps) {
  const filterId = useId().replace(/[:]/g, '')
  const cx = size / 2
  const cy = size / 2
  const radius = Math.max(60, size / 2 - 24)
  const hubSize = Math.max(48, Math.round(size * 0.17))

  const sectors = useMemo(() => computeSectorGeometry(options), [options])

  if (options.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-full"
        style={{
          width: size,
          height: size,
          background: 'var(--an-card, #ffffff)',
          border: `3px dashed ${INK}`,
          color: 'var(--an-ink-soft, #7d6f99)',
          fontSize: 13,
          fontFamily: DISPLAY_FONT,
        }}
      >
        暂无选项
      </div>
    )
  }

  // 高亮扇区最后绘制，避免被相邻扇区描边盖住
  const orderedSectors = [...sectors].sort((a, b) => {
    const aHi = a.index === highlightIndex ? 1 : 0
    const bHi = b.index === highlightIndex ? 1 : 0
    return aHi - bHi
  })

  return (
    <div style={{ width: size, height: size, position: 'relative' }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{
          transform: `rotate(${rotation}deg)`,
          filter: spinning ? 'blur(0.6px)' : undefined,
          display: 'block',
          willChange: 'transform',
        }}
      >
        <defs>
          <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#ff86b8" floodOpacity="0.75" />
          </filter>
        </defs>

        {/* 外圈白底 */}
        <circle
          cx={cx}
          cy={cy}
          r={radius + 8}
          fill="var(--an-card, #ffffff)"
          stroke={INK}
          strokeWidth={3}
          style={{ filter: 'drop-shadow(0 6px 0 rgba(64,50,92,0.18))' }}
        />

        {/* 扇区 */}
        {orderedSectors.map((sector) => {
          const span = sector.endAngle - sector.startAngle
          if (span <= 0.05) return null

          const option = options[sector.index]
          const isHighlighted = highlightIndex === sector.index
          const path = describeSector(sector.startAngle, sector.endAngle, radius, cx, cy)
          const textRadius = radius * 0.66
          const textPos = polarToCartesian(sector.midAngle, textRadius, cx, cy)
          const flipText = sector.midAngle > 90 && sector.midAngle < 270
          const fontSize = Math.max(11, Math.min(16, span * 0.55))
          // 文字可用的弧长（近似）→ 最大字符数
          const arcLength = (span * Math.PI * textRadius) / 180
          const maxChars = Math.max(1, Math.floor(arcLength / Math.max(fontSize * 0.95, 1)))
          const label = fitText(option?.text ?? '', maxChars)

          return (
            <g key={option?.id ?? sector.index}>
              <path
                d={path}
                fill={WHEEL_SECTOR_COLORS[sector.index % WHEEL_SECTOR_COLORS.length]}
                stroke={INK}
                strokeWidth={isHighlighted ? 5 : 3}
                strokeLinejoin="round"
                filter={isHighlighted ? `url(#${filterId})` : undefined}
                opacity={highlightIndex !== undefined && !isHighlighted ? 0.88 : 1}
              />
              {isHighlighted && (
                <path d={path} fill="#ffffff" opacity={0.18} />
              )}
              <text
                x={textPos.x}
                y={textPos.y}
                fill={INK}
                fontSize={fontSize}
                fontWeight={700}
                fontFamily={DISPLAY_FONT}
                textAnchor="middle"
                dominantBaseline="middle"
                transform={`rotate(${flipText ? sector.midAngle + 180 : sector.midAngle} ${textPos.x} ${textPos.y})`}
                style={{ pointerEvents: 'none', paintOrder: 'stroke', letterSpacing: '0.5px' }}
              >
                <title>{option?.text ?? ''}</title>
                {label}
              </text>
            </g>
          )
        })}
      </svg>

      {/* 顶部指针 */}
      <div
        style={{
          position: 'absolute',
          top: -8,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 2,
          filter: 'drop-shadow(0 4px 0 rgba(64,50,92,0.25))',
          pointerEvents: 'none',
        }}
      >
        <svg width={38} height={50} viewBox="0 0 38 50">
          <path
            d="M19 47 L3 15 Q1 5 11 5 L27 5 Q37 5 35 15 Z"
            fill="#fff"
            stroke={INK}
            strokeWidth={3}
            strokeLinejoin="round"
          />
          <circle cx={19} cy={16} r={6} fill={WHEEL_SECTOR_COLORS[0]} stroke={INK} strokeWidth={2.5} />
        </svg>
      </div>

      {/* 中心轮毂（不随转盘旋转） */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: hubSize,
          height: hubSize,
          transform: 'translate(-50%, -50%)',
          borderRadius: '50%',
          background: 'var(--an-card, #ffffff)',
          border: `3px solid ${INK}`,
          boxShadow: '0 4px 0 rgba(64,50,92,0.9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: INK,
          fontFamily: DISPLAY_FONT,
          fontSize: Math.round(hubSize * 0.42),
          lineHeight: 1,
          userSelect: 'none',
          zIndex: 1,
        }}
      >
        转
      </div>
    </div>
  )
}
