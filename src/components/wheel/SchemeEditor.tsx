// ============================================================
// 玩转盘 - 方案编辑器
//
// 功能：
//   - 编辑方案名、说明、Prompt 模板
//   - 增删改阶段（name / options / drawCount / unique /
//     outputVariable / condition / formula）
//   - 增删改选项（text / weight）
//   - 保存 / 取消
//
// 设计：
//   - 受控组件：value=scheme, onChange=新方案
//   - 所有修改通过 onChange 通知父组件，由父组件决定何时保存
//   - 阶段和选项用 id 作为 key，便于排序
// ============================================================

import { useCallback, useMemo } from 'react'
import type { WheelScheme, WheelStage, WheelOption } from '../../types/wheel'

export interface SchemeEditorProps {
  /** 当前编辑的方案（已包含 id；新建时由父组件先生成空壳再传入） */
  scheme: WheelScheme
  /** 方案变更回调（每次修改都会触发，父组件可用于「保存」按钮启用状态） */
  onChange: (next: WheelScheme) => void
  /** 保存到磁盘 */
  onSave: () => void
  /** 取消编辑（不保存） */
  onCancel: () => void
  /** 是否正在保存 */
  saving?: boolean
}

/** 生成唯一 ID（与 wheelStore 风格一致） */
function genId(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36).slice(-4) +
    Math.random().toString(36).slice(2, 6)
  )
}

/** 创建一个空阶段 */
function createEmptyStage(name = '新阶段'): WheelStage {
  return {
    id: genId(),
    name,
    options: [
      { id: genId(), text: '选项1', weight: 1 },
      { id: genId(), text: '选项2', weight: 1 },
    ],
    drawCount: 1,
    unique: false,
  }
}

/** 创建一个空选项 */
function createEmptyOption(text = '新选项'): WheelOption {
  return { id: genId(), text, weight: 1 }
}

// ============================================================
// 子组件：选项行
// ============================================================
interface OptionRowProps {
  option: WheelOption
  index: number
  onChange: (next: WheelOption) => void
  onRemove: () => void
}

function OptionRow({ option, index, onChange, onRemove }: OptionRowProps) {
  return (
    <div
      className="flex items-center gap-2 py-1.5"
      style={{ borderBottom: '1px solid var(--border-color)' }}
    >
      <span
        className="shrink-0 w-6 text-xs text-center"
        style={{ color: 'var(--text-tertiary, #888)' }}
      >
        {index + 1}
      </span>
      <input
        type="text"
        value={option.text}
        onChange={(e) => onChange({ ...option, text: e.target.value })}
        placeholder="选项文本"
        className="flex-1 px-2 py-1 text-sm rounded"
        style={{
          background: 'var(--bg-base)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-color)',
        }}
      />
      <label
        className="shrink-0 flex items-center gap-1 text-xs"
        style={{ color: 'var(--text-secondary)' }}
        title="权重越大被抽中概率越高"
      >
        权重
        <input
          type="number"
          min={0}
          step={1}
          value={option.weight}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            onChange({ ...option, weight: isNaN(v) ? 0 : Math.max(0, v) })
          }}
          className="w-16 px-2 py-1 text-sm rounded"
          style={{
            background: 'var(--bg-base)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
          }}
        />
      </label>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 px-2 py-1 text-xs rounded transition-colors"
        style={{
          background: 'var(--bg-hover)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border-color)',
        }}
        title="删除选项"
      >
        ✕
      </button>
    </div>
  )
}

