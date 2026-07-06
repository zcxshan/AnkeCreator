// ============================================================
// 骰子核心引擎
// ------------------------------------------------------------
// 负责：
//  - 数值骰子 / 选项骰子 的统一数据模型
//  - 解析用户输入（例如 "2d6+3"、"1d100"）
//  - 投掷与产生结果
//  - 选项骰子的值展开与命中判定
//  - 表达式模式：支持四则运算（如 "2*3d100+1d10-5"）
// ============================================================

import type { DiceKind, DiceOptionValue, DiceConfig, DiceResult } from '../types';

export type { DiceKind, DiceOptionValue, DiceConfig, DiceResult };

// -------------------- 表达式解析器 --------------------

/** 表达式 AST 节点类型 */
type DiceMode = 'kh' | 'kl' | '!' | 'pool';

type ExprNode =
  | { type: 'number'; value: number }
  | {
      type: 'dice';
      count: number;
      faces: number;
      /** 进阶模式：保留高/低、爆炸、骰池计数；undefined = 传统求和 */
      mode?: DiceMode;
      /** kh/kl 保留数量（默认 1） */
      keep?: number;
      /** pool 阈值（>=X） */
      threshold?: number;
    }
  | { type: 'binary'; op: '+' | '-' | '*' | '/'; left: ExprNode; right: ExprNode };

/** Token 类型 */
type Token =
  | { type: 'number'; value: number }
  | {
      type: 'dice';
      count: number;
      faces: number;
      mode?: DiceMode;
      keep?: number;
      threshold?: number;
    }
  | { type: 'op'; op: '+' | '-' | '*' | '/' }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'end' };

/**
 * 将表达式字符串转换为 Token 流
 * 支持：数字、NdM 骰子、运算符、括号
 */
function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  const normalized = expr.replace(/\s+/g, '').toLowerCase();
  let i = 0;

  while (i < normalized.length) {
    const ch = normalized[i];

    // 括号
    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }

    // 运算符
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', op: ch });
      i++;
      continue;
    }

    // 数字或骰子（NdM 格式）
    if (/\d/.test(ch)) {
      // 解析数字部分
      let numStr = '';
      while (i < normalized.length && /\d/.test(normalized[i])) {
        numStr += normalized[i];
        i++;
      }

      // 检查是否是骰子格式（后面跟着 d）
      if (i < normalized.length && normalized[i] === 'd') {
        i++; // 跳过 d
        let facesStr = '';
        while (i < normalized.length && /\d/.test(normalized[i])) {
          facesStr += normalized[i];
          i++;
        }
        const count = numStr === '' ? 1 : parseInt(numStr, 10);
        const faces = parseInt(facesStr, 10);
        if (!Number.isFinite(count) || !Number.isFinite(faces) || count < 1 || faces < 1) {
          throw new Error(`无效骰子格式: ${numStr}d${facesStr}`);
        }

        // 解析可选后缀：khX / klX / ! / >=X
        let mode: DiceMode | undefined;
        let keep: number | undefined;
        let threshold: number | undefined;
        if (i < normalized.length) {
          // kh/kl 后必须跟数字
          if ((normalized[i] === 'k' || normalized[i] === 'K') &&
              i + 1 < normalized.length &&
              (normalized[i + 1] === 'h' || normalized[i + 1] === 'H' ||
               normalized[i + 1] === 'l' || normalized[i + 1] === 'L')) {
            const hl = normalized[i + 1].toLowerCase();
            const kStart = i + 2;
            let kStr = '';
            let k = kStart;
            while (k < normalized.length && /\d/.test(normalized[k])) {
              kStr += normalized[k];
              k++;
            }
            if (kStr === '') throw new Error(`kh/kl 后必须指定保留数量：${numStr}d${facesStr}k${hl}`);
            mode = (hl === 'h' ? 'kh' : 'kl') as DiceMode;
            keep = parseInt(kStr, 10);
            if (keep < 1 || keep > count) {
              throw new Error(`kh/kl 保留数量 ${keep} 超出骰子数 ${count}`);
            }
            i = k;
          } else if (normalized[i] === '!') {
            mode = '!';
            i++;
            // 爆炸骰建议 count=1（多颗爆炸是高级用法，单独说明）
          } else if (normalized[i] === '>' && i + 1 < normalized.length && normalized[i + 1] === '=') {
            i += 2;
            let tStr = '';
            while (i < normalized.length && /\d/.test(normalized[i])) {
              tStr += normalized[i];
              i++;
            }
            if (tStr === '') throw new Error(`>= 后必须指定阈值：${numStr}d${facesStr}>=`);
            mode = 'pool';
            threshold = parseInt(tStr, 10);
            if (threshold < 1) throw new Error(`>= 阈值必须 >=1`);
          }
        }

        tokens.push({ type: 'dice', count, faces, mode, keep, threshold });
      } else {
        const value = parseInt(numStr, 10);
        if (!Number.isFinite(value)) {
          throw new Error(`无效数字: ${numStr}`);
        }
        tokens.push({ type: 'number', value });
      }
      continue;
    }

    // 未知字符
    throw new Error(`无法解析字符: ${ch} (位置 ${i})`);
  }

  tokens.push({ type: 'end' });
  return tokens;
}

