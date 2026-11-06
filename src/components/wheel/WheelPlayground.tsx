// ============================================================
// 玩转盘 - 抽取界面（糖果贴纸风）
//
// 功能：
//   - 按方案的阶段顺序链式抽取
//   - rAF + easeOutQuart 旋转，落点精确对准顶部指针
//   - 旋转结束中奖弹层 + 彩带（prefers-reduced-motion 下关闭）
//   - 支持变量、条件、公式（前序阶段结果影响后续）
//   - 抽取完成后渲染 Prompt 模板并保存历史
//   - 复制结果 / 复制 Prompt / 再次抽取
// ============================================================

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { Icon } from '../common/Icon'
import { WheelCanvas } from './WheelCanvas'
import type { WheelScheme, WheelStage, DrawResult, VariableScope } from '../../types/wheel'
import {
  evaluateCondition,
  evaluateFormula,
  renderPromptTemplate,
  formatDrawResults,
} from '../../utils/wheelExpression'
import { computeTargetRotation, pickWeightedIndex } from '../../utils/wheelSpin'

export interface WheelPlaygroundProps {
  /** 要抽取的方案 */
  scheme: WheelScheme
  /** 关闭/返回回调 */
  onClose: () => void
  /** 抽取完成时回调（保存历史记录） */
  onComplete?: (result: DrawResult[], finalPrompt?: string) => void
}

const CONFETTI_COLORS = [
  '#ff86b8',
  '#5cc6ff',
  '#4fdcae',
  '#ffd45e',
  '#b39bff',
  '#ffb38a',
  '#9be36b',
]

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const handler = (event: MediaQueryListEvent) => setReduced(event.matches)
    mq.addEventListener?.('change', handler)
    return () => mq.removeEventListener?.('change', handler)
  }, [])
  return reduced
}

function useWideLayout(minWidth = 1100): boolean {
  const [wide, setWide] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth >= minWidth,
  )
  useEffect(() => {
    const mq = window.matchMedia?.(`(min-width: ${minWidth}px)`)
    if (!mq) return
    const handler = (event: MediaQueryListEvent) => setWide(event.matches)
    mq.addEventListener?.('change', handler)
    return () => mq.removeEventListener?.('change', handler)
  }, [minWidth])
  return wide
}

function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4)
}

/** 彩带装饰 */
function Confetti({ burst }: { burst: number }) {
  const pieces = useMemo(() => {
    if (!burst) return []
    return Array.from({ length: 18 }, (_, i) => ({
      left: Math.random() * 92 + 4,
      delay: Math.random() * 0.35,
      duration: 1.05 + Math.random() * 0.5,
      dx: Math.round((Math.random() - 0.5) * 140),
      rot: Math.round(360 + Math.random() * 540),
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    }))
  }, [burst])

  if (!burst) return null
  return (
    <div
      key={burst}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 4,
      }}
    >
      {pieces.map((p, i) => (
        <span
          key={i}
          className="an-confetti"
          style={{
            left: `${p.left}%`,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            ['--dx' as string]: `${p.dx}px`,
            ['--rot' as string]: `${p.rot}deg`,
          }}
        />
      ))}
    </div>
  )
}

