// ============================================================
// 玩转盘 - 抽取界面
//
// 功能：
//   - 按方案的阶段顺序链式抽取
//   - 每个阶段显示转盘 + 旋转抽取按钮
//   - 旋转动画 + 高亮中奖扇区
//   - 支持变量、条件、公式（前序阶段结果影响后续）
//   - 抽取完成后渲染 Prompt 模板
//   - 保存到历史记录
//   - 复制结果 / 复制 Prompt 到剪贴板
// ============================================================

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { WheelCanvas } from './WheelCanvas'
import type { WheelScheme, WheelStage, DrawResult, VariableScope } from '../../types/wheel'
import {
  evaluateCondition,
  evaluateFormula,
  renderPromptTemplate,
  formatDrawResults,
} from '../../utils/wheelExpression'

export interface WheelPlaygroundProps {
  /** 要抽取的方案 */
  scheme: WheelScheme
  /** 关闭/返回回调 */
  onClose: () => void
  /** 抽取完成时回调（保存历史记录） */
  onComplete?: (result: DrawResult[], finalPrompt?: string) => void
}

/**
 * 按权重抽取一个选项
 * 返回选中选项在 options 数组中的索引
 */
function pickWeightedIndex(options: { weight: number }[]): number {
  const totalWeight = options.reduce((sum, o) => sum + Math.max(o.weight, 0), 0)
  if (totalWeight <= 0) return 0
  let rand = Math.random() * totalWeight
  for (let i = 0; i < options.length; i++) {
    rand -= Math.max(options[i].weight, 0)
    if (rand <= 0) return i
  }
  return options.length - 1
}

/**
 * 计算让指定扇区对准顶部指针所需的旋转角度
 *
 * 顶部指针在 12 点方向（-90 度 / 270 度）
 * 扇区 i 的中线角度 = midAngle
 * 要让 midAngle 旋转后对准 -90 度，需要：
 *   rotation = -90 - midAngle + 360k（k 为正整数，确保旋转方向）
 * 实际中加多圈旋转让动画好看
 */
function computeRotationToHighlight(
  options: { weight: number }[],
  targetIndex: number,
  currentRotation: number,
): number {
  const totalWeight = options.reduce((sum, o) => sum + Math.max(o.weight, 0), 0)
  if (totalWeight <= 0) return currentRotation + 360 * 5

  // 计算目标扇区的中线角度（与 WheelCanvas 的 computeSectors 一致）
  let currentAngle = -90
  let midAngle = -90
  for (let i = 0; i < options.length; i++) {
    const weight = Math.max(options[i].weight, 0)
    const angle = (weight / totalWeight) * 360
    const start = currentAngle
    const end = currentAngle + angle
    if (i === targetIndex) {
      midAngle = (start + end) / 2
      break
    }
    currentAngle = end
  }

  // 目标：让 midAngle + rotation ≡ -90 (mod 360)
  // 即 rotation ≡ -90 - midAngle (mod 360)
  const targetRotation = -90 - midAngle
  // 加 5 圈让动画好看，并确保是正向旋转
  const baseRotation = Math.ceil((currentRotation - targetRotation) / 360) * 360 + targetRotation + 360 * 5
  return baseRotation
}

