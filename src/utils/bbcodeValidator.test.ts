/**
 * bbcodeValidator 单元测试
 *
 * 覆盖：栈式标签匹配检查、未闭合标签、交叉闭合、多余闭合标签、
 * NGA 特殊语法（表情/collapse/img）跳过。
 * v35: errors 改为 BBCodeError[] (含行号)，测试同步更新。
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

  it('[b]unclosed 返回未闭合的 [b] 标签错误，且含行号', () => {
    const result = validateBBCode('[b]unclosed');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message === '未闭合的 [b] 标签')).toBe(true);
    expect(result.errors.some(e => e.line >= 1)).toBe(true);
  });

  it('多行 BBCode 中未闭合标签行号正确', () => {
    const bbcode = 'line1\nline2\n[b]unclosed';
    const result = validateBBCode(bbcode);
    expect(result.valid).toBe(false);
    const err = result.errors.find(e => e.message === '未闭合的 [b] 标签');
    expect(err).toBeDefined();
    expect(err!.line).toBe(3); // [b] 在第 3 行
  });

  it('[b][i]x[/b][/i] 返回交叉闭合错误', () => {
    const result = validateBBCode('[b][i]x[/b][/i]');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message === '标签交叉闭合：[i] 在 [b] 内打开但在 [b] 闭合后才关闭')).toBe(true);
  });

  it('[/b] 返回多余的闭合标签错误', () => {
    const result = validateBBCode('[/b]');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message === '多余的闭合标签 [/b]')).toBe(true);
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

  it('多余闭合标签的行号正确', () => {
    const bbcode = '[b]ok[/b]\n[/i]';
    const result = validateBBCode(bbcode);
    expect(result.valid).toBe(false);
    const err = result.errors.find(e => e.message === '多余的闭合标签 [/i]');
    expect(err).toBeDefined();
    expect(err!.line).toBe(2); // [/i] 在第 2 行
  });
});

// =============================================================================
// v38: BBCode 标签白名单测试
// 不在白名单内的 [xxx] 视为普通文本方括号,不参与开闭校验
// =============================================================================

describe('v38: BBCode 标签白名单 - 非已知标签不校验', () => {
  it('[文本] 普通文本方括号不报错', () => {
    expect(validateBBCode('[文本]')).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  it('[注意] 普通文本方括号不报错', () => {
    expect(validateBBCode('[注意]')).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  it('[文本]内容[文本] 多个相同文本方括号不报错', () => {
    expect(validateBBCode('[文本]内容[文本]')).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  it('[自定义标签=属性] 带属性的未知标签不报错', () => {
    expect(validateBBCode('[自定义标签=属性]')).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  it('混合已知标签和文本方括号: [b][文本][/b] 返回 valid=true', () => {
    expect(validateBBCode('[b][文本][/b]')).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  it('混合已知标签和文本方括号: [文本][b]ok[/b][注意] 返回 valid=true', () => {
    expect(validateBBCode('[文本][b]ok[/b][注意]')).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  it('已知标签 [b] 未闭合仍报错', () => {
    const result = validateBBCode('[b]unclosed');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message === '未闭合的 [b] 标签')).toBe(true);
  });

  it('已知标签 [color=red] 未闭合仍报错', () => {
    const result = validateBBCode('[color=red]unclosed');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message === '未闭合的 [color] 标签')).toBe(true);
  });

  it('已知标签 [quote] 未闭合仍报错', () => {
    const result = validateBBCode('[quote]unclosed');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message === '未闭合的 [quote] 标签')).toBe(true);
  });

  it('未知标签的闭合标签也不报错: [/文本] 单独出现 valid=true', () => {
    expect(validateBBCode('[/文本]')).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  it('所有已知标签成对出现 valid=true', () => {
    const bbcode = '[b]b[/b][i]i[/i][u]u[/u][del]del[/del][s]s[/s]' +
      '[color=red]color[/color][size=120]size[/size][font=宋体]font[/font]' +
      '[align=center]align[/align][sup]sup[/sup][sub]sub[/sub]' +
      '[url=http://x]url[/url][img]img[/img]' +
      '[quote]quote[/quote][collapse=标题]collapse[/collapse][code]code[/code]' +
      '[list][*]item[/list][table][tr][td]cell[/td][/tr][/table]';
    const result = validateBBCode(bbcode);
    expect(result.valid).toBe(true);
  });
});