/**
 * 递归下降解析器：解析 Token 流为 AST
 * 优先级：* / > + -
 */
function parseExpression(tokens: Token[]): ExprNode {
  let pos = 0;

  function peek(): Token {
    return tokens[pos];
  }

  function consume(): Token {
    return tokens[pos++];
  }

  // 解析加法和减法（最低优先级）
  function parseAddSub(): ExprNode {
    let left = parseMulDiv();

    while (peek().type === 'op' && (peek() as { type: 'op'; op: string }).op === '+' || (peek().type === 'op' && (peek() as { type: 'op'; op: string }).op === '-')) {
      const tok = consume();
      const op = (tok as { type: 'op'; op: '+' | '-' }).op;
      const right = parseMulDiv();
      left = { type: 'binary', op, left, right };
    }

    return left;
  }

  // 解析乘法和除法（较高优先级）
  function parseMulDiv(): ExprNode {
    let left = parsePrimary();

    while (peek().type === 'op' && ((peek() as { type: 'op'; op: string }).op === '*' || (peek() as { type: 'op'; op: string }).op === '/')) {
      const tok = consume();
      const op = (tok as { type: 'op'; op: '*' | '/' }).op;
      const right = parsePrimary();
      left = { type: 'binary', op, left, right };
    }

    return left;
  }

  // 解析基本单元：数字、骰子、括号表达式
  function parsePrimary(): ExprNode {
    const tok = peek();

    if (tok.type === 'number') {
      consume();
      return { type: 'number', value: tok.value };
    }

    if (tok.type === 'dice') {
      consume();
      return { type: 'dice', count: tok.count, faces: tok.faces };
    }

    if (tok.type === 'lparen') {
      consume(); // 吃掉 (
      const inner = parseAddSub();
      if (peek().type !== 'rparen') {
        throw new Error('缺少右括号');
      }
      consume(); // 吃掉 )
      return inner;
    }

    throw new Error(`意外的 token: ${JSON.stringify(tok)}`);
  }

  const ast = parseAddSub();
  if (peek().type !== 'end') {
    throw new Error(`表达式末尾有多余内容`);
  }
  return ast;
}

/**
 * 表达式求值结果
 */
interface EvalResult {
  total: number;
  /** 详细计算步骤文本 */
  detail: string;
  /** 所有骰子投掷结果 */
  allRolls: number[];
}

/**
 * 执行 AST 求值，投掷骰子并生成详细计算过程
 */
