// ============================================================
// 玩转盘 - 导入工具
//
// 校验导入的 JSON 是否为合法的 wheel-export bundle
// 剥离 data 包装，重新生成 id 和时间戳（导入时视为新方案）
// 与 storyImport 风格一致
// ============================================================

import type { WheelScheme, WheelExportBundle } from '../types/wheel'

const SUPPORTED_FORMATS = ['anke-creator-wheel-export']
const SUPPORTED_VERSIONS = ['1.0']

export interface ValidationResult {
  ok: boolean
  error?: string
  /** 校验通过时为解析后的 bundle，否则为 null */
  bundle?: WheelExportBundle
}

/**
 * 校验导入的 JSON 对象是否为合法的 wheel-export bundle
 *
 * 校验项：
 *   1. 顶层是对象
 *   2. format 字段为 'anke-creator-wheel-export'
 *   3. version 字段为 '1.0'
 *   4. data 字段是对象
 *   5. data.name 是非空字符串
 *   6. data.stages 是数组
 *
 * @param parsed 已 JSON.parse 的对象
 * @returns 校验结果
 */
export function validateWheelImport(parsed: any): ValidationResult {
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: '导入文件不是有效的 JSON 对象' }
  }

  if (!SUPPORTED_FORMATS.includes(parsed.format)) {
    return {
      ok: false,
      error: `不支持的格式：${parsed.format || '空'}（期望 ${SUPPORTED_FORMATS.join(' / ')}）`,
    }
  }

  if (!SUPPORTED_VERSIONS.includes(parsed.version)) {
    return {
      ok: false,
      error: `不支持的版本：${parsed.version || '空'}（期望 ${SUPPORTED_VERSIONS.join(' / ')}）`,
    }
  }

  if (!parsed.data || typeof parsed.data !== 'object') {
    return { ok: false, error: '导入文件缺少 data 字段或 data 不是对象' }
  }

  const scheme = parsed.data as WheelScheme
  if (typeof scheme.name !== 'string' || !scheme.name.trim()) {
    return { ok: false, error: '方案缺少有效的 name 字段' }
  }

  if (!Array.isArray(scheme.stages)) {
    return { ok: false, error: '方案缺少 stages 数组' }
  }

  // 校验每个阶段的必要字段
  for (let i = 0; i < scheme.stages.length; i++) {
    const stage = scheme.stages[i]
    if (!stage || typeof stage !== 'object') {
      return { ok: false, error: `第 ${i + 1} 个阶段不是有效对象` }
    }
    if (typeof stage.name !== 'string' || !stage.name.trim()) {
      return { ok: false, error: `第 ${i + 1} 个阶段缺少有效的 name 字段` }
    }
    if (!Array.isArray(stage.options)) {
      return { ok: false, error: `第 ${i + 1} 个阶段缺少 options 数组` }
    }
  }

  return { ok: true, bundle: parsed as WheelExportBundle }
}

/**
 * 把校验通过的 bundle 剥离成新的 WheelScheme
 *
 * 行为：
 *   - 重新生成 id（导入视为新方案，避免与已有方案冲突）
 *   - 重新生成 created_at / updated_at
 *   - 重新生成每个 stage 和 option 的 id（避免跨方案 id 重复）
 *   - 保留方案名、说明、阶段配置、Prompt 模板
 *
 * @param bundle 校验通过的 bundle
 * @returns 新的 WheelScheme（未持久化，需要调用 createScheme 写入）
 */
export function unwrapWheelImport(bundle: WheelExportBundle): WheelScheme {
  const src = bundle.data
  const now = new Date().toISOString()

  return {
    id: generateId(),
    name: src.name,
    description: src.description,
    stages: src.stages.map((stage) => ({
      id: generateId(),
      name: stage.name,
      options: stage.options.map((opt) => ({
        id: generateId(),
        text: opt.text,
        weight: typeof opt.weight === 'number' ? opt.weight : 1,
      })),
      drawCount: typeof stage.drawCount === 'number' ? stage.drawCount : 1,
      unique: Boolean(stage.unique),
      outputVariable: stage.outputVariable,
      condition: stage.condition,
      formula: stage.formula,
    })),
    promptTemplate: src.promptTemplate,
    created_at: now,
    updated_at: now,
  }
}

/**
 * 生成唯一 ID
 * 复用 diceEngine 的 newId 风格：随机串 + 时间戳
 */
function generateId(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36).slice(-4) +
    Math.random().toString(36).slice(2, 6)
  )
}
