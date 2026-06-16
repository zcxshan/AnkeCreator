// ============================================================
// 安科作者助手 - NGA 发帖代码导出器（节级）
//
// 把单节（section）的内容（HTML 字符串）转换为 NGA 论坛可直接
// 粘贴的 BBCode。沿用项目内置 [b]/[i]/[u]/[color]/[size]/[font]/
// [quote]/[collapse]/[img]/[list]/[url]/[sup]/[sub] 等标签。
// ============================================================

import type { Character, Section, Story, DiceConfig, DiceResult } from '../types';
import { htmlToNGABBCode } from './ngaHtmlToBBCode';

const DEFAULT_SECTION_SEPARATOR = '\n\n';

const DEFAULT_CHARACTER_COLORS = [
  'red',
  'blue',
  'green',
  'orange',
  'purple',
  'skyblue',
  'pink',
  'yellow',
];

/** 单个骰子 → NGA BBCode 折叠/引用块。
 *  - 数值骰子：始终 [b]标题ROLL 1dN=…[/b]
 *  - 选项骰子：
 *      options ≤ 10 → [quote]…[/quote] 包裹，首/末各一行 [b]…ROLL…[/b]，命中项 [b]…[/b]
 *      options >  10 → [collapse=标题ROLL 1dN=…]…[/collapse] 包裹，命中项 [b]…[/b]
 *  由 ngaHtmlToBBCode 在转换 dice-card 节点时调用。 */
export function renderDiceBlock(
  payload: { config: DiceConfig; lastResult: DiceResult | null },
  opts: { mark_hit?: boolean } = {},
): string {
  const cfg = payload.config;
  const last = payload.lastResult;
  const markHit = opts.mark_hit ?? true;
  const kind = cfg.kind || 'option';

  const name = (cfg.name || (kind === 'numeric' ? '数值骰' : '选项骰')).trim();

  if (kind === 'option') {
    const faces = Math.max(1, Math.floor(cfg.faces ?? 2));
    const optsArr = cfg.options || [];
    if (optsArr.length === 0) {
      return `[b]${name}（未配置选项）[/b]`;
    }
    // 按 value 升序
    const sorted = [...optsArr].sort(
      (a, b) => Math.min(...a.values) - Math.min(...b.values),
    );
    const value = last ? last.total : faces;
    const rollText = last ? `ROLL 1d${faces}=${value}` : `ROLL 1d${faces}=?`;
    const lines: string[] = [];
    // 首行：标题（不含 ROLL）
    lines.push(`[b]${name}[/b]`);
    sorted.forEach((opt) => {
      const lo = Math.min(...opt.values);
      const hi = Math.max(...opt.values);
      const isHit =
        markHit && last && last.total >= lo && last.total <= hi;
      // 直接输出选项文本，不加序号范围前缀
      lines.push(isHit ? `[b]${opt.content}[/b]` : opt.content);
    });
    // 末行：ROLL 1dN=命中值
    lines.push(`[b]${rollText}[/b]`);
    if (optsArr.length > 10) {
      return `[collapse=${name} ${rollText}]\n${lines.join('\n')}\n[/collapse]`;
    }
    return `[quote]\n${lines.join('\n')}\n[/quote]`;
  }

  // numeric：始终 [b]标题ROLL 表达式=…[/b]
  const total = last ? last.total : 0;

  if (cfg.expression) {
    // 表达式模式：使用 displayText 或简化格式
    const displayText = last?.displayText || `[${cfg.expression}=?]`;
    return `[b]${name}ROLL ${displayText.slice(1, -1)}[/b]`;
  }

  // 传统模式
  const count = Math.max(1, Math.floor(cfg.count ?? 1));
  const faces = Math.max(1, Math.floor(cfg.numericFaces ?? 100));
  const modifier = Math.floor(cfg.modifier ?? 0);
  const modStr = modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : `${modifier}`;
  const expr = `${count}d${faces}${modStr}`;
  // 用户示例是 1dN；我们按 1dN 输出最简形式
  return `[b]${name}ROLL ${expr}=${total}[/b]`;
}

/** 节级 NGA 导出选项 */
export interface SectionExportOptions {
  /** 是否把 {{角色名}} 替换为带颜色的 [color=xxx]角色名[/color] */
  mark_characters?: boolean;
  /** 是否在 BBCode 之前附加节标题行（默认 true） */
  include_title?: boolean;
  /** 角色列表（用于占位符染色；可空） */
  characters?: Character[];
}

export interface SectionExportResult {
  /** 单段完整 BBCode 代码 */
  code: string;
  /** 节标题 */
  title: string;
}

