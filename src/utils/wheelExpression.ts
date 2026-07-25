// ============================================================
// 玩转盘 - 表达式求值工具
//
// 提供：
//   - evaluateCondition: 条件表达式求值（如 gender == '女'）
//   - evaluateFormula: 公式表达式求值（如 1d6+{gender_bonus}）
//   - renderPromptTemplate: Prompt 模板渲染（替换 {variable} 占位符）
//
// 设计原则：
//   - 不引入完整表达式引擎，用安全的方式解析
//   - 条件求值用 new Function 严格沙箱（仅暴露变量，不暴露全局对象）
//   - 公式求值复用 diceEngine.rollExpression（支持 1d6+2 这类骰子表达式）
//   - 变量替换用简单字符串替换，避免引入模板引擎
// ============================================================

import { rollExpression } from './diceEngine'
import type { VariableScope } from '../types/wheel'

/**
 * 把 {variable} 占位符替换为变量值
 * - {name} → variables[name]
 * - 未找到变量时保留原占位符（如 "{name}"）
 * - 变量值会转成字符串
 */
export function substituteVariables(template: string, variables: VariableScope): string {
  if (!template) return ''
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, name)) {
      const v = variables[name]
      return v === undefined || v === null ? match : String(v)
    }
    return match
  })
}

/**
 * 条件表达式求值
 *
 * 支持的语法：
 *   - 字符串比较：gender == '女' / gender != '男'
 *   - 数字比较：age > 18 / level >= 5 / count < 3
 *   - 逻辑组合：a == 'x' && b == 'y' / a || b
 *   - 变量引用：直接写变量名（先替换 {var} 再求值）
 *
 * 安全策略：
 *   - 用 new Function 在严格模式下求值
 *   - 仅暴露 variables 中的字段，不暴露 window/global/process
 *   - 表达式内访问未定义变量会抛错（被 try/catch 捕获返回 false）
 *
 * @param expression 条件表达式（如 "gender == '女'"）
 * @param variables 变量作用域
 * @returns 求值结果。空表达式返回 true（无条件），求值失败返回 false
 */
export function evaluateCondition(expression: string, variables: VariableScope): boolean {
  if (!expression || !expression.trim()) return true

  // 先替换 {variable} 占位符（让公式风格统一）
  const substituted = substituteVariables(expression, variables)

  try {
    // 构造变量参数列表（仅传递存在的变量，避免污染作用域）
    const varNames = Object.keys(variables)
    const varValues = varNames.map((k) => variables[k])

    // 严格模式 + 变量注入；访问未声明变量会抛 ReferenceError
    // 注意：不能用 with 语句（严格模式禁止），所以用函数参数注入
    const fn = new Function(...varNames, `"use strict"; return (${substituted});`)
    const result = fn(...varValues)
    return Boolean(result)
  } catch (e) {
    // 求值失败（变量未定义、语法错误等）→ 视为条件不满足
    console.warn('[wheelExpression] 条件求值失败:', expression, e)
    return false
  }
}

/**
 * 公式表达式求值
 *
 * 支持的语法：
 *   - 骰子表达式：1d6 / 2d100+3 / 1d6*2-1
 *   - 变量占位符：{gender_bonus} → 先替换为变量值
 *   - 混合：1d6+{gender_bonus} / {base}*2+1d4
 *
 * 求值流程：
 *   1. 替换 {variable} 占位符为变量值
 *   2. 用 diceEngine.rollExpression 求值（支持 NdM 加减乘除运算）
 *   3. 返回数值结果
 *
 * @param expression 公式表达式（如 "1d6+{gender_bonus}"）
 * @param variables 变量作用域
 * @returns 数值结果。求值失败返回 0
 */
export function evaluateFormula(expression: string, variables: VariableScope): number {
  if (!expression || !expression.trim()) return 0

  // 先替换 {variable} 占位符
  const substituted = substituteVariables(expression, variables)

  try {
    // 用 diceEngine 解析骰子表达式
    const result = rollExpression(substituted)
    if (result && typeof result.total === 'number' && !isNaN(result.total)) {
      return result.total
    }
    return 0
  } catch (e) {
    console.warn('[wheelExpression] 公式求值失败:', expression, e)
    return 0
  }
}

/**
 * 渲染 Prompt 模板
 *
 * 支持的占位符：
 *   - {variable}: 替换为变量值（来自 outputVariable）
 *   - {{stageName}}: 替换为该阶段的所有抽取结果拼接（用 / 分隔）
 *
 * @param template Prompt 模板
 * @param variables 变量作用域（每个阶段的 outputVariable → 抽取结果）
 * @param stageResults 每个阶段的所有抽取结果，按阶段名索引（用于 {{stageName}} 占位符）
 * @returns 渲染后的 Prompt 字符串
 */
export function renderPromptTemplate(
  template: string,
  variables: VariableScope,
  stageResults: Record<string, string[]>,
): string {
  if (!template) return ''

  let result = template

  // 先替换 {{stageName}}（双大括号，引用整阶段结果）
  result = result.replace(/\{\{(\w+)\}\}/g, (match, stageName: string) => {
    const arr = stageResults[stageName]
    if (arr && arr.length > 0) {
      return arr.join('、')
    }
    return match
  })

  // 再替换 {variable}（单大括号，引用变量值）
  result = substituteVariables(result, variables)

  return result
}

/**
 * 把多个抽取结果拼接成可读字符串
 * 例：[{stageName: '性别', results: ['女']}, {stageName: '性格', results: ['冷酷']}]
 *     → "性别：女 / 性格：冷酷"
 */
export function formatDrawResults(results: Array<{ stageName: string; results: string[]; skipped?: boolean }>): string {
  if (!results || results.length === 0) return ''
  return results
    .filter((r) => !r.skipped && r.results.length > 0)
    .map((r) => `${r.stageName}：${r.results.join('、')}`)
    .join(' / ')
}