function evaluateAst(ast: ExprNode, originalExpr: string): EvalResult {
  const allRolls: number[] = [];

  function evalNode(node: ExprNode): { value: number; rollText: string; isMultiDice: boolean } {
    if (node.type === 'number') {
      return { value: node.value, rollText: String(node.value), isMultiDice: false };
    }

    if (node.type === 'dice') {
      const rolls: number[] = [];
      for (let i = 0; i < node.count; i++) {
        const r = rollOne(node.faces);
        rolls.push(r);
        allRolls.push(r);
      }

      // 默认（无 mode）：传统求和
      if (!node.mode) {
        const sum = rolls.reduce((a, b) => a + b, 0);
        const rollText = node.count === 1 ? String(sum) : rolls.join('+');
        return { value: sum, rollText, isMultiDice: node.count > 1 };
      }

      // kh：保留最高 X 颗求和
      if (node.mode === 'kh') {
        const keep = node.keep ?? 1;
        const sorted = [...rolls].sort((a, b) => b - a);
        const kept = sorted.slice(0, keep);
        const sum = kept.reduce((a, b) => a + b, 0);
        // rollText 形如 "[4,2,1,3]k3=4+2+3"
        const rollText = node.count === 1
          ? String(rolls[0])
          : `[${rolls.join(',')}]k${keep}=${kept.join('+')}`;
        return { value: sum, rollText, isMultiDice: true };
      }

      // kl：保留最低 X 颗求和
      if (node.mode === 'kl') {
        const keep = node.keep ?? 1;
        const sorted = [...rolls].sort((a, b) => a - b);
        const kept = sorted.slice(0, keep);
        const sum = kept.reduce((a, b) => a + b, 0);
        const rollText = node.count === 1
          ? String(rolls[0])
          : `[${rolls.join(',')}]k${keep}(低)=${kept.join('+')}`;
        return { value: sum, rollText, isMultiDice: true };
      }

      // ! 爆炸：单颗若掷出 faces 则追加 1 颗，递归直到非最大
      if (node.mode === '!') {
        const chain: number[] = [];
        for (const first of rolls) {
          chain.push(first);
          if (first === node.faces) {
            let cur = first;
            while (cur === node.faces) {
              cur = rollOne(node.faces);
              chain.push(cur);
              allRolls.push(cur);
            }
          }
        }
        const sum = chain.reduce((a, b) => a + b, 0);
        const rollText = node.count === 1
          ? `!${chain.length - 1}=${chain.join('+')}`
          : `[${rolls.join(',')}]!=${chain.join('+')}`;
        return { value: sum, rollText, isMultiDice: true };
      }

      // pool 骰池：统计 >= 阈值的颗数作为"成功次数"
      if (node.mode === 'pool') {
        const threshold = node.threshold ?? 1;
        const successes = rolls.filter((v) => v >= threshold).length;
        const rollText = `[${rolls.join(',')}]>=${threshold} → ${successes}次成功`;
        return { value: successes, rollText, isMultiDice: true };
      }

      // 兜底（不应该到达）
      const sum = rolls.reduce((a, b) => a + b, 0);
      return { value: sum, rollText: String(sum), isMultiDice: false };
    }

    if (node.type === 'binary') {
      const left = evalNode(node.left);
      const right = evalNode(node.right);
      let value: number;
      switch (node.op) {
        case '+': value = left.value + right.value; break;
        case '-': value = left.value - right.value; break;
        case '*': value = left.value * right.value; break;
        case '/': value = Math.floor(left.value / right.value); break;
      }
      // 构建展开文本：乘除法中多骰加括号
      let leftText = left.rollText;
      let rightText = right.rollText;
      if (node.op === '*' || node.op === '/') {
        // 乘除法中，如果操作数是加法表达式或多骰，加括号
        if (left.isMultiDice || (node.left.type === 'binary' && (node.left.op === '+' || node.left.op === '-'))) {
          leftText = `(${left.rollText})`;
        }
        if (right.isMultiDice || (node.right.type === 'binary' && (node.right.op === '+' || node.right.op === '-'))) {
          rightText = `(${right.rollText})`;
        }
      }
      const rollText = `${leftText}${node.op}${rightText}`;
      return { value, rollText, isMultiDice: false };
    }

    // 不应到达此处
    return { value: 0, rollText: '', isMultiDice: false };
  }

  const result = evalNode(ast);
  // displayText 格式：[表达式=展开=结果]
  const detail = `${originalExpr}=${result.rollText}=${result.value}`;
  return { total: result.value, detail, allRolls };
}

/**
 * 解析并验证表达式
 * 返回解析后的 AST 结构描述（用于 UI 预览）
 */
export function parseDiceExpression(expr: string): { ok: boolean; error?: string; preview?: string } {
  if (!expr || !expr.trim()) {
    return { ok: false, error: '表达式为空' };
  }
  try {
    const tokens = tokenize(expr);
    const ast = parseExpression(tokens);
    // 生成预览文本（不执行投掷，只显示结构）
    const preview = astPreview(ast);
    return { ok: true, preview };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '解析失败' };
  }
}

