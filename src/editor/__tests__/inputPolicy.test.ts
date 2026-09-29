import { describe, expect, it } from 'vitest';
import { isWhitespaceOnly } from '../../editor/inputPolicy';

describe('inputPolicy 空白输入豁免', () => {
  it('空格视为空白只,应放行不接管', () => {
    expect(isWhitespaceOnly(' ')).toBe(true);
  });
  it('多个空白字符也放行', () => {
    expect(isWhitespaceOnly('   ')).toBe(true);
  });
  it('普通文字应接管', () => {
    expect(isWhitespaceOnly('a')).toBe(false);
    expect(isWhitespaceOnly('abc')).toBe(false);
  });
  it('混合文字与空白视为可接管内容', () => {
    expect(isWhitespaceOnly('a ')).toBe(false);
  });
  it('空串不放行(由外层 !e.data 过滤)', () => {
    expect(isWhitespaceOnly('')).toBe(false);
  });
});