export function WheelPlayground({ scheme, onClose, onComplete }: WheelPlaygroundProps) {
  const [currentStageIdx, setCurrentStageIdx] = useState(0)
  const [variables, setVariables] = useState<VariableScope>({})
  const [allResults, setAllResults] = useState<DrawResult[]>([])
  const [stageResults, setStageResults] = useState<Record<string, string[]>>({})
  const [rotation, setRotation] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState<number | undefined>(undefined)
  const [currentStageResults, setCurrentStageResults] = useState<string[]>([])
  const [finished, setFinished] = useState(false)
  const spinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 清理定时器
  useEffect(() => {
    return () => {
      if (spinTimerRef.current) {
        clearTimeout(spinTimerRef.current)
      }
    }
  }, [])

  const stages = scheme.stages
  const currentStage: WheelStage | undefined = stages[currentStageIdx]

  // 当前阶段是否应该跳过（条件为 false）
  const stageSkipped = useMemo(() => {
    if (!currentStage) return false
    if (!currentStage.condition) return false
    return !evaluateCondition(currentStage.condition, variables)
  }, [currentStage, variables])

  // 当前阶段的有效选项（含公式生成的额外选项）
  const effectiveOptions = useMemo(() => {
    if (!currentStage) return []
    const opts = [...currentStage.options]
    if (currentStage.formula) {
      const formulaResult = evaluateFormula(currentStage.formula, variables)
      opts.push({
        id: '_formula',
        text: `🎲 ${formulaResult}`,
        weight: 1,
      })
    }
    return opts
  }, [currentStage, variables])

  // 当前阶段的进度
  const progressText = `阶段 ${currentStageIdx + 1} / ${stages.length}`

  // 完成所有抽取
  const finishDraw = useCallback(
    (results: DrawResult[], vars: VariableScope, stageRes: Record<string, string[]>) => {
      setFinished(true)
      // 渲染 Prompt 模板（如果有）
      let finalPrompt: string | undefined
      if (scheme.promptTemplate) {
        finalPrompt = renderPromptTemplate(scheme.promptTemplate, vars, stageRes)
      }
      // 回调保存历史
      if (onComplete) {
        onComplete(results, finalPrompt)
      }
    },
    [scheme.promptTemplate, onComplete],
  )

  // 推进到下一阶段
  const advanceToNextStage = useCallback(
    (results: DrawResult[], vars: VariableScope, stageRes: Record<string, string[]>) => {
      const nextIdx = currentStageIdx + 1
      if (nextIdx >= stages.length) {
        // 所有阶段完成
        finishDraw(results, vars, stageRes)
      } else {
        setCurrentStageIdx(nextIdx)
        setCurrentStageResults([])
        setHighlightIndex(undefined)
      }
    },
    [currentStageIdx, stages.length, finishDraw],
  )

  // 处理当前阶段（含条件跳过逻辑）
  const processCurrentStage = useCallback(
    (vars: VariableScope, stageRes: Record<string, string[]>) => {
      if (!currentStage) {
        finishDraw(allResults, vars, stageRes)
        return
      }
      // 检查条件
      if (currentStage.condition && !evaluateCondition(currentStage.condition, vars)) {
        // 条件不满足，跳过此阶段
        const skippedResult: DrawResult = {
          stageId: currentStage.id,
          stageName: currentStage.name,
          results: [],
          skipped: true,
        }
        const newResults = [...allResults, skippedResult]
        setAllResults(newResults)
        // 推进到下一阶段
        const nextIdx = currentStageIdx + 1
        if (nextIdx >= stages.length) {
          finishDraw(newResults, vars, stageRes)
        } else {
          setCurrentStageIdx(nextIdx)
          setCurrentStageResults([])
        }
        return
      }
      // 条件满足，等待用户点击"旋转抽取"
    },
    [currentStage, allResults, currentStageIdx, stages.length, finishDraw],
  )

  // 用户点击"旋转抽取"
  const handleSpin = useCallback(() => {
    if (!currentStage || spinning || effectiveOptions.length === 0) return
    if (stageSkipped) {
      // 已跳过，直接推进
      processCurrentStage(variables, stageResults)
      return
    }

    setSpinning(true)
    setHighlightIndex(undefined)

    // 先决定中奖项
    const targetIdx = pickWeightedIndex(effectiveOptions)

    // 计算旋转角度
    const targetRotation = computeRotationToHighlight(
      effectiveOptions,
      targetIdx,
      rotation,
    )
    setRotation(targetRotation)

    // 4 秒后（动画结束）记录结果
    spinTimerRef.current = setTimeout(() => {
      const picked = effectiveOptions[targetIdx]
      const newResults = [...currentStageResults, picked.text]
      setCurrentStageResults(newResults)

      // 如果还需要继续抽取（drawCount > 1 且未去重池空）
      if (newResults.length < currentStage.drawCount) {
        // 继续抽取下一个
        setHighlightIndex(targetIdx)
        setSpinning(false)
        // 自动开始下一次旋转
        setTimeout(() => {
          handleSpin()
        }, 800)
      } else {
        // 当前阶段抽取完成
        setHighlightIndex(targetIdx)

        // 记录到 allResults
        const drawResult: DrawResult = {
          stageId: currentStage.id,
          stageName: currentStage.name,
          results: newResults,
          variableName: currentStage.outputVariable,
          variableValue: newResults.join('、'),
        }
        const updatedAllResults = [...allResults, drawResult]
        setAllResults(updatedAllResults)

        // 更新变量
        const updatedVars = { ...variables }
        if (currentStage.outputVariable) {
          updatedVars[currentStage.outputVariable] = newResults.join('、')
        }
        setVariables(updatedVars)

        // 更新阶段结果（用于 Prompt 模板的 {{stageName}} 占位符）
        const updatedStageResults = {
          ...stageResults,
          [currentStage.name]: newResults,
        }
        setStageResults(updatedStageResults)

        setSpinning(false)

        // 推进到下一阶段
        setTimeout(() => {
          advanceToNextStage(updatedAllResults, updatedVars, updatedStageResults)
        }, 1000)
      }
    }, 4100) // 略大于 CSS transition 时长（4s）
  }, [
    currentStage,
    spinning,
    effectiveOptions,
    stageSkipped,
    processCurrentStage,
    variables,
    stageResults,
    rotation,
    currentStageResults,
    allResults,
    advanceToNextStage,
  ])

  // 重置抽取
  const handleReset = useCallback(() => {
    setCurrentStageIdx(0)
    setVariables({})
    setAllResults([])
    setStageResults({})
    setRotation(0)
    setSpinning(false)
    setHighlightIndex(undefined)
    setCurrentStageResults([])
    setFinished(false)
  }, [])

  // 复制到剪贴板
  const copyToClipboard = useCallback(async (text: string, label: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      // 简单提示（不引入 toast store 避免耦合）
      console.log(`[wheel] ${label} 已复制到剪贴板`)
    } catch (e) {
      console.error('[wheel] 复制失败:', e)
    }
  }, [])

  // 最终 Prompt（如果方案有 promptTemplate）
  const finalPrompt = useMemo(() => {
    if (!finished || !scheme.promptTemplate) return ''
    return renderPromptTemplate(scheme.promptTemplate, variables, stageResults)
  }, [finished, scheme.promptTemplate, variables, stageResults])

  // 拼接结果文本
  const resultsText = useMemo(() => formatDrawResults(allResults), [allResults])

  // 已抽取的变量列表（用于显示）
  const variableList = useMemo(() => {
    return Object.entries(variables).map(([k, v]) => ({ name: k, value: String(v) }))
  }, [variables])

  if (stages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="text-4xl mb-4">🎡</div>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          这个方案还没有阶段，请先编辑方案添加阶段
        </p>
        <button
          onClick={onClose}
          className="mt-6 px-4 py-2 text-sm rounded-lg"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
        >
          返回编辑
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-6 py-6">
      {/* 顶部：进度 + 当前阶段名 */}
      {!finished && currentStage && (
        <>
          <div className="text-center">
            <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
              {progressText}
            </div>
            <div className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              {currentStage.name}
            </div>
            {stageSkipped && (
              <div className="mt-2 text-xs px-3 py-1 rounded-full" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>
                条件不满足，已跳过此阶段
              </div>
            )}
          </div>

          {/* 已抽取变量列表 */}
          {variableList.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-center">
              {variableList.map((v) => (
                <span
                  key={v.name}
                  className="px-2 py-1 rounded text-xs"
                  style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
                >
                  {v.name} = {v.value}
                </span>
              ))}
            </div>
          )}

          {/* 当前阶段已抽取结果 */}
          {currentStageResults.length > 0 && (
            <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
              已抽取：{currentStageResults.join('、')}
            </div>
          )}

          {/* 转盘 */}
          <WheelCanvas
            options={effectiveOptions}
            size={320}
            rotation={rotation}
            highlightIndex={highlightIndex}
            spinning={spinning}
          />

          {/* 旋转按钮 */}
          <button
            onClick={handleSpin}
            disabled={spinning || stageSkipped}
            className="px-8 py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: spinning ? 'var(--bg-hover)' : 'var(--accent-bg)',
              color: spinning ? 'var(--text-secondary)' : 'var(--accent)',
              border: '1px solid var(--accent)',
            }}
          >
            {spinning ? '旋转中...' : stageSkipped ? '已跳过' : '🎲 旋转抽取'}
          </button>

          {/* 阶段配置摘要 */}
          <div className="text-xs text-center max-w-md" style={{ color: 'var(--text-tertiary, #888)' }}>
            {currentStage.drawCount > 1 && `抽取 ${currentStage.drawCount} 次`}
            {currentStage.drawCount > 1 && currentStage.unique && '（去重）'}
            {currentStage.outputVariable && ` · 存入变量 ${currentStage.outputVariable}`}
            {currentStage.condition && ` · 条件：${currentStage.condition}`}
            {currentStage.formula && ` · 公式：${currentStage.formula}`}
          </div>
        </>
      )}

      {/* 完成界面 */}
      {finished && (
        <>
          <div className="text-center">
            <div className="text-4xl mb-2">🎉</div>
            <div className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              抽取完成
            </div>
          </div>

          {/* 结果列表 */}
          <div
            className="w-full max-w-2xl rounded-xl p-5"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
          >
            <div className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
              抽取结果
            </div>
            <div className="space-y-2">
              {allResults.map((r, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 py-2"
                  style={{ borderBottom: idx < allResults.length - 1 ? '1px solid var(--border-color)' : 'none' }}
                >
                  <div className="shrink-0 text-sm font-medium" style={{ color: 'var(--text-secondary)', minWidth: 80 }}>
                    {r.stageName}
                  </div>
                  <div className="flex-1 text-sm" style={{ color: r.skipped ? 'var(--text-tertiary, #888)' : 'var(--text-primary)' }}>
                    {r.skipped ? '（已跳过）' : r.results.join('、')}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Prompt 模板渲染结果 */}
          {finalPrompt && (
            <div
              className="w-full max-w-2xl rounded-xl p-5"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--accent)' }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  生成的 Prompt
                </div>
                <button
                  onClick={() => copyToClipboard(finalPrompt, 'Prompt')}
                  className="px-3 py-1 text-xs rounded-lg transition-colors"
                  style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
                >
                  📋 复制 Prompt
                </button>
              </div>
              <pre
                className="text-sm whitespace-pre-wrap"
                style={{ color: 'var(--text-primary)', fontFamily: 'inherit', margin: 0 }}
              >
                {finalPrompt}
              </pre>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex gap-3">
            <button
              onClick={() => copyToClipboard(resultsText, '结果')}
              className="px-4 py-2 text-sm rounded-lg transition-colors"
              style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >
              📋 复制结果
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2 text-sm rounded-lg transition-colors"
              style={{ background: 'var(--accent-bg)', color: 'var(--accent)', border: '1px solid var(--accent)' }}
            >
              🔄 再次抽取
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg transition-colors"
              style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >
              返回
            </button>
          </div>
        </>
      )}
    </div>
  )
}
