// ============================================================
// parseNgaAnjia - 解析 NGA 安价文本为选项数组（共享工具）
// ------------------------------------------------------------
// 支持两种 NGA 安价格式：
//   1) 简易格式（来自 AnjiaPage "复制 NGA 格式"）：
//        "1楼 用户A：选项一的内容\n2楼 用户B：选项二的内容"
//   2) BBCode 锚点格式（来自 NGA 帖子原文粘贴）：
//        [b]16楼 橘响弦[/b]
//        安价：克星血统 (...) [s:ac:哭笑]
//
//        [b]23楼 uid:67074399[/b]
//        安价：数据库
//        ...
// 解析结果：DiceNGAOption[]（displayValue 从 1 开始递增）
// ============================================================

export interface DiceNGAOption {
  displayValue: string;
  content: string;
  ok: boolean;
}

const SIMPLE_LINE_RE = /^(\d+)楼\s+([^：:]+)[：:]\s*(.+)$/;
const BOLD_ANCHOR_RE = /^\[b\]\s*(\d+)楼[^]*?\[\/b\]\s*$/i;
const ANJIA_PREFIX = /^安价[：:]\s*/i;
// BBCode 标签：[b]...[/b], [s:ac:哭笑], [img]...[/img], [url=...]...[/url]
const BBCODE_RE = /\[[^\]]+\]|\[\/[a-zA-Z][^\]]*\]/g;

/** 去除 BBCode 标签，但保留标签内文字（[b]xxx[/b] → xxx） */
function stripBBCode(s: string): string {
  // 先将成对标签的内部文字保留
  // 简化：直接移除所有 [xxx] 形式
  return s.replace(BBCODE_RE, '').trim();
}

/**
 * 解析 BBCode 锚点格式
 *  - 文本按 [b]N楼 ...[/b] 切分
 *  - 每段内：取第一行 "安价：xxx" 之后的内容，去除 BBCode 表情/标签
 */
function parseBBCodeAnchors(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (BOLD_ANCHOR_RE.test(line)) {
      if (current) blocks.push(current);
      current = [];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) blocks.push(current);
  // 每段：取安价：后的内容
  const out: string[] = [];
  for (const block of blocks) {
    let found = false;
    for (const ln of block) {
      if (ANJIA_PREFIX.test(ln)) {
        out.push(ln.replace(ANJIA_PREFIX, '').trim());
        found = true;
        break;
      }
    }
    if (!found && block.length > 0) {
      // 兜底：第一行作为 content
      out.push(block[0].trim());
    }
  }
  return out;
}

/**
 * 解析 NGA 安价文本，返回选项数组
 * 自动识别简易格式 / BBCode 锚点格式 / 混合
 */
export function parseNgaAnjia(text: string): DiceNGAOption[] {
  const t = (text || '').trim();
  if (!t) return [];

  // BBCode 锚点格式（必有 [b]N楼 标签）
  if (/\[b\]\s*\d+楼/i.test(t)) {
    const contents = parseBBCodeAnchors(t);
    return contents.map((c, i) => ({
      displayValue: String(i + 1),
      content: stripBBCode(c),
      ok: true,
    }));
  }

  // 简易格式：逐行匹配 "N楼 用户名：内容"
  const lines = t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.map((line, i) => {
    const m = line.match(SIMPLE_LINE_RE);
    if (m) {
      return { displayValue: String(i + 1), content: stripBBCode(m[3].trim()), ok: true };
    }
    return { displayValue: String(i + 1), content: stripBBCode(line), ok: true };
  });
}

/**
 * 把 DiceNGAOption[] 转换为 diceStore 草稿的 options 字段
 * - id 重新生成（避免冲突）
 * - values 数组包含 displayValue 转的 number
 * - 兼容 DiceConfigDialog 的 DiceOptionValue 形状（含 displayValue）
 */
export function toDiceOptions(
  options: DiceNGAOption[],
  idGen: () => string,
): { id: string; displayValue: string; content: string; values: number[] }[] {
  return options.map((o) => ({
    id: idGen(),
    displayValue: o.displayValue,
    content: o.content,
    values: [Number(o.displayValue) || 1],
  }));
}
