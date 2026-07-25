// ============================================================
// 玩转盘功能 - 类型定义
//
// 参考：https://cnmeme.wiki/wheel/tutorial
// 功能范围：
//   - 基础+核心：单转盘 + 多阶段链式抽取 + 权重 + 抽取次数 + 去重 + 结果拼接 + 方案保存 + 导入导出 + 历史记录
//   - 进阶：变量与条件（前序阶段结果存为变量供后续使用）
//   - 高阶：公式计算（骰子表达式 + 变量混合）
//   - AI 协作：Prompt 占位符（抽取结果拼成 Prompt 复制到剪贴板）
// ============================================================

/**
 * 转盘选项
 */
export interface WheelOption {
  /** 唯一 ID（同一方案内唯一，前端用 crypto.randomUUID() 生成） */
  id: string
  /** 选项文本（如"男"/"女"/"冷酷"） */
  text: string
  /** 权重，默认 1，影响抽取概率。weight 越大被抽中概率越高 */
  weight: number
}

/**
 * 转盘阶段（一个方案可包含多个阶段，按顺序链式抽取）
 *
 * 多阶段示例：
 *   阶段1「性别」→ 选项[男,女] → 输出变量 gender
 *   阶段2「性格」→ 条件 gender=='女' 时才抽取 → 选项[温柔,冷酷]
 *   阶段3「特长」→ 公式 1d6+{gender_bonus} → 选项[剑术,魔法,...]
 */
export interface WheelStage {
  /** 唯一 ID */
  id: string
  /** 阶段名（如"主角"/"性别"/"性格"） */
  name: string
  /** 选项列表 */
  options: WheelOption[]
  /** 抽取次数，默认 1。>1 时本阶段抽取多个结果 */
  drawCount: number
  /** 是否去重，默认 false。true 时同一阶段内不重复抽取同一选项（drawCount>1 时有意义） */
  unique: boolean

  // -------- 进阶：变量与条件 --------

  /** 抽取结果存入此变量名（如"gender"），供后续阶段的条件/公式引用。不填则不存变量 */
  outputVariable?: string
  /**
   * 条件表达式（如"gender == '女'"），为 false 时跳过此阶段
   * 表达式语法见 wheelExpression.evaluateCondition
   * 不填则无条件执行
   */
  condition?: string

  // -------- 高阶：公式计算 --------

  /**
   * 公式表达式（如"1d6+{gender_bonus}"），结果作为额外选项加入抽取池
   * 支持 {variable} 占位符 + 骰子表达式（复用 diceEngine）
   * 不填则不加公式选项
   */
  formula?: string
}

/**
 * 转盘方案（顶层实体，一个方案 = 一套完整的转盘配置）
 */
export interface WheelScheme {
  /** 唯一 ID */
  id: string
  /** 方案名 */
  name: string
  /** 方案说明（可选） */
  description?: string
  /** 阶段列表，按顺序执行 */
  stages: WheelStage[]

  // -------- AI 协作：Prompt 模板 --------

  /**
   * Prompt 模板，支持 {variable} 占位符
   * 例："请生成一个{gender}性角色，性格是{personality}"
   * 抽取完成后用变量值替换占位符，生成最终 Prompt 复制到剪贴板
   * 不填则不生成 Prompt
   */
  promptTemplate?: string

  /** 创建时间（ISO 字符串） */
  created_at: string
  /** 最后更新时间（ISO 字符串） */
  updated_at: string
}

/**
 * 单次抽取结果（一个阶段的抽取结果）
 */
export interface DrawResult {
  /** 对应阶段的 ID */
  stageId: string
  /** 阶段名（冗余存储，方便历史记录展示） */
  stageName: string
  /** 抽取的选项文本列表（drawCount > 1 时多个） */
  results: string[]
  /** 该阶段结果存储到的变量名（如果有） */
  variableName?: string
  /** 该阶段结果对应的变量值（取 results[0] 或拼接结果） */
  variableValue?: string
  /** 是否因为条件为 false 而跳过 */
  skipped?: boolean
}

/**
 * 一次完整抽取的历史记录（所有阶段抽取完毕后产生一条）
 */
export interface DrawHistory {
  /** 唯一 ID */
  id: string
  /** 对应方案 ID */
  schemeId: string
  /** 方案名（冗余存储） */
  schemeName: string
  /** 各阶段的抽取结果 */
  results: DrawResult[]
  /** 拼接后的最终 Prompt（如果方案有 promptTemplate） */
  finalPrompt?: string
  /** 抽取时间（ISO 字符串） */
  drawnAt: string
}

// ============================================================
// 变量与条件求值
// ============================================================

/**
 * 变量作用域（变量名 → 变量值）
 * - 字符串变量：来自前序阶段的 outputVariable
 * - 数字变量：来自公式的求值结果
 */
export interface VariableScope {
  [name: string]: string | number
}

// ============================================================
// 导入导出格式
// ============================================================

/**
 * 导出文件格式（单方案导出）
 * 与 storyExport.ts 风格一致：包裹 format/version/exportedAt + data
 */
export interface WheelExportBundle {
  /** 格式标识，固定为 'anke-creator-wheel-export' */
  format: 'anke-creator-wheel-export'
  /** 版本号 */
  version: '1.0'
  /** 导出时间（ISO 字符串） */
  exportedAt: string
  /** 方案数据 */
  data: WheelScheme
}
