/**
 * bbcodeValidator 单元测试
 *
 * 覆盖：栈式标签匹配检查、未闭合标签、交叉闭合、多余闭合标签、
 * NGA 特殊语法（表情/collapse/img）跳过。
 */
import { describe, it, expect } from 'vitest';
import { validateBBCode } from './bbcodeValidator';

describe('validateBBCode - BBCode 语法校验', () => {
  it('[b]ok[/b] 返回 valid=true', () => {
    expect(validateBBCode('[b]ok[/b]')).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  it('[b]unclosed 返回未闭合的 [b] 标签错误', () => {
    const result = validateBBCode('[b]unclosed');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('未闭合的 [b] 标签');
  });

  it('[b][i]x[/b][/i] 返回交叉闭合错误', () => {
    const result = validateBBCode('[b][i]x[/b][/i]');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      '标签交叉闭合：[i] 在 [b] 内打开但在 [b] 闭合后才关闭',
    );
  });

  it('[/b] 返回多余的闭合标签错误', () => {
    const result = validateBBCode('[/b]');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('多余的闭合标签 [/b]');
  });

  it('[collapse=标题]内容[/collapse] 返回 valid=true', () => {
    expect(validateBBCode('[collapse=标题]内容[/collapse]')).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  it('[s:ac:哭笑] NGA 表情语法不校验，返回 valid=true', () => {
    expect(validateBBCode('[s:ac:哭笑]')).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  it('[img]url[/img] 返回 valid=true', () => {
    expect(validateBBCode('[img]url[/img]')).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
  });
});
