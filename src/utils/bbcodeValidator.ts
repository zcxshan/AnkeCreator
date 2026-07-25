// ============================================================
// BBCode syntax validator (stack-based tag matching).
//
// Checks:
//   - Every opening tag [tag] / [tag=attr] has a matching [/tag].
//   - No unclosed tags at end of input.
//   - No extra closing tags without a matching opener.
//   - No cross-closing (e.g. [b][i][/b][/i]).
//
// NGA special syntax is skipped (not validated):
//   - [s:xxx:xxx]  emoji
//   - [h] / [/h]   divider (self-closing in NGA)
//   - [*]          list item (self-closing in NGA)
//
// v35: errors 包含行号 (1-based)，用于编辑器点击跳转。
// ============================================================

export interface BBCodeError {
  message: string;
  line: number; // 1-based 行号
}

export interface BBCodeValidationResult {
  valid: boolean;
  errors: BBCodeError[];
  warnings: string[];
}

// Tags that NGA treats as self-closing / void: they don't need a
// matching close tag and we ignore both their open and close forms.
const VOID_TAGS = new Set(['h', 'hr', 'br', '*']);

// 已知的 NGA BBCode 标签白名单（与 ngaBBCodeToHtml.ts / ngaHtmlToBBCode.ts 保持一致）。
// 不在白名单内的 [xxx] 视为普通文本方括号，不参与开闭校验，
// 避免把 [文本] / [注意] 等正文方括号误报为未闭合标签。
const KNOWN_BB_TAGS = new Set<string>([
  'b', 'i', 'u', 'del', 's',
  'color', 'size', 'font', 'align',
  'sup', 'sub', 'url', 'img',
  'quote', 'collapse', 'code',
  'list', '*', 'table', 'tr', 'td', 'th',
  'h', 'hr', 'br',
]);

/**
 * 根据字符索引计算所在行号 (1-based)。
 * 用于在错误信息中提示用户出错位置。
 */
function getLineOfIndex(bbcode: string, index: number): number {
  let line = 1;
  const max = Math.min(index, bbcode.length);
  for (let i = 0; i < max; i++) {
    if (bbcode[i] === '\n') line++;
  }
  return line;
}

/**
 * Validate a BBCode string. Returns { valid, errors, warnings }.
 * v35: errors 为 BBCodeError[]，包含 message + line (1-based 行号)。
 */
export function validateBBCode(
  bbcode: string,
): BBCodeValidationResult {
  const errors: BBCodeError[] = [];
  const warnings: string[] = [];
  // 栈元素记录 tag 名和开标签起始位置（用于行号计算）
  const stack: Array<{ name: string; index: number }> = [];
  // Tags that were force-closed as part of a cross-closing recovery.
  // Their eventual [/tag] is silently consumed to avoid duplicate
  // "extra closing tag" errors.
  const crossClosed: Set<string> = new Set();

  // Match [content] or [/content]. Content may include =attr.
  const tagRegex = /\[(\/?)([^\]]+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(bbcode)) !== null) {
    const tagStart = match.index;
    const isClosing = match[1] === '/';
    const raw = match[2];

    // NGA emoji syntax: [s:xxx:xxx]
    if (raw.startsWith('s:')) continue;

    // Tag name is the part before '=' (if any), lowercased.
    const tagName = raw.split('=')[0].toLowerCase();

    // Skip void / self-closing tags (both open and close forms).
    if (VOID_TAGS.has(tagName)) continue;

    // 不在白名单内的标签视为普通文本方括号，跳过开闭校验。
    // 避免把 [文本] / [注意] 等正文方括号误报为未闭合/多余闭合标签。
    if (!KNOWN_BB_TAGS.has(tagName)) continue;

    if (isClosing) {
      // If this tag was force-closed during cross-closing recovery,
      // silently consume its close tag.
      if (crossClosed.has(tagName)) {
        crossClosed.delete(tagName);
        continue;
      }

      if (stack.length === 0) {
        errors.push({
          message: `多余的闭合标签 [/${tagName}]`,
          line: getLineOfIndex(bbcode, tagStart),
        });
        continue;
      }

      // Top of stack matches → normal close.
      if (stack[stack.length - 1].name === tagName) {
        stack.pop();
        continue;
      }

      // Look for the tag deeper in the stack → cross-closing.
      let idx = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === tagName) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) {
        // Everything above idx is force-closed. popped[0] is the
        // matched tag itself; popped[1] is the innermost unclosed
        // tag that triggered the cross-close error.
        const popped = stack.splice(idx);
        for (let i = 1; i < popped.length; i++) {
          crossClosed.add(popped[i].name);
        }
        const inner = popped[1] ?? popped[0];
        errors.push({
          message: `标签交叉闭合：[${inner.name}] 在 [${tagName}] 内打开但在 [${tagName}] 闭合后才关闭`,
          line: getLineOfIndex(bbcode, inner.index),
        });
        continue;
      }

      // Tag not in the stack at all → extra closing tag.
      errors.push({
        message: `多余的闭合标签 [/${tagName}]`,
        line: getLineOfIndex(bbcode, tagStart),
      });
      continue;
    }

    // Opening tag.
    stack.push({ name: tagName, index: tagStart });
  }

  // Anything left on the stack is unclosed.
  for (const s of stack) {
    errors.push({
      message: `未闭合的 [${s.name}] 标签`,
      line: getLineOfIndex(bbcode, s.index),
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