export function WheelPlayground({ scheme, onClose, onComplete }: WheelPlaygroundProps) {
  const reducedMotion = usePrefersReducedMotion()
  const wide = useWideLayout()

  const [currentStageIdx, setCurrentStageIdx] = useState(0)
  const [variables, setVariables] = useState<VariableScope>({})
  const [allResults, setAllResults] = useState<DrawResult[]>([])
  const [stageResults, setStageResults] = useState<Record<string, string[]>>({})
  const [rotation, setRotation] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState<number | undefined>(undefined)
  const [currentStageResults, setCurrentStageResults] = useState<string[]>([])
  const [finished, setFinished] = useState(false)
  const [prize, setPrize] = useState<{ text: string; key: number } | null>(null)
  const [confettiBurst, setConfettiBurst] = useState(0)

  const rotationRef = useRef(0)
  const spinningRef = useRef(false)
  const spinRef = useRef<(() => void) | null>(null)
  const rafRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wheelWrapRef = useRef<HTMLDivElement | null>(null)
  const [wheelSize, setWheelSize] = useState(() =>
    typeof window === 'undefined' ? 420 : Math.max(260, Math.min(420, window.innerWidth - 80)),
  )

  // 转盘尺寸自适应（420 → 容器宽）
  useEffect(() => {
    const el = wheelWrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const width = el.clientWidth
      if (width > 0) setWheelSize(Math.max(260, Math.min(420, Math.floor(width))))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 清理动画与定时器
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [])

  const stages = scheme.stages
  const currentStage: WheelStage | undefined = stages[currentStageIdx]

  const stageSkipped = useMemo(() => {
    if (!currentStage) return false
    if (!currentStage.condition) return false
    return !evaluateCondition(currentStage.condition, variables)
  }, [currentStage, variables])

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

  const progressText = `阶段 ${currentStageIdx + 1} / ${stages.length}`

  const finishDraw = useCallback(
    (results: DrawResult[], vars: VariableScope, stageRes: Record<string, string[]>) => {
      setFinished(true)
      let finalPrompt: string | undefined
      if (scheme.promptTemplate) {
        finalPrompt = renderPromptTemplate(scheme.promptTemplate, vars, stageRes)
      }
      onComplete?.(results, finalPrompt)
    },
    [scheme.promptTemplate, onComplete],
  )

  const advanceToNextStage = useCallback(
    (results: DrawResult[], vars: VariableScope, stageRes: Record<string, string[]>) => {
      const nextIdx = currentStageIdx + 1
      if (nextIdx >= stages.length) {
        finishDraw(results, vars, stageRes)
      } else {
        setCurrentStageIdx(nextIdx)
        setCurrentStageResults([])
        setHighlightIndex(undefined)
      }
    },
    [currentStageIdx, stages.length, finishDraw],
  )

  const processCurrentStage = useCallback(
    (vars: VariableScope, stageRes: Record<string, string[]>) => {
      if (!currentStage) {
        finishDraw(allResults, vars, stageRes)
        return
      }
      if (currentStage.condition && !evaluateCondition(currentStage.condition, vars)) {
        const skippedResult: DrawResult = {
          stageId: currentStage.id,
          stageName: currentStage.name,
          results: [],
          skipped: true,
        }
        const newResults = [...allResults, skippedResult]
        setAllResults(newResults)
        const nextIdx = currentStageIdx + 1
        if (nextIdx >= stages.length) {
          finishDraw(newResults, vars, stageRes)
        } else {
          setCurrentStageIdx(nextIdx)
          setCurrentStageResults([])
        }
      }
    },
    [currentStage, allResults, currentStageIdx, stages.length, finishDraw],
  )

  // 落点后写入阶段结果
  const commitSpin = useCallback(
    (targetIdx: number) => {
      if (!currentStage) return
      const picked = effectiveOptions[targetIdx]
      if (!picked) return
      const newResults = [...currentStageResults, picked.text]

      if (newResults.length < currentStage.drawCount) {
        setCurrentStageResults(newResults)
        timerRef.current = setTimeout(() => {
          setPrize(null)
          spinRef.current?.()
        }, 950)
        return
      }

      const drawResult: DrawResult = {
        stageId: currentStage.id,
        stageName: currentStage.name,
        results: newResults,
        variableName: currentStage.outputVariable,
        variableValue: newResults.join('、'),
      }
      const updatedAllResults = [...allResults, drawResult]
      setAllResults(updatedAllResults)

      const updatedVars = { ...variables }
      if (currentStage.outputVariable) {
        updatedVars[currentStage.outputVariable] = newResults.join('、')
      }
      setVariables(updatedVars)

      const updatedStageResults = { ...stageResults, [currentStage.name]: newResults }
      setStageResults(updatedStageResults)

      timerRef.current = setTimeout(() => {
        setPrize(null)
        advanceToNextStage(updatedAllResults, updatedVars, updatedStageResults)
      }, 1100)
    },
    [
      currentStage,
      effectiveOptions,
      currentStageResults,
      allResults,
      variables,
      stageResults,
      advanceToNextStage,
    ],
  )

  const commitSpinRef = useRef(commitSpin)
  commitSpinRef.current = commitSpin

  // rAF 旋转动画
  const animateTo = useCallback(
    (target: number, duration: number, onDone: () => void) => {
      const startRotation = rotationRef.current
      const startedAt = performance.now()
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)

      const frame = (now: number) => {
        const t = Math.min(1, (now - startedAt) / duration)
        const value = startRotation + (target - startRotation) * easeOutQuart(t)
        rotationRef.current = value
        setRotation(value)
        if (t < 1) {
          rafRef.current = requestAnimationFrame(frame)
        } else {
          rafRef.current = null
          rotationRef.current = target
          setRotation(target)
          onDone()
        }
      }
      rafRef.current = requestAnimationFrame(frame)
    },
    [],
  )

  const handleSpin = useCallback(() => {
    if (!currentStage || spinningRef.current || effectiveOptions.length === 0) return
    if (stageSkipped) {
      processCurrentStage(variables, stageResults)
      return
    }

    spinningRef.current = true
    setSpinning(true)
    setHighlightIndex(undefined)
    setPrize(null)

    const targetIdx = pickWeightedIndex(effectiveOptions)
    const extraTurns = reducedMotion ? 1 : 4 + Math.floor(Math.random() * 3)
    const offsetRatio = reducedMotion ? 0 : (Math.random() * 2 - 1) * 0.7
    const targetRotation = computeTargetRotation(
      effectiveOptions,
      targetIdx,
      rotationRef.current,
      { extraTurns, offsetRatio },
    )
    const duration = reducedMotion ? 650 : 3200 + Math.random() * 1000

    animateTo(targetRotation, duration, () => {
      spinningRef.current = false
      setSpinning(false)
      setHighlightIndex(targetIdx)
      setPrize({ text: effectiveOptions[targetIdx]?.text ?? '', key: Date.now() })
      if (!reducedMotion) setConfettiBurst((n) => n + 1)
      commitSpinRef.current(targetIdx)
    })
  }, [
    currentStage,
    effectiveOptions,
    stageSkipped,
    processCurrentStage,
    variables,
    stageResults,
    reducedMotion,
    animateTo,
  ])

  spinRef.current = handleSpin

  const handleReset = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    rafRef.current = null
    timerRef.current = null
    spinningRef.current = false
    rotationRef.current = 0
    setCurrentStageIdx(0)
    setVariables({})
    setAllResults([])
    setStageResults({})
    setRotation(0)
    setSpinning(false)
    setHighlightIndex(undefined)
    setCurrentStageResults([])
    setFinished(false)
    setPrize(null)
  }, [])

  const copyToClipboard = useCallback(async (text: string, label: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      console.log(`[wheel] ${label} 已复制到剪贴板`)
    } catch (e) {
      console.error('[wheel] 复制失败:', e)
    }
  }, [])

  const finalPrompt = useMemo(() => {
    if (!finished || !scheme.promptTemplate) return ''
    return renderPromptTemplate(scheme.promptTemplate, variables, stageResults)
  }, [finished, scheme.promptTemplate, variables, stageResults])

  const resultsText = useMemo(() => formatDrawResults(allResults), [allResults])

  const variableList = useMemo(
    () => Object.entries(variables).map(([k, v]) => ({ name: k, value: String(v) })),
    [variables],
  )

  const stageStatus = useCallback(
    (index: number): 'done' | 'current' | 'pending' | 'skipped' => {
      if (index < currentStageIdx) {
        const record = allResults.find((r) => r.stageId === stages[index].id)
        return record?.skipped ? 'skipped' : 'done'
      }
      if (index === currentStageIdx && !finished) return 'current'
      return 'pending'
    },
    [currentStageIdx, allResults, stages, finished],
  )

  if (stages.length === 0) {
    return (
      <div className="an-empty">
        <Icon name="wheel" size={56} />
        <div className="an-empty__title">这个方案还没有阶段</div>
        <div className="an-empty__desc">请先编辑方案，添加至少一个阶段和若干选项。</div>
        <button className="an-btn an-btn--pink" onClick={onClose}>
          <Icon name="back" size={16} /> 返回编辑
        </button>
      </div>
    )
  }

  const stageRail = (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="an-card" style={{ padding: 16 }}>
        <div className="an-badge">阶段进度</div>
        <ol style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {stages.map((stage, index) => {
            const status = stageStatus(index)
            const record = allResults.find((r) => r.stageId === stage.id)
            const statusColor =
              status === 'done'
                ? 'var(--an-mint)'
                : status === 'current'
                  ? 'var(--an-pink)'
                  : status === 'skipped'
                    ? 'var(--an-ink-faint)'
                    : 'transparent'
            return (
              <li key={stage.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span
                  style={{
                    flex: '0 0 auto',
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    border: `2px solid var(--an-ink)`,
                    background: statusColor,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 700,
                    color: status === 'done' || status === 'current' ? '#fff' : 'var(--an-ink)',
                  }}
                >
                  {status === 'done' ? '✓' : status === 'skipped' ? '×' : index + 1}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: status === 'pending' ? 'var(--an-ink-soft)' : 'var(--an-ink)',
                      textDecoration: status === 'skipped' ? 'line-through' : 'none',
                    }}
                  >
                    {stage.name}
                  </div>
                  {record && !record.skipped && (
                    <div style={{ fontSize: 12, color: 'var(--an-ink-soft)', marginTop: 2 }}>
                      {record.results.join('、')}
                    </div>
                  )}
                  {status === 'current' && !finished && (
                    <div style={{ fontSize: 12, color: 'var(--an-pink)', marginTop: 2 }}>
                      正在抽取…
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </div>

      {variableList.length > 0 && (
        <div className="an-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--an-ink-soft)', marginBottom: 8 }}>
            已抽取变量
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {variableList.map((v) => (
              <span key={v.name} className="an-chip">
                {v.name} = {v.value}
              </span>
            ))}
          </div>
        </div>
      )}

      <button className="an-btn an-btn--ghost an-btn--sm" onClick={onClose}>
        <Icon name="back" size={14} /> 退出抽取
      </button>
    </aside>
  )

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: wide ? 'minmax(0, 1fr) 330px' : 'minmax(0, 1fr)',
        gap: 24,
        alignItems: 'start',
      }}
    >
      <div style={{ minWidth: 0 }}>
        {!finished && currentStage && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <span className="an-badge">{progressText}</span>
              <h2
                style={{
                  margin: '12px 0 0',
                  fontFamily: 'var(--an-font-display)',
                  fontSize: 30,
                  color: 'var(--an-ink)',
                }}
              >
                {currentStage.name}
              </h2>
              {stageSkipped && (
                <div style={{ marginTop: 8, fontSize: 13, color: 'var(--an-ink-soft)' }}>
                  条件不满足，已跳过此阶段
                </div>
              )}
            </div>

            {currentStageResults.length > 0 && (
              <div style={{ textAlign: 'center', marginBottom: 10 }}>
                <span className="an-chip">已抽取：{currentStageResults.join('、')}</span>
              </div>
            )}

            <div ref={wheelWrapRef} style={{ width: '100%', maxWidth: 440, margin: '0 auto' }}>
              <div style={{ position: 'relative', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <WheelCanvas
                    options={effectiveOptions}
                    size={wheelSize}
                    rotation={rotation}
                    highlightIndex={highlightIndex}
                    spinning={spinning}
                  />
                </div>
                <Confetti burst={reducedMotion ? 0 : confettiBurst} />
                {prize && !spinning && (
                  <div
                    key={prize.key}
                    className="an-pop-in"
                    style={{
                      position: 'absolute',
                      left: '50%',
                      bottom: wheelSize * 0.06,
                      transform: 'translateX(-50%)',
                      zIndex: 5,
                      pointerEvents: 'none',
                    }}
                  >
                    <span
                      className="an-badge"
                      style={{
                        fontSize: 16,
                        padding: '10px 20px',
                        transform: 'none',
                        boxShadow: '0 4px 0 var(--an-ink)',
                      }}
                    >
                      🎉 {prize.text}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}>
              <button
                className="an-btn an-btn--pink"
                onClick={handleSpin}
                disabled={spinning || stageSkipped}
                style={{ fontSize: 20, minHeight: 52, padding: '14px 36px' }}
              >
                {spinning ? (
                  '旋转中…'
                ) : stageSkipped ? (
                  '已跳过'
                ) : (
                  <>
                    <Icon name="dices" size={22} /> 旋转抽取
                  </>
                )}
              </button>
            </div>

            <div
              style={{
                marginTop: 12,
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--an-ink-soft)',
              }}
            >
              {currentStage.drawCount > 1 && `抽取 ${currentStage.drawCount} 次`}
              {currentStage.drawCount > 1 && currentStage.unique && '（去重）'}
              {currentStage.outputVariable && ` · 存入变量 ${currentStage.outputVariable}`}
              {currentStage.condition && ` · 条件：${currentStage.condition}`}
              {currentStage.formula && ` · 公式：${currentStage.formula}`}
            </div>
          </>
        )}

        {finished && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <Icon name="party" size={32} />
              <h2
                style={{
                  margin: 0,
                  fontFamily: 'var(--an-font-display)',
                  fontSize: 30,
                  color: 'var(--an-ink)',
                }}
              >
                抽取完成
              </h2>
            </div>

            <div className="an-card" style={{ padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>抽取结果</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {allResults.map((r, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      gap: 12,
                      alignItems: 'flex-start',
                      padding: '8px 0',
                      borderBottom:
                        idx < allResults.length - 1 ? '1px dashed var(--an-ink-faint)' : 'none',
                    }}
                  >
                    <div style={{ width: 90, flex: '0 0 auto', fontSize: 13, fontWeight: 700 }}>
                      {r.stageName}
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        color: r.skipped ? 'var(--an-ink-soft)' : 'var(--an-ink)',
                      }}
                    >
                      {r.skipped ? '（已跳过）' : r.results.join('、')}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {finalPrompt && (
              <div className="an-card" style={{ padding: 20, marginTop: 16 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 12,
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 700 }}>生成的 Prompt</div>
                  <button
                    className="an-btn an-btn--sm an-btn--sky"
                    onClick={() => copyToClipboard(finalPrompt, 'Prompt')}
                  >
                    <Icon name="copy" size={14} /> 复制
                  </button>
                </div>
                <pre
                  className="an-scroll"
                  style={{
                    margin: 0,
                    maxHeight: 280,
                    overflow: 'auto',
                    padding: 12,
                    borderRadius: 14,
                    background: 'var(--an-paper-2)',
                    border: '2px dashed var(--an-ink-faint)',
                    fontSize: 13,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'inherit',
                  }}
                >
                  {finalPrompt}
                </pre>
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 18 }}>
              <button
                className="an-btn an-btn--sm an-btn--ghost"
                onClick={() => copyToClipboard(resultsText, '结果')}
              >
                <Icon name="copy" size={14} /> 复制结果
              </button>
              <button className="an-btn an-btn--sm an-btn--mint" onClick={handleReset}>
                <Icon name="refresh" size={14} /> 再次抽取
              </button>
              <button className="an-btn an-btn--sm an-btn--ghost" onClick={onClose}>
                返回
              </button>
            </div>
          </>
        )}
      </div>

      {wide && stageRail}
    </div>
  )
}
