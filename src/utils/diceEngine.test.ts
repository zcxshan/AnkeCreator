import { describe, expect, it } from 'vitest';
import { parseDiceExpression, rollExpression } from './diceEngine';

describe('diceEngine kh/kl 取高/取低', () => {
  it('4d6kh3 只保留最高 3 颗求和', () => {
    const r = rollExpression('4d6kh3');
    expect(r.allRolls).toHaveLength(4);
    // 期望 = 按降序取前 3 之和
    const expected = [...r.allRolls].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
    expect(r.total).toBe(expected);
    expect(r.detail).toContain(`k3=`);
  });

  it('4d6kl2 只保留最低 2 颗求和', () => {
    const r = rollExpression('4d6kl2');
    expect(r.allRolls).toHaveLength(4);
    // 期望 = 按升序取前 2 之和
    const expected = [...r.allRolls].sort((a, b) => a - b).slice(0, 2).reduce((a, b) => a + b, 0);
    expect(r.total).toBe(expected);
    expect(r.detail).toContain(`k2(低)=`);
  });

  it('1d100kh1 单骰等价于普通投掷', () => {
    const r = rollExpression('1d100kh1');
    expect(r.allRolls).toHaveLength(1);
    expect(r.total).toBe(r.allRolls[0]);
  });

  it('parseDiceExpression 预览保留 kh/kl 后缀', () => {
    expect(parseDiceExpression('1d100kh1').preview).toBe('1d100kh1');
    expect(parseDiceExpression('4d6kl2').preview).toBe('4d6kl2');
    expect(parseDiceExpression('1d20!').preview).toBe('1d20!');
    expect(parseDiceExpression('10d6>=5').preview).toBe('10d6>=5');
  });
});