/** 生成 AST 结构预览（不投掷） */
function astPreview(node: ExprNode): string {
  if (node.type === 'number') return String(node.value);
  if (node.type === 'dice') {
    const base = `${node.count}d${node.faces}`;
    if (node.mode === 'kh') return `${base}kh${node.keep ?? 1}`;
    if (node.mode === 'kl') return `${base}kl${node.keep ?? 1}`;
    if (node.mode === '!') return `${base}!`;
    if (node.mode === 'pool') return `${base}>=${node.threshold ?? 1}`;
    return base;
  }
  if (node.type === 'binary') {
    const left = astPreview(node.left);
    const right = astPreview(node.right);
    // 添加括号保持优先级可见
    if (node.op === '*' || node.op === '/') {
      // 如果左右是加减表达式，加括号
      if (node.left.type === 'binary' && (node.left.op === '+' || node.left.op === '-')) {
        return `(${left})${node.op}${right}`;
      }
      if (node.right.type === 'binary' && (node.right.op === '+' || node.right.op === '-')) {
        return `${left}${node.op}(${right})`;
      }
    }
    return `${left}${node.op}${right}`;
  }
  return '?';
}

/**
 * 投掷表达式骰子
 */
export function rollExpression(expr: string): EvalResult {
  const tokens = tokenize(expr);
  const ast = parseExpression(tokens);
  return evaluateAst(ast, expr);
}

// -------------------- 工具函数 --------------------

const newId = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** 生成一个新的骰子配置 id */
export const createDiceId = newId;

/** 生成一个新的选项 id */
export const createOptionId = newId;

/**
 * 解析用户填写的"值表达式"：
 *   单个值："5"
 *   枚举值："2,4,6"（支持中英文逗号与空格）
 *   范围："1-3" 或 "7-9"
 *   混合："1, 3-5, 9"
 */
