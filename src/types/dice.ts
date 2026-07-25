// ============================================================
// 骰子相关类型
//
// - 老版本：DiceType / DiceOption / DiceBlockPayload（保留兼容）
// - 新版本：DiceKind / DiceOptionValue / DiceConfig / DiceResult / DiceBlockPayloadV2
// - 联合类型：DiceBlockPayloadUnion（兼容读老数据 + 写新数据）
// ============================================================

// --- 骰点块 ---

/** 老版本：与现有数据保持兼容（保留 read 能力） */
export type DiceType = '1d2' | '1d10' | '1d100';

/** 老版本选项结构，保留以兼容既有数据 */
export interface DiceOption {
  id: string;
  range_start: number;
  range_end: number;
  content: string;
}

/** 老版本 payload，保留以兼容既有数据 */
export interface DiceBlockPayload {
  dice_type: DiceType;
  last_roll: number | null;
  options: DiceOption[];
}

// ======= 新一代骰子系统：选项骰子 + 数值骰子 =======

/** 骰子的两种基本类别 */
export type DiceKind = 'option' | 'numeric';

/** 选项骰子中的单个选项（值表达式 + 展开后的值数组） */
export interface DiceOptionValue {
  id: string;
  displayValue: string;
  values: number[];
  content: string;
}

/** 骰子完整配置，统一描述选项骰子与数值骰子 */
export interface DiceConfig {
  id: string;
  kind: DiceKind;
  name: string;
  // 选项骰子
  faces?: number;
  options?: DiceOptionValue[];
  // 数值骰子
  count?: number;
  numericFaces?: number;
  modifier?: number;
  // 数值骰子表达式模式（如 "2*3d100+1d10-5"）
  expression?: string;
}

/** 投掷结果 */
export interface DiceResult {
  configId?: string;
  kind?: DiceKind;
  rolls: number[];
  total: number;
  modifier: number;
  displayText?: string;
  hitOptionId?: string | null;
  hitOptionContent?: string | null;
  timestamp: number;
}

/** 需求4:单个文本样式配置 */
export interface DiceTextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;       // CSS 颜色值
  fontFamily?: string;  // CSS font-family
  fontSize?: string;    // CSS font-size(如 '14px'、'12pt')
}

/** 需求4:骰子卡片样式配置(三类文本) */
export interface DiceStyleConfig {
  /** 骰子点数文本(投掷动画滚动数字 + 结果区表达式) */
  resultText?: DiceTextStyle;
  /** 被选中(命中)选项文本 */
  selectedOption?: DiceTextStyle;
  /** 未被选中选项文本 */
  unselectedOption?: DiceTextStyle;
}

/** 新一代骰点块 payload（用于替换旧的 DiceBlockPayload） */
export interface DiceBlockPayloadV2 {
  version: 2;
  config: DiceConfig;
  lastResult: DiceResult | null;
  /** 历史记录，最多保留若干条，方便回顾 */
  history?: DiceResult[];
  /** 需求4:骰子卡片样式配置(每个骰子单独配置) */
  style?: DiceStyleConfig;
}

/** 最终对外：DiceBlock 的 payload 可能是老版本或新版本 */
export type DiceBlockPayloadUnion = DiceBlockPayload | DiceBlockPayloadV2;