/**
 * 把单节内容导出为 NGA 发帖代码。
 *  - story: 当前 Story 实体（用于标题）
 *  - section: 当前节
 *  - opts:  导出选项
 */
export function exportSectionToNGA(
  story: Story | null | undefined,
  section: Section,
  opts: SectionExportOptions = {},
): SectionExportResult {
  const includeTitle = opts.include_title !== false;
  const markChars = opts.mark_characters !== false;
  const characters = opts.characters ?? [];

  const innerRaw = (section.content ?? '').trim();
  let body = innerRaw ? htmlToNGABBCode(innerRaw) : '';

  if (markChars && characters.length > 0 && body) {
    body = applyCharacterColorPlaceholders(body, characters);
  }

  const title = section.title || '未命名节';
  const titleLine = includeTitle
    ? `[size=130%][u]${title}[/u][/size]\n\n`
    : '';

  return {
    code: (titleLine + body).trim() + '\n',
    title,
  };
}

/**
 * 角色名占位符：{{角色名}}。
 * 实际编辑时占位符可能直接出现在文本里（用户从人物栏插入名字），
 * 也可能嵌入 BBCode 内部。本函数做"色标签包裹"：把 {{角色名}} 替换为
 * [color=xxx]角色名[/color]。
 */
const CHARACTER_PLACEHOLDER_RE = /\{\{([^{}]+?)\}\}/g;

function applyCharacterColorPlaceholders(
  text: string,
  characters: Character[],
): string {
  const nameToColor: Record<string, string> = {};
  characters.forEach((c, i) => {
    nameToColor[c.name] = DEFAULT_CHARACTER_COLORS[i % DEFAULT_CHARACTER_COLORS.length];
  });
  return text.replace(CHARACTER_PLACEHOLDER_RE, (_full, name: string) => {
    const trimmed = String(name || '').trim();
    const color = nameToColor[trimmed] ?? DEFAULT_CHARACTER_COLORS[0];
    return `[color=${color}]${trimmed}[/color]`;
  });
}

// ------------------------------------------------------------
// 反向解析：把 NGA 文本解析成最简化的 TextBlock 列表
//   （用于"已有稿子导入"的场景，可选功能）
// 只处理最常见的 [b]/[i]/[u]/[color]/[size]/[font]/[img]。
// ------------------------------------------------------------

import type { TextBlockPayload, TextStyles } from '../types';

export function parseNGATextToBlocks(input: string): TextBlockPayload[] {
  const blocks: TextBlockPayload[] = [];
  const segments = input.split(/\n\s*\n/);

  segments.forEach((seg) => {
    const { text, styles } = parseSegment(seg);
    const trimmed = text.trim();
    if (trimmed) blocks.push({ text: trimmed, styles });
  });

  return blocks;
}

function parseSegment(seg: string): { text: string; styles: TextStyles } {
  const styles: TextStyles = {};
  let s = seg;

  s = s.replace(/\[img\][\s\S]*?\[\/img\]/gi, '');
  s = s.replace(/\[collapse[^\]]*\]/gi, '').replace(/\[\/collapse\]/gi, '');
  s = s.replace(/\[quote[^\]]*\]/gi, '').replace(/\[\/quote\]/gi, '');

  const rules: Array<{ re: RegExp; apply: () => void }> = [
    { re: /\[b\]([\s\S]*)\[\/b\]/i, apply: () => (styles.bold = true) },
    { re: /\[i\]([\s\S]*)\[\/i\]/i, apply: () => (styles.italic = true) },
    { re: /\[u\]([\s\S]*)\[\/u\]/i, apply: () => (styles.underline = true) },
    {
      re: /\[color=([^\]]+)\]([\s\S]*)\[\/color\]/i,
      apply: () => {
        const m = s.match(/\[color=([^\]]+)\]/i);
        if (m) styles.color = m[1];
      },
    },
    {
      re: /\[size=(\d+)%\]([\s\S]*)\[\/size\]/i,
      apply: () => {
        const m = s.match(/\[size=(\d+)%\]/i);
        if (m) styles.size = parseInt(m[1], 10);
      },
    },
    {
      re: /\[font=([^\]]+)\]([\s\S]*)\[\/font\]/i,
      apply: () => {
        const m = s.match(/\[font=([^\]]+)\]/i);
        if (m) styles.font = m[1];
      },
    },
  ];

  rules.forEach((r) => {
    if (r.re.test(s)) {
      r.apply();
      s = s.replace(r.re, '$1$2');
    }
  });

  s = s.replace(/\[[^\]]+\]/g, '');
  return { text: s, styles };
}

// 注意：旧 exportStoryToNGA 已被 exportSectionToNGA 取代；此处不再导出旧函数。