export function parseValueExpression(input: string): number[] {
  if (!input) return [];
  const tokens = input
    .replace(/[，\s]+/g, ',')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const set = new Set<number>();
  for (const tok of tokens) {
    const range = tok.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if (range) {
      const a = parseInt(range[1], 10);
      const b = parseInt(range[2], 10);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        for (let v = lo; v <= hi; v++) set.add(v);
      }
      continue;
    }
    const single = parseInt(tok, 10);
    if (Number.isFinite(single)) set.add(single);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * 将一组数字"压缩"回最紧凑的展示形式：
 *   [1,2,3,5,7,8]  -> "1-3,5,7-8"
 */
export function compressValuesToDisplay(values: number[]): string {
  if (!values || values.length === 0) return '';
  const sorted = [...values].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j === i) parts.push(String(sorted[i]));
    else if (j === i + 1) parts.push(`${sorted[i]},${sorted[j]}`);
    else parts.push(`${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return parts.join(',');
}

/**
 * 检查选项骰子：所有选项的值合起来是否完整覆盖 1..faces。
 * 返回 null 表示通过，否则返回描述性错误。
 */
export function validateOptionCoverage(
  options: DiceOptionValue[],
  faces: number,
): { ok: boolean; missing: number[]; overlaps: number[] } {
  const seen = new Map<number, number>();
  for (const opt of options) {
    for (const v of opt.values) seen.set(v, (seen.get(v) ?? 0) + 1);
  }
  const missing: number[] = [];
  for (let v = 1; v <= faces; v++) {
    if (!seen.has(v)) missing.push(v);
  }
  const overlaps: number[] = [];
  seen.forEach((count, v) => {
    if (count > 1) overlaps.push(v);
  });
  return {
    ok: missing.length === 0 && overlaps.length === 0,
    missing,
    overlaps,
  };
}

/**
 * 解析一个"NdM+K"格式的字符串。
 *   "1d100"    -> { count: 1, faces: 100, modifier: 0 }
 *   "3d6"      -> { count: 3, faces: 6, modifier: 0 }
 *   "2d10+5"   -> { count: 2, faces: 10, modifier: 5 }
 *   "d20-3"    -> { count: 1, faces: 20, modifier: -3 }
 * 解析失败返回 null。
 */
export function parseNumericExpression(
  input: string,
): { count: number; faces: number; modifier: number } | null {
  if (!input) return null;
  const normalized = input.replace(/\s+/g, '').toLowerCase();
  const m = normalized.match(/^(\d*)d(\d+)([+-]\d+)?$/);
  if (!m) return null;
  const count = m[1] === '' ? 1 : parseInt(m[1], 10);
  const faces = parseInt(m[2], 10);
  const modifier = m[3] ? parseInt(m[3], 10) : 0;
  if (!Number.isFinite(count) || !Number.isFinite(faces) || !Number.isFinite(modifier)) {
    return null;
  }
  if (count < 1 || faces < 1) return null;
  return { count, faces, modifier };
}

/** 数值骰子格式常量 */
export const NUMERIC_MAX_COUNT = 100;
export const NUMERIC_MAX_FACES = 9999999;

/** 把 {count, faces, modifier} 格式化为标准字符串，例如 "2d10+5"、"1d2" */
export function formatNumericExpression(
  count: number,
  faces: number,
  modifier: number,
): string {
  const mod = modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : `${modifier}`;
  return `${count}d${faces}${mod}`;
}

// -------------------- 投掷 --------------------

function rollOne(faces: number): number {
  const safeFaces = Math.max(1, Math.floor(faces));
  return Math.floor(Math.random() * safeFaces) + 1;
}

/** 投掷数值骰子 */
export function rollNumeric(config: DiceConfig): DiceResult {
  // 表达式模式
  if (config.expression) {
    const result = rollExpression(config.expression);
    const displayText = `[${result.detail}=${result.total}]`;
    return {
      configId: config.id,
      kind: 'numeric',
      rolls: result.allRolls,
      total: result.total,
      modifier: 0,
      displayText,
      timestamp: Date.now(),
    };
  }

  // 传统模式（向后兼容）
  const count = Math.max(1, Math.min(NUMERIC_MAX_COUNT, Math.floor(config.count ?? 1)));
  const faces = Math.max(1, Math.min(NUMERIC_MAX_FACES, Math.floor(config.numericFaces ?? 6)));
  const modifier = Math.floor(config.modifier ?? 0);
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(rollOne(faces));
  const sum = rolls.reduce((a, b) => a + b, 0) + modifier;

  // 展示文本：[D100=52] / [3D6=2+5+3=10] / [2D10+5=7+4+5=16]
  const head = `${count > 1 ? count : ''}D${faces}${modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : modifier}`;
  let tail: string;
  if (count === 1 && modifier === 0) {
    tail = `=${sum}`;
  } else {
    tail = `=${rolls.join('+')}${modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : modifier}=${sum}`;
  }
  const displayText = `[${head}${tail}]`;

  return {
    configId: config.id,
    kind: 'numeric',
    rolls,
    total: sum,
    modifier,
    displayText,
    timestamp: Date.now(),
  };
}

/** 投掷选项骰子 */
export function rollOption(config: DiceConfig): DiceResult {
  const faces = Math.max(1, Math.floor(config.faces ?? 2));
  const value = rollOne(faces);
  const opts = config.options ?? [];
  let hitOptionId: string | null = null;
  let hitOptionContent: string | null = null;
  for (const opt of opts) {
    if (opt.values.includes(value)) {
      hitOptionId = opt.id;
      hitOptionContent = opt.content;
      break;
    }
  }
  const displayText = `[1D${faces}=${value}]`;
  return {
    configId: config.id,
    kind: 'option',
    rolls: [value],
    total: value,
    modifier: 0,
    displayText,
    hitOptionId,
    hitOptionContent,
    timestamp: Date.now(),
  };
}

/** 根据配置类型自动选择投掷方式 */
export function rollDice(config: DiceConfig): DiceResult {
  return config.kind === 'numeric' ? rollNumeric(config) : rollOption(config);
}

// -------------------- 默认模板 --------------------

/** 生成一个默认的"是/否"选项骰子 */
export function createDefaultOptionDice(overrides: Partial<DiceConfig> = {}): DiceConfig {
  const id = createDiceId();
  return {
    id,
    kind: 'option',
    name: '',
    faces: 2,
    options: [
      { id: createOptionId(), displayValue: '1', values: [1], content: '否' },
      { id: createOptionId(), displayValue: '2', values: [2], content: '是' },
    ],
    ...overrides,
  };
}

/** 生成一个默认的数值骰子（1d100） */
export function createDefaultNumericDice(overrides: Partial<DiceConfig> = {}): DiceConfig {
  return {
    id: createDiceId(),
    kind: 'numeric',
    name: 'D100 检定',
    count: 1,
    numericFaces: 100,
    modifier: 0,
    ...overrides,
  };
}
