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
// ============================================================

export interface BBCodeValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// Tags that NGA treats as self-closing / void: they don't need a
// matching close tag and we ignore both their open and close forms.
const VOID_TAGS = new Set(['h', 'hr', 'br', '*']);

/**
 * Validate a BBCode string. Returns { valid, errors, warnings }.
 */
export function validateBBCode(
  bbcode: string,
): BBCodeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stack: string[] = [];
  // Tags that were force-closed as part of a cross-closing recovery.
  // Their eventual [/tag] is silently consumed to avoid duplicate
  // "extra closing tag" errors.
  const crossClosed: Set<string> = new Set();

  // Match [content] or [/content]. Content may include =attr.
  const tagRegex = /\[(\/?)([^\]]+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(bbcode)) !== null) {
    const isClosing = match[1] === '/';
    const raw = match[2];

    // NGA emoji syntax: [s:xxx:xxx]
    if (raw.startsWith('s:')) continue;

    // Tag name is the part before '=' (if any), lowercased.
    const tagName = raw.split('=')[0].toLowerCase();

    // Skip void / self-closing tags (both open and close forms).
    if (VOID_TAGS.has(tagName)) continue;

    if (isClosing) {
      // If this tag was force-closed during cross-closing recovery,
      // silently consume its close tag.
      if (crossClosed.has(tagName)) {
        crossClosed.delete(tagName);
        continue;
      }

      if (stack.length === 0) {
        errors.push(`多余的闭合标签 [/${tagName}]`);
        continue;
      }

      // Top of stack matches → normal close.
      if (stack[stack.length - 1] === tagName) {
        stack.pop();
        continue;
      }

      // Look for the tag deeper in the stack → cross-closing.
      const idx = stack.lastIndexOf(tagName);
      if (idx >= 0) {
        // Everything above idx is force-closed. popped[0] is the
        // matched tag itself; popped[1] is the innermost unclosed
        // tag that triggered the cross-close error.
        const popped = stack.splice(idx);
        for (let i = 1; i < popped.length; i++) {
          crossClosed.add(popped[i]);
        }
        const inner = popped[1] ?? popped[0];
        errors.push(
          `标签交叉闭合：[${inner}] 在 [${tagName}] 内打开但在 [${tagName}] 闭合后才关闭`,
        );
        continue;
      }

      // Tag not in the stack at all → extra closing tag.
      errors.push(`多余的闭合标签 [/${tagName}]`);
      continue;
    }

    // Opening tag.
    stack.push(tagName);
  }

  // Anything left on the stack is unclosed.
  for (const tag of stack) {
    errors.push(`未闭合的 [${tag}] 标签`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