// ============================================================
// 子组件：阶段卡片
// ============================================================
interface StageCardProps {
  stage: WheelStage
  index: number
  total: number
  onChange: (next: WheelStage) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

function StageCard({
  stage,
  index,
  total,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: StageCardProps) {
  // 修改选项
  const updateOption = useCallback(
    (optId: string, next: WheelOption) => {
      onChange({
        ...stage,
        options: stage.options.map((o) => (o.id === optId ? next : o)),
      })
    },
    [stage, onChange],
  )

  const removeOption = useCallback(
    (optId: string) => {
      onChange({
        ...stage,
        options: stage.options.filter((o) => o.id !== optId),
      })
    },
    [stage, onChange],
  )

  const addOption = useCallback(() => {
    onChange({
      ...stage,
      options: [...stage.options, createEmptyOption(`选项${stage.options.length + 1}`)],
    })
  }, [stage, onChange])

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
      }}
    >
      {/* 阶段头部 */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="shrink-0 px-2 py-0.5 text-xs rounded-full"
          style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
        >
          阶段 {index + 1}
        </span>
        <input
          type="text"
          value={stage.name}
          onChange={(e) => onChange({ ...stage, name: e.target.value })}
          placeholder="阶段名（如：性别 / 性格 / 特长）"
          className="flex-1 px-2 py-1 text-sm font-medium rounded"
          style={{
            background: 'var(--bg-base)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
          }}
        />
        <button
          type="button"
          onClick={onMoveUp}
          disabled={index === 0}
          className="shrink-0 px-2 py-1 text-xs rounded transition-colors disabled:opacity-40"
          style={{
            background: 'var(--bg-hover)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-color)',
          }}
          title="上移阶段"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={index === total - 1}
          className="shrink-0 px-2 py-1 text-xs rounded transition-colors disabled:opacity-40"
          style={{
            background: 'var(--bg-hover)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-color)',
          }}
          title="下移阶段"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 px-2 py-1 text-xs rounded transition-colors"
          style={{
            background: 'var(--bg-hover)',
            color: '#ef4444',
            border: '1px solid var(--border-color)',
          }}
          title="删除阶段"
        >
          🗑
        </button>
      </div>

      {/* 基础配置 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3 text-xs">
        <label
          className="flex items-center gap-1"
          style={{ color: 'var(--text-secondary)' }}
          title="本阶段抽取多少个结果"
        >
          抽取次数
          <input
            type="number"
            min={1}
            step={1}
            value={stage.drawCount}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              onChange({ ...stage, drawCount: isNaN(v) ? 1 : Math.max(1, v) })
            }}
            className="w-16 px-2 py-1 rounded"
            style={{
              background: 'var(--bg-base)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
            }}
          />
        </label>
        <label
          className="flex items-center gap-1"
          style={{ color: 'var(--text-secondary)' }}
          title="开启后，本阶段多次抽取不会重复同一选项"
        >
          <input
            type="checkbox"
            checked={stage.unique}
            onChange={(e) => onChange({ ...stage, unique: e.target.checked })}
          />
          去重
        </label>
      </div>

      {/* 选项列表 */}
      <div className="mb-3">
        <div
          className="text-xs mb-1.5"
          style={{ color: 'var(--text-secondary)' }}
        >
          选项列表（共 {stage.options.length} 个）
        </div>
        <div>
          {stage.options.map((opt, i) => (
            <OptionRow
              key={opt.id}
              option={opt}
              index={i}
              onChange={(next) => updateOption(opt.id, next)}
              onRemove={() => removeOption(opt.id)}
            />
          ))}
          {stage.options.length === 0 && (
            <div
              className="py-3 text-center text-xs"
              style={{ color: 'var(--text-tertiary, #888)' }}
            >
              暂无选项，点击下方按钮添加
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={addOption}
          className="mt-2 px-3 py-1 text-xs rounded transition-colors"
          style={{
            background: 'var(--accent-bg)',
            color: 'var(--accent)',
            border: '1px solid var(--accent)',
          }}
        >
          + 添加选项
        </button>
      </div>

      {/* 进阶：变量与条件 */}
      <details className="mb-2">
        <summary
          className="cursor-pointer text-xs font-medium select-none"
          style={{ color: 'var(--text-secondary)' }}
        >
          进阶：变量与条件
        </summary>
        <div className="mt-2 space-y-2 pl-2">
          <label
            className="block text-xs"
            style={{ color: 'var(--text-secondary)' }}
          >
            输出变量名
            <input
              type="text"
              value={stage.outputVariable || ''}
              onChange={(e) =>
                onChange({ ...stage, outputVariable: e.target.value || undefined })
              }
              placeholder="如 gender（后续阶段可用 {gender} 引用）"
              className="mt-1 w-full px-2 py-1 text-sm rounded"
              style={{
                background: 'var(--bg-base)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
              }}
            />
          </label>
          <label
            className="block text-xs"
            style={{ color: 'var(--text-secondary)' }}
          >
            条件表达式（为 false 时跳过此阶段）
            <input
              type="text"
              value={stage.condition || ''}
              onChange={(e) =>
                onChange({ ...stage, condition: e.target.value || undefined })
              }
              placeholder="如 gender == '女'"
              className="mt-1 w-full px-2 py-1 text-sm rounded font-mono"
              style={{
                background: 'var(--bg-base)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
              }}
            />
          </label>
        </div>
      </details>

      {/* 高阶：公式 */}
      <details>
        <summary
          className="cursor-pointer text-xs font-medium select-none"
          style={{ color: 'var(--text-secondary)' }}
        >
          高阶：公式计算
        </summary>
        <div className="mt-2 pl-2">
          <label
            className="block text-xs"
            style={{ color: 'var(--text-secondary)' }}
          >
            公式表达式（结果作为额外选项加入抽取池）
            <input
              type="text"
              value={stage.formula || ''}
              onChange={(e) =>
                onChange({ ...stage, formula: e.target.value || undefined })
              }
              placeholder="如 1d6+{gender_bonus}（支持骰子表达式 + 变量占位符）"
              className="mt-1 w-full px-2 py-1 text-sm rounded font-mono"
              style={{
                background: 'var(--bg-base)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
              }}
            />
          </label>
        </div>
      </details>
    </div>
  )
}

// ============================================================
// 主组件
// ============================================================
export function SchemeEditor({
  scheme,
  onChange,
  onSave,
  onCancel,
  saving,
}: SchemeEditorProps) {
  // 修改方案基础字段
  const updateField = useCallback(
    <K extends keyof WheelScheme>(key: K, value: WheelScheme[K]) => {
      onChange({ ...scheme, [key]: value })
    },
    [scheme, onChange],
  )

  // 阶段操作
  const updateStage = useCallback(
    (stageId: string, next: WheelStage) => {
      onChange({
        ...scheme,
        stages: scheme.stages.map((s) => (s.id === stageId ? next : s)),
      })
    },
    [scheme, onChange],
  )

  const addStage = useCallback(() => {
    onChange({
      ...scheme,
      stages: [...scheme.stages, createEmptyStage(`阶段${scheme.stages.length + 1}`)],
    })
  }, [scheme, onChange])

  const removeStage = useCallback(
    (stageId: string) => {
      onChange({
        ...scheme,
        stages: scheme.stages.filter((s) => s.id !== stageId),
      })
    },
    [scheme, onChange],
  )

  const moveStage = useCallback(
    (index: number, direction: -1 | 1) => {
      const newStages = [...scheme.stages]
      const target = index + direction
      if (target < 0 || target >= newStages.length) return
      ;[newStages[index], newStages[target]] = [newStages[target], newStages[index]]
      onChange({ ...scheme, stages: newStages })
    },
    [scheme, onChange],
  )

  // 选项总数（用于状态显示）
  const totalOptions = useMemo(
    () => scheme.stages.reduce((sum, s) => sum + s.options.length, 0),
    [scheme.stages],
  )

  return (
    <div className="flex flex-col gap-4">
      {/* 顶部：方案基础信息 */}
      <div
        className="rounded-xl p-4"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
        }}
      >
        <label
          className="block text-sm font-medium mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          方案名
          <input
            type="text"
            value={scheme.name}
            onChange={(e) => updateField('name', e.target.value)}
            placeholder="如：角色生成器 / 剧情分支选择器"
            className="mt-1 w-full px-3 py-2 text-sm rounded"
            style={{
              background: 'var(--bg-base)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
            }}
          />
        </label>
        <label
          className="block text-sm mb-2"
          style={{ color: 'var(--text-secondary)' }}
        >
          方案说明（可选）
          <textarea
            value={scheme.description || ''}
            onChange={(e) => updateField('description', e.target.value || undefined)}
            placeholder="简单描述这个方案的用途"
            rows={2}
            className="mt-1 w-full px-3 py-2 text-sm rounded resize-none"
            style={{
              background: 'var(--bg-base)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
            }}
          />
        </label>
        <div
          className="text-xs"
          style={{ color: 'var(--text-tertiary, #888)' }}
        >
          共 {scheme.stages.length} 个阶段 · {totalOptions} 个选项
        </div>
      </div>

      {/* 阶段列表 */}
      <div className="flex flex-col gap-3">
        {scheme.stages.map((stage, idx) => (
          <StageCard
            key={stage.id}
            stage={stage}
            index={idx}
            total={scheme.stages.length}
            onChange={(next) => updateStage(stage.id, next)}
            onRemove={() => removeStage(stage.id)}
            onMoveUp={() => moveStage(idx, -1)}
            onMoveDown={() => moveStage(idx, 1)}
          />
        ))}
        {scheme.stages.length === 0 && (
          <div
            className="rounded-xl p-8 text-center"
            style={{
              background: 'var(--bg-card)',
              border: '2px dashed var(--border-color)',
              color: 'var(--text-secondary)',
            }}
          >
            <div className="text-3xl mb-2">🎡</div>
            <div className="text-sm">还没有阶段，点击下方按钮添加第一个阶段</div>
          </div>
        )}
        <button
          type="button"
          onClick={addStage}
          className="self-start px-4 py-2 text-sm rounded-lg transition-colors"
          style={{
            background: 'var(--accent-bg)',
            color: 'var(--accent)',
            border: '1px solid var(--accent)',
          }}
        >
          + 添加阶段
        </button>
      </div>

      {/* AI 协作：Prompt 模板 */}
      <details>
        <summary
          className="cursor-pointer text-sm font-medium select-none"
          style={{ color: 'var(--text-primary)' }}
        >
          AI 协作：Prompt 模板（可选）
        </summary>
        <div
          className="mt-2 rounded-xl p-4"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
          }}
        >
          <label
            className="block text-xs mb-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            Prompt 模板（抽取完成后用变量值替换占位符，生成可复制的 Prompt）
          </label>
          <textarea
            value={scheme.promptTemplate || ''}
            onChange={(e) => updateField('promptTemplate', e.target.value || undefined)}
            placeholder={
              '如：请生成一个{gender}性角色，性格是{personality}，特长是{{特长}}\n' +
              '（{variable} 引用变量值，{{stageName}} 引用整阶段结果）'
            }
            rows={4}
            className="w-full px-3 py-2 text-sm rounded resize-none font-mono"
            style={{
              background: 'var(--bg-base)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
            }}
          />
        </div>
      </details>

      {/* 底部操作栏 */}
      <div
        className="sticky bottom-0 flex items-center justify-end gap-3 py-3 px-4 -mx-4"
        style={{
          background: 'var(--bg-base)',
          borderTop: '1px solid var(--border-color)',
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-50"
          style={{
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
          }}
        >
          取消
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !scheme.name.trim()}
          className="px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-50"
          style={{
            background: 'var(--accent-bg)',
            color: 'var(--accent)',
            border: '1px solid var(--accent)',
          }}
        >
          {saving ? '保存中...' : '💾 保存方案'}
        </button>
      </div>
    </div>
  )
}